import type { TriggerResult } from "../agent";
import { computeTiming, computeWindowDate, daysBetween } from "./eventTiming";
import { isFreshEvent, parseQoQIncreasePercent, type TimingInfo } from "./textHeuristics";

/** The card-eligibility spec's core test: dated/live AND actionable within ~12-18mo. */
export interface EligibilityResult {
  cardEligible: boolean;
  reason: string;
  timing: TimingInfo;
}

const REFI_WINDOW_MONTHS = 18;
const CASH_JUMP_THRESHOLD_PCT = 30;
/** A completed issuance only cards if it's this recent — see the proceeds test below. Single named tunable, per spec. */
export const PROCEEDS_RECENCY_DAYS = 90;

/**
 * Per-trigger card-eligibility rules (Session 11 rewrite) — pure arithmetic
 * over the structured eventDate/eventStatus/proceedsUse fields (Step 2),
 * no regex-scanning of evidence prose for timing anymore. Every bucket
 * runs the same two universal hard rules FIRST, before any per-trigger
 * logic — there are no trigger cases exempt from them:
 *
 *   - eventStatus "standing" -> TABLE, always, no exceptions.
 *   - eventStatus "completed" -> TABLE, for every trigger EXCEPT
 *     "new-debt-issuance", which instead runs the completed-issuance
 *     proceeds test (a genuinely fresh, not-fully-applied raise can still
 *     be worth a card) — see the case below.
 *
 * This is what fixes the HCA class of bug: status gates the branch BEFORE
 * any date is even looked at, so a redeemed note's now-irrelevant former
 * due date can never be reached, let alone mistaken for an upcoming
 * maturity.
 */
export function evaluateEligibility(trigger: TriggerResult, now: Date = new Date()): EligibilityResult {
  const { eventStatus, eventDate, dateGranularity, triggerId } = trigger;
  const timing = computeTiming(eventStatus, eventDate, dateGranularity, now);

  if (eventStatus === "standing") {
    return { cardEligible: false, reason: "standing condition, no dated change", timing };
  }
  if (eventStatus === "completed" && triggerId !== "new-debt-issuance") {
    return { cardEligible: false, reason: "already completed — nothing left to win", timing };
  }

  switch (triggerId) {
    // --- Treasury / deposits ---
    case "asset-sale":
    case "ipo-secondary":
      return { cardEligible: true, reason: "dated capital event", timing };

    case "new-subsidiary":
      // INTERNAL/rarely-disclosed; when it does fire it's reporting one
      // specific formation event, which is inherently dated.
      return { cardEligible: true, reason: "dated entity-formation event", timing };

    case "large-cash-balance": {
      const qoq = parseQoQIncreasePercent(trigger.evidence);
      if (qoq !== null && qoq > CASH_JUMP_THRESHOLD_PCT) {
        return { cardEligible: true, reason: `cash up ${qoq.toFixed(0)}% QoQ`, timing };
      }
      return { cardEligible: false, reason: "standing cash level or QoQ jump uncomputable", timing };
    }

    // --- New debt / financing need ---
    case "new-debt-issuance": {
      if (eventStatus === "completed") {
        const windowDate = computeWindowDate(eventDate, dateGranularity);
        if (trigger.proceedsUse === "partly_unapplied" && windowDate) {
          // daysBetween(date, now) is positive when `date` is in the FUTURE
          // (see eventTiming.ts) — a completed issuance's windowDate is in
          // the past, so negate it to get "days ago" as a positive number.
          const daysAgo = -daysBetween(windowDate, now);
          if (daysAgo >= 0 && daysAgo <= PROCEEDS_RECENCY_DAYS) {
            return { cardEligible: true, reason: `proceeds partly unapplied, issued ${daysAgo}d ago`, timing };
          }
          return {
            cardEligible: false,
            reason: `proceeds partly unapplied but issued ${daysAgo}d ago — beyond the ${PROCEEDS_RECENCY_DAYS}d window`,
            timing,
          };
        }
        if (trigger.proceedsUse === "refinancing_only") {
          return { cardEligible: false, reason: "proceeds fully applied to refinancing — nothing left to win", timing };
        }
        return { cardEligible: false, reason: "completed issuance, use of proceeds not disclosed", timing };
      }
      // just_announced / upcoming: a live, dated capital-markets event —
      // the proceeds test only applies once the raise has settled.
      return { cardEligible: true, reason: "dated capital event", timing };
    }

    case "acquisition-announced":
      // Runs the universal test via timing.isPendingLive (computed
      // centrally in eventTiming.ts — this case does no recency math of
      // its own): a just-announced deal cards while it's still recent,
      // and stops once it ages past PENDING_LIVE_MAX_AGE_DAYS with no
      // other qualifying date. Previously unconditional true — the same
      // omission already fixed for new-debt-issuance/capex-program, just
      // reached through eventStatus persisting indefinitely instead of an
      // explicit unconditional return.
      return timing.isPendingLive
        ? { cardEligible: true, reason: "financing need from announced deal", timing }
        : { cardEligible: false, reason: "acquisition announced, but beyond the pending-live window — no longer recent", timing };

    case "capex-program":
      // isFreshEvent is already wired for dividend-buyback/floating-rate-debt/
      // international-expansion below — this trigger previously had no
      // freshness check at all (the single largest source of false
      // positives found in the Step 1 audit: "each year"/"actively pursue"
      // standing programs carding unconditionally).
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "capex program newly announced", timing }
        : { cardEligible: false, reason: "ongoing/recurring capex program", timing };

    case "revolver-near-capacity":
      return { cardEligible: false, reason: "standing revolver utilization", timing };

    case "dividend-buyback":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly increased/announced authorization", timing }
        : { cardEligible: false, reason: "ongoing/unchanged program", timing };

    // --- Refi (debt maturity) ---
    case "debt-maturity": {
      // eventStatus "standing"/"completed" are already excluded by the
      // universal hard rules above — by the time we reach here, status is
      // "upcoming" or "just_announced", so this is purely the date-window
      // check, never a status guess.
      if (timing.monthsToNearestFuture === null) {
        return { cardEligible: false, reason: "approaching maturity, but no verifiable date — held to table", timing };
      }
      if (timing.monthsToNearestFuture <= REFI_WINDOW_MONTHS) {
        // Year-granularity facts (a bare "due 2026", no month disclosed
        // anywhere) must never display a computed month count — that
        // count came from windowDate's Dec-31 convention, not the filing.
        // Display the year the filing actually states, nothing more
        // precise.
        const reason = timing.dateGranularity === "year" ? `matures ${eventDate}` : `maturity ~${timing.monthsToNearestFuture}mo out`;
        return { cardEligible: true, reason, timing };
      }
      return { cardEligible: false, reason: "maturity 18+ months out", timing };
    }

    // --- FX / rate hedging ---
    case "floating-rate-debt":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly issued floating-rate debt", timing }
        : { cardEligible: false, reason: "standing floating-rate exposure", timing };

    case "international-expansion":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly disclosed foreign revenue", timing }
        : { cardEligible: false, reason: "standing international exposure", timing };

    case "commodity-exposure":
    case "fx-exposure":
      return { cardEligible: false, reason: "standing exposure, no dated change", timing };

    default:
      return { cardEligible: false, reason: "no card rule for this trigger", timing };
  }
}
