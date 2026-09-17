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

/**
 * THE CARD HEADER'S TIMING TAG, in one place (Session 22, Stage 1).
 *
 * It lived in app/page.tsx as `formatHeadlineDate` and reconstructed a date
 * by adding a ROUNDED MONTH COUNT to the run date:
 *
 *     future.setMonth(future.getMonth() + Math.round(monthsToNearestFuture))
 *
 * That is wrong twice. It re-derives a date the pipeline already holds
 * exactly, so rounding could move the printed month; and it never branched
 * on dateGranularity, so a tranche whose filing prints only "due 2027" got
 * December 31 — the code's own worst-case convention — read back as
 * "matures ~Dec 2027". `computeWindowDate`'s contract forbids exactly that,
 * and `compactLabelWithTiming` above has honoured it since stage 2 while
 * the card header did not. Two surfaces answering one question, disagreeing.
 *
 * Now: a bare year says the year, a real date says the date it states, and
 * nothing is reconstructed from a count.
 */
export function headlineTimingTag(
  timing: TimingInfo,
  citations: { form: string; date: string }[],
  asOf: Date
): string {
  if (timing.dateGranularity === "year") {
    const year = timing.windowDate?.slice(0, 4);
    if (year) return `matures during ${year}`;
  }
  if (timing.windowDate && timing.monthsToNearestFuture !== null) {
    const d = new Date(timing.windowDate);
    if (!Number.isNaN(d.getTime())) {
      return `matures ${d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`;
    }
  }
  const mostRecent = [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (mostRecent) {
    const d = new Date(mostRecent.date);
    if (!Number.isNaN(d.getTime())) {
      return `${mostRecent.form} filed ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    }
  }
  return timing.isPendingLive ? "pending" : "";
}
