import type { CompanyResult, TriggerResult } from "../agent";
import { BUCKET_PRIORITY, bucketForTrigger, type Bucket } from "./buckets";
import { clusterIntoEvents } from "./dedup";
import { evaluateEligibility } from "./eligibility";
import type { TimingInfo } from "./textHeuristics";

export interface EventRecord {
  id: string;
  company: string;
  cik: string;
  ticker: string;
  bucket: Bucket;
  /** The triggers this event was deduped from — usually 1, sometimes 2-3. */
  triggers: TriggerResult[];
  cardEligible: boolean;
  eligibilityReasons: string[];
  timing: TimingInfo;
  citations: TriggerResult["citations"];
  /**
   * This company's OTHER card-eligible events, collapsed into this one
   * surfaced card (one company = one card). Always empty on an event that
   * isn't itself the company's chosen primary card.
   */
  alsoActive: EventRecord[];
}

export interface CompanyPortfolio {
  company: string;
  cik: string;
  ticker: string;
  buckets: Record<Bucket, EventRecord[]>;
  /** Distress signals — a relationship flag, never a sell opportunity; not part of any bucket. */
  relationshipFlags: TriggerResult[];
}

export interface BuildEventsResult {
  /** At most one per company, already ordered: known future dates first (soonest first), then undated-but-fresh events by recency. */
  flashCardCandidates: EventRecord[];
  /** Every company x the 4 buckets, card-eligible or not — the table's full-evidence layer. */
  portfolio: CompanyPortfolio[];
}

function dedupeCitations(citations: TriggerResult["citations"]): TriggerResult["citations"] {
  const seen = new Set<string>();
  const out: TriggerResult["citations"] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/** Picks one bucket to label a (possibly multi-trigger) merged event with. */
function resolveEventBucket(
  triggers: TriggerResult[],
  eligibility: Map<string, ReturnType<typeof evaluateEligibility>>
): Bucket {
  const buckets = triggers
    .map((t) => bucketForTrigger(t.triggerId))
    .filter((b): b is Bucket => b !== null);

  // Prefer whichever constituent trigger is itself card-eligible.
  const eligibleBuckets = triggers
    .filter((t) => eligibility.get(t.triggerId)?.cardEligible)
    .map((t) => bucketForTrigger(t.triggerId))
    .filter((b): b is Bucket => b !== null);

  const candidates = eligibleBuckets.length > 0 ? eligibleBuckets : buckets;
  for (const b of BUCKET_PRIORITY) {
    if (candidates.includes(b)) return b;
  }
  // Shouldn't happen (caller only reaches here with >=1 non-null-bucket trigger).
  return "treasury";
}

/**
 * Combines per-trigger timing into one event-level timing for ordering.
 * Only draws from the constituents that are actually card-eligible — an
 * event merged from one eligible trigger (e.g. a just-completed raise,
 * live now) and one ineligible sibling (e.g. a debt tranche maturing in 3
 * years) should order as "live now," not inherit the irrelevant sibling's
 * future date.
 */
function combineTiming(
  triggers: TriggerResult[],
  eligibility: Map<string, ReturnType<typeof evaluateEligibility>>
): TimingInfo {
  const eligibleTimings = triggers
    .filter((t) => eligibility.get(t.triggerId)?.cardEligible)
    .map((t) => eligibility.get(t.triggerId)!.timing);
  const timings = eligibleTimings.length > 0 ? eligibleTimings : triggers.map((t) => eligibility.get(t.triggerId)!.timing);

  const future = timings.map((t) => t.monthsToNearestFuture).filter((m): m is number => m !== null);
  return {
    monthsToNearestFuture: future.length > 0 ? Math.min(...future) : null,
    alreadyPast: timings.every((t) => t.alreadyPast) && timings.length > 0,
    isPendingLive: timings.some((t) => t.isPendingLive),
  };
}

function mostRecentCitationDate(citations: TriggerResult["citations"]): string {
  const dates = citations.map((c) => c.date).filter(Boolean);
  return dates.length > 0 ? dates.reduce((latest, d) => (d > latest ? d : latest)) : "";
}

const FRESHNESS_WINDOW_DAYS = 90;

/** True when the event's most recent source filing is within the freshness window. */
function isRecentFiling(citations: TriggerResult["citations"], now: Date): boolean {
  const mostRecent = mostRecentCitationDate(citations);
  if (!mostRecent) return false;
  const filingDate = new Date(mostRecent);
  if (Number.isNaN(filingDate.getTime())) return false;
  const daysAgo = (now.getTime() - filingDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo >= 0 && daysAgo <= FRESHNESS_WINDOW_DAYS;
}

/** A maturity <18mo (already required by eligibility.ts) or a pending close — a real point-in-time in the future. */
function hasGenuineFutureDate(timing: TimingInfo): boolean {
  return timing.monthsToNearestFuture !== null || timing.isPendingLive;
}

function buildEventsForCompany(
  result: CompanyResult,
  now: Date
): { events: EventRecord[]; portfolio: CompanyPortfolio; primaryFlashCard: EventRecord | null } {
  const eligible = result.results.filter(
    (t) => t.fired && (t.needType === "credit" || t.needType === "treasury") && bucketForTrigger(t.triggerId) !== null
  );

  const eligibilityByTriggerId = new Map(eligible.map((t) => [t.triggerId, evaluateEligibility(t)]));

  const clusters = clusterIntoEvents(eligible);

  const events: EventRecord[] = clusters.map((triggers) => {
    const bucket = resolveEventBucket(triggers, eligibilityByTriggerId);
    const perTrigger = triggers.map((t) => eligibilityByTriggerId.get(t.triggerId)!);
    const timing = combineTiming(triggers, eligibilityByTriggerId);
    const citations = dedupeCitations(triggers.flatMap((t) => t.citations));
    const rawEligible = perTrigger.some((e) => e.cardEligible);

    // Freshness gate: a rule-eligible event only earns a card if it's
    // dated/live right now — a genuine future date (maturity <18mo,
    // pending close), or a source filing within the last 90 days. An old
    // completed event (rule-eligible in principle, e.g. a divestiture from
    // two years ago) no longer qualifies; it drops to the portfolio table.
    const fresh = hasGenuineFutureDate(timing) || isRecentFiling(citations, now);
    const cardEligible = rawEligible && fresh;
    const eligibilityReasons = perTrigger.map((e) => e.reason);
    if (rawEligible && !fresh) eligibilityReasons.push("stale — filed 90+ days ago with no future date");

    return {
      id: `${result.company}::${triggers
        .map((t) => t.triggerId)
        .sort()
        .join("+")}`,
      company: result.company,
      cik: result.cik,
      ticker: result.ticker,
      bucket,
      triggers,
      cardEligible,
      eligibilityReasons,
      timing,
      citations,
      alsoActive: [],
    };
  });

  const buckets: Record<Bucket, EventRecord[]> = { treasury: [], new_debt: [], refi: [], hedging: [] };
  for (const event of events) buckets[event.bucket].push(event);

  // One card per company: the most urgent card-eligible event becomes the
  // company's single surfaced card; every other card-eligible event for
  // this company collapses into that card's "Also active" line instead of
  // spawning a second (repeated-company) card.
  const eligibleSorted = events.filter((e) => e.cardEligible).sort(compareForOrdering);
  const primaryFlashCard = eligibleSorted[0] ?? null;
  if (primaryFlashCard) primaryFlashCard.alsoActive = eligibleSorted.slice(1);

  return {
    events,
    portfolio: {
      company: result.company,
      cik: result.cik,
      ticker: result.ticker,
      buckets,
      relationshipFlags: result.relationshipFlags,
    },
    primaryFlashCard,
  };
}

/**
 * A known future date (a real maturity/closing point-in-time) sorts first,
 * ascending — soonest first. Everything else (no parseable future date,
 * but still fresh enough to be card-eligible) sorts after, by recency —
 * most recently filed first. Unparseable-timing events never reach this
 * comparator at all: they fail card eligibility outright (see
 * buildEventsForCompany), so they can't float to the top of either tier.
 */
function compareForOrdering(a: EventRecord, b: EventRecord): number {
  const aHasDate = a.timing.monthsToNearestFuture !== null;
  const bHasDate = b.timing.monthsToNearestFuture !== null;
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;

  if (aHasDate && bHasDate) {
    const diff = a.timing.monthsToNearestFuture! - b.timing.monthsToNearestFuture!;
    if (diff !== 0) return diff;
  } else {
    const dateDiff = mostRecentCitationDate(b.citations).localeCompare(mostRecentCitationDate(a.citations));
    if (dateDiff !== 0) return dateDiff;
  }
  return a.company.localeCompare(b.company);
}

/**
 * Card Eligibility Spec v2 entry point: replaces the old company-level
 * weighted score with per-event grouping, dedup, and eligibility. No
 * ranking of one opportunity type against another — flash cards are
 * ordered strictly by time-to-event; everything else (bucket, company)
 * is presentation only. One card per company: each company contributes at
 * most one flash card (its most urgent event); every other card-eligible
 * event for that company rides along as that card's `alsoActive` list.
 */
export function buildEvents(results: CompanyResult[], now: Date = new Date()): BuildEventsResult {
  const perCompany = results.map((result) => buildEventsForCompany(result, now));

  const flashCardCandidates = perCompany
    .map((c) => c.primaryFlashCard)
    .filter((e): e is EventRecord => e !== null)
    .sort(compareForOrdering);

  return {
    flashCardCandidates,
    portfolio: perCompany.map((c) => c.portfolio),
  };
}
