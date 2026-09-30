/**
 * SESSION 25 — COVERAGE, ON THE ROLLED POSITION.
 *
 * `rolledPosition.ts` declared the criterion before the call billed: rolled
 * rows count toward coverage only when BOTH ties hold. `rollForward.ts` owns
 * the arithmetic. `rollDeltas.ts` derives the movements from the filings.
 * This file is the last missing join — it asks those three and hands coverage
 * a position, or hands it nothing and says why.
 *
 * IT DECIDES NOTHING ITSELF. Every tie runs through `decideTie`, every band
 * through `toleranceFor`, every placement through `placeByDate`. A fourth
 * opinion about whether a roll reconciles is exactly what the fold this
 * session performed was removing.
 *
 * THE BASE TIE HERE IS THE ROW-SUM TIE, and that distinction cost a whole
 * sample. `rollForward.computeBaseTie` checks the referenced note's stated
 * SUBTOTALS against the referenced filing's balance-sheet captions. That is a
 * real check and it is not this one. The question a transcription has to
 * answer is whether the ROWS IT TRANSCRIBED add up to the totals the same
 * table prints — a gate that reads the transcribed subtotal lines is checking
 * whether the model copied two numbers, and one did: a sample whose 36 rows
 * summed to 22,783 passed it, because the subtotal lines carried a "$" and
 * the bare row cells parsed to null.
 *
 * So the rows are summed, partitioned by position — A SUBTOTAL CLOSES THE
 * ROWS BEFORE IT — and each printed subtotal is checked against its own
 * section. Both subtotals and the grand total must hold.
 *
 * WHAT THE ROLLED POSITION IS: the base rows, plus each counted movement as
 * its own entry. Not the base alone — that would be a position at the base
 * date wearing the anchor's label, which is the substitution this whole
 * design exists to prevent — and not a single rolled number either, because
 * a reader has to be able to see the walk.
 */
import type { PriorPeriodBase } from "../agent/loop";
import { decideTie, computeRollTie, toleranceFor, rollForwardFires, type RollDelta, type TieResult } from "./rollForward";
import { derivePlacedMovements, toRollDeltas, type PlacedMovement } from "./rollDeltas";

export interface BaseRowTie {
  /** One per printed subtotal, plus the grand total. */
  sections: { label: string; rowCount: number; computedMillions: number; statedMillions: number | null; ties: boolean }[];
  rowsUnscaled: number;
  computedMillions: number;
  ties: boolean;
  detail: string;
}

/**
 * THE ROWS AGAINST THE TOTALS THE SAME TABLE PRINTS.
 *
 * Partitioned by position: rows accumulate until a subtotal is reached, and
 * that subtotal closes them. A note that prints "Total short-term debt" after
 * five lines and "Total long-term debt" after thirty-one is stating two
 * sections, and summing all thirty-six against either one would be checking
 * a number nobody printed.
 */
export function baseRowTie(base: PriorPeriodBase | null | undefined): BaseRowTie | null {
  if (!base || base.rows.length === 0) return null;
  const sections: BaseRowTie["sections"] = [];
  let open: { count: number; sum: number } = { count: 0, sum: 0 };
  let rowsUnscaled = 0;
  let grand = 0;
  let allTie = true;

  for (const r of base.rows) {
    if (r.kind === "subtotal") {
      const stated = r.amountMillions ?? null;
      const { ties } = decideTie(open.sum, stated, 0);
      sections.push({ label: r.instrument, rowCount: open.count, computedMillions: open.sum, statedMillions: stated, ties });
      if (!ties) allTie = false;
      grand += open.sum;
      open = { count: 0, sum: 0 };
      continue;
    }
    if (r.kind !== "row") continue;
    if (r.amountMillions === null || r.amountMillions === undefined) { rowsUnscaled++; continue; }
    open.count++;
    open.sum += r.amountMillions;
  }
  // Rows after the last printed subtotal still count toward the grand total.
  grand += open.sum;
  if (open.count > 0) {
    sections.push({ label: "(rows after the last printed subtotal)", rowCount: open.count, computedMillions: open.sum, statedMillions: null, ties: false });
    allTie = false;
  }

  // A TRANSCRIPTION WITH UNSCALABLE ROWS HAS NOT TIED, even if the rest adds
  // up: the missing rows are exactly the ones a sum cannot see.
  if (rowsUnscaled > 0) allTie = false;
  if (sections.length === 0) allTie = false;

  return {
    sections,
    rowsUnscaled,
    computedMillions: grand,
    ties: allTie,
    detail:
      sections.map((s) => `${s.label}: ${s.rowCount} rows = ${s.computedMillions}${s.statedMillions === null ? " against NO printed total" : ` against printed ${s.statedMillions}`}${s.ties ? " ✓" : " ✗"}`).join("; ") +
      (rowsUnscaled > 0 ? ` — and ${rowsUnscaled} row(s) carry no resolvable scale, so the sum is short by exactly them` : "") +
      (sections.length === 0 ? " — the note prints no subtotal, so the transcription can only be checked against itself, which a wrong transcription passes" : ""),
  };
}

export interface RolledCoverageEntry {
  label: string;
  amountMillions: number;
  kind: "base-row" | "movement";
  sourceLine: string;
  citedUrl: string;
}

export type RolledCoverage =
  | { counts: false; reason: string; baseTie: BaseRowTie | null; rollTie: TieResult | null; movements: PlacedMovement[] }
  | {
      counts: true;
      label: string;
      entries: RolledCoverageEntry[];
      capturedFaceMillions: number;
      baseTie: BaseRowTie;
      rollTie: TieResult;
      movements: PlacedMovement[];
      toleranceMillions: number;
    };

export interface RolledCoverageInput {
  base: PriorPeriodBase | null | undefined;
  /** The anchor's own ladder — a roll may never replace a position the anchor prints. */
  anchorHasLadder: boolean;
  crossReference: Parameters<typeof rollForwardFires>[0]["crossReference"];
  baseDate: string;
  anchorDate: string;
  /** The anchor's stated total, in millions. The roll's target. */
  anchorTotalMillions: number | null;
  movementInputs: Omit<Parameters<typeof derivePlacedMovements>[0], "baseDate" | "anchorDate" | "baseRows" | "parseMillions">;
}

export function rolledCoverage(i: RolledCoverageInput): RolledCoverage {
  const gate = rollForwardFires({ crossReference: i.crossReference, anchorHasLadder: i.anchorHasLadder });
  if (!gate.fires) return { counts: false, reason: gate.reason, baseTie: null, rollTie: null, movements: [] };

  const tie = baseRowTie(i.base);
  if (!tie) {
    return { counts: false, reason: "the roll fires but no prior-period base was transcribed, so there is nothing to roll", baseTie: null, rollTie: null, movements: [] };
  }

  const rows = (i.base?.rows ?? []).filter((r) => r.kind === "row");
  const movements = derivePlacedMovements({
    ...i.movementInputs,
    baseDate: i.baseDate,
    anchorDate: i.anchorDate,
    baseRows: rows.map((r) => ({ instrument: r.instrument, amount: r.amount, sourceLine: r.sourceLine })),
    // THE SCALE IS ALREADY DECIDED (Rule 67). This reads the resolved number
    // off the row it belongs to and falls back to the shared table parse for
    // a figure that is not a base row — never a private copy of either.
    parseMillions: (amount, sourceLine) => {
      const hit = rows.find((r) => r.sourceLine === sourceLine && r.amount === amount);
      if (hit && hit.amountMillions !== null && hit.amountMillions !== undefined) return hit.amountMillions;
      return parseStatedMillions(amount);
    },
  });
  const deltas = toRollDeltas(movements);

  // THE BASE TIE RUNS FIRST AND A FAILED ONE PRODUCES NO ROLL. An untied base
  // rolled forward is two unknowns reported as one number.
  if (!tie.ties) {
    return {
      counts: false,
      reason: `the prior-period base does NOT tie to the totals its own table prints, so no roll is attempted: ${tie.detail}. Coverage stays on the rows the anchor states directly.`,
      baseTie: tie, rollTie: null, movements,
    };
  }

  const rollTie = computeRollTie(tie.computedMillions, deltas, i.anchorTotalMillions);
  if (!rollTie.ties) {
    return {
      counts: false,
      reason: `the base ties but the roll does not: ${rollTie.detail}. The base renders as prior-period context with this gap stated, and coverage stays on the anchor's own rows.`,
      baseTie: tie, rollTie, movements,
    };
  }

  const entries: RolledCoverageEntry[] = [
    ...rows
      .filter((r) => r.amountMillions !== null && r.amountMillions !== undefined)
      .map((r) => ({ label: r.instrument, amountMillions: r.amountMillions as number, kind: "base-row" as const, sourceLine: r.sourceLine, citedUrl: i.base?.filingUrl ?? "" })),
    ...deltas.map((d) => ({ label: d.label, amountMillions: d.amountMillions, kind: "movement" as const, sourceLine: d.sourceLine, citedUrl: d.citedUrl })),
  ];

  return {
    counts: true,
    label: i.base?.label ?? "rolled position",
    entries,
    capturedFaceMillions: entries.reduce((a, e) => a + e.amountMillions, 0),
    baseTie: tie,
    rollTie,
    movements,
    toleranceMillions: toleranceFor(deltas),
  };
}

/**
 * THE ONE PLACE A SURFACE ASKS "IS THIS COMPANY'S COVERAGE ROLLED?"
 *
 * Every consumer — the golden state, the criteria, the rendered table —
 * calls this and passes the answer to `computeCoverage`. None of them
 * assembles the inputs itself, because three assemblies of one question is
 * how the three surfaces start disagreeing about the same company.
 */
export function rolledCoverageFor(result: { results: readonly TriggerResultLike[] }): RolledCoverage {
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const nd = result.results.find((t) => t.triggerId === "new-debt-issuance");
  const base = (dm?.priorPeriodBase ?? null) as PriorPeriodBase | null;
  const anchorDate = dm?.debtScheduleSourceFiling?.reportDate ?? null;
  const rowsAtAnchor = (dm?.scheduleSequence ?? []).filter((e) => e.kind === "row").length;

  if (!anchorDate) {
    return { counts: false, reason: "the anchor states no reporting period, so there is no date to roll to. Nothing is excluded on an input that could not be read.", baseTie: null, rollTie: null, movements: [] };
  }
  const xbrl = dm?.xbrlDebtTotal?.total ?? null;

  return rolledCoverage({
    base,
    anchorHasLadder: rowsAtAnchor > 0,
    crossReference: dm?.noteCrossReference ?? null,
    baseDate: base?.periodOfReport ?? "",
    anchorDate,
    anchorTotalMillions: xbrl === null ? null : Math.round(xbrl / 1e6),
    movementInputs: {
      noteRetirements: (dm?.noteRetirements ?? []) as never,
      issuedTranches: (nd?.issuedTranches ?? []) as never,
      issuanceDate: nd?.eventDate ?? null,
      intendedRedemptions: (nd?.redeems ?? []) as never,
      anchorBalances: (dm?.proseInstruments ?? []) as never,
    },
  });
}

/** Structurally what this file needs off a TriggerResult, and nothing more. */
interface TriggerResultLike {
  triggerId: string;
  priorPeriodBase?: unknown;
  debtScheduleSourceFiling?: { reportDate?: string | null } | null;
  scheduleSequence?: { kind: string }[];
  noteCrossReference?: Parameters<typeof rollForwardFires>[0]["crossReference"];
  xbrlDebtTotal?: { total?: number | null } | null;
  noteRetirements?: unknown[];
  issuedTranches?: unknown[];
  eventDate?: string | null;
  redeems?: unknown[];
  proseInstruments?: unknown[];
}

/**
 * A figure stated in its own words ("$ 1.0 billion", "$ 550 million"), in
 * millions. Deliberately NOT a table-cell parse: a movement is stated in
 * prose, where a bare number is as likely a share count, so a value with no
 * magnitude word and no currency marker is refused rather than guessed.
 */
export function parseStatedMillions(raw: string): number | null {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(billion|million|thousand)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "billion") return n * 1000;
  if (unit === "million") return n;
  if (unit === "thousand") return n / 1000;
  return /\$/.test(s) ? n : null;
}

/** For a reader: what the roll did, whether or not it counted. */
export function rolledCoverageLine(r: RolledCoverage, anchorTotalMillions: number | null): string {
  if (!r.counts) return `Coverage is NOT on a rolled position — ${r.reason}`;
  const residual = r.rollTie.residualMillions ?? 0;
  return (
    `Coverage is computed on the ROLLED position, labelled "${r.label}". ` +
    `${r.baseTie.computedMillions}${r.movements.filter((m) => m.placement === "delta").map((m) => ` ${m.amountMillions < 0 ? "−" : "+"} ${Math.abs(m.amountMillions)}`).join("")} = ${r.rollTie.computedMillions} ` +
    `against the anchor's stated ${anchorTotalMillions} — residual ${residual}, inside the ±${r.toleranceMillions} the filer's own approximation earns.`
  );
}
