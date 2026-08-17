import type { CompanyResult, TriggerResult } from "../agent";
import type { FlashCard } from "./buildEvents";
import { bucketForTrigger, type Bucket } from "./buckets";
import { evaluateEligibility } from "./eligibility";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { condenseEvidenceDescription, formatAnnouncedDate } from "./evidenceCondense";
import type { TimingInfo } from "./textHeuristics";

/**
 * Session 15b Part A: the portfolio table's deterministic renderer,
 * rewritten to render per TRIGGER, not per dedup cluster. Session 15's
 * first version grouped by buildEvents.ts's merged-cluster bucket, which
 * meant a trigger could render under a bucket that wasn't its own (a
 * cluster resolves to ONE bucket by priority tie-break; every constituent
 * trigger inherited it) — confirmed live: HCA's debt-maturity fact
 * rendered under "New debt" because it shared a citation with
 * new-debt-issuance, which won the tie-break. Clusters/dedup stay exactly
 * as they are for CARDS (out of scope this session); the table simply
 * stops using them — it renders every verified trigger independently,
 * under bucketForTrigger(triggerId), which is what "the table is the full
 * picture" requires.
 *
 * Each line is built from the trigger's own evidence prose
 * (evidenceCondense.ts), not from a figure+status template — see that
 * file's doc comment for the three condensing rules this implements.
 *
 * No model call anywhere in this file.
 */

export interface TableLine {
  triggerId: string;
  /** Condensed "what happened, with its amount and date" — evidenceCondense.ts. Never empty (bareLineFallback guarantees a reason string when a fact has nothing else). */
  description: string;
  /** dateGranularity-aware phrase — "~46mo out", "matures 2026" (never a computed month count for a year-granularity fact), "pending/live", "standing", or "". */
  timingPhrase: string;
  /** ALL citations for this trigger, not just the most recent — every line must carry its source link(s). */
  citations: TriggerResult["citations"];
  /** True when this exact trigger is the headline of one of this company's actual rendered cards above — "the carded events appear in the table too, marked." */
  cardEligible: boolean;
  /** True for a hedging-bucket line with no card of its own — renders with the ⚑ marker so a standing exposure is never buried. */
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

/**
 * Session 16 Fix C: every line must carry a status a reader can read as
 * status, never a blank — a blank was indistinguishable from a rendering
 * gap. Confirmed live across both books: any "completed" or "just_announced"
 * fact whose own date is neither a near-future maturity nor within the
 * pending-live recency window (i.e. it happened, but a while ago) fell
 * through every branch below to "" — DaVita's Feb 2026 acquisition, HCA's
 * April offering, Tenet's Nov 2025 issuance, Cigna's Sept 2025 issuance,
 * Quest's May 2026 issuance, Encompass's May 2026 issuance, UHS's Talkspace
 * line, CHS's April 2026 divestiture all did this. The two new branches
 * (completed/just_announced) and the final never-blank fallback close every
 * remaining eventStatus case.
 */
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
  if (t.eventStatus === "completed") return "completed";
  if (t.eventStatus === "just_announced") {
    return t.eventDate && t.dateGranularity ? `announced ${formatAnnouncedDate(t.eventDate, t.dateGranularity)}` : "announced";
  }
  // Never reached in practice (eventStatus is exhaustive above at
  // "upcoming"/"just_announced"/"completed"/"standing" and "upcoming" with
  // no computable date already returned via monthsToNearestFuture/
  // isPendingLive being null/false above only when there's truly nothing to
  // say) — kept as a hard never-blank floor, not a silent "".
  return t.eventStatus;
}

/** Citations of `a` all appear in `b`'s citation set (by URL) — used to detect when a debt-maturity fact is really just describing the SAME event as a new-debt-issuance fact (see the A1 fix below). Empty `a` is never a subset of anything (nothing to compare). */
function citationsSubsetOf(a: TriggerResult["citations"], b: TriggerResult["citations"]): boolean {
  if (a.length === 0) return false;
  const bUrls = new Set(b.map((c) => c.url));
  return a.every((c) => bUrls.has(c.url));
}

/**
 * Builds one company's table block. `cardsForCompany` is this company's
 * slice of the SAME flashCardCandidates list the cards section renders
 * from (filter by `.cik`) — it decides both cardCount and which specific
 * trigger lines get the "card above" marker; this function never decides
 * eligibility itself, only groups/labels/formats what the gate already
 * decided (evaluateEligibility is called read-only, purely for each
 * trigger's own TimingInfo — eligibility.ts itself is untouched).
 */
export function buildCompanyTableBlock(result: CompanyResult, cardsForCompany: FlashCard[], now: Date = new Date()): CompanyTableBlock {
  const factBase = buildVerifiedFactBase(result);
  const factByTrigger = new Map(factBase.map((f) => [f.linkedTriggerId, f]));
  const headlineTriggerIds = new Set(cardsForCompany.map((c) => c.headlineTrigger.triggerId));

  const buckets: BucketLines = { treasury: [], new_debt: [], refi: [], hedging: [] };

  // Session 16 Fix A1: a debt-maturity fact whose citations are a SUBSET of
  // (here, in practice, identical to) the company's new-debt-issuance
  // fact's citations describes the SAME 8-K's own just-priced tranches, not
  // a genuine upcoming refinancing need — confirmed live for HCA and Cigna,
  // where the notes-pricing 8-K also states each new tranche's own (5+
  // year-out) maturity date, and the debt-maturity trigger latched onto
  // that instead of a real refi signal. Rendered once, under New debt;
  // Refi correctly shows "no signal found" rather than a duplicate line.
  const newDebtFact = factByTrigger.get("new-debt-issuance");

  for (const t of result.results) {
    const fact = factByTrigger.get(t.triggerId);
    if (!fact) continue; // not quote-verified — never described, never implied (same GATED FACTS ONLY rule cards use)
    const bucket = bucketForTrigger(t.triggerId);
    if (!bucket) continue; // distress/covenant-breach — a relationship flag, never a bucket line

    if (t.triggerId === "debt-maturity" && newDebtFact && citationsSubsetOf(fact.citations, newDebtFact.citations)) {
      continue;
    }

    const { timing } = evaluateEligibility(t, now);
    const cardEligible = headlineTriggerIds.has(t.triggerId);

    buckets[bucket].push({
      triggerId: t.triggerId,
      description: condenseEvidenceDescription(fact),
      timingPhrase: timingPhraseFor(t, timing),
      citations: t.citations,
      cardEligible,
      isHedgingFlag: bucket === "hedging" && !cardEligible,
    });
  }

  const cardCount = cardsForCompany.length;
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
    // Session 16 Fix A3: was rendering the DISTRESS TRIGGER'S OWN generic
    // definition (t.triggerName, e.g. "Covenant breach / waiver, or
    // going-concern / liquidity warning") whenever one fired, instead of
    // what actually happened — confirmed live for Molina, whose covenant
    // amendment is a real, verified fact with its own evidence sentence.
    // Renders that evidence (condensed the same way every other line is)
    // when a verified fact backs the flag; a fired-but-unverified distress
    // trigger (quote failed verification) is dropped rather than shown with
    // no backing text, same GATED FACTS ONLY rule the rest of the table
    // follows.
    relationshipFlags: result.relationshipFlags
      .map((t) => factByTrigger.get(t.triggerId))
      .filter((f): f is VerifiedFact => f !== undefined)
      .map((f) => condenseEvidenceDescription(f)),
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
