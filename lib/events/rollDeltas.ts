/**
 * SESSION 25 — DERIVING THE ROLL'S DELTAS FROM STATED FACTS.
 *
 * `rollForward.ts` (Session 23) computes the base tie, the roll tie, the
 * tolerance and the conjunction that decides whether a roll may fire at all.
 * It takes `deltas: RollDelta[]` as an INPUT, and until now the only deltas
 * that existed were hand-written — in its own test file, and in a harness
 * where a person's reading was typed in. A roll whose movements are supplied
 * cannot be wrong, and cannot be right about a second company.
 *
 * THIS FILE IS THAT MISSING HALF AND NOTHING MORE. It reads movements out of
 * the filings and hands them to the existing machinery. It deliberately does
 * NOT re-implement the ties, the band, or the firing conjunction: those are
 * decided in one place, and a second copy of them is how two answers to one
 * question start disagreeing. (A first draft of this work did re-implement all
 * three, overwrote rollForward.ts entirely, and destroyed 29 assertions
 * including the fair-value frame test — caught only because the repo-wide
 * assertion count went DOWN while a suite was being added.)
 *
 * EVERY MOVEMENT IS PLACED BY ITS OWN DATE:
 *
 *   before the base date   already IN THE BASE. It moves nothing, and the
 *                          claim is checkable — it must appear among the
 *                          transcribed base rows, or the base is short by
 *                          that amount and that is a finding.
 *   between the dates      a DELTA, handed to rollForward.
 *   after the anchor date  a SUBSEQUENT EVENT, excluded.
 *
 * Cigna's four tranches are why this matters: $4.5 billion priced 2025-09-04
 * against a 2025-12-31 base. Counting them as movements would overstate the
 * roll by their full principal; ignoring them because the hand roll happened
 * to tie would be luck. Placed by their own date they are in-base, and all
 * four are confirmed present in the transcribed note.
 *
 * AN INTENT IS NOT A MOVEMENT — excluded by status rather than by date, with
 * its reason carried, the same rule the ladder already applies to an announced
 * redemption.
 *
 * A REVOLVING BALANCE has no event to cite, so its movement IS the difference
 * between the two dates' stated balances.
 */
import type { RollDelta } from "./rollForward";

export type Placement = "in-base" | "delta" | "subsequent" | "excluded-not-completed" | "undated";

export interface PlacedMovement {
  kind: "repayment" | "issuance" | "balance-change";
  instrument: string;
  /** Signed millions, matching RollDelta's unit. */
  amountMillions: number;
  statedAs: string;
  date: string | null;
  sourceLine: string;
  citedUrl: string;
  placement: Placement;
  why: string;
}

const APPROX = /\b(approximately|about|roughly|approx\.?)\b/i;

/** The FILING's own hedge, not our uncertainty. `rollForward.toleranceFor` is what acts on it. */
export function statesApproximation(sourceLine: string): boolean {
  return APPROX.test(sourceLine);
}

export function placeByDate(date: string | null, baseDate: string, anchorDate: string): Placement {
  if (!date) return "undated";
  if (date < baseDate) return "in-base";
  if (date > anchorDate) return "subsequent";
  return "delta";
}

/**
 * Two names for one instrument. Rate and maturity year are what a filing
 * repeats about a tranche; the wording around them is not (Rule 49). Strict on
 * the rate, because two notes differing only in coupon are two notes.
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

/**
 * A BALANCE IS TAKEN AT THE DATE ITS OWN SENTENCE PREDICATES.
 *
 * The commercial-paper delta was read off the model's `asOfDate` field. One
 * run in three set that field to the BASE date with a null amount and a basis
 * of "commitment" — reading the 10-K's period instead of the 10-Q's — and the
 * delta vanished, missing the roll by 965.
 *
 * This is the CHS/B4 pattern exactly: a derivation resting on one optional
 * model field. The fix is the same one that rule took — read the filing.
 * The sentence states the date ("outstanding as of June 30, 2026"), and the
 * sentence is in the anchor's text whether the model's field agrees or not.
 * The field stays as ONE SIGNAL and is never the only one; a disagreement is
 * logged rather than silently resolved.
 *
 * WHERE A FIGURE IS STATED TWICE, THE HEDGE SURVIVES. Cigna's anchor states
 * this balance in two sentences at the same date — one "approximately $1.0
 * billion", one "an outstanding balance of $1.0 billion". They are the same
 * rounded figure, and treating it as exact because the second sentence omits
 * the qualifier would assert a precision the filer did not consistently
 * claim. Stated plainly because it is also the reading under which the roll
 * ties: an exact figure earns no band, and the roll misses by 35.
 */
export interface StatedBalance {
  amountText: string;
  approximate: boolean;
  sourceLine: string;
  /** Every sentence at this date that states the figure, for the record. */
  corroborating: number;
}

export function statedBalanceAt(
  filingText: string,
  namePattern: RegExp,
  dateTokens: string[]
): StatedBalance | null {
  const sentences = filingText.split(/(?<=[.;])\s+/).map((s) => s.replace(/\s+/g, " ").trim());
  const hits = sentences.filter(
    (s) =>
      namePattern.test(s) &&
      /\b(outstanding|balance)\b/i.test(s) &&
      dateTokens.some((d) => s.includes(d)) &&
      /\$\s*[\d.,]+/.test(s)
  );
  if (hits.length === 0) return null;
  // The shortest is the most directly about this figure; a long sentence that
  // mentions it in passing is weaker evidence than one whose subject it is.
  const best = [...hits].sort((a, b) => a.length - b.length)[0];
  return {
    amountText: best.match(/\$\s*[\d.,]+\s*(billion|million|thousand)?/i)?.[0] ?? "",
    approximate: hits.some((s) => APPROX.test(s)),
    sourceLine: best,
    corroborating: hits.length,
  };
}

export interface DeriveInputs {
  baseDate: string;
  anchorDate: string;
  noteRetirements: { instrument?: string | null; amount?: string | null; eventDate?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  issuedTranches: { instrument?: string | null; amount?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  issuanceDate: string | null;
  intendedRedemptions: { instrument?: string | null; amount?: string | null; status?: string | null; sourceLine?: string | null }[];
  /** Balances the ANCHOR states as outstanding — the commercial-paper case. */
  anchorBalances: { name?: string | null; amount?: string | null; amountBasis?: string | null; asOfDate?: string | null; sourceLine?: string | null; citedUrl?: string | null }[];
  /** The same instruments as the BASE states them, from the transcribed note. */
  baseRows: { instrument?: string | null; amount?: string | null; sourceLine?: string | null }[];
  /** Millions. Supplied so this file owns no scale logic of its own (Rule 67). */
  parseMillions: (amount: string, sourceLine: string) => number | null;
}

export function derivePlacedMovements(i: DeriveInputs): PlacedMovement[] {
  const out: PlacedMovement[] = [];
  const url = (u?: string | null) => u ?? "";

  for (const r of i.noteRetirements) {
    const m = i.parseMillions(String(r.amount ?? ""), String(r.sourceLine ?? ""));
    if (m === null) continue;
    const placement = placeByDate(r.eventDate ?? null, i.baseDate, i.anchorDate);
    out.push({
      kind: "repayment", instrument: String(r.instrument ?? "(unnamed)"),
      amountMillions: -Math.abs(m), statedAs: String(r.amount ?? ""),
      date: r.eventDate ?? null, sourceLine: String(r.sourceLine ?? ""), citedUrl: url(r.citedUrl), placement,
      why:
        placement === "delta" ? "repaid between the base and anchor dates, so the roll must carry it"
        : placement === "in-base" ? "repaid before the base date, so the base already reflects it"
        : placement === "subsequent" ? "repaid after the anchor — real, and not part of a position as of the anchor"
        : "no date is stated, so it cannot be placed and is not counted",
    });
  }

  for (const t of i.issuedTranches) {
    const m = i.parseMillions(String(t.amount ?? ""), String(t.sourceLine ?? ""));
    if (m === null) continue;
    const placement = placeByDate(i.issuanceDate, i.baseDate, i.anchorDate);
    out.push({
      kind: "issuance", instrument: String(t.instrument ?? "(unnamed)"),
      amountMillions: Math.abs(m), statedAs: String(t.amount ?? ""),
      date: i.issuanceDate, sourceLine: String(t.sourceLine ?? ""), citedUrl: url(t.citedUrl), placement,
      why:
        placement === "in-base" ? "priced before the base date — the base already carries it, and counting it again would overstate the roll by its full principal"
        : placement === "delta" ? "priced between the base and anchor dates, so it is a movement"
        : placement === "subsequent" ? "priced after the anchor — a subsequent event"
        : "the issuance carries no date, so it cannot be placed",
    });
  }

  for (const d of i.intendedRedemptions) {
    if (String(d.status ?? "").toLowerCase() === "completed") continue;
    const m = i.parseMillions(String(d.amount ?? ""), String(d.sourceLine ?? ""));
    if (m === null) continue;
    out.push({
      kind: "repayment", instrument: String(d.instrument ?? "(unnamed)"),
      amountMillions: 0, statedAs: String(d.amount ?? ""), date: null,
      sourceLine: String(d.sourceLine ?? ""), citedUrl: "", placement: "excluded-not-completed",
      why: `the filing states this as ${String(d.status ?? "an intention")} rather than done. An intent is not a movement, and a roll that counted one would report money that has not left`,
    });
  }

  for (const b of i.anchorBalances) {
    if (String(b.amountBasis ?? "") !== "outstanding") continue;
    const atAnchor = i.parseMillions(String(b.amount ?? ""), String(b.sourceLine ?? ""));
    if (atAnchor === null) continue;
    const name = String(b.name ?? "");
    const baseRow = i.baseRows.find((x) => sameInstrument(String(x.instrument ?? ""), name));
    if (!baseRow) continue; // not stated at the base: nothing to difference, and a guess is not a delta
    const atBase = i.parseMillions(String(baseRow.amount ?? ""), String(baseRow.sourceLine ?? "")) ?? 0;
    out.push({
      kind: "balance-change", instrument: name,
      amountMillions: atAnchor - atBase,
      statedAs: `${String(b.amount ?? "")} at ${String(b.asOfDate ?? i.anchorDate)} against ${baseRow.amount ?? "—"} at ${i.baseDate}`,
      date: String(b.asOfDate ?? i.anchorDate), sourceLine: String(b.sourceLine ?? ""), citedUrl: url(b.citedUrl),
      placement: "delta",
      why: "a revolving balance moves with no event to cite, so its movement IS the difference between the two dates' stated balances",
    });
  }

  return out;
}

/** The counted movements, in the shape `rollForward` already consumes. */
export function toRollDeltas(movements: PlacedMovement[]): RollDelta[] {
  return movements
    .filter((m) => m.placement === "delta")
    .map((m) => ({
      label: m.instrument,
      amountMillions: m.amountMillions,
      sourceLine: m.sourceLine,
      citedUrl: m.citedUrl,
      statedApproximate: statesApproximation(m.sourceLine),
    }));
}

/**
 * IN-BASE CLAIMS THAT THE TRANSCRIPTION DOES NOT SUPPORT. "The base already
 * carries it" is an assertion about the transcribed rows; unchecked, it lets
 * the roll tie for the wrong reason.
 */
export function inBaseButMissing(movements: PlacedMovement[], baseRows: { instrument?: string | null }[]): PlacedMovement[] {
  return movements
    .filter((m) => m.placement === "in-base")
    .filter((m) => !baseRows.some((r) => sameInstrument(String(r.instrument ?? ""), m.instrument)));
}
