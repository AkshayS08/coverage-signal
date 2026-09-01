/**
 * INSTRUMENT FACTS — what one debt instrument IS, independent of any surface
 * that reports it.
 *
 * SESSION 21: these lived in coverage.ts, which was fine while coverage was
 * the only thing that asked. It no longer is — the position layer builds a
 * ladder line for every instrument, including the prose half, and it has to
 * decide the same two questions coverage decides: is this amount owed or is
 * it capacity, and is this instrument the same one as that table row.
 *
 * Two modules asking one question is how a rendered line and the total above
 * it come to disagree (Rule 21's corollary, which cost a real render defect
 * in Session 20: a revolver line reading "capacity, not debt" above a
 * coverage figure that counted its drawn balance). And importing coverage
 * from position, while position is what coverage is built on, is a cycle.
 *
 * So the instrument-level facts get their own home and every layer reads it,
 * which is Rule 7 applied one level up from the glyph table.
 */
import { parseMoneyAmount } from "./position";
import type { ProseInstrumentRow, RevolverRow, VerifiedSequenceEntry } from "../agent";

export type DebtCategory = ProseInstrumentRow["category"];

/**
 * 3C — DEDUP BEFORE COVERAGE.
 *
 * A prose instrument that duplicates a table row is ONE entry. Without this,
 * a company whose note both tabulates its senior notes and describes them in
 * narrative counts them twice and reports impossible coverage — and UHS's own
 * "Subtotal — revolving credit, term loan A and Senior Notes" is exactly the
 * shape that would do it.
 *
 * Matched on CATEGORY plus AMOUNT, never on name: a filing calls the same
 * facility different things in different sentences.
 */
/**
 * SESSION 20, STAGE 4 — ONE INSTRUMENT IN TWO UNITS IS STILL ONE.
 *
 * Matching was exact equality on the parsed amount, which is exact equality
 * on how the filing chose to PRINT the figure. The same term loan written
 * "$ 1.448 billion" in a sentence and "1,447,500" in a table stated in
 * thousands is 1.448e9 against 1.4475e9 — a 0.03% difference that is not a
 * difference at all, it is one number rounded for prose.
 *
 * The test is not a tolerance band. It is the rounding relationship itself:
 * the more precise figure MATCHES the less precise one when it rounds to it
 * at the less precise one's OWN PRINTED PRECISION. "$1.448 billion" carries
 * three decimals of a billion, 1.4475e9 rounds to 1.448e9 there, so they
 * match; "$1.155 billion" also carries three, 1.1625e9 rounds to 1.163e9
 * there, so they do not — and they should not, because those two ARE
 * different balances of an amortising loan at two different dates.
 */
function printedPrecision(raw: string): number {
  const m = raw.match(/([\d,]+)(?:\.(\d+))?\s*(thousand|million|billion|bn|mm|k)?/i);
  if (!m) return 0;
  const unit = (m[3] ?? "").toLowerCase();
  const scale = unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit.startsWith("t") || unit === "k" ? 1e3 : 1;
  return scale / Math.pow(10, (m[2] ?? "").length);
}

/** Do two printed amounts state the same figure, once units are normalised and the coarser one's own rounding is allowed for? */
export function sameNormalisedAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const va = parseMoneyAmount(a);
  const vb = parseMoneyAmount(b);
  if (va === null || vb === null || va <= 0 || vb <= 0) return false;
  if (va === vb) return true;
  // Round the finer figure at the coarser one's precision and compare there.
  const step = Math.max(printedPrecision(a), printedPrecision(b));
  if (!Number.isFinite(step) || step <= 0) return false;
  return Math.round(va / step) === Math.round(vb / step);
}

/** A four-digit maturity year, from an ISO date or a bare year. Null when the entry states none. */
function maturityYear(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/** Coupon rate as a number, when stated. */
function rateOf(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/**
 * INSTRUMENT CONTINUITY. Two entries are the same instrument only if nothing
 * they BOTH state contradicts. A maturity or a rate stated on both and
 * differing is the filing telling us these are two instruments, whatever
 * their sizes are — which is what keeps UHS's three separate $500 million
 * senior notes (2029, 2032, 2034) three, and would keep them three even if
 * every other signal collapsed them.
 */
interface Continuity { maturityDate: string | null; rate: string | null; label?: string | null; name?: string | null }

/**
 * An instrument's distinguishing facts, read from wherever the filing put
 * them. A transcribed bullet often carries its maturity in its own LABEL
 * ("4.625 % senior secured notes due in October, 2029") and nowhere else,
 * and a rule that only reads the maturityDate field would find no
 * contradiction between three notes that plainly contradict.
 */
function statedYear(e: Continuity): number | null {
  return maturityYear(e.maturityDate) ?? maturityYear(e.label ?? e.name);
}
function statedRate(e: Continuity): number | null {
  return rateOf(e.rate) ?? rateOf(e.label ?? e.name);
}

function contradicts(a: Continuity, b: Continuity): boolean {
  const ya = statedYear(a), yb = statedYear(b);
  if (ya !== null && yb !== null && ya !== yb) return true;
  const ra = statedRate(a), rb = statedRate(b);
  if (ra !== null && rb !== null && Math.abs(ra - rb) > 0.001) return true;
  return false;
}

export function dedupAgainstRows(
  prose: ProseInstrumentRow[],
  rows: VerifiedSequenceEntry[]
): { kept: ProseInstrumentRow[]; suppressed: ProseInstrumentRow[] } {
  const kept: ProseInstrumentRow[] = [];
  const suppressed: ProseInstrumentRow[] = [];
  for (const p of prose) {
    // DEDUP IS AGAINST ROWS ONLY, NEVER PROSE AGAINST PROSE.
    //
    // An earlier cut also collapsed prose entries sharing a category and an
    // amount, and it cost exactly $1B on the worked example: UHS issued THREE
    // separate $500 million senior notes (2029, 2032, 2034), which are three
    // instruments that happen to be the same size. Same category and same
    // amount is the signature of a duplicate only when one of the two is a
    // TABLE ROW — because then the note has printed the instrument twice, once
    // in each form. Two sentences are two instruments.
    const twin = rows.find((r) => sameNormalisedAmount(r.amount, p.amount) && !contradicts(r, p));
    if (twin) suppressed.push(p);
    else kept.push(p);
  }
  return { kept, suppressed };
}

/**
 * SESSION 20, STAGE 4 — DEBT IS WHAT IS DRAWN.
 *
 * An undrawn commitment is capacity. It is a real fact, it belongs on the
 * liquidity line, and it is not owed. The distinction was already drawn once
 * here — the delayed-draw facility was excluded — and drawn in ONE PLACE
 * only, as a category name rather than as the distinction itself, so every
 * other facility went through uncounted. Measured on v22: Molina contributed
 * its $1.25 billion facility SIZE against nothing drawn, Tenet its $1.900
 * billion against $0 drawn, and both rendered above 100% coverage.
 *
 * Three tests, in order, none of them a list of facility names:
 *   1. A revolving facility contributes its DRAWN balance and nothing else.
 *      The drawn figure has its own field precisely because size and balance
 *      are different numbers; where the note states no drawn balance, the
 *      facility contributes zero.
 *   2. An amount the note itself states as a commitment contributes zero,
 *      whatever kind of instrument it is. This is the general form, and it
 *      is why a facility type nobody has seen yet is handled.
 *   3. Otherwise the stated amount is a balance and counts.
 *
 * Nothing excluded is silently dropped — every one is returned as capacity
 * and rendered on its own line.
 */
export function debtContribution(
  p: ProseInstrumentRow,
  revolver: RevolverRow | null | undefined
): { amount: number | null; capacity: boolean; why: string } {
  if (p.category === "revolver") {
    const drawn = revolver?.drawn ? parseMoneyAmount(revolver.drawn) : null;
    if (drawn === null) return { amount: null, capacity: true, why: "revolving facility, no drawn balance stated — capacity, not debt" };
    return { amount: drawn, capacity: drawn === 0, why: drawn === 0 ? "revolving facility, nothing drawn" : "revolving facility, drawn balance" };
  }
  if (p.category === "delayed-draw-term-loan") {
    return { amount: null, capacity: true, why: "committed but undrawn — capacity, not debt" };
  }
  if (p.amountBasis === "commitment") {
    return { amount: null, capacity: true, why: "the note states this amount as a commitment, not a balance outstanding" };
  }
  return { amount: p.amount ? parseMoneyAmount(p.amount) : null, capacity: false, why: "stated balance outstanding" };
}

