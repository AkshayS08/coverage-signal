import { parseMoneyAmount } from "./position";
import { extractFactTokens } from "../agent/factTokens";
import { isStatedZeroAmount } from "../agent/moneyScale";

/**
 * E7 (Session 18, post-stage-2) — ONE MONEY FORMATTER, AT THE DISPLAY LAYER.
 *
 * Extraction preserves whatever unit the filing printed, which is correct:
 * "$ 2,750,000 thousands" and "$ 1,500 millions" and "$600,000,000" are the
 * same kind of fact recorded in three companies' three conventions, and
 * normalising them at extraction would throw away the filing's own words
 * before verification could check them against it. So the raw strings are
 * right where they are, and it is the RENDER layer that has been passing them
 * through unchanged. Measured across one book, the same column produced:
 *
 *     $ 1,500 millions      $ 2,750,000 thousands      $699,887 thousand
 *     $600,000,000          $ 788.4 million            $ —
 *
 * Six spellings, four scales, two pluralisations, in one table. An RM
 * comparing two tranches should not have to do unit arithmetic in their head
 * to find out which is bigger.
 *
 * The rule: billions above $1B with one decimal, millions below, never
 * "thousands", never a plural unit, never a raw digit string. Applied to
 * ladder rows, adjustment lines, bucket lines and card figures alike, so the
 * same value reads the same way everywhere it appears.
 *
 * DISPLAY ONLY. Nothing here feeds arithmetic — the checksums walk the raw
 * extracted amounts through parseMoneyAmount, and must keep doing so, because
 * a rounded figure cannot reconcile.
 */

/** A value this function could not parse is returned verbatim rather than replaced with a guess — an unparseable amount is a real signal and hiding it behind "—" would be worse than showing it raw. */
export function formatMoneyForDisplay(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || !raw.trim()) return "";
  // C1's nil convention says something specific — "the filing states this at
  // zero" — and "$0.0M" says it less clearly than the filing did.
  if (isStatedZeroAmount(raw.replace(/[()]/g, ""))) return "nil";

  const value = parseMoneyAmount(raw);
  if (value === null) return raw.trim();
  return formatMoneyValue(value);
}

/** The same formatting, for a value already parsed. */
export function formatMoneyValue(value: number): string {
  const negative = value < 0;
  const abs = Math.abs(value);

  let body: string;
  if (abs >= 1e9) {
    body = `$${(abs / 1e9).toFixed(1)}B`;
  } else if (abs >= 1e6) {
    // A whole number of millions reads better without a trailing ".0", and
    // the fractional case is real — Encompass prints tranches to the
    // hundred-thousand ($788.4M).
    const millions = abs / 1e6;
    body = `$${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  } else {
    body = `$${Math.round(abs).toLocaleString("en-US")}`;
  }

  // Accounting parentheses, not a leading minus: every negative figure in
  // this pipeline comes from a filing that printed it that way (discount,
  // issuance costs, current portion), and the round trip should look like the
  // source.
  return negative ? `(${body})` : body;
}

/**
 * ITEM 2 (stage-2 review) — THE FORMATTER REACHES PROSE TOO.
 *
 * E7 put one formatter at the display layer and wired it to the four
 * surfaces built from structured fields: ladder amounts, adjustment lines,
 * the card's outstanding-amount field, and movement deltas. It never reached
 * the bucket lines, because those render the extraction's own EVIDENCE
 * SENTENCE — a written paraphrase, not a field — and a formatter that takes
 * a whole amount string has nothing to do with a sentence.
 *
 * So one screen carried "$2,350 million", "$1,435,000 thousand",
 * "$2,357,910 thousand", "$600,000,000" and a unit-less "10,847,516"
 * alongside correctly formatted "$2.8B" and "$699.9M". Same values, seven
 * spellings, because half the surfaces went through the rule and half did
 * not.
 *
 * This rewrites money expressions IN PLACE inside a sentence, leaving every
 * other character untouched, so the same rule reaches a paraphrase without
 * anything else being reformatted or re-ordered.
 *
 * DELIBERATELY NARROW. Only a token that already states its own scale — a
 * unit word, or a magnitude of at least a million — is rewritten. Two things
 * this protects:
 *
 *   Per-share amounts. "raised the quarterly dividend from $0.80 to $0.86
 *   per share" must survive verbatim; rounding those to whole dollars would
 *   turn a real disclosure into "$1 to $1".
 *
 *   Bare figures with no determinable scale. "10,847,516" with no unit is
 *   the one case where the RIGHT answer is to leave it alone and let it look
 *   wrong: the pipeline's standing rule is that an amount whose scale the
 *   filing never stated is never guessed at, and printing "$10.8M" here
 *   would be inventing the scale at the very last step, after every guard
 *   upstream had correctly refused to.
 */
const MIN_FORMATTABLE_MAGNITUDE = 1_000_000;

export function normalizeMoneyInText(text: string): string {
  if (!text) return text;
  const tokens = extractFactTokens(text).filter((t) => t.kind === "money" && t.moneyUnitType !== "per-share" && t.moneyUnitType !== "count");

  // Right to left, so an earlier token's offsets stay valid as later ones
  // are replaced.
  const ordered = [...tokens].sort((a, b) => b.index - a.index);
  let out = text;
  for (const token of ordered) {
    // moneyValue means the token carried its own unit word. A "$"-prefixed
    // figure written out in full ("$600,000,000") carries no unit word but
    // is not unscaled either — the currency sign and the digits ARE the
    // scale, with nothing to guess. Anything with neither is left exactly as
    // the filing printed it.
    const value = token.moneyValue ?? (token.raw.trim().startsWith("$") ? parseMoneyAmount(token.raw) : null);
    if (value === null || value === undefined) continue;
    if (Math.abs(value) < MIN_FORMATTABLE_MAGNITUDE) continue;
    const replacement = formatMoneyValue(value);
    if (replacement === token.raw) continue;
    out = out.slice(0, token.index) + replacement + out.slice(token.index + token.raw.length);
  }
  return out;
}
