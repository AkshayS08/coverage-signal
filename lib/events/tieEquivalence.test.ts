/**
 * SESSION 25 — THE EQUIVALENCE PROOF, RUN BEFORE THE DUPLICATE WAS DELETED.
 *
 * `rolledPosition.ts` carried its own copy of the tie arithmetic that
 * `rollForward.ts` already owned. Folding one into the other is only safe if
 * the folded version answers identically, and "I read both and they look the
 * same" is not a proof — that is how the frame test got destroyed in Session
 * 23, caught only because an assertion count fell.
 *
 * So the OLD arithmetic is frozen here, verbatim, and both are run over the
 * same inputs: the fixture grid, the boundary of every band, the
 * frame-distinction numbers from `rollForward.test.ts` [3g], and Cigna's real
 * measured totals. A single disagreement fails this suite.
 *
 * THE ONE DIFFERENCE, DECLARED RATHER THAN HIDDEN. The old `rolledVerdict`
 * granted a ±$50M band UNCONDITIONALLY; `rollForward.toleranceFor` earns the
 * band from the filer's own stated approximation and is zero without one.
 * They therefore CANNOT be equivalent on a roll with no approximate figure,
 * and pretending otherwise would be the widening this project forbids. The
 * fold preserves the old behaviour at the old default and exposes the earned
 * band as an explicit input; both halves are asserted below.
 *
 * Run: npx tsx lib/events/tieEquivalence.test.ts
 */
import { decideTie, computeBaseTie, computeRollTie, toleranceFor, type RollDelta } from "./rollForward";
import { rolledVerdict, ROLL_BAND_USD, type RollInputs } from "./rolledPosition";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/* ───────────────── THE OLD ARITHMETIC, FROZEN ───────────────── */
/** Verbatim from rolledPosition.ts before the fold. Never imported anywhere else. */
function OLD_rolledTies(i: {
  baseStatedTotal: number | null; baseComputedTotal: number | null;
  anchorStatedTotal: number | null; rolledTotal: number | null;
}): { kind: "not-measurable" } | { kind: "measured"; baseGap: number; rollGap: number; baseTies: boolean; rollTies: boolean } {
  if (i.baseStatedTotal === null || i.baseComputedTotal === null || i.anchorStatedTotal === null || i.rolledTotal === null) {
    return { kind: "not-measurable" };
  }
  const baseGap = i.baseComputedTotal - i.baseStatedTotal;
  const rollGap = i.rolledTotal - i.anchorStatedTotal;
  return { kind: "measured", baseGap, rollGap, baseTies: baseGap === 0, rollTies: Math.abs(rollGap) <= 50_000_000 };
}

/** Verbatim from rollForward.computeBaseTie before the fold. */
function OLD_baseTie(computed: number, stated: number | null): { residual: number | null; ties: boolean } {
  const residual = stated === null ? null : computed - stated;
  return { residual, ties: residual !== null && Math.abs(residual) < 0.5 };
}
/** Verbatim from rollForward.computeRollTie before the fold. */
function OLD_rollTie(computed: number, stated: number | null, tol: number): { residual: number | null; ties: boolean } {
  const residual = stated === null ? null : computed - stated;
  return { residual, ties: residual !== null && Math.abs(residual) <= tol };
}

const shape = (i: RollInputs) => {
  const v = rolledVerdict(i);
  return v.kind === "counts"
    ? { kind: "measured" as const, baseGap: v.baseGap, rollGap: v.rollGap, baseTies: true, rollTies: true }
    : v.failed === "not-measurable"
      ? { kind: "not-measurable" as const }
      : { kind: "measured" as const, baseGap: v.baseGap as number, rollGap: v.rollGap as number,
          baseTies: v.failed === "roll", rollTies: v.failed === "base" };
};

const base = (over: Partial<RollInputs> = {}): RollInputs => ({
  baseStatedTotal: 31_463_000_000, baseComputedTotal: 31_463_000_000,
  anchorStatedTotal: 31_878_000_000, rolledTotal: 31_913_000_000,
  baseAsOf: "December 31, 2025", anchorAsOf: "June 30, 2026", baseNote: "Note 7 to the 2025 Form 10-K",
  ...over,
});

console.log("=== [1] THE FIXTURE GRID — old arithmetic against new, case by case ===");
{
  const cases: { label: string; over: Partial<RollInputs> }[] = [
    { label: "both tie (Cigna's real numbers)", over: {} },
    { label: "base off by one dollar", over: { baseComputedTotal: 31_463_000_001 } },
    { label: "base off by a whole tranche", over: { baseComputedTotal: 30_913_000_000 } },
    { label: "roll exactly ON the band", over: { rolledTotal: 31_928_000_000 } },
    { label: "roll one dollar OUTSIDE the band", over: { rolledTotal: 31_928_000_001 } },
    { label: "roll one dollar INSIDE the band", over: { rolledTotal: 31_927_999_999 } },
    { label: "roll on the band, negative side", over: { rolledTotal: 31_828_000_000 } },
    { label: "roll outside on the negative side", over: { rolledTotal: 31_827_999_999 } },
    { label: "both fail", over: { baseComputedTotal: 30_000_000_000, rolledTotal: 40_000_000_000 } },
    { label: "base stated absent", over: { baseStatedTotal: null } },
    { label: "base computed absent", over: { baseComputedTotal: null } },
    { label: "anchor stated absent", over: { anchorStatedTotal: null } },
    { label: "rolled absent", over: { rolledTotal: null } },
    { label: "roll ties exactly, zero residual", over: { rolledTotal: 31_878_000_000 } },
  ];
  for (const c of cases) {
    const i = base(c.over);
    assert(JSON.stringify(shape(i)) === JSON.stringify(OLD_rolledTies(i)),
      `[1:${c.label}] folded verdict is identical to the frozen original — ${JSON.stringify(shape(i))}`);
  }
}

console.log("\n=== [2] THE BAND BOUNDARY, SWEPT — every dollar either side of ±$50M ===");
{
  let disagreements = 0, checked = 0;
  for (let d = -50_000_010; d <= 50_000_010; d += 1_000_003) {
    const i = base({ rolledTotal: 31_878_000_000 + d });
    checked++;
    if (JSON.stringify(shape(i)) !== JSON.stringify(OLD_rolledTies(i))) disagreements++;
  }
  for (const d of [-50_000_001, -50_000_000, -49_999_999, -1, 0, 1, 49_999_999, 50_000_000, 50_000_001]) {
    const i = base({ rolledTotal: 31_878_000_000 + d });
    checked++;
    if (JSON.stringify(shape(i)) !== JSON.stringify(OLD_rolledTies(i))) disagreements++;
  }
  assert(disagreements === 0,
    `[2a] ${checked} points swept across the band including every boundary dollar — ${disagreements} disagreement(s). A band whose EDGE moved would be a silent widening, which is the exact thing this fold must not do`);
}

console.log("\n=== [3] ROLLFORWARD'S OWN TWO TIES, AGAINST THEIR FROZEN ORIGINALS ===");
{
  // The base tie runs in MILLIONS and is exact; its half-unit epsilon is
  // float noise, not tolerance.
  const basePoints: [number, number | null][] = [
    [31463, 31463], [31463, 31462], [31463, 31464], [30871, 30871], [592, 592], [31463, null], [31463.2, 31463],
  ];
  // WRITTEN WITH A CURRENCY MARKER, DELIBERATELY. A first version of this
  // harness passed bare cells — "31463" — and `parseMoneyAmount` returns null
  // for those, so every subtotal was dropped and the computed side was 0. It
  // reported three disagreements in the CODE that were three defects in the
  // TEST. That is item 1 of this same session arriving one layer over, and it
  // is left recorded here rather than quietly corrected.
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;
  let bad = 0;
  for (const [c, s] of basePoints) {
    const now = computeBaseTie(
      [{ kind: "subtotal", label: "total", section: "", amount: money(c) } as never],
      s === null ? [] : [{ label: "total debt", amount: money(s) } as never]
    );
    const old = OLD_baseTie(c, s);
    if (now.ties !== old.ties || (now.residualMillions ?? null) !== (old.residual ?? null)) bad++;
  }
  assert(bad === 0, `[3a] computeBaseTie is unchanged across ${basePoints.length} points, including a null stated total and a float-noise residual (${bad} disagreement(s))`);

  const mk = (n: number, approx: boolean): RollDelta[] => [{ label: "d", amountMillions: n, sourceLine: "", citedUrl: "", statedApproximate: approx }];
  let bad2 = 0, pts = 0;
  for (const approx of [true, false]) {
    for (const target of [31878, 31913, 31963, 31964, 31862, 31863, null]) {
      const deltas = mk(450, approx);
      const now = computeRollTie(31463, deltas, target);
      const old = OLD_rollTie(31463 + 450, target, approx ? 50 : 0);
      pts++;
      if (now.ties !== old.ties || (now.residualMillions ?? null) !== (old.residual ?? null)) bad2++;
    }
  }
  assert(bad2 === 0, `[3b] computeRollTie is unchanged across ${pts} points, under BOTH an earned band and no band (${bad2} disagreement(s))`);
}

console.log("\n=== [4] THE FRAME DISTINCTION SURVIVES THE FOLD (rollForward.test.ts [3g]) ===");
{
  // Fair-value base 31,352 against the balance-sheet target 31,878. The two
  // frames differ by a constant present at BOTH dates, so mixing them gives a
  // gap of the wrong size that nobody can attribute. This is the assertion a
  // previous session destroyed by overwriting the module; it is re-checked
  // here because a fold is the same kind of risk as a rewrite.
  const deltas: RollDelta[] = [
    { label: "1.250% notes repaid", amountMillions: -550, sourceLine: "", citedUrl: "", statedApproximate: false },
    { label: "commercial paper", amountMillions: 1000, sourceLine: "approximately", citedUrl: "", statedApproximate: true },
  ];
  const wrongFrame = computeRollTie(31352, deltas, 31878);
  assert(wrongFrame.computedMillions === 31802 && wrongFrame.residualMillions === -76 && !wrongFrame.ties,
    `[4a] the fair-value base rolled against the balance-sheet target still lands −76 and does NOT tie (got ${wrongFrame.computedMillions}/${wrongFrame.residualMillions}/${wrongFrame.ties})`);
  const rightFrame = computeRollTie(31463, deltas, 31878);
  assert(rightFrame.computedMillions === 31913 && rightFrame.residualMillions === 35 && rightFrame.ties,
    `[4b] and the balance-sheet frame still lands 35 and ties inside the band the filer's own "approximately" earns (got ${rightFrame.computedMillions}/${rightFrame.residualMillions}/${rightFrame.ties})`);
  assert(toleranceFor(deltas) === 50 && toleranceFor(deltas.slice(0, 1)) === 0,
    "[4c] and the band is still EARNED — 50 with the filer's approximation, 0 without it");
}

console.log("\n=== [5] THE ONE DIFFERENCE, DECLARED ===");
{
  // The old rolledVerdict granted ±$50M no matter what. With an earned band
  // of zero the two MUST differ, and that is the defect being removed, not a
  // regression. Asserting it makes the change visible rather than silent.
  const i = base({ rolledTotal: 31_913_000_000, toleranceUsd: 0 });
  const now = rolledVerdict(i);
  const old = OLD_rolledTies(i);
  assert(now.kind === "prior-period-only" && old.kind === "measured" && old.rollTies,
    "[5a] a roll of EXACT figures now fails where the frozen original passed — the old band was unconditional, and a band nothing earned is a tolerance for our own error rather than the filer's approximation");
  assert(rolledVerdict(base({ rolledTotal: 31_913_000_000 })).kind === "counts",
    "[5b] and at the declared default the behaviour is unchanged, so the fold is a strictly-narrowing option rather than a silent re-decision");
  assert(ROLL_BAND_USD / 1e6 === 50,
    "[5c] the two modules' bands are the same quantity in different units, which is why one of them had to stop owning it");
}

console.log("\n=== [6] decideTie ITSELF, at the seam between the units ===");
{
  assert(decideTie(100, 100, 0).ties && decideTie(100.4, 100, 0).ties && !decideTie(101, 100, 0).ties,
    "[6a] a zero tolerance still admits the half-unit of float noise and nothing more");
  assert(decideTie(150, 100, 50).ties && !decideTie(150.6, 100, 50).ties,
    "[6b] and an explicit band is inclusive of its own edge");
  assert(decideTie(100, null, 50).residual === null && !decideTie(100, null, 50).ties,
    "[6c] nothing to compare is NOT a tie — Rule 61, and the reason the roll reports 'not measurable' separately from 'did not tie'");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
