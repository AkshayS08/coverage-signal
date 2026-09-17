/**
 * SESSION 22, STAGE 5 — A FACILITY'S STATED MATURITY, RESOLVED OR REFUSED.
 *
 * A term loan and a revolver mature like a bond does, and those are the
 * strongest refi conversations on the book — a facility coming due is a
 * renewal negotiation with a date on it. Measured before this existed: 18
 * facilities, 16 stating a maturity, and only 5 whose LADDER ROW carried one.
 * Centene's term loan is the named case: the facility states March 5, 2030 and
 * the ladder row states nothing at all.
 *
 * The facility's maturity arrives as the filing's own words — "March 5,
 * 2030", "April 2030", "November 4, 2030" — because every figure in this
 * schema is copied, never computed. Turning those words into a comparable
 * date is this module's only job.
 *
 * THREE OUTCOMES, NOT TWO, for the same reason corpus.ts has three: "the
 * filing states no maturity" and "the filing states one I cannot turn into a
 * date" are different facts about the company, and collapsing them reports a
 * disclosure gap the filer does not have.
 *
 *   HCA   "five years"
 *   UHS   "364 days after funding"
 *
 * Both are real, stated maturities. Neither is a date, because both are
 * relative to an event the filing does not date here. A facility like that
 * must never card — there is no date to be inside a window — and must never
 * read as "no maturity stated", which would be false about the filing.
 *
 * NO DATE PARSER IS WRITTEN HERE. `extractFactTokens` already parses dates
 * into year/month/day with exactly the partial-precision rules the rest of
 * this pipeline compares dates by, and it is the same function the quote
 * verifier uses. A second parser would be a second opinion about what a date
 * is — the same defect as two fields holding one instrument.
 */
import { extractFactTokens } from "../agent/factTokens";
import type { DateGranularity } from "../agent/claude";

export type FacilityMaturity =
  /** A date the window gate can compare against. */
  | { outcome: "dated"; date: string; granularity: DateGranularity; statedAs: string }
  /** The filing states a maturity, and it is not a date. Real, and never cardable. */
  | { outcome: "relative"; statedAs: string; why: string }
  /** The filing states no maturity for this facility at all. */
  | { outcome: "unstated" };

/** Zero-padded, so the result is directly comparable with every other ISO date in the pipeline. */
function iso(year: number, month: number | null, day: number | null): string {
  return `${year}-${String(month ?? 1).padStart(2, "0")}-${String(day ?? 1).padStart(2, "0")}`;
}

/**
 * Resolve a facility's stated maturity text.
 *
 * REFUSES ON AMBIGUITY. A value naming several dates — "extended the
 * scheduled maturity date from March 16, 2027 to November 4, 2030" is a real
 * sentence in this book — cannot be resolved to one maturity by counting, and
 * picking the later or the first would be a convention the filing never
 * stated. The facility's own `maturity.value` is normally the date alone;
 * where it is not, saying so is better than guessing which one it meant.
 */
export function resolveFacilityMaturity(statedValue: string | null | undefined): FacilityMaturity {
  const stated = (statedValue ?? "").trim();
  if (stated === "") return { outcome: "unstated" };

  const dates = extractFactTokens(stated).filter((t) => t.kind === "date" && t.dateValue);
  if (dates.length === 0) {
    return {
      outcome: "relative",
      statedAs: stated,
      why: `the filing states this facility's maturity as "${stated}", which names no date — it is measured from an event this disclosure does not date`,
    };
  }
  if (dates.length > 1) {
    return {
      outcome: "relative",
      statedAs: stated,
      why: `the filing's stated maturity for this facility names ${dates.length} dates ("${stated}"), and choosing between them would be a convention the filing does not state`,
    };
  }

  const d = dates[0].dateValue!;
  // Same granularity vocabulary the schedule rows use, so downstream window
  // logic cannot tell a facility's date from a bond's.
  const granularity: DateGranularity = d.month === null ? "year" : d.day === null ? "month" : "day";
  return { outcome: "dated", date: iso(d.year, d.month, d.day), granularity, statedAs: stated };
}

/**
 * How a facility's maturity reads when it cannot be a date. Never blank, and
 * never phrased as an absence of disclosure — the filer disclosed it.
 */
export function facilityMaturityNote(m: FacilityMaturity): string | null {
  if (m.outcome === "dated") return null;
  if (m.outcome === "unstated") return "no maturity stated for this facility, so it is not carded";
  return `${m.why} — so it cannot be placed in a refinancing window, and is not carded`;
}
