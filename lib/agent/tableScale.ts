/**
 * RULE 67 — ONE DECIDING FUNCTION FOR A TABLE CELL'S SCALE.
 *
 * A filing declares its table's scale once, in a caption, and prints bare
 * cells beneath it. Resolving "$592" to $592 MILLION is therefore a question
 * every layer of this pipeline has to answer, and each layer grew its own
 * answer:
 *
 *   1. `deriveScaleFromFilingDeclaration` — schedule entries, prior entries,
 *      balance-sheet captions, cashAmount.
 *   2. `deriveFacilityScale` — facility figures, added in Session 24 when it
 *      turned out (1) had never covered them, which cost DaVita five figures
 *      that vanished on a coin flip.
 *   3. A harness's own `resolved()` — which compared printed cells against
 *      million-scaled expectations and reported a PERFECT 38-entry
 *      transcription of Cigna's 10-K as a failed base tie, "36 rows sum to
 *      $0M".
 *
 * THREE COPIES, THREE TIMES THE SAME BUG, each found only because a number
 * disagreed with something already known. The third was the worst: it would
 * have reported a working design as broken on its first run.
 *
 * So there is one function that decides what scale governs a cell, and the two
 * shapes callers actually need — a display string and a number for arithmetic
 * — are built on it rather than beside it. A fourth caller adds a call, not a
 * copy.
 *
 * WHAT IT DOES NOT DO: invent a scale. A cell that names its own is
 * self-describing and is returned untouched; a cell with no governing
 * declaration above it stays unresolved and says so, because a cell we cannot
 * scale must not become a plausible wrong number.
 */
import { detectDollarScaleAt, canonicalScaleWord } from "./scaleNormalize";
import { createTextLocator } from "./verifyQuote";
import { isSelfDescribingAmount } from "./moneyScale";

export interface ScaleResolution {
  /** Null when nothing governs this cell, or when the cell names its own scale. */
  word: "thousand" | "million" | null;
  multiplier: number;
  /** Why — for the never-silent path. */
  reason: "self-describing" | "governed-by-caption" | "not-locatable" | "no-declaration";
}

export type Locator = ReturnType<typeof createTextLocator>;

/** Build once per document and reuse; locating is the expensive half. */
export function locatorFor(filingText: string): Locator {
  return createTextLocator(filingText);
}

/**
 * THE ONE DECISION. What scale governs the cell this sourceLine came from?
 */
export function governingScale(amount: string, sourceLine: string, filingText: string, locator: Locator): ScaleResolution {
  // THE CELL'S OWN SCALE ALWAYS WINS. A caption cannot override a figure that
  // names its magnitude — that is the direction that turns $1B into $1
  // quadrillion.
  if (isSelfDescribingAmount(amount)) return { word: null, multiplier: 1, reason: "self-describing" };
  const at = locator.find(sourceLine);
  if (at === null) return { word: null, multiplier: 1, reason: "not-locatable" };
  const scale = detectDollarScaleAt(filingText, at);
  if (!scale) return { word: null, multiplier: 1, reason: "no-declaration" };
  const word = canonicalScaleWord(scale.scaleWord);
  return { word, multiplier: word === "million" ? 1e6 : 1e3, reason: "governed-by-caption" };
}

/**
 * The amount as it should RENDER: the cell's digits plus the tool's canonical
 * scale word. Whitespace normalised, because a table cell's padding is neither
 * the filing's figure nor ours.
 */
export function scaledAmountString(amount: string, sourceLine: string, filingText: string, locator: Locator): string {
  const r = governingScale(amount, sourceLine, filingText, locator);
  if (r.word === null) return amount;
  return `${amount.replace(/\s+/g, " ").trim()} ${r.word}`;
}

/**
 * A TABLE CELL'S VALUE, IN THE UNIT ITS CAPTION DECLARES.
 *
 * `parseMoneyAmount` requires a currency marker — a "$" or a grouping comma —
 * and returns null for a bare "549" or "43". That strictness is right for
 * prose, where a bare number is as likely to be a share count or a year as
 * money. It is wrong for a TABLE CELL, because the transcription prompt asks
 * for cells exactly as printed and a filing prints plenty of them bare.
 *
 * IT COST A WHOLE SAMPLE. Cigna's sample 2 wrote its cells without "$" where
 * sample 1 wrote them with it. Seventeen rows parsed to null, contributed
 * zero, and the base summed to 22,783 against 31,463 — a transcription that
 * was entirely correct, reported as a failed reconciliation. The gate did not
 * catch it because the gate was reading the transcribed SUBTOTAL LINES, which
 * carried "$" and parsed fine.
 *
 * So a cell is read as a number and given the scale its table declares. The
 * em-dash convention is preserved (a printed dash is a stated zero, Rule 53),
 * and anything that is not a number at all still returns null rather than a
 * guess.
 */
export function tableCellMillions(
  amount: string,
  sourceLine: string,
  filingText: string,
  locator: Locator
): number | null {
  const raw = String(amount).trim();
  if (raw === "") return null;
  // A printed dash IS a figure: zero, stated.
  if (/^[$\s]*[—–-][\s]*$/.test(raw)) return 0;
  const m = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  // A cell naming its own scale is self-describing; otherwise the caption
  // decides, through the one function that owns that decision.
  const r = governingScale(raw, sourceLine, filingText, locator);
  if (r.reason === "self-describing") {
    if (/\bbillion/i.test(raw)) return n * 1000;
    if (/\bmillion/i.test(raw)) return n;
    if (/\bthousand/i.test(raw)) return n / 1000;
    return n;
  }
  if (r.word === "million") return n;
  if (r.word === "thousand") return n / 1000;
  // No governing declaration: the cell is taken at the unit the surrounding
  // table is already being read in, which is the caller's unit. Reported as-is
  // rather than scaled by a guess.
  return n;
}

/**
 * The amount as a NUMBER, for arithmetic. Null when it cannot be read — never
 * a bare-dollars fallback, which is the 1000x error this whole module exists
 * to prevent.
 */
export function resolvedAmountUsd(
  amount: string,
  sourceLine: string,
  filingText: string,
  locator: Locator,
  parse: (s: string) => number | null
): number | null {
  const raw = parse(amount);
  if (raw === null) return null;
  const r = governingScale(amount, sourceLine, filingText, locator);
  return raw * r.multiplier;
}
