/**
 * SESSION 24 — WHEN MAY A ROLLED POSITION BE SIGNED?
 *
 * The one-document-per-call design gives the roll-forward a labelled
 * prior-period base. That base is only worth having if it can eventually
 * produce a signature, and a signature over a rolled position needs a rule
 * saying when the roll is good enough to count — decided BEFORE the call
 * bills, so the answer is not chosen after seeing the numbers.
 *
 * THREE RULES, AND THE THIRD IS THE ONE THAT MATTERS.
 *
 *   1. Rolled rows count toward COVERAGE only when BOTH ties hold: the
 *      transcribed base sums to what the filing states for its own period,
 *      and the base rolled forward lands within the band of the anchor's own
 *      stated total. Coverage is then computed on the rolled position.
 *
 *   2. Rolled rows RENDER as what they are — "as of <base date>, per <note>,
 *      rolled to <anchor date>" — separate from rows the anchor states
 *      directly, and they never enter the anchor's current ladder as the
 *      anchor's own rows. That is fix 5 and Rule 66, unchanged: being allowed
 *      to read a table as the prior-period base is not being allowed to put
 *      its rows on the current ladder.
 *
 *   3. If EITHER tie fails, coverage stays on the anchor's own rows, the base
 *      renders prior-period-only with the gap stated, and the name does not
 *      sign. A roll that does not reconcile is a reading, not a position.
 *
 * WHY BOTH TIES AND NOT ONE. The base tie says the transcription is the table
 * it claims to be. The roll tie says the events between the two dates account
 * for the distance. Either alone is satisfiable by an error: a base that ties
 * with a roll that misses means real movement is missing, and a roll that
 * lands with a base that does not tie means two errors cancelled. They are
 * reported separately for the same reason.
 */

import { decideTie } from "./rollForward";

/**
 * Dollars. The band inside which a rolled total is taken to reconcile, where
 * the filer's own words earn one. It is the DEFAULT here rather than the
 * rule: `rollForward.toleranceFor` decides whether a band exists at all, and
 * a caller that knows should pass `toleranceUsd`.
 */
export const ROLL_BAND_USD = 50_000_000;

export interface RollInputs {
  /** What the FILING states as the base period's total — the number the transcription must reproduce. */
  baseStatedTotal: number | null;
  /** What the transcribed rows actually sum to. */
  baseComputedTotal: number | null;
  /** The anchor's own stated total — what the roll must land on. */
  anchorStatedTotal: number | null;
  /** The base carried forward through the events between the two dates. */
  rolledTotal: number | null;
  /**
   * The band this roll has EARNED, in dollars — `rollForward.toleranceFor`
   * converted. Omitted falls back to ROLL_BAND_USD, which is what this file
   * assumed unconditionally before the tie math was folded.
   */
  toleranceUsd?: number;
  /** For the label, in the filing's own terms. */
  baseAsOf: string;
  anchorAsOf: string;
  baseNote: string;
}

export type RolledVerdict =
  | {
      kind: "counts";
      /** The label every rolled row renders under. */
      label: string;
      baseGap: number;
      rollGap: number;
      statement: string;
    }
  | {
      kind: "prior-period-only";
      failed: "base" | "roll" | "both" | "not-measurable";
      baseGap: number | null;
      rollGap: number | null;
      /** Rendered on the page. Never silent: a base that did not tie says so. */
      statement: string;
    };

/**
 * The label a rolled row renders under. A rolled row that does not say it is
 * rolled is indistinguishable from a row the anchor states, which is the whole
 * substitution this design exists to avoid.
 */
export function rolledRowLabel(i: Pick<RollInputs, "baseAsOf" | "anchorAsOf" | "baseNote">): string {
  return `as of ${i.baseAsOf}, per ${i.baseNote}, rolled to ${i.anchorAsOf}`;
}

export function rolledVerdict(i: RollInputs): RolledVerdict {
  const label = rolledRowLabel(i);

  // A COMPARISON THAT CANNOT READ ITS INPUTS DOES NOT ANSWER (Rule 61). A
  // missing total is not a tie and is not a failure to tie; it is nothing to
  // compare, and it must not read as either.
  if (
    i.baseStatedTotal === null || i.baseComputedTotal === null ||
    i.anchorStatedTotal === null || i.rolledTotal === null
  ) {
    return {
      kind: "prior-period-only",
      failed: "not-measurable",
      baseGap: null,
      rollGap: null,
      statement:
        "the roll could not be checked: one of the four totals it reconciles is not stated. " +
        "The prior-period base renders on its own and contributes nothing to coverage, because a " +
        "reconciliation that could not be attempted is not one that passed.",
    };
  }

  // SESSION 25 — THE TIE MATH IS NOT DECIDED HERE ANY MORE.
  //
  // This file owned a second copy of `rollForward`'s arithmetic: `baseGap ===
  // 0` beside `computeBaseTie`, and `|rollGap| <= 50M` beside
  // `computeRollTie`. Two answers to one question, and they had already
  // begun to differ — the band here was UNCONDITIONAL, while rollForward's
  // is earned by the filer's own stated approximation and is zero without
  // one. A roll made entirely of exact figures reconciled here and failed
  // there, on the same numbers.
  //
  // `decideTie` is now the single decision, and this file keeps what is
  // actually its own: WHEN A ROLLED POSITION MAY BE SIGNED, and what a rolled
  // row says about itself. The tolerance is passed explicitly rather than
  // assumed, so the band is still a declared quantity on this surface.
  //
  // Unit-safe: these four totals are DOLLARS, and `decideTie`'s half-unit
  // epsilon is therefore half a dollar — exactness on integer dollars, which
  // is precisely what `baseGap === 0` meant. Equivalence was measured against
  // a frozen copy of the old arithmetic before this replaced it.
  const base = decideTie(i.baseComputedTotal, i.baseStatedTotal, 0);
  const roll = decideTie(i.rolledTotal, i.anchorStatedTotal, i.toleranceUsd ?? ROLL_BAND_USD);
  const baseGap = base.residual as number;
  const rollGap = roll.residual as number;
  const baseTies = base.ties;
  const rollTies = roll.ties;

  // THE BASE TIE IS EXACT. It is a transcription of a printed table against
  // that table's own printed total — there is no rounding to allow for, and a
  // band here would hide exactly the missing row it exists to catch. The ROLL
  // tie gets a band because it spans two dates and a chain of events, each
  // stated to its own precision.
  if (baseTies && rollTies) {
    return {
      kind: "counts",
      label,
      baseGap,
      rollGap,
      statement:
        `the ${i.baseAsOf} base ties exactly to its own stated total, and rolled forward to ${i.anchorAsOf} ` +
        `it lands ${fmtUsd(rollGap)} from the anchor's stated total, inside the ±${fmtUsd(i.toleranceUsd ?? ROLL_BAND_USD)} band. ` +
        `Coverage is computed on the rolled position; every rolled row renders "${label}".`,
    };
  }

  const failed: "base" | "roll" | "both" = !baseTies && !rollTies ? "both" : !baseTies ? "base" : "roll";
  return {
    kind: "prior-period-only",
    failed,
    baseGap,
    rollGap,
    statement:
      (failed === "base" || failed === "both"
        ? `the ${i.baseAsOf} base does NOT tie: the transcribed rows sum ${fmtUsd(baseGap)} from the total that table states, so the transcription is not the table it claims to be. `
        : "") +
      (failed === "roll" || failed === "both"
        ? `the roll to ${i.anchorAsOf} lands ${fmtUsd(rollGap)} from the anchor's stated total, outside the ±${fmtUsd(i.toleranceUsd ?? ROLL_BAND_USD)} band, so the events between the two dates do not account for the distance. `
        : "") +
      "Coverage stays on the rows the anchor states directly. The base renders as prior-period context only, with this gap stated, and this name does not sign on a rolled position.",
  };
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000_000 ? `$${(abs / 1_000_000_000).toFixed(3)}B` : `$${Math.round(abs / 1_000_000)}M`;
  return n < 0 ? `-${s}` : s;
}
