import { parseMoneyAmount } from "./position";
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
