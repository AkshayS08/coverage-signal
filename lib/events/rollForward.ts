/**
 * SESSION 23, STAGE 2 — THE FILER-DIRECTED ROLL-FORWARD.
 *
 * Where an anchor's debt note carries no ladder AND the anchor itself points,
 * in its own words, at a specific note in a specific filing, the position can
 * be built from that filing and rolled forward — labelled as exactly that,
 * never as the anchor's own table.
 *
 * ==========================================================================
 * THE FRAME, WHICH IS THE THING MOST EASILY GOT WRONG
 * ==========================================================================
 *
 * A filer can state its debt in two frames that differ by a constant:
 *
 *   balance-sheet frame   Dec 31,463   ->   Jun 31,878
 *   fair-value frame      Dec 31,352   ->   Jun 31,768
 *
 * The ~$110M difference is a scope exclusion of the fair-value disclosure and
 * it is present at BOTH dates, so the two frames are individually consistent
 * and mutually incomparable. **The roll operates entirely in the
 * balance-sheet frame.** The fair-value table may render beside it as a
 * witness with its scope gap named; it is never the tie target.
 *
 * Mixing them produces a gap of the wrong size that nobody can attribute —
 * which is what an earlier draft of this session's own declaration did, using
 * 31,352 as the base and reporting a $76M miss. Rule 24's shape at the level
 * of a disclosure: a measurement is only as clean as the frame it runs in.
 *
 * ==========================================================================
 * WHAT THE ROLL RESTS ON, STATED WHERE IT RESTS ON IT
 * ==========================================================================
 *
 * ASSUMPTION (load-bearing): commercial paper outstanding at the base date is
 * ZERO, sourced to the 10-K in two places — the MD&A sentence "There was no
 * commercial paper outstanding balance as of December 31, 2025", and the debt
 * note table printing "Commercial paper $ —" in the December 31, 2025 column
 * against $880 in the prior-year column.
 *
 * It is an ASSUMPTION and not a settled fact, for three reasons worth keeping
 * in front of whoever reads a miss:
 *
 *   1. It is load-bearing in a specific way: the commercial-paper delta is
 *      the ENTIRE closing balance rather than an increment, so if the base is
 *      not zero the roll is wrong by exactly the amount it is not.
 *   2. Both sources are spot measures. Commercial paper is issued and repaid
 *      continuously; a period-end zero is consistent with the balance sheet
 *      it feeds, and says nothing about the period.
 *   3. The base table states amounts "net of issuance costs, discounts or
 *      premiums" while the closing figure is stated as an approximation. On
 *      ~$1.0B at 3.92% over a typical tenor that is single-digit millions —
 *      inside the tolerance, but a named contributor to the residual rather
 *      than noise.
 *
 * DIAGNOSTIC ORDER: **if the base tie misses, commercial-paper composition at
 * the base date is the first thing to check** — before the tranche rows,
 * before the residual machinery. It is the line carrying an em-dash rather
 * than a figure, the line that moves, and the line whose zero converts a
 * delta from a difference into a whole balance. A base-tie miss that is
 * really a commercial-paper misread would otherwise be chased through
 * thirty-six correctly transcribed tranches.
 *
 * `baseTieFailureGuidance()` renders that ordering onto the surface, so the
 * next reader is told where to look rather than having to know.
 */
import type { NoteCrossReference, ScheduleSequenceEntry, BalanceSheetDebtCaption } from "../agent/claude";
import { parseMoneyAmount } from "./position";

/** One period's movement between the base date and the anchor date. */
export interface RollDelta {
  /** What moved, in the filing's own words. */
  label: string;
  /** Signed, in the same unit as the base. Negative for a repayment. */
  amountMillions: number;
  /** The sentence stating it, verbatim. */
  sourceLine: string;
  /** The document that sentence was found in (Rule 44). */
  citedUrl: string;
  /**
   * True where the filing states the figure as an approximation
   * ("approximately $1.0 billion"). This is what earns the tolerance band —
   * a roll built only from exact figures gets no band at all.
   */
  statedApproximate: boolean;
}

export interface RollForwardInput {
  crossReference: NoteCrossReference | null;
  /** True when the ANCHOR's own note yielded a ladder. The conjunction requires false. */
  anchorHasLadder: boolean;
  referencedSequence: ScheduleSequenceEntry[];
  referencedCaptions: BalanceSheetDebtCaption[];
  deltas: RollDelta[];
  /** The ANCHOR's balance-sheet debt total, in millions. The roll's target. */
  anchorTotalMillions: number | null;
  basePeriod: string;
  baseFilingLabel: string;
  anchorPeriod: string;
}

export type RollForwardOutcome =
  | { fires: false; reason: string }
  | {
      fires: true;
      baseTie: TieResult;
      /** Null when the base tie failed — no roll is attempted on an untied base. */
      rollTie: TieResult | null;
      label: string;
      deltas: RollDelta[];
      toleranceMillions: number;
    };

export interface TieResult {
  computedMillions: number;
  statedMillions: number | null;
  /** computed − stated. Positive means the computation is over the stated figure. */
  residualMillions: number | null;
  ties: boolean;
  /** Always rendered, tie or not — how close a "tie" actually was (Session 18's rule). */
  detail: string;
}

/**
 * THE CONJUNCTION. Both halves, every time.
 *
 * A cross-reference alone is not sufficient: Quest carries three debt-specific
 * pointers AND a full twelve-tranche ladder, and firing on the pointer would
 * replace a good ladder with a rolled one. Absence alone is not sufficient
 * either: UHS has no ladder and nine boilerplate pointers, and firing on
 * absence would have rolled a company already golden at 98%.
 *
 * And a pointer that names nothing is not a direction. HCA's six all read
 * "refer to the consolidated financial statements and footnotes thereto
 * included in our annual report on Form 10-K" — they point at a document, at
 * every note in it, and so at no note at all. The test is whether the
 * sentence NAMES what it points at, which is structural; there is no list of
 * approved phrasings anywhere in this file (Rule 1).
 */
export function rollForwardFires(input: {
  crossReference: NoteCrossReference | null;
  anchorHasLadder: boolean;
}): { fires: boolean; reason: string } {
  if (input.anchorHasLadder) {
    return { fires: false, reason: "the anchor states its own ladder — a roll-forward may never replace a position the anchor itself prints" };
  }
  const x = input.crossReference;
  if (!x) {
    return { fires: false, reason: "the anchor states no cross-reference — absence of a ladder is not, on its own, a direction to look elsewhere" };
  }
  const names: string[] = [];
  if (!x.referencedSubject) names.push("no subject");
  if (!x.referencedNote) names.push("no specific note");
  if (names.length) {
    return {
      fires: false,
      reason: `the anchor's pointer names ${names.join(" and ")} — it points at a document rather than at a disclosure, which is a general reference and not a direction`,
    };
  }
  return { fires: true, reason: `the anchor states no ladder AND directs the reader to ${x.referencedNote}${x.referencedFiling ? ` in ${x.referencedFiling}` : ""} for ${x.referencedSubject}` };
}

/** Section subtotals from a transcribed sequence, by their own section label. */
export function subtotalsBySection(seq: ScheduleSequenceEntry[]): { section: string; amountMillions: number; label: string }[] {
  const out: { section: string; amountMillions: number; label: string }[] = [];
  for (const e of seq) {
    if (e.kind !== "subtotal") continue;
    const v = parseMoneyAmount(e.amount ?? null);
    if (v === null) continue;
    out.push({ section: (e.section ?? "").trim(), amountMillions: v, label: e.label ?? "" });
  }
  return out;
}

/**
 * THE BASE TIE, AND IT RUNS FIRST.
 *
 * The base ladder is checked against the REFERENCED filing's own balance
 * sheet, at the referenced filing's own date. This is Check 2's shape applied
 * to a filing that is not the anchor, and it exists because Check 1 alone
 * cannot catch it: a stale note ties to itself perfectly.
 *
 * A base that does not tie produces NO ROLL. The position renders
 * prior-period-only with the gap stated, which is never-suppress working
 * rather than a failure to report.
 */
export function computeBaseTie(
  referencedSequence: ScheduleSequenceEntry[],
  referencedCaptions: BalanceSheetDebtCaption[]
): TieResult {
  const subs = subtotalsBySection(referencedSequence);
  const computed = subs.reduce((a, s) => a + s.amountMillions, 0);
  const stated = referencedCaptions
    .map((c) => parseMoneyAmount(c.amount ?? null))
    .filter((v): v is number => v !== null)
    .reduce((a, b) => a + b, 0);
  const statedOrNull = referencedCaptions.length ? stated : null;
  const residual = statedOrNull === null ? null : computed - statedOrNull;
  // The base tie is an IDENTITY, not an approximation: both sides are the
  // filer's own stated figures at the same date, in the same frame. It ties
  // exactly or it does not tie.
  const ties = residual !== null && Math.abs(residual) < 0.5;
  const parts = subs.map((s) => `${s.label || s.section}: ${s.amountMillions}`).join(" + ");
  return {
    computedMillions: computed,
    statedMillions: statedOrNull,
    residualMillions: residual,
    ties,
    detail:
      statedOrNull === null
        ? "the referenced filing states no balance-sheet debt captions, so the base ladder can only be checked against itself — which a stale note passes"
        : `${parts} = ${computed} against the referenced filing's own balance sheet ${statedOrNull}` +
          (ties ? " — ties exactly" : `, out by ${residual}`),
  };
}

/**
 * THE TOLERANCE, AND WHERE IT COMES FROM.
 *
 * Zero unless a delta is stated as an approximation by the filer. A roll made
 * of exact figures must tie exactly; a roll containing "approximately $1.0
 * billion" inherits that word's width, and the band is declared on the
 * surface as the filer's own approximation rather than as our tolerance.
 */
export const APPROXIMATION_BAND_MILLIONS = 50;

export function toleranceFor(deltas: RollDelta[]): number {
  return deltas.some((d) => d.statedApproximate) ? APPROXIMATION_BAND_MILLIONS : 0;
}

export function computeRollTie(
  baseMillions: number,
  deltas: RollDelta[],
  anchorTotalMillions: number | null
): TieResult {
  const computed = deltas.reduce((a, d) => a + d.amountMillions, baseMillions);
  const residual = anchorTotalMillions === null ? null : computed - anchorTotalMillions;
  const tol = toleranceFor(deltas);
  const ties = residual !== null && Math.abs(residual) <= tol;
  const walk = `${baseMillions}${deltas.map((d) => ` ${d.amountMillions < 0 ? "−" : "+"} ${Math.abs(d.amountMillions)}`).join("")} = ${computed}`;
  return {
    computedMillions: computed,
    statedMillions: anchorTotalMillions,
    residualMillions: residual,
    ties,
    detail:
      anchorTotalMillions === null
        ? `${walk}, and the anchor states no balance-sheet total to check it against`
        : `${walk} against the anchor's balance sheet ${anchorTotalMillions}` +
          (residual === null
            ? ""
            : ties
              ? ` — residual ${residual}, within the filer's stated approximation (±${tol})`
              : ` — residual ${residual}, OUTSIDE the ±${tol} the filer's own approximation supports`),
  };
}

/** What to tell a reader when the base tie misses. The order is the finding. */
export function baseTieFailureGuidance(): string {
  return (
    "Base tie failed, so no roll is attempted and the position renders prior-period-only with this gap stated. " +
    "Check commercial-paper composition at the base date FIRST: it is the line most likely to be misread " +
    "(an em-dash rather than a figure, and the one whose zero turns a delta into a whole balance), and a " +
    "misread there looks exactly like thirty-six wrong tranches."
  );
}

/**
 * THE ONE GATE BETWEEN A REFERENCED TABLE AND A RENDERED POSITION.
 *
 * Every surface that wants to show rolled rows asks this and nothing else.
 * It returns rows only for a roll that FIRED and TIED, and it returns the
 * label with them so a caller cannot render the rows and forget the
 * provenance — the two travel together or not at all (Rule 14: a marker
 * describes its provenance; here the rows cannot arrive without one).
 *
 * Every other state — did not fire, base tie failed, roll tie outside the
 * band — returns no rows and the reason, which the surface renders instead.
 * A populated `referencedScheduleSequence` on its own renders NOTHING, ever.
 */
export function positionFromRoll(
  outcome: RollForwardOutcome,
  referencedSequence: ScheduleSequenceEntry[]
): { rows: ScheduleSequenceEntry[]; label: string | null; reason: string } {
  if (!outcome.fires) {
    return { rows: [], label: null, reason: outcome.reason };
  }
  if (!outcome.baseTie.ties) {
    return {
      rows: [],
      label: null,
      reason: `${baseTieFailureGuidance()} ${outcome.baseTie.detail}`,
    };
  }
  if (!outcome.rollTie || !outcome.rollTie.ties) {
    return {
      rows: [],
      label: null,
      reason:
        `The base ties but the roll does not: ${outcome.rollTie?.detail ?? "no roll was computed"}. ` +
        `The position renders prior-period-only with this gap stated rather than as a rolled total nobody can attribute.`,
    };
  }
  return { rows: referencedSequence, label: outcome.label, reason: outcome.rollTie.detail };
}

export function rollForward(input: RollForwardInput): RollForwardOutcome {
  const gate = rollForwardFires(input);
  if (!gate.fires) return { fires: false, reason: gate.reason };

  const baseTie = computeBaseTie(input.referencedSequence, input.referencedCaptions);
  const label =
    `as of ${input.basePeriod}, per ${input.baseFilingLabel}` +
    `, rolled forward to ${input.anchorPeriod}`;

  if (!baseTie.ties) {
    return { fires: true, baseTie, rollTie: null, label, deltas: input.deltas, toleranceMillions: toleranceFor(input.deltas) };
  }
  const rollTie = computeRollTie(baseTie.computedMillions, input.deltas, input.anchorTotalMillions);
  return { fires: true, baseTie, rollTie, label, deltas: input.deltas, toleranceMillions: toleranceFor(input.deltas) };
}
