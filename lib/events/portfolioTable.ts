import type { CompanyResult, TriggerResult } from "../agent";
import type { CompanyPortfolio, EventRecord } from "./buildEvents";
import type { Bucket } from "./buckets";
import type { TimingInfo } from "./textHeuristics";
import { shortTriggerLabel } from "./labels";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";

/**
 * Session 15 Part B: the portfolio table's deterministic renderer.
 * Replaces sonnetPortfolioSummary.ts (deleted) entirely — same "GATED
 * FACTS ONLY" principle (only quote-verified fired triggers ever produce a
 * line, matching factBase.ts's VerifiedFact definition exactly), but
 * rendered directly as one line per fact instead of narrated into prose.
 * Every function here is a pure function of already-computed data
 * (CompanyResult + CompanyPortfolio, both produced upstream by the
 * unmodified gate/buildEvents.ts) — no model call anywhere in this file.
 */

export interface TableLine {
  triggerId: string;
  /** Short deterministic label (labels.ts), e.g. "refi window", "new debt raised" — never raw filing prose. */
  label: string;
  /** The one safely-scaled figure bound to this fact (factBase.ts's selectDisplayFigure), or null for "no figure disclosed". */
  figure: string | null;
  /** dateGranularity-aware phrase — "~46mo out", "matures 2026" (never a computed month count for a year-granularity fact), "pending/live", "standing", or "". */
  timingPhrase: string;
  citation: { form: string; date: string; url: string } | null;
  /** True when this same fact also has its own flash card above — "companies with cards: the carded events appear in the table too, marked." */
  cardEligible: boolean;
  /** True only for a STANDING (non-card) hedging-bucket fact — renders with the ⚑ marker instead of the ordinary bullet. */
  isHedgingFlag: boolean;
}

export type BucketLines = Record<Bucket, TableLine[]>;

export interface CompanyTableBlock {
  company: string;
  cik: string;
  ticker: string;
  cardCount: number;
  /** "N cards this week" or "no action this week" — Part B's required header line. */
  headerLine: string;
  /** Part C's fuller empty-state line, set only when cardCount === 0. */
  emptyStateLine: string | null;
  /** All 4 buckets always present as keys, possibly with an empty array ("no signal found"). */
  buckets: BucketLines;
  relationshipFlags: string[];
  triggersRun: number;
  triggersNoSignalCount: number;
}

/** Display order matching the spec's own illustrative table (Refi, New debt, Treasury, Hedging) — presentation only, distinct from buckets.ts's BUCKET_PRIORITY tie-break order. */
export const TABLE_BUCKET_ORDER: Bucket[] = ["refi", "new_debt", "treasury", "hedging"];

function timingPhraseFor(t: TriggerResult, timing: TimingInfo): string {
  if (timing.monthsToNearestFuture !== null) {
    if (timing.dateGranularity === "year") {
      // A bare-year maturity (e.g. "due 2026", no month ever disclosed)
      // must never show a computed month count — that number comes from
      // eventTiming.ts's Dec-31 windowDate convention, not the filing.
      return t.eventDate ? `matures ${t.eventDate}` : "future maturity (year known, month undisclosed)";
    }
    return `~${timing.monthsToNearestFuture}mo out`;
  }
  if (timing.isPendingLive) return "pending/live";
  if (t.eventStatus === "standing") return "standing";
  return "";
}

function mostRecentCitation(citations: TriggerResult["citations"]): TriggerResult["citations"][number] | null {
  if (citations.length === 0) return null;
  return [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * One line per quote-verified fired trigger in this event cluster — a
 * trigger that fired but failed quote verification never gets a line, the
 * same rule buildVerifiedFactBase already enforces for cards.
 */
function buildLinesForEvent(event: EventRecord, factByTrigger: Map<string, VerifiedFact>): TableLine[] {
  const lines: TableLine[] = [];
  for (const t of event.triggers) {
    const fact = factByTrigger.get(t.triggerId);
    if (!fact) continue;
    lines.push({
      triggerId: t.triggerId,
      label: shortTriggerLabel(t.triggerId, t.triggerName),
      figure: fact.figures[0] ?? null,
      timingPhrase: timingPhraseFor(t, event.timing),
      citation: mostRecentCitation(t.citations),
      cardEligible: event.cardEligible,
      isHedgingFlag: event.bucket === "hedging" && !event.cardEligible,
    });
  }
  return lines;
}

/**
 * Builds one company's table block. `cardCount` is passed in rather than
 * recomputed here because it must match the SAME flashCardCandidates list
 * the cards section renders from (buildEvents' cross-company sort) — this
 * function only ever groups/labels/formats, it never decides eligibility.
 */
export function buildCompanyTableBlock(result: CompanyResult, portfolio: CompanyPortfolio, cardCount: number): CompanyTableBlock {
  const factBase = buildVerifiedFactBase(result);
  const factByTrigger = new Map(factBase.map((f) => [f.linkedTriggerId, f]));

  const buckets: BucketLines = { treasury: [], new_debt: [], refi: [], hedging: [] };
  for (const bucket of Object.keys(portfolio.buckets) as Bucket[]) {
    for (const event of portfolio.buckets[bucket]) {
      buckets[bucket].push(...buildLinesForEvent(event, factByTrigger));
    }
  }

  const triggersRun = result.results.length;
  const triggersNoSignalCount = triggersRun - result.results.filter((r) => r.fired).length;

  const headerLine = cardCount > 0 ? `${cardCount} card${cardCount === 1 ? "" : "s"} this week` : "no action this week";
  const emptyStateLine =
    cardCount === 0
      ? `No actionable events this week — 4 buckets checked, ${triggersRun} triggers run, ${triggersNoSignalCount} found no signal.`
      : null;

  return {
    company: result.company,
    cik: result.cik,
    ticker: result.ticker,
    cardCount,
    headerLine,
    emptyStateLine,
    buckets,
    relationshipFlags: result.relationshipFlags.map((t) => t.triggerName),
    triggersRun,
    triggersNoSignalCount,
  };
}

/** Part C, book level: shown in place of the flash-card section when NO company in the whole book produced a single card. */
export function buildBookEmptyStateLine(blocks: CompanyTableBlock[]): string {
  const companyCount = blocks.length;
  const totalTriggersRun = blocks.reduce((sum, b) => sum + b.triggersRun, 0);
  const totalNoSignal = blocks.reduce((sum, b) => sum + b.triggersNoSignalCount, 0);
  return `No actionable events this week — ${companyCount} compan${companyCount === 1 ? "y" : "ies"} assessed, 4 buckets checked each, ${totalTriggersRun} triggers run, ${totalNoSignal} found no signal.`;
}
