import type { TimingInfo } from "./textHeuristics";

/**
 * Short, human labels for a trigger — shared by the card's compact "Also
 * active" line and the portfolio table's deterministic per-bucket bullets,
 * so the same event reads the same short way everywhere it's summarized
 * (as opposed to the full trigger name, which is more clinical/taxonomic).
 */
export const SHORT_TRIGGER_LABEL: Record<string, string> = {
  "debt-maturity": "refi window",
  "new-debt-issuance": "new debt raised",
  "acquisition-announced": "acquisition financing",
  "capex-program": "capex financing",
  "revolver-near-capacity": "revolver upsize",
  "dividend-buyback": "buyback increase",
  "large-cash-balance": "cash build-up",
  "asset-sale": "asset sale proceeds",
  "international-expansion": "new foreign revenue",
  "new-subsidiary": "new subsidiary accounts",
  "ipo-secondary": "capital raise proceeds",
  "floating-rate-debt": "new floating-rate issuance",
  "commodity-exposure": "commodity hedging",
  "fx-exposure": "FX hedging",
};

export function shortTriggerLabel(triggerId: string, fallback: string): string {
  return SHORT_TRIGGER_LABEL[triggerId] ?? fallback;
}

/**
 * The short label plus a timing suffix — "refi window ~9mo", "refi window
 * matures 2027", "asset sale proceeds (pending)", or just the label if
 * undated.
 *
 * ITEM 15 (stage-2 review) — NO MONTH COUNT FOR A BARE-YEAR MATURITY.
 *
 * `monthsToNearestFuture` is computed from eventTiming.ts's windowDate, and
 * for a year-granularity fact that date is a CODE-CHOSEN CONVENTION —
 * December 31 of the stated year — applied so a bare "2027" can be ordered
 * and windowed at all. computeWindowDate's own contract says it in as many
 * words: "Callers building user-facing text must branch on dateGranularity
 * and never surface this value directly."
 *
 * This function surfaced it directly, and it feeds both the portfolio
 * bullets and the card's own "Timing (already decided)" line. So a card
 * about a tranche whose filing prints only "due 2027" was handed "~16mo" and
 * wrote "now about 16 months out" — a precision the filing does not state,
 * and one that is only true if the tranche matures in December. The card was
 * repeating the convention back as though it were a disclosure.
 *
 * A year-granularity fact states its year, which is all anyone knows.
 */
export function compactLabelWithTiming(triggerId: string, fallback: string, timing: TimingInfo): string {
  const label = shortTriggerLabel(triggerId, fallback);
  if (timing.dateGranularity === "year") {
    // The year itself, read back off the window date's own leading four
    // digits — there is no other year available here, and re-deriving it
    // cannot disagree with the value the rest of the pipeline sorted on.
    const year = timing.windowDate?.slice(0, 4);
    if (year) return `${label} matures ${year}`;
  }
  if (timing.monthsToNearestFuture !== null) return `${label} ~${timing.monthsToNearestFuture}mo`;
  if (timing.isPendingLive) return `${label} (pending)`;
  return label;
}
