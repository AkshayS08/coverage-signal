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

/** The short label plus a timing suffix — "refi window ~9mo", "asset sale proceeds (pending)", or just the label if undated. */
export function compactLabelWithTiming(triggerId: string, fallback: string, timing: TimingInfo): string {
  const label = shortTriggerLabel(triggerId, fallback);
  if (timing.monthsToNearestFuture !== null) return `${label} ~${timing.monthsToNearestFuture}mo`;
  if (timing.isPendingLive) return `${label} (pending)`;
  return label;
}
