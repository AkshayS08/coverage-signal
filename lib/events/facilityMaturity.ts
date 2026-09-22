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

/**
 * A MATURITY STATED AS A SPAN FROM AN EVENT — the shape that cannot be a date
 * until the event happens. Closed vocabulary of spans, not of filers.
 */
const RELATIVE_TERM =
  /\b\d[\d,]*\s*(?:days?|months?|years?)\s+(?:after|from|following)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b|\banniversary\s+of\b/i;

/** A date immediately governed by one of these IS the maturity. */
const MATURITY_PREDICATE = /\b(?:matur\w*|due|payable|expir\w*|terminat\w*|final\s+maturity)\b[^.;]{0,24}$/i;

/**
 * What a date sitting in a maturity sentence is otherwise predicated of. Each
 * is a real fact about the facility, and none of them is when it comes due.
 */
const OTHER_PREDICATE: { re: RegExp; of: string }[] = [
  { re: /\bfund(?:ed|ing)\b/i, of: "when the facility may be FUNDED" },
  { re: /\bdraw(?:n|ing)?\b|\bborrow(?:ed|ing)\b|\butiliz/i, of: "when it may be DRAWN" },
  { re: /\bamend(?:ed|ment)\b|\bentered\s+into\b/i, of: "when an AMENDMENT was made" },
  { re: /\beffective\b|\bcommenc\w*\b/i, of: "when it became EFFECTIVE" },
  { re: /\bthrough\b|\bperiod\s+from\b|\bavailab\w*\b/i, of: "the AVAILABILITY period" },
];

/** The date tokens as they appear in the text, so what precedes one can be read. */
const DATE_IN_TEXT =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}?,?\s*\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi;

/**
 * WHAT IS THIS DATE ATTACHED TO? Rule 57.
 *
 * `resolveFacilityMaturity` took the single date token in the stated value and
 * called it the maturity. UHS is the measured cost. Its 10-Q says the $700
 * million delayed draw loan "would be FUNDED on or prior to September 30,
 * 2026, with a maturity date 364 days after the initial funding" — so the only
 * date in the sentence is the FUNDING deadline, and the maturity is a span
 * from an event the disclosure does not date. Drawn on the last permitted day,
 * the facility matures around September 30, 2027.
 *
 * Taking it anyway carded a $700 million maturity TWELVE MONTHS EARLY, and it
 * did so in one run of three — so the variance we were about to chase was a
 * coin flip between correct and materially wrong.
 *
 * The test is predication, not proximity: where the maturity itself is stated
 * as a relative term, a date in the same sentence is the maturity only if the
 * clause predicates it of maturity. Otherwise the facility is `relative` and
 * cannot card — which is what this module's own header always said it should
 * be, defeated by a foreign date sitting inside the string.
 *
 * DELIBERATELY CONSERVATIVE. A genuine outside bound that names no maturity
 * word — "364 days after funding, but in no event later than December 31,
 * 2027" — also resolves `relative`. Refusing to card is the safe direction and
 * the facility still renders its stated words; carding on a date the sentence
 * does not predicate of maturity is the failure that cannot be taken back.
 */
function predicationOf(stated: string): { kind: "maturity" } | { kind: "other"; of: string; date: string } | null {
  if (!RELATIVE_TERM.test(stated)) return null; // no relative term: nothing to adjudicate
  const matches = [...stated.matchAll(DATE_IN_TEXT)];
  if (matches.length === 0) return null;
  const m = matches[0];
  const before = stated.slice(0, m.index ?? 0);
  if (MATURITY_PREDICATE.test(before)) return { kind: "maturity" };
  for (const p of OTHER_PREDICATE) {
    if (p.re.test(before)) return { kind: "other", of: p.of, date: m[0] };
  }
  return { kind: "other", of: "something the clause does not state is maturity", date: m[0] };
}

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

  // RULE 57 — a date is the maturity only where the clause predicates it of
  // maturity. Checked before the date is accepted, never after.
  const predication = predicationOf(stated);
  if (predication && predication.kind === "other") {
    return {
      outcome: "relative",
      statedAs: stated,
      why:
        `the filing states this facility's maturity as a span from an event it does not date, and the only date in ` +
        `"${stated}" is ${predication.of} (${predication.date}) — a real fact about the facility, and not when it comes due`,
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
