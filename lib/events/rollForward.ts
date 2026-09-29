/**
 * SESSION 25 — THE ROLL'S EVENTS, DERIVED FROM STATED FACTS.
 *
 * A prior-period base is only a position when something carries it forward,
 * and the first roll this build ever computed had its two movements TYPED IN
 * by hand from a person's own reading. That produced the right number and
 * proved nothing: a roll whose inputs are supplied cannot be wrong, and cannot
 * be right about a second company.
 *
 * So every movement is derived, each from a sentence in a filing, and each
 * PLACED BY ITS OWN DATE rather than by where it was found:
 *
 *   before the base date   it is already IN THE BASE. It moves nothing, and
 *                          the claim is checkable: it must appear among the
 *                          transcribed base rows. If it does not, the base is
 *                          incomplete and that is a finding, not a rounding.
 *   between the dates      it is a DELTA and is counted.
 *   after the anchor date  it is a SUBSEQUENT EVENT and is excluded — real,
 *                          and not part of a position as of the anchor.
 *
 * CIGNA'S FOUR TRANCHES ARE THE CASE THAT MAKES THIS WORTH BUILDING. $4.5
 * billion of notes, priced 2025-09-04, which is BEFORE the 2025-12-31 base.
 * Counting them as a delta would overstate the roll by $4.5B; ignoring them
 * because the hand roll happened to tie would be luck. Placed by their own
 * date they are in-base, and all four are confirmed present in the transcribed
 * note.
 *
 * AN INTENT IS NOT A MOVEMENT. Cigna's 8-K states an intention to repay $2.0
 * billion of a term loan. It is excluded, by status and not by date, and the
 * exclusion is stated — the same rule the ladder already applies to a
 * redemption that was announced rather than completed.
 *
 * APPROXIMATION IS CARRIED, NOT ROUNDED AWAY. "approximately $1.0 billion"
 * enters as approximate, and an approximate input is the ONLY thing the roll's
 * tolerance band may absorb. A roll made entirely of exact figures that misses
 * is a roll that is wrong, and the band must not launder it.
 */

export type Placement = "in-base" | "delta" | "subsequent" | "excluded-not-completed";

export interface RollEvent {
  kind: "repayment" | "issuance" | "balance-change";
  instrument: string;
  /** Signed: a repayment is negative, an issuance positive. */
  amountUsd: number;
  /** Verbatim, as the filing states it. */
  statedAs: string;
  /** True when the filing itself hedges the figure ("approximately"). */
  approximate: boolean;
  date: string | null;
  sourceLine: string;
  citedUrl: string;
  placement: Placement;
  why: string;
}

const APPROX = /\b(approximately|about|roughly|approx\.?)\b/i;

/** The filing hedged this figure itself — carried, never silently firmed up. */
export function statesApproximation(sourceLine: string): boolean {
  return APPROX.test(sourceLine);
}

export function placeByDate(date: string | null, baseDate: string, anchorDate: string): Placement | "undated" {
  if (!date) return "undated";
  if (date < baseDate) return "in-base";
  if (date > anchorDate) return "subsequent";
  return "delta";
}

export interface DeriveInputs {
  baseDate: string;
  anchorDate: string;
  /** Repayments and maturities the ANCHOR states. */
  noteRetirements: { instrument?: string | null; amount?: string | null; eventDate?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  /** Tranches with a stated principal, and the date the issuance itself is dated. */
  issuedTranches: { instrument?: string | null; amount?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  issuanceDate: string | null;
  /** Redemptions the filing states an INTENTION about rather than completing. */
  intendedRedemptions: { instrument?: string | null; amount?: string | null; status?: string | null; sourceLine?: string | null }[];
  /** Balances stated at the ANCHOR date, by instrument — the commercial paper case. */
  anchorBalances: { name?: string | null; category?: string | null; amount?: string | null; amountBasis?: string | null; asOfDate?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  /** The same instruments as the BASE states them, from the transcribed note. */
  baseRows: { instrument?: string | null; amount?: string | null; sourceLine?: string | null }[];
  parse: (s: string) => number | null;
  /** Resolve a base row's printed cell to dollars (the base note's caption scale). */
  resolveBase: (amount: string, sourceLine: string) => number | null;
}

export function deriveRollEvents(i: DeriveInputs): RollEvent[] {
  const out: RollEvent[] = [];
  const cited = (u?: string | null) => u ?? "";

  // ── REPAYMENTS AND MATURITIES THE ANCHOR STATES ──────────────────────
  for (const r of i.noteRetirements) {
    const amt = i.parse(String(r.amount ?? ""));
    if (amt === null) continue;
    const placement = placeByDate(r.eventDate ?? null, i.baseDate, i.anchorDate);
    out.push({
      kind: "repayment",
      instrument: String(r.instrument ?? "(unnamed)"),
      amountUsd: -Math.abs(amt),
      statedAs: String(r.amount ?? ""),
      approximate: statesApproximation(String(r.sourceLine ?? "")),
      date: r.eventDate ?? null,
      sourceLine: String(r.sourceLine ?? ""),
      citedUrl: cited(r.citedUrl),
      placement: placement === "undated" ? "excluded-not-completed" : placement,
      why:
        placement === "delta" ? "repaid between the base and anchor dates, so it is a movement the roll must carry"
        : placement === "in-base" ? "repaid before the base date, so the base already reflects it"
        : placement === "subsequent" ? "repaid after the anchor date — real, and not part of a position as of the anchor"
        : "the filing states no date for this repayment, so it cannot be placed and is not counted",
    });
  }

  // ── ISSUANCES WITH A STATED PRINCIPAL ────────────────────────────────
  for (const t of i.issuedTranches) {
    const amt = i.parse(String(t.amount ?? ""));
    if (amt === null) continue;
    const placement = placeByDate(i.issuanceDate, i.baseDate, i.anchorDate);
    out.push({
      kind: "issuance",
      instrument: String(t.instrument ?? "(unnamed)"),
      amountUsd: Math.abs(amt),
      statedAs: String(t.amount ?? ""),
      approximate: statesApproximation(String(t.sourceLine ?? "")),
      date: i.issuanceDate,
      sourceLine: String(t.sourceLine ?? ""),
      citedUrl: cited(t.citedUrl),
      placement: placement === "undated" ? "excluded-not-completed" : placement,
      why:
        placement === "in-base" ? "priced before the base date, so the base already carries it — counting it again would overstate the roll by its full principal"
        : placement === "delta" ? "priced between the base and anchor dates, so it is a movement"
        : placement === "subsequent" ? "priced after the anchor date — a subsequent event, not part of this position"
        : "the issuance carries no date, so it cannot be placed",
    });
  }

  // ── INTENTIONS, EXCLUDED BY STATUS RATHER THAN BY DATE ───────────────
  for (const d of i.intendedRedemptions) {
    const amt = i.parse(String(d.amount ?? ""));
    if (amt === null || String(d.status ?? "").toLowerCase() === "completed") continue;
    out.push({
      kind: "repayment",
      instrument: String(d.instrument ?? "(unnamed)"),
      amountUsd: 0,
      statedAs: String(d.amount ?? ""),
      approximate: statesApproximation(String(d.sourceLine ?? "")),
      date: null,
      sourceLine: String(d.sourceLine ?? ""),
      citedUrl: "",
      placement: "excluded-not-completed",
      why: `the filing states this as ${String(d.status ?? "an intention")} rather than done. An intent is not a movement, and a roll that counts one reports money that has not left`,
    });
  }

  // ── BALANCE CHANGES: the anchor's stated balance less the base's ─────
  for (const b of i.anchorBalances) {
    if (String(b.amountBasis ?? "") !== "outstanding") continue;
    const atAnchor = i.parse(String(b.amount ?? ""));
    if (atAnchor === null) continue;
    const name = String(b.name ?? "");
    const baseRow = i.baseRows.find((x) => sameInstrument(String(x.instrument ?? ""), name));
    const atBase = baseRow ? i.resolveBase(String(baseRow.amount ?? ""), String(baseRow.sourceLine ?? "")) ?? 0 : null;
    if (atBase === null) continue; // not stated at the base: nothing to difference, and a guess is not a delta
    out.push({
      kind: "balance-change",
      instrument: name,
      amountUsd: atAnchor - atBase,
      statedAs: `${String(b.amount ?? "")} at ${String(b.asOfDate ?? i.anchorDate)} against ${baseRow?.amount ?? "—"} at ${i.baseDate}`,
      approximate: statesApproximation(String(b.sourceLine ?? "")),
      date: String(b.asOfDate ?? i.anchorDate),
      sourceLine: String(b.sourceLine ?? ""),
      citedUrl: cited(b.citedUrl),
      placement: "delta",
      why: "a revolving balance moves without an event to cite, so its movement IS the difference between the two dates' stated balances",
    });
  }

  return out;
}

export interface RollResult {
  total: number;
  counted: RollEvent[];
  inBase: RollEvent[];
  excluded: RollEvent[];
  /** How much of the counted movement came from figures the filing itself hedged. */
  approximateUsd: number;
  /** Every in-base event that could NOT be found among the base rows — a real gap. */
  missingFromBase: RollEvent[];
}

export function rollForward(
  baseUsd: number,
  events: RollEvent[],
  baseRows: { instrument?: string | null }[]
): RollResult {
  const counted = events.filter((e) => e.placement === "delta");
  const inBase = events.filter((e) => e.placement === "in-base");
  const excluded = events.filter((e) => e.placement === "subsequent" || e.placement === "excluded-not-completed");
  // AN IN-BASE CLAIM IS CHECKABLE. "The base already carries it" is an
  // assertion about the transcription, and if the instrument is not there the
  // base is short by that amount and the roll would tie for the wrong reason.
  const missingFromBase = inBase.filter(
    (e) => !baseRows.some((r) => sameInstrument(String(r.instrument ?? ""), e.instrument))
  );
  return {
    total: counted.reduce((a, e) => a + e.amountUsd, baseUsd),
    counted,
    inBase,
    excluded,
    approximateUsd: counted.filter((e) => e.approximate).reduce((a, e) => a + Math.abs(e.amountUsd), 0),
    missingFromBase,
  };
}

/**
 * Two names for one instrument. Rate and maturity are what a filing repeats
 * about a tranche; the wording around them is not (Rule 49). Deliberately
 * strict on the rate — two notes differing only in coupon are two notes.
 */
export function sameInstrument(a: string, b: string): boolean {
  const rate = (s: string) => s.match(/(\d+\.\d+)\s*%/)?.[1] ?? null;
  const year = (s: string) => s.match(/\b(20\d{2})\b/)?.[1] ?? null;
  const ra = rate(a), rb = rate(b);
  if (ra && rb) return ra === rb && (year(a) === year(b) || year(a) === null || year(b) === null);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const na = norm(a), nb = norm(b);
  return na !== "" && (na === nb || na.includes(nb) || nb.includes(na));
}
