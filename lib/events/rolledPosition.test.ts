/**
 * SESSION 24 — THE SIGNING CRITERION FOR A ROLLED POSITION, ON FIXTURES.
 *
 * Declared and asserted BEFORE the extra call bills, so the rule that decides
 * whether a roll counts is not chosen after seeing the numbers it will be
 * applied to. Cigna's real figures appear in the assertion text because they
 * are what the rule was written against; the inputs are constructed, so this
 * suite does not go green merely because Cigna still has the totals it had.
 *
 * Run: npx tsx lib/events/rolledPosition.test.ts
 */
import { rolledVerdict, rolledRowLabel, ROLL_BAND_USD } from "./rolledPosition";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** Cigna's shape: a $31.463B base at Dec 31 2025 rolling to a $31.878B anchor total. */
const cigna = (over: Partial<Parameters<typeof rolledVerdict>[0]> = {}) => ({
  baseStatedTotal: 31_463_000_000,
  baseComputedTotal: 31_463_000_000,
  anchorStatedTotal: 31_878_000_000,
  rolledTotal: 31_878_000_000,
  baseAsOf: "Dec 31, 2025",
  anchorAsOf: "June 30, 2026",
  baseNote: "10-K Note 7",
  ...over,
});

console.log("\n=== [1] BOTH TIES HOLD — rolled rows count toward coverage ===");
{
  const v = rolledVerdict(cigna());
  assert(v.kind === "counts",
    `[1a] base ties exactly and the roll lands on the anchor's stated total — the rolled position counts toward coverage (got ${v.kind})`);
  assert(v.kind === "counts" && v.baseGap === 0,
    "[1b] and the base gap is reported as zero rather than merely implied by a pass");
  assert(v.statement.includes("Coverage is computed on the rolled position"),
    "[1c] the verdict says what happens next in words, so a reader is not left inferring it from a kind");

  const nearEdge = rolledVerdict(cigna({ rolledTotal: 31_878_000_000 + ROLL_BAND_USD }));
  assert(nearEdge.kind === "counts",
    `[1d] a roll exactly ON the ±$50M band counts — the band is inclusive, stated rather than left to a reader of the operator (got ${nearEdge.kind})`);
}

console.log("\n=== [2] ROLLED ROWS RENDER AS ROLLED, AND NEVER AS THE ANCHOR'S ===");
{
  const label = rolledRowLabel({ baseAsOf: "Dec 31, 2025", anchorAsOf: "June 30, 2026", baseNote: "10-K Note 7" });
  assert(label === "as of Dec 31, 2025, per 10-K Note 7, rolled to June 30, 2026",
    `[2a] the label names the base date, the note it came from, and the date it was rolled to (got "${label}")`);
  const v = rolledVerdict(cigna());
  assert(v.kind === "counts" && v.label === label,
    "[2b] and a counting verdict carries that exact label, so every rolled row renders under one string rather than each caller composing its own");
  assert(label.includes("Dec 31, 2025") && label.includes("rolled to"),
    "[2c] A ROLLED ROW THAT DOES NOT SAY IT IS ROLLED is indistinguishable from a row the anchor states — which is the substitution this whole design exists to prevent (fix 5, Rule 66). The label is not decoration");
}

console.log("\n=== [3] EITHER TIE FAILS — coverage stays on the anchor, and the name does not sign ===");
{
  const baseMiss = rolledVerdict(cigna({ baseComputedTotal: 31_463_000_000 - 120_000_000 }));
  assert(baseMiss.kind === "prior-period-only" && baseMiss.failed === "base",
    `[3a] a base that does not tie is prior-period-only — the transcription is not the table it claims to be (got ${baseMiss.kind}/${(baseMiss as { failed?: string }).failed})`);
  assert(baseMiss.statement.includes("does not sign"),
    "[3b] and it says so: coverage stays on the anchor's own rows and this name does not sign on a rolled position");

  const rollMiss = rolledVerdict(cigna({ rolledTotal: 31_878_000_000 + 200_000_000 }));
  assert(rollMiss.kind === "prior-period-only" && rollMiss.failed === "roll",
    `[3c] a base that ties with a roll that MISSES is still prior-period-only — real movement is unaccounted for, and a tied base does not excuse it (got ${(rollMiss as { failed?: string }).failed})`);
  assert(rollMiss.statement.includes("do not account for the distance"),
    "[3d] and the gap is stated on the page rather than the base quietly not counting");

  const both = rolledVerdict(cigna({ baseComputedTotal: 1, rolledTotal: 1 }));
  assert(both.kind === "prior-period-only" && both.failed === "both",
    "[3e] both failing is its own outcome, not collapsed into either one — a base that ties with a roll that misses and a roll that lands on an untied base are different findings and point at different fixes");

  // THE EXACTNESS OF THE BASE TIE IS ITSELF A RULE, and a band here would hide
  // the missing row it exists to catch.
  const oneOff = rolledVerdict(cigna({ baseComputedTotal: 31_463_000_000 + 1_000_000 }));
  assert(oneOff.kind === "prior-period-only",
    "[3f] the BASE tie is exact — a transcription checked against its own printed total has no rounding to allow for, so $1M off is off. Only the ROLL gets a band, because it spans two dates and a chain of separately-stated events");
}

console.log("\n=== [4] A TIE THAT COULD NOT BE CHECKED IS NOT A TIE ===");
{
  const v = rolledVerdict(cigna({ anchorStatedTotal: null }));
  assert(v.kind === "prior-period-only" && v.failed === "not-measurable",
    `[4a] a missing total makes the roll UNCHECKABLE, which is its own outcome — Rule 61: a comparison that cannot read its inputs must not answer (got ${(v as { failed?: string }).failed})`);
  assert(v.statement.includes("could not be attempted"),
    "[4b] and it reads as 'not checked', never as 'checked and failed' or 'checked and passed' — the three must not print the same way");
  assert(v.baseGap === null && v.rollGap === null,
    "[4c] with no gap numbers invented to fill the report");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
