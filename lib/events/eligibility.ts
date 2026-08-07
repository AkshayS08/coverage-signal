import type { TriggerResult } from "../agent";
import { extractTimingInfo, isFreshEvent, parseQoQIncreasePercent, type TimingInfo } from "./textHeuristics";

/** The card-eligibility spec's core test: dated/live AND actionable within ~12-18mo. */
export interface EligibilityResult {
  cardEligible: boolean;
  reason: string;
  timing: TimingInfo;
}

const REFI_WINDOW_MONTHS = 18;
const CASH_JUMP_THRESHOLD_PCT = 30;

/**
 * Per-trigger card-eligibility rules, straight from the spec's four
 * bucket sections. Each rule returns both the yes/no and the timing info
 * the caller needs for flash-card ordering (nearest future date first).
 */
export function evaluateEligibility(trigger: TriggerResult, now: Date = new Date()): EligibilityResult {
  const timing = extractTimingInfo(trigger.evidence, now);

  switch (trigger.triggerId) {
    // --- Treasury / deposits ---
    case "new-debt-issuance": // completed capital raise, proceeds need a home
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
    case "acquisition-announced":
      return { cardEligible: true, reason: "financing need from announced deal", timing };

    case "capex-program":
      return { cardEligible: true, reason: "capex program announced", timing };

    case "revolver-near-capacity":
      return { cardEligible: false, reason: "standing revolver utilization", timing };

    case "dividend-buyback":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly increased/announced authorization", timing }
        : { cardEligible: false, reason: "ongoing/unchanged program", timing };

    // --- Refi (debt maturity) ---
    case "debt-maturity": {
      if (timing.monthsToNearestFuture === null) {
        if (timing.alreadyPast) {
          return { cardEligible: false, reason: "already matured — nothing left to win", timing };
        }
        // No parseable window at all. In practice this trigger sometimes
        // fires on maturities well outside 12-18mo (a multi-tranche ladder
        // where only the nearest one qualifies) — since the spec's window
        // is a hard requirement, an unparseable timing defaults to
        // table-only rather than trusting the trigger fired at all.
        return { cardEligible: false, reason: "approaching maturity, but timing unparsed — held to table", timing };
      }
      if (timing.monthsToNearestFuture <= REFI_WINDOW_MONTHS) {
        return { cardEligible: true, reason: `maturity ~${timing.monthsToNearestFuture}mo out`, timing };
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
