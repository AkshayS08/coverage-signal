import type { CompanyResult, TriggerResult } from "../agent";
import { BUCKET_PRIORITY, bucketForTrigger, type Bucket } from "./buckets";
import { clusterIntoEvents } from "./dedup";
import { evaluateEligibility } from "./eligibility";
import { extractEventDate, type TimingInfo } from "./textHeuristics";

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
}

/** One other card-eligible trigger for the same company, collapsed into the headline card's "Also active" line. */
export interface FlashCardActiveItem {
  trigger: TriggerResult;
  bucket: Bucket;
  timing: TimingInfo;
}

/**
 * A flash card is built around exactly ONE headline trigger — the most
 * urgent card-eligible trigger WITHIN ITS OWN dedup cluster (see dedup.ts),
 * never a merged multi-trigger prose dump. A cluster can still contain
 * several triggers (e.g. a credit-agreement amendment that's simultaneously
 * new debt, an acquisition, and a new subsidiary); the cluster itself is
 * untouched for the portfolio table, but the CARD only describes its most
 * urgent member.
 *
 * One company can produce MULTIPLE cards — one per card-eligible cluster,
 * per the spec ("one per card-eligible event," not one per company; see
 * Session 11 Step 3, which removed the implicit one-card cap that used to
 * pick only the single most urgent trigger across the whole company and
 * silently demote every other genuinely card-worthy event to a footnote).
 * Every OTHER card-eligible trigger for this company that belongs to a
 * DIFFERENT cluster — i.e. every other card this company also has — still
 * appears as a compact `alsoActive` pointer here too, as cross-referencing
 * context, not as a substitute for its own card.
 */
export interface FlashCard {
  id: string;
  company: string;
  cik: string;
  ticker: string;
  headlineTrigger: TriggerResult;
  /** The headline trigger's own bucket — never a defaulted/fallback pick. */
  bucket: Bucket;
  /**
   * A second tag ONLY when the headline's own dedup cluster is exactly two
   * triggers spanning two buckets AND the cluster-mate is itself
   * individually card-eligible (the same real-world event viewed from two
   * angles, e.g. a divestiture that's both an asset sale and an
   * "acquisition announced" — not a standing/background trigger that
   * merely shared the same 8-K citation, e.g. ordinary floating-rate debt
   * disclosed alongside a fresh acquisition). A 3+-trigger cluster (several
   * distinct actions bundled in one filing) never gets a second tag — those
   * extra triggers go to `alsoActive` instead.
   */
  secondaryBucket: Bucket | null;
  timing: TimingInfo;
  /** The headline trigger's own citations only — not the whole cluster's. */
  citations: TriggerResult["citations"];
  alsoActive: FlashCardActiveItem[];
  /** Why this card cleared the freshness gate — e.g. "future maturity ~9mo" or "filed within 90 days (2026-07-21)". */
  freshnessReason: string;
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
  /** One per card-eligible event — a company can contribute more than one — already ordered: known future dates first (soonest first), then undated-but-fresh events by recency. */
  flashCardCandidates: FlashCard[];
  /** Every company x the 4 buckets, card-eligible or not — the table's full-evidence layer. */
  portfolio: CompanyPortfolio[];
}

export function dedupeCitations(citations: TriggerResult["citations"]): TriggerResult["citations"] {
  const seen = new Set<string>();
  const out: TriggerResult["citations"] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/** Picks one bucket to label a (possibly multi-trigger) merged event with, for the portfolio table. */
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
 * Combines per-trigger timing into one cluster-level timing, for the
 * portfolio table and the freshness gate. Only draws from the constituents
 * that are actually card-eligible — a cluster merged from one eligible
 * trigger (e.g. a just-completed raise, live now) and one ineligible
 * sibling (e.g. a debt tranche maturing in 3 years) should read as "live
 * now," not inherit the irrelevant sibling's future date.
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
  const nearest = future.length > 0 ? Math.min(...future) : null;
  // Carry the granularity of whichever timing actually produced the
  // winning (nearest) months figure, so display code downstream still
  // knows to render "matures <year>" instead of a month count for it.
  const nearestGranularity = timings.find((t) => t.monthsToNearestFuture === nearest)?.dateGranularity ?? null;
  return {
    monthsToNearestFuture: nearest,
    alreadyPast: timings.every((t) => t.alreadyPast) && timings.length > 0,
    isPendingLive: timings.some((t) => t.isPendingLive),
    dateGranularity: nearest !== null ? nearestGranularity : null,
  };
}

function mostRecentCitationDate(citations: TriggerResult["citations"]): string {
  const dates = citations.map((c) => c.date).filter(Boolean);
  return dates.length > 0 ? dates.reduce((latest, d) => (d > latest ? d : latest)) : "";
}

const FRESHNESS_WINDOW_DAYS = 90;

/**
 * The event's own date — an offering, closing, maturity, or amendment
 * date — as opposed to the date of whichever filing happens to mention it.
 * Matters because a filing can cite an OLD event alongside new ones in the
 * same 8-K: a 14-month-old notes offering must not read as "this week"
 * just because a recent filing happens to mention it too.
 *
 * Prefers each trigger's structured, fact-guarded `eventDate` (Session 11
 * Step 2 — verified against the actual filing text, and guaranteed to
 * belong to THIS fact, not a neighboring sentence). Falls back to the old
 * text-scanning heuristic only when no trigger in the cluster has one —
 * e.g. a trigger classified before the schema existed, or one where
 * extraction genuinely couldn't pin a date.
 */
function eventOwnDate(triggers: TriggerResult[]): string | null {
  for (const t of triggers) {
    if (t.eventDate) return t.eventDate;
  }
  for (const t of triggers) {
    const d = extractEventDate(t.verifiedQuote ?? t.evidence);
    if (d) return d;
  }
  return null;
}

/** True when the EVENT's own date (preferred) or, failing that, its most recent citing filing, is within the freshness window. */
function isRecentFiling(triggers: TriggerResult[], citations: TriggerResult["citations"], now: Date): boolean {
  const dateToCheck = eventOwnDate(triggers) ?? mostRecentCitationDate(citations);
  if (!dateToCheck) return false;
  const eventDate = new Date(dateToCheck);
  if (Number.isNaN(eventDate.getTime())) return false;
  const daysAgo = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo >= 0 && daysAgo <= FRESHNESS_WINDOW_DAYS;
}

/** A maturity <18mo (already required by eligibility.ts) or a pending close — a real point-in-time in the future. */
function hasGenuineFutureDate(timing: TimingInfo): boolean {
  return timing.monthsToNearestFuture !== null || timing.isPendingLive;
}

const TABLE_WINDOW_DAYS = 365;

/**
 * Rate/FX/commodity exposure is a standing condition, not a dated event —
 * it's disclosed the same way whether it started last week or three years
 * ago, and it represents a hedging opportunity for as long as it's on the
 * books. It must never age out of the "current state" table the way a
 * one-time completed transaction does.
 */
const ONGOING_EXPOSURE_TRIGGERS = new Set(["floating-rate-debt", "fx-exposure", "commodity-exposure"]);

function isOngoingExposureEvent(triggers: TriggerResult[]): boolean {
  return triggers.some((t) => ONGOING_EXPOSURE_TRIGGERS.has(t.triggerId));
}

/** True when the event's most recent source filing is within the last 12 months. */
function isWithinTableWindow(citations: TriggerResult["citations"], now: Date): boolean {
  const mostRecent = mostRecentCitationDate(citations);
  if (!mostRecent) return false;
  const filingDate = new Date(mostRecent);
  if (Number.isNaN(filingDate.getTime())) return false;
  const daysAgo = (now.getTime() - filingDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysAgo >= 0 && daysAgo <= TABLE_WINDOW_DAYS;
}

/**
 * Portfolio-table visibility: the table is a weekly "current state" view,
 * not a full transaction history. A dated past event (a completed raise, a
 * closed divestiture, a buyback authorization) rolls off after 12 months —
 * it's no longer current state, just history. Two categories are exempt
 * from that roll-off entirely: an ongoing exposure (see
 * ONGOING_EXPOSURE_TRIGGERS above) is never "past," and a genuine
 * future-dated item (an upcoming maturity, a pending closing) is
 * forward-looking, not backward-looking, so its age at disclosure is
 * irrelevant. This governs table inclusion only — it has no bearing on
 * card eligibility, which is decided separately by the freshness gate
 * above.
 */
function isTableEligible(event: { triggers: TriggerResult[]; timing: TimingInfo; citations: TriggerResult["citations"] }, now: Date): boolean {
  if (isOngoingExposureEvent(event.triggers)) return true;
  if (hasGenuineFutureDate(event.timing)) return true;
  return isWithinTableWindow(event.citations, now);
}

/**
 * Human-readable justification for why a card cleared the freshness gate —
 * surfaced in the trace/console so the gate's decision is auditable, not a
 * black box (see buildEventsForCompany's freshness-gate comment for the
 * underlying rule this describes). Prefers the event's own date over the
 * citing filing's, matching isRecentFiling above.
 *
 * Year-granularity facts (a bare "due 2026", no month disclosed anywhere)
 * must never show a computed month count — that number came from
 * windowDate's Dec-31 convention (eventTiming.ts), not the filing. Shows
 * the bare year itself instead, matching eligibility.ts's debt-maturity
 * reason string.
 */
function describeFreshness(timing: TimingInfo, triggers: TriggerResult[], citations: TriggerResult["citations"]): string {
  if (timing.monthsToNearestFuture !== null) {
    if (timing.dateGranularity === "year") {
      const year = triggers.find((t) => t.dateGranularity === "year")?.eventDate;
      return year ? `matures ${year}` : "future maturity (year known, month undisclosed)";
    }
    return `future maturity ~${timing.monthsToNearestFuture}mo`;
  }
  if (timing.isPendingLive) return "pending/live event";
  const eventDate = eventOwnDate(triggers);
  if (eventDate) return `dated within 90 days (${eventDate})`;
  const mostRecent = mostRecentCitationDate(citations);
  return mostRecent ? `filed within 90 days (${mostRecent})` : "no citation date (unexpected)";
}

/**
 * The one ordering rule, shared by every unit it applies to (a company's
 * headline-trigger candidates, and the final cross-company card list): a
 * known future date sorts first, ascending — soonest first. Everything
 * else (no parseable future date, but still fresh enough to be
 * card-eligible) sorts after, by recency — most recently filed first.
 */
export function compareUrgency(
  a: { timing: TimingInfo; citations: TriggerResult["citations"] },
  b: { timing: TimingInfo; citations: TriggerResult["citations"] }
): number {
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
  return 0;
}

function buildEventsForCompany(
  result: CompanyResult,
  now: Date
): { events: EventRecord[]; portfolio: CompanyPortfolio; flashCards: FlashCard[] } {
  const eligible = result.results.filter(
    (t) => t.fired && (t.needType === "credit" || t.needType === "treasury") && bucketForTrigger(t.triggerId) !== null
  );

  const eligibilityByTriggerId = new Map(eligible.map((t) => [t.triggerId, evaluateEligibility(t, now)]));

  const clusters = clusterIntoEvents(eligible);

  const events: EventRecord[] = clusters.map((triggers) => {
    const bucket = resolveEventBucket(triggers, eligibilityByTriggerId);
    const perTrigger = triggers.map((t) => eligibilityByTriggerId.get(t.triggerId)!);
    const timing = combineTiming(triggers, eligibilityByTriggerId);
    const citations = dedupeCitations(triggers.flatMap((t) => t.citations));
    // A trigger only counts toward card eligibility if it's ALSO
    // quote-verified (see verifyQuote.ts) — a rule-eligible-but-unverified
    // trigger must never produce a card, since its number/date claim
    // couldn't be confirmed against the actual filing text.
    const rawEligible = triggers.some((t, i) => perTrigger[i].cardEligible && t.quoteVerified);

    // Freshness gate: a rule-eligible event only earns a card if it's
    // dated/live right now — a genuine future date (maturity <18mo,
    // pending close), or the EVENT ITSELF (not merely whichever filing
    // cites it) dated within the last 90 days. An old completed event
    // (rule-eligible in principle, e.g. a divestiture from two years ago)
    // no longer qualifies; it drops to the portfolio table.
    const fresh = hasGenuineFutureDate(timing) || isRecentFiling(triggers, citations, now);
    const cardEligible = rawEligible && fresh;
    const eligibilityReasons = perTrigger.map((e, i) => {
      const t = triggers[i];
      const unverifiedNote = t.fired && !t.quoteVerified ? " — UNVERIFIED (quote not found in source filing)" : "";
      return `${e.reason}${unverifiedNote}`;
    });
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
    };
  });

  // Card candidates: flatten every INDIVIDUALLY card-eligible trigger
  // across ALL of this company's card-eligible clusters. A trigger that
  // only "rides along" in an eligible cluster (its own rule said not
  // eligible, e.g. standing floating-rate exposure bundled with a fresh
  // acquisition in the same 8-K) is never a headline candidate. Nor is a
  // trigger whose quote failed verification — an unconfirmed number or
  // date must never drive a card, no matter how urgent it looks.
  const sortedCandidates = events
    .filter((event) => event.cardEligible)
    .flatMap((event) =>
      event.triggers
        .filter((t) => eligibilityByTriggerId.get(t.triggerId)?.cardEligible && t.quoteVerified)
        .map((t) => ({
          trigger: t,
          timing: eligibilityByTriggerId.get(t.triggerId)!.timing,
          citations: t.citations,
          cluster: event.triggers,
        }))
    )
    .sort((a, b) => compareUrgency(a, b) || a.trigger.triggerName.localeCompare(b.trigger.triggerName));

  // One card PER CARD-ELIGIBLE CLUSTER, not one per company (Session 11
  // Step 3 — the previous version kept only sortedCandidates[0] company-
  // wide and buried every other genuinely card-worthy event in
  // `alsoActive`; a company can have several distinct, simultaneously
  // urgent stories — e.g. UHS: an upcoming note maturity AND a newly
  // announced acquisition are two separate cards, not one). Within a
  // cluster, its own most-urgent trigger (first in sort order) is the
  // headline; clusters are then emitted in the same urgency order.
  const clusterOrder: TriggerResult[][] = [];
  const headlineByCluster = new Map<TriggerResult[], (typeof sortedCandidates)[number]>();
  for (const candidate of sortedCandidates) {
    if (!headlineByCluster.has(candidate.cluster)) {
      headlineByCluster.set(candidate.cluster, candidate);
      clusterOrder.push(candidate.cluster);
    }
  }

  const flashCards: FlashCard[] = clusterOrder.map((cluster) => {
    const headline = headlineByCluster.get(cluster)!;
    const bucket = bucketForTrigger(headline.trigger.triggerId)!;

    // A second tag requires the cluster-mate to be a genuine second facet of
    // THIS event, not merely a standing/background trigger that happened to
    // share the same 8-K citation (dedup.ts clusters on shared citations,
    // which can sweep in an unrelated standing exposure — e.g. a company's
    // ordinary floating-rate debt disclosed in the same 8-K as a fresh
    // acquisition). Individual eligibility is exactly the test for "genuine
    // event, not standing background" (see eligibility.ts), so the
    // cluster-mate must independently pass it before it can drive a tag.
    let secondaryBucket: Bucket | null = null;
    if (cluster.length === 2) {
      const clusterMate = cluster.find((t) => t.triggerId !== headline.trigger.triggerId);
      const clusterMateEligible =
        clusterMate ? eligibilityByTriggerId.get(clusterMate.triggerId)?.cardEligible && clusterMate.quoteVerified : false;
      const clusterMateBucket = clusterMate && clusterMateEligible ? bucketForTrigger(clusterMate.triggerId) : null;
      if (clusterMateBucket && clusterMateBucket !== bucket) secondaryBucket = clusterMateBucket;
    }

    // Table/card agreement: the portfolio table normally labels a merged
    // cluster via BUCKET_PRIORITY tie-break among its eligible constituents
    // (resolveEventBucket, above) — which can disagree with the card when a
    // different constituent trigger in the SAME cluster wins that tie-break
    // (e.g. a cluster eligible via both "new debt issuance" and "new
    // subsidiary" resolves to treasury by priority, even when new-debt
    // issuance is this card's actual headline). Card and table must never
    // contradict, so the cluster containing the headline trigger is
    // re-filed under the card's own bucket.
    const headlineCluster = events.find((event) => event.triggers === cluster);
    if (headlineCluster && headlineCluster.bucket !== bucket) {
      headlineCluster.bucket = bucket;
    }

    return {
      id: `${result.company}::${headline.trigger.triggerId}`,
      company: result.company,
      cik: result.cik,
      ticker: result.ticker,
      headlineTrigger: headline.trigger,
      bucket,
      secondaryBucket,
      timing: headline.timing,
      citations: headline.trigger.citations,
      // Every other card-eligible candidate for this company, EXCLUDING
      // this card's own cluster (already represented by bucket +
      // secondaryBucket above) — cross-referencing context pointing at
      // this company's OTHER cards, not a substitute for them.
      alsoActive: sortedCandidates
        .filter((c) => c.cluster !== cluster)
        .map((c) => ({
          trigger: c.trigger,
          bucket: bucketForTrigger(c.trigger.triggerId)!,
          timing: c.timing,
        })),
      freshnessReason: describeFreshness(headline.timing, [headline.trigger], headline.trigger.citations),
    };
  });

  const buckets: Record<Bucket, EventRecord[]> = { treasury: [], new_debt: [], refi: [], hedging: [] };
  for (const event of events) {
    if (isTableEligible(event, now)) buckets[event.bucket].push(event);
  }

  return {
    events,
    portfolio: {
      company: result.company,
      cik: result.cik,
      ticker: result.ticker,
      buckets,
      relationshipFlags: result.relationshipFlags,
    },
    flashCards,
  };
}

/**
 * Card Eligibility Spec v2 entry point: replaces the old company-level
 * weighted score with per-event grouping, dedup, and eligibility. No
 * ranking of one opportunity type against another — flash cards are
 * ordered strictly by time-to-event; everything else (bucket, company) is
 * presentation only. One card per card-eligible EVENT (dedup cluster), not
 * per company — a company with two genuinely distinct, simultaneously
 * urgent stories produces two cards, each pointing at the other via
 * `alsoActive`.
 */
export function buildEvents(results: CompanyResult[], now: Date = new Date()): BuildEventsResult {
  const perCompany = results.map((result) => buildEventsForCompany(result, now));

  const flashCardCandidates = perCompany
    .flatMap((c) => c.flashCards)
    .sort((a, b) => compareUrgency(a, b) || a.company.localeCompare(b.company));

  return {
    flashCardCandidates,
    portfolio: perCompany.map((c) => c.portfolio),
  };
}
