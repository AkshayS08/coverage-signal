import Anthropic from "@anthropic-ai/sdk";
import type { CompanyPortfolio, EventRecord } from "./buildEvents";
import type { Bucket } from "./buckets";
import type { VerifiedFact } from "./factBase";
import { checkNumbersAgainstQuotes } from "./numberGuard";
import { isScrapeShapedText } from "./scrapeGuard";
import { BUCKET_LABELS } from "./buckets";
import { shortTriggerLabel } from "./labels";
import { failedPortfolioSummary, type DraftedPortfolioSummary } from "./portfolioSummary";

export type { DraftedPortfolioSummary } from "./portfolioSummary";
export { failedPortfolioSummary } from "./portfolioSummary";

// Deliberately NOT re-exported from lib/events/index.ts — same reason as
// sonnetEventBriefing.ts: pulls in the Anthropic SDK, must stay out of the
// client bundle. Server-only callers (app/api/run/route.ts) import it by
// direct path. The DraftedPortfolioSummary type/failedPortfolioSummary
// helper live in portfolioSummary.ts (no SDK import) and are re-exported
// here for convenience.

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 12000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Same "matures <year>" vs "~<N>mo out" distinction as buildEvents.ts's
 * (private) describeFreshness — a year-granularity fact (bare "due 2026",
 * no month disclosed) must never be handed to Sonnet as a computed month
 * count, or it has no way to know the difference between a real disclosed
 * duration and an internal worst-case-date convention.
 */
function timingPhrase(event: EventRecord): string {
  if (event.timing.monthsToNearestFuture !== null) {
    if (event.timing.dateGranularity === "year") {
      const year = event.triggers.find((t) => t.dateGranularity === "year")?.eventDate;
      return year ? `matures ${year}` : "future maturity (year known, month undisclosed)";
    }
    return `~${event.timing.monthsToNearestFuture}mo out`;
  }
  if (event.timing.isPendingLive) return "pending/live";
  return "standing";
}

export interface FactLine {
  text: string;
  bucket: Bucket;
  actionable: boolean;
  timingPhrase: string;
}

/**
 * The GATED FACTS ONLY input: one line per event that has at least one
 * quote-verified trigger (lib/agent/verifyQuote.ts + factBase.ts) — an
 * event with no verified trigger contributes nothing here, full stop, no
 * matter how it reads in the raw table. Never built from verifiedText or
 * raw filing prose (that's exactly the scrape-shaped-text risk Part C
 * guards against) — only the already-extracted figure/date tokens
 * (factBase.ts's figures[]/dates[]) and a precomputed timing phrase, so
 * Sonnet is reasoning over clean structured data, not quoted filing text.
 */
export function buildFactLines(portfolio: CompanyPortfolio, factBase: VerifiedFact[]): FactLine[] {
  const factByTrigger = new Map(factBase.map((f) => [f.linkedTriggerId, f]));
  const lines: FactLine[] = [];
  const buckets = Object.keys(portfolio.buckets) as Bucket[];
  for (const bucket of buckets) {
    for (const event of portfolio.buckets[bucket]) {
      const verifiedTriggers = event.triggers.filter((t) => factByTrigger.has(t.triggerId));
      if (verifiedTriggers.length === 0) continue;

      const figures = new Set<string>();
      const dates = new Set<string>();
      for (const t of verifiedTriggers) {
        const fact = factByTrigger.get(t.triggerId)!;
        fact.figures.forEach((f) => figures.add(f));
        fact.dates.forEach((d) => dates.add(d));
      }
      const labels = verifiedTriggers.map((t) => shortTriggerLabel(t.triggerId, t.triggerName)).join(" + ");
      const status = event.cardEligible ? "THIS WEEK (actionable now)" : "STANDING (not actionable this week)";
      const phrase = timingPhrase(event);
      const figuresStr = figures.size > 0 ? Array.from(figures).join(", ") : "none";
      const datesStr = dates.size > 0 ? Array.from(dates).join(", ") : "none";
      lines.push({
        text: `- [${BUCKET_LABELS[bucket]}] ${labels} — ${status} — timing (use verbatim, never recompute): "${phrase}" — figures: ${figuresStr} — dates: ${datesStr}`,
        bucket,
        actionable: event.cardEligible,
        timingPhrase: phrase,
      });
    }
  }
  return lines;
}

const SYSTEM_PROMPT = `You write the 2-4 sentence summary of ONE company's row in a bank relationship manager's (RM) portfolio table — the fuller "state of the company" read below the flash cards, not a repeat of any card's own text.

You will be given a list of GATED FACTS — the entire factual universe you may draw from. Each fact line states: its bucket, which trigger(s) it is, whether it is THIS WEEK (card-eligible, actionable now) or STANDING (background, not actionable this week), a timing phrase, and its verified figures/dates. There is no other source of truth — no raw filing text, no outside knowledge.

Hard rules, each of which is checked mechanically after you write:
1. HEDGING: if any fact line's bucket is "FX / rate hedging" and marked STANDING, your summary MUST explicitly name it as a hedging opportunity worth raising — this is the one standing condition that must never get lost in the table, precisely because it never triggers a card of its own.
2. DO NOT CONTRADICT THE GATE: if no fact line is THIS WEEK, say plainly that there is nothing actionable this week — never manufacture urgency, never describe a STANDING-only fact as a reason to call now, never use words like "call now," "urgent," or "immediately" when nothing is THIS WEEK.
3. NO INVENTED FIGURES: state only figures and dates that appear, verbatim, in the fact lines given. Nothing computed, nothing rounded differently, nothing from outside knowledge.
4. RESPECT TIMING PHRASES EXACTLY: each fact line gives you its own timing phrase already computed — copy it verbatim or paraphrase only its wording, never its meaning. A fact whose phrase is "matures 2026" must never be described with a computed month count like "~5mo out" — that precision does not exist in the filing. Never compute a relative duration yourself.
5. SHAPE: exactly 2 to 4 sentences, plain prose a banker would say out loud. No semicolons. No bulleted or listed clauses inside a sentence.

If the fact list is empty, write exactly: "No verified activity to report this week." and nothing else.`;

const SUMMARY_TOOL = {
  name: "submit_portfolio_summary",
  description: "Submit the company's portfolio-table summary.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "2 to 4 sentences of plain prose, no semicolons, following every hard rule given in the system prompt.",
      },
    },
    required: ["summary"],
  },
};

function buildContext(portfolio: CompanyPortfolio, factLines: FactLine[]): string {
  const lines = [`Company: ${portfolio.company}`, ``];
  if (factLines.length === 0) {
    lines.push(`GATED FACTS: (none — nothing verified for this company)`);
  } else {
    lines.push(`GATED FACTS:`, ...factLines.map((f) => f.text));
  }
  return lines.join("\n");
}

async function callSonnet(portfolio: CompanyPortfolio, factLines: FactLine[], correctionNote?: string): Promise<string> {
  const context = buildContext(portfolio, factLines);
  const userContent = correctionNote ? `${context}\n\n${correctionNote}` : context;

  const response = await getClient().messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 400,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      tools: [SUMMARY_TOOL],
      tool_choice: { type: "tool", name: SUMMARY_TOOL.name },
    },
    { timeout: TIMEOUT_MS }
  );

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Sonnet did not return a submit_portfolio_summary tool call (stop_reason: ${response.stop_reason})`);
  }
  const input = toolUse.input as { summary?: string };
  if (!input.summary || !input.summary.trim()) {
    throw new Error(`malformed portfolio summary response (stop_reason: ${response.stop_reason}): ${JSON.stringify(input)}`);
  }
  return input.summary.trim();
}

const URGENT_PHRASE_RE = /\b(call (now|this week|today)|reach out (now|this week|today)|should call|worth calling now|immediate(ly)?|urgent(ly)?|act now)\b/i;

/** Constraint 2: no fact is THIS WEEK, but the prose still reads as a call to action. */
function violatesGateContract(summary: string, anyActionable: boolean): boolean {
  if (anyActionable) return false;
  return URGENT_PHRASE_RE.test(summary);
}

const RELATIVE_DURATION_RE = /~?\s?\d+\s?(?:mo|months?)\b/gi;

/** Constraint 4: any relative-month phrase in the output must be one of the genuine timing phrases we handed in — never a duration Sonnet computed itself. */
function violatesDateGranularity(summary: string, factLines: FactLine[]): boolean {
  const found = summary.match(RELATIVE_DURATION_RE) ?? [];
  if (found.length === 0) return false;
  const allowed = factLines.map((f) => f.timingPhrase);
  return found.some((f) => !allowed.some((phrase) => phrase.includes(f.trim())));
}

/** Constraint 1: a standing hedging fact exists but the summary never names hedging. */
function violatesHedgingSurfacing(summary: string, factLines: FactLine[]): boolean {
  const hasStandingHedging = factLines.some((f) => f.bucket === "hedging" && !f.actionable);
  if (!hasStandingHedging) return false;
  return !/hedg/i.test(summary);
}

/**
 * Constraint 5: 2-4 sentences, no semicolons. Exactly one case is exempt
 * from the 2-sentence MINIMUM: when there are no gated facts at all, the
 * system prompt's fixed one-sentence "No verified activity to report this
 * week." is correct and complete — padding it to a second sentence would
 * mean inventing filler just to satisfy a shape rule, which is worse than
 * the rule. The max (4) and the no-semicolon rule still apply always.
 */
function violatesShape(summary: string, allowSingleSentence: boolean): boolean {
  if (summary.includes(";")) return true;
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const minSentences = allowSingleSentence ? 1 : 2;
  return sentences.length < minSentences || sentences.length > 4;
}

export interface SummaryGuardResult {
  ok: boolean;
  reasons: string[];
}

/** All five constraints, checked mechanically — exported for direct testing at zero API cost. */
export function checkSummaryConstraints(summary: string, factLines: FactLine[]): SummaryGuardResult {
  const anyActionable = factLines.some((f) => f.actionable);
  const tokenCorpus = factLines.map((f) => f.text).join(" \n ");
  const numberGuard = checkNumbersAgainstQuotes(summary, [tokenCorpus]);

  const reasons: string[] = [];
  if (!numberGuard.ok) reasons.push(`unverified figures/dates: ${numberGuard.unverifiedTokens.join(", ")}`);
  if (isScrapeShapedText(summary)) reasons.push("scrape-shaped text (numbers/labels with no sentence structure)");
  if (violatesGateContract(summary, anyActionable)) reasons.push("contradicts the card gate (urgency language with nothing THIS WEEK)");
  if (violatesDateGranularity(summary, factLines)) reasons.push("stated a relative duration not present in the given timing phrases");
  if (violatesHedgingSurfacing(summary, factLines)) reasons.push("standing hedging exposure exists but was not surfaced");
  if (violatesShape(summary, factLines.length === 0)) reasons.push("not 2-4 plain-prose sentences (1 allowed only when there are no gated facts), or contains a semicolon");

  return { ok: reasons.length === 0, reasons };
}

/**
 * Drafts the portfolio table's per-company summary from the GATED FACT SET
 * ONLY — never raw filing text, never a verifiedQuote. `factBase` must be
 * this company's own buildVerifiedFactBase() output (the caller already
 * has it, since draftEventBriefing needs the same thing). A first miss on
 * any of the five mechanical constraints gets one corrective retry; a
 * second miss is a loud failure (see failedPortfolioSummary), never a
 * silent template line. When the fact list is empty, still calls Sonnet
 * once (the system prompt's fixed no-activity line) rather than
 * special-casing it in code, so the "nothing to report" phrasing stays
 * centrally defined.
 */
export async function draftPortfolioSummary(portfolio: CompanyPortfolio, factBase: VerifiedFact[]): Promise<DraftedPortfolioSummary> {
  const factLines = buildFactLines(portfolio, factBase);

  try {
    let summary = await callSonnet(portfolio, factLines);
    let guard = checkSummaryConstraints(summary, factLines);

    if (!guard.ok) {
      console.warn(`[portfolioSummary] ${portfolio.company} failed constraints, retrying once:`, guard.reasons);
      summary = await callSonnet(
        portfolio,
        factLines,
        `Your previous attempt violated: ${guard.reasons.join("; ")}. Rewrite the summary so it satisfies every hard rule.`
      );
      guard = checkSummaryConstraints(summary, factLines);
    }

    if (!guard.ok) {
      return failedPortfolioSummary(portfolio.company, `still failed constraints after retry: ${guard.reasons.join("; ")}`);
    }

    return { summary, source: "sonnet" };
  } catch (err) {
    return failedPortfolioSummary(portfolio.company, err instanceof Error ? err.message : String(err));
  }
}
