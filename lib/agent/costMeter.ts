/**
 * Session 18 — per-company API spend, measured from the API's own `usage`
 * blocks rather than estimated.
 *
 * Why this exists: files/coverage_signal_metrics_cost_limits.md §2 has
 * PLANNING estimates ("~$0.30–0.60 per 12-name run") with its own "treat as
 * estimates" caveat, and nothing anywhere measured the real figure. Before
 * this file, `usage` was read exactly once in the whole codebase — inside an
 * error string in sonnetEventBriefing.ts — and never aggregated or
 * persisted. So a full pass could not report its own spend, which is the
 * gap this closes. It does not replace §2; §2 is the budget, this is the
 * actual, and the two are worth comparing.
 *
 * Every one of the four `messages.create` call sites in the codebase feeds
 * this: claude.ts's classifyAllTriggers (Haiku) and classifyOneTrigger
 * (Haiku, per dig step), proceedsUse.ts (Sonnet), and
 * sonnetEventBriefing.ts (Sonnet, per card). All four token classes are
 * tracked separately — plain input, output, cache read, cache write — so
 * the breakdown stays honest if prompt caching is ever switched on. It is
 * NOT on today (no `cache_control` anywhere in the codebase), so the two
 * cache columns currently read zero by construction, not by accident.
 *
 * Scoping is a module-level accumulator rather than a threaded parameter,
 * which is safe here for one specific reason and would not be otherwise:
 * companies are processed STRICTLY SEQUENTIALLY (app/api/run/route.ts's
 * `for (const company of names)` awaits each run before the next begins).
 * If that ever becomes concurrent, this must become an explicitly passed
 * context — a shared mutable accumulator would silently misattribute spend
 * across companies, which is worse than not measuring it at all.
 */

/**
 * Published per-million-token rates. THESE CHANGE — the metrics doc says so
 * in its own §2, and a stale constant here produces confidently wrong
 * numbers, which is worse than none. Update alongside any model change.
 * Rates as used here: Haiku 4.5 $1/$5 per MTok in/out; Sonnet $3/$15.
 */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
};

/** Anthropic's standard cache multipliers against the model's own base INPUT rate: a 5-minute cache write costs 1.25x, a read 0.1x. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** The shape of an Anthropic `response.usage`, kept structural so this never depends on the SDK's exact exported type. Fields are optional because a response can legitimately omit the cache counters entirely when caching is off. */
export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface ModelSpend {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
}

export interface CompanySpend {
  company: string;
  /** Every model that billed anything during this company's run. */
  byModel: ModelSpend[];
  totalCalls: number;
  totalUsd: number;
  /** True when at least one call used a model with no entry in PRICING_PER_MTOK — its tokens are counted but its cost is NOT, so the total understates. Surfaced rather than silently absorbed. */
  hasUnpricedModel: boolean;
  unpricedModels: string[];
}

function emptySpend(company: string): { company: string; byModel: Map<string, ModelSpend>; unpriced: Set<string> } {
  return { company, byModel: new Map(), unpriced: new Set() };
}

let current = emptySpend("(no company scope)");

/** Starts a fresh scope. Called once per company at the top of runAgentLoop. */
export function beginCompanyCostScope(company: string): void {
  current = emptySpend(company);
}

/**
 * Records one API call's usage. Never throws and never blocks the pipeline:
 * a cost meter that can break an extraction is a worse trade than a cost
 * meter that occasionally under-reports, so an unknown model is counted in
 * tokens, flagged, and charged nothing rather than guessed at.
 */
export function recordUsage(model: string, usage: UsageLike | undefined | null): void {
  if (!usage) return;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;

  const price = PRICING_PER_MTOK[model];
  if (!price) current.unpriced.add(model);

  const usd = price
    ? (inputTokens * price.input +
        outputTokens * price.output +
        cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
        cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER) /
      1_000_000
    : 0;

  const existing = current.byModel.get(model) ?? {
    model,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0,
  };
  existing.calls += 1;
  existing.inputTokens += inputTokens;
  existing.outputTokens += outputTokens;
  existing.cacheReadTokens += cacheReadTokens;
  existing.cacheWriteTokens += cacheWriteTokens;
  existing.usd += usd;
  current.byModel.set(model, existing);
}

export function currentCompanySpend(): CompanySpend {
  const byModel = [...current.byModel.values()].sort((a, b) => b.usd - a.usd);
  return {
    company: current.company,
    byModel,
    totalCalls: byModel.reduce((n, m) => n + m.calls, 0),
    totalUsd: byModel.reduce((n, m) => n + m.usd, 0),
    hasUnpricedModel: current.unpriced.size > 0,
    unpricedModels: [...current.unpriced],
  };
}

export function formatUsd(usd: number): string {
  // Sub-cent figures are the norm for a cached company, so a plain 2-dp
  // format would render most real runs as "$0.00" and read as free.
  if (usd === 0) return "$0.0000";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/**
 * One-line summary for the run trace. States CALLS as well as dollars —
 * a company that hit the answer cache makes zero calls and costs zero, and
 * that must be legible as "cached", not as "free extraction".
 */
export function formatCompanyCostLine(spend: CompanySpend = currentCompanySpend()): string {
  if (spend.totalCalls === 0) return `  cost: ${formatUsd(0)} — 0 API calls (fully cached)`;
  const parts = spend.byModel.map(
    (m) =>
      `${m.model} ${m.calls}x in=${m.inputTokens.toLocaleString("en-US")} out=${m.outputTokens.toLocaleString("en-US")}` +
      (m.cacheReadTokens || m.cacheWriteTokens ? ` cacheR=${m.cacheReadTokens.toLocaleString("en-US")} cacheW=${m.cacheWriteTokens.toLocaleString("en-US")}` : "") +
      ` ${formatUsd(m.usd)}`
  );
  const warn = spend.hasUnpricedModel ? `  ⚠ UNPRICED MODEL(S): ${spend.unpricedModels.join(", ")} — tokens counted, cost NOT included, total understates` : "";
  return `  cost: ${formatUsd(spend.totalUsd)} across ${spend.totalCalls} API call(s) — ${parts.join("; ")}${warn}`;
}

/**
 * SESSION 20, STAGE 4 — A BACKGROUNDED RUN PERSISTS ITS OWN COST, OR RULE 13
 * CANNOT BE CHECKED AFTER THE FACT.
 *
 * The meter printed a per-company line into the run trace and stored nothing.
 * That is sufficient exactly as long as someone is watching the trace. The
 * Stage 4 run was moved to the background, its captured output was truncated
 * to the last few kilobytes, and eight of the ten per-company cost lines were
 * simply gone — so a run whose spend was pre-registered under Rule 13 could
 * not be reconciled against that registration at all, and the reported figure
 * had to be reconstructed from the two companies that happened to survive.
 *
 * A pre-registered cost that cannot be checked afterwards is not a control.
 * Every scope now appends a line to a JSONL file as it closes, so the record
 * outlives the terminal it was printed in.
 *
 * Append-only and best-effort: a cost meter must never be able to break an
 * extraction (see recordUsage), and that applies at least as much to a
 * filesystem write as to an unknown model price.
 */
const COST_LOG_PATH = process.env.COST_LOG_PATH ?? "baselines/cost-log.jsonl";

export function persistCompanySpend(spend: CompanySpend = currentCompanySpend(), at: Date = new Date()): void {
  try {
    // Required lazily so this module stays importable from any environment
    // that has no filesystem; the meter is not worth a hard dependency.
    const { appendFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { dirname } = require("node:path") as typeof import("node:path");
    mkdirSync(dirname(COST_LOG_PATH), { recursive: true });
    appendFileSync(
      COST_LOG_PATH,
      JSON.stringify({
        at: at.toISOString(),
        company: spend.company,
        totalUsd: Number(spend.totalUsd.toFixed(6)),
        totalCalls: spend.totalCalls,
        byModel: spend.byModel.map((m) => ({
          model: m.model, calls: m.calls, inputTokens: m.inputTokens, outputTokens: m.outputTokens,
          cacheReadTokens: m.cacheReadTokens, cacheWriteTokens: m.cacheWriteTokens, usd: Number(m.usd.toFixed(6)),
        })),
        unpricedModels: spend.unpricedModels,
      }) + "\n",
      "utf8"
    );
  } catch {
    // Deliberately silent. A run that cannot write its cost log is still a
    // valid run; the trace line above it is the fallback record.
  }
}
