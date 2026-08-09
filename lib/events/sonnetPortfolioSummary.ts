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

/** The month count backing timingPhrase's "~Nmo out" form — null for year-granularity (no real month precision exists), standing, or pending facts. See FactLine.monthsValue. */
function timingMonthsValue(event: EventRecord): number | null {
  if (event.timing.dateGranularity === "year") return null;
  return event.timing.monthsToNearestFuture;
}

export interface FactLine {
  text: string;
  bucket: Bucket;
  actionable: boolean;
  timingPhrase: string;
  /** The event's own computed month count, when its timing phrase actually states one ("~9mo out" -> 9) — null for a year-granularity fact (no real month precision exists to check a duration against), a standing/pending fact, or one with no future date at all. The ONLY ground truth constraint 4 compares Sonnet's stated durations against; the phrase string itself is for display only. */
  monthsValue: number | null;
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
/**
 * A bare "$" + comma-grouped digit string ("$1,500,000,000") is unambiguous
 * — unlike a table's unit-less bare number, it already carries its own
 * exact value, so this needs no scale DECLARATION lookup, just formatting.
 * Converts it to the same word-scaled form ("$1.5 billion") every other
 * figure in the fact set already uses, so two figures never appear
 * side by side in two different conventions ("$1,500,000,000" next to
 * "$750 million"). Anything else (already word-scaled, a percent, a bare
 * date) is returned unchanged.
 */
function toReadableScale(value: string): string {
  const m = value.match(/^\$\s*([\d,]+(?:\.\d+)?)$/);
  if (!m) return value;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num < 1000) return value;
  const [divisor, unit] =
    num >= 1_000_000_000 ? [1_000_000_000, "billion"] : num >= 1_000_000 ? [1_000_000, "million"] : [1_000, "thousand"];
  const scaled = (num / divisor).toFixed(2).replace(/\.?0+$/, "");
  return `$${scaled} ${unit}`;
}

/**
 * GATED FACTS ONLY, one line per verified trigger — never a merged cluster
 * dump. Each line carries exactly ONE labeled, dated value, never a bare
 * list: earlier versions unioned every figure across a cluster's triggers
 * into one comma-joined blob, which (a) let an unrelated adjacent line
 * item the extraction window happened to sweep in (e.g. "Accounts
 * receivable" next to a "large cash balance" fact) get stated as if part
 * of the same fact, and (b) mixed formatting conventions ("$1,500,000,000"
 * next to "$750 million") depending on how each filing's own prose
 * happened to state it. Fixed by taking only the fact's own FIRST
 * extracted figure — SEC filings state the current period before any
 * prior-period comparative, so this is the fact's most recent value — and
 * scale-normalizing it before the model ever sees it.
 */
export function buildFactLines(portfolio: CompanyPortfolio, factBase: VerifiedFact[]): FactLine[] {
  const factByTrigger = new Map(factBase.map((f) => [f.linkedTriggerId, f]));
  const lines: FactLine[] = [];
  const buckets = Object.keys(portfolio.buckets) as Bucket[];
  for (const bucket of buckets) {
    for (const event of portfolio.buckets[bucket]) {
      const status = event.cardEligible ? "THIS WEEK (actionable now)" : "STANDING (not actionable this week)";
      const phrase = timingPhrase(event);
      const monthsValue = timingMonthsValue(event);
      for (const t of event.triggers) {
        const fact = factByTrigger.get(t.triggerId);
        if (!fact) continue; // not quote-verified — never described, never implied
        const label = shortTriggerLabel(t.triggerId, t.triggerName);
        const value = fact.figures.length > 0 ? toReadableScale(fact.figures[0]) : "no figure disclosed";
        const asOf = fact.sourceFiling ? `as of ${fact.sourceFiling.form} filed ${fact.sourceFiling.date}` : "date unstated";
        lines.push({
          text: `- [${BUCKET_LABELS[bucket]}] ${label} — ${status} — timing (use verbatim, never recompute): "${phrase}" — value: ${value} (${asOf})`,
          bucket,
          actionable: event.cardEligible,
          timingPhrase: phrase,
          monthsValue,
        });
      }
    }
  }
  return lines;
}

const SYSTEM_PROMPT = `You write the 2-4 sentence summary of ONE company's row in a bank relationship manager's (RM) portfolio table — the fuller "state of the company" read below the flash cards, not a repeat of any card's own text.

You will be given a list of GATED FACTS — the entire factual universe you may draw from. Each fact line states: its bucket, which trigger it is, whether it is THIS WEEK (card-eligible, actionable now) or STANDING (background, not actionable this week), a timing phrase, and ONE dated value (its most recent figure, or "no figure disclosed"). There is no other source of truth — no raw filing text, no outside knowledge.

Hard rules, each of which is checked mechanically after you write:
1. HEDGING: if any fact line's bucket is "FX / rate hedging" and marked STANDING, your summary MUST explicitly name it as a hedging opportunity worth raising — this is the one standing condition that must never get lost in the table, precisely because it never triggers a card of its own.
2. DO NOT CONTRADICT THE GATE: if no fact line is THIS WEEK, say plainly that there is nothing actionable this week — never manufacture urgency, never describe a STANDING-only fact as a reason to call now, never use words like "call now," "urgent," or "immediately" when nothing is THIS WEEK.
3. NO INVENTED FIGURES: state only figures and dates that appear, verbatim, in the fact lines given. Nothing computed, nothing rounded differently, nothing from outside knowledge.
4. RESPECT TIMING VALUES: each fact line gives you its own timing phrase already computed — you may rephrase the wording (e.g. "~15mo out" as "about 15 months out") but never the VALUE. A fact whose phrase is "matures 2026" has no month-level precision at all and must never be given a computed month count like "~5mo out" — that precision does not exist in the filing. Never compute a relative duration yourself, for any fact.
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

/**
 * "Nothing/no ... actionable ... this week" — the exact framing the
 * system prompt's rule 2 instructs, and what Sonnet has consistently
 * produced across every real run observed. Also accepts the system
 * prompt's OTHER fixed phrasing for the empty-fact-list case ("No
 * verified activity to report this week") — that sentence never uses the
 * word "actionable" at all.
 */
const NO_ACTION_STATEMENT_RE =
  /\b(?:nothing|no)\b[^.!?]{0,50}\b(?:actionable|activity to report)\b[^.!?]{0,30}\bthis week\b/i;

/** An imperative/directive verb tied to a "now/today/this week" timeframe — the shape of "call them this week about the maturity", not the mere presence of a word like "urgent" or "immediate". */
const ACTION_DIRECTIVE_RE = /\b(call|reach out|follow up|act)\b[^.!?]{0,30}\b(now|today|this week)\b/i;

/** A negation anywhere in the same sentence as a would-be directive cancels it — "there is no urgent call to make" and "has not triggered any immediate action" are claims of INaction, not action. */
const NEGATION_RE = /\b(no|not|n't|never|nothing|without)\b/i;

/**
 * Constraint 2, checked against the gate's actual verdict (anyActionable),
 * not against vocabulary. The previous version (a banned-phrase regex —
 * "urgent," "immediate," "call now") flagged NEGATED uses of those exact
 * words — "there is no urgent call to make right now," "has not triggered
 * any immediate action" — even though both sentences correctly say the
 * OPPOSITE of what they were flagged for. Across two full fixture runs,
 * this was the single largest source of retries and the one hard failure,
 * always on an otherwise-correct draft.
 *
 * A no-card company's summary must (a) contain an explicit no-action
 * statement, and (b) contain no NON-NEGATED directive naming a specific
 * action tied to "now/today/this week." Standing-opportunity language
 * ("worth raising," "worth flagging," "worth monitoring") matches neither
 * pattern and is never touched by this check — it can never conflict with
 * constraint 1's hedging-surfacing requirement. A carded company is exempt
 * entirely: any language about its own actionable item is fine.
 */
function violatesGateContract(summary: string, anyActionable: boolean): boolean {
  if (anyActionable) return false;
  if (!NO_ACTION_STATEMENT_RE.test(summary)) return true;
  const sentences = summary.split(/(?<=[.!?])\s+/);
  return sentences.some((sentence) => ACTION_DIRECTIVE_RE.test(sentence) && !NEGATION_RE.test(sentence));
}

/** Matches a relative duration mention with its own unit, e.g. "~15 months out", "15mo", "1 year", "2 yrs". Captures the number and the unit separately so the VALUE can be checked, not the wording. */
const DURATION_MENTION_RE = /~?\s?(\d+(?:\.\d+)?)\s?(mo|months?|yrs?|years?)\b/gi;

function durationMentionToMonths(rawNumber: string, rawUnit: string): number {
  const value = Number(rawNumber);
  return rawUnit.toLowerCase().startsWith("y") ? value * 12 : value;
}

/**
 * Constraint 4: this exists to stop Sonnet INVENTING a duration, not to
 * force it to copy the fed phrase's exact abbreviation — "~15 months out"
 * restating a fed "~15mo" is fine; the constraint is about the VALUE, not
 * the wording. Parses every relative-duration mention out of the summary
 * (normalizing mo/month/months and yr/year/years to a month count) and
 * checks each against the real month values the fact set actually
 * supports (FactLine.monthsValue — pre-computed, not re-parsed from
 * display strings). A year-granularity fact contributes NO month value at
 * all (monthsValue is null for it), so any relative-duration statement
 * that can only be attributed to it will correctly find nothing to match
 * — this is what "also flag any relative duration on a year-granularity
 * fact" reduces to: such a fact simply never adds a value to the allowed
 * set, so a duration invented for it has nothing real to match against.
 */
function violatesDateGranularity(summary: string, factLines: FactLine[]): boolean {
  const mentions = [...summary.matchAll(DURATION_MENTION_RE)];
  if (mentions.length === 0) return false;
  const allowedMonths = factLines.map((f) => f.monthsValue).filter((m): m is number => m !== null);
  return mentions.some((m) => {
    const value = durationMentionToMonths(m[1], m[2]);
    return !allowedMonths.some((allowed) => Math.abs(allowed - value) < 0.5);
  });
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
  if (violatesGateContract(summary, anyActionable)) reasons.push("contradicts the card gate (missing an explicit no-action statement, or names a specific action for this week, with nothing THIS WEEK)");
  if (violatesDateGranularity(summary, factLines)) reasons.push("stated a relative duration whose value doesn't match any fed fact's timing");
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
      console.warn(`[portfolioSummary] ${portfolio.company} rejected draft: ${JSON.stringify(summary)}`);
      summary = await callSonnet(
        portfolio,
        factLines,
        `Your previous attempt violated: ${guard.reasons.join("; ")}. Rewrite the summary so it satisfies every hard rule.`
      );
      guard = checkSummaryConstraints(summary, factLines);
    }

    if (!guard.ok) {
      console.warn(`[portfolioSummary] ${portfolio.company} rejected retry draft: ${JSON.stringify(summary)}`);
      return failedPortfolioSummary(portfolio.company, `still failed constraints after retry: ${guard.reasons.join("; ")}`);
    }

    return { summary, source: "sonnet" };
  } catch (err) {
    return failedPortfolioSummary(portfolio.company, err instanceof Error ? err.message : String(err));
  }
}
