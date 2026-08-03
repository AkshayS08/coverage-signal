/**
 * Card Eligibility Spec v2 — static trigger -> bucket mapping.
 *
 * The 15-trigger taxonomy is unchanged; this is purely a downstream lookup
 * from triggerId to one of the 4 opportunity buckets the redesign groups
 * cards/table rows into. Distress (covenant-breach) maps to no bucket at
 * all — it's a relationship flag, never a sell opportunity, and is
 * surfaced separately (CompanyResult.relationshipFlags), same as before.
 *
 * A few placements are non-obvious from the trigger name alone:
 * - "new-debt-issuance" -> TREASURY, not NEW_DEBT. Per spec bucket 1, a
 *   completed raise (the notes already priced) is a "proceeds need a home"
 *   conversation, not a "we need financing" one — the borrowing already
 *   happened.
 * - "acquisition-announced" -> NEW_DEBT (bridge financing need), matching
 *   its own mappedNeed. When the same 8-K also describes a divestiture
 *   (the reporting company is the seller, not the acquirer), dedup
 *   clustering merges it with the asset-sale trigger and the merged
 *   event's bucket resolves to TREASURY instead (see buildEvents.ts).
 */
export type Bucket = "treasury" | "new_debt" | "refi" | "hedging";

export const BUCKET_LABELS: Record<Bucket, string> = {
  treasury: "Treasury / deposits",
  new_debt: "New debt / financing need",
  refi: "Refi (debt maturity)",
  hedging: "FX / rate hedging",
};

/** Deterministic tie-break when a merged event spans more than one bucket. */
export const BUCKET_PRIORITY: Bucket[] = ["treasury", "new_debt", "refi", "hedging"];

export const TRIGGER_BUCKET: Record<string, Bucket | null> = {
  // Credit / lending
  "debt-maturity": "refi",
  "new-debt-issuance": "treasury",
  "acquisition-announced": "new_debt",
  "capex-program": "new_debt",
  "revolver-near-capacity": "new_debt",
  "dividend-buyback": "new_debt",

  // Treasury / deposits
  "large-cash-balance": "treasury",
  "asset-sale": "treasury",
  "international-expansion": "hedging",
  "new-subsidiary": "treasury",
  "ipo-secondary": "treasury",

  // Risk / hedging
  "floating-rate-debt": "hedging",
  "commodity-exposure": "hedging",
  "fx-exposure": "hedging",

  // Distress / defensive — no bucket, never a card or table row.
  "covenant-breach": null,
};

export function bucketForTrigger(triggerId: string): Bucket | null {
  return TRIGGER_BUCKET[triggerId] ?? null;
}
