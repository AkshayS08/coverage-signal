/**
 * SESSION 20, ITEMS 3C–3E — the coverage check.
 *
 * Run: npx tsx lib/events/coverage.test.ts
 */
import { computeCoverage, dedupAgainstRows, checkRevolverArithmetic, COVERAGE_RESIDUAL_LIMIT } from "./coverage";
import type { TriggerResult, ProseInstrumentRow, VerifiedSequenceEntry } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const row = (label: string, amount: string, kind: VerifiedSequenceEntry["kind"] = "row"): VerifiedSequenceEntry =>
  ({ kind, label, amount, rate: null, seniority: null, maturityDate: null, dateGranularity: null,
     sourceLine: label, citedUrl: "u", section: null, periodColumn: null } as VerifiedSequenceEntry);
const prose = (o: Partial<ProseInstrumentRow> & { category: ProseInstrumentRow["category"] }): ProseInstrumentRow =>
  ({ name: null, amount: null, asOfDate: null, dateGranularity: null, maturityDate: null, rate: null,
     sourceLine: `s:${o.category}`, ...o } as ProseInstrumentRow);

function dm(o: Partial<TriggerResult> = {}): TriggerResult {
  return { triggerId: "debt-maturity", scheduleSequence: [], balanceSheetDebtCaptions: [],
    proseInstruments: [], revolver: null, ...o } as unknown as TriggerResult;
}

console.log("\n=== [1] REAL: UHS before prose instruments — correctly terrible ===");
{
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
      { label: "Long-term debt", amount: "$4,079,937 thousands" },
    ] as never,
  }));
  assert(c.statedTotalDebt === 4_851_847_000,
    `[1a] stated total debt is the two anchor captions summed — $4,851,847K, matching UHS's own capitalization table exactly (got ${c.statedTotalDebt})`);
  assert(c.capturedFace === 0 && c.residualPasses === false,
    "[1b] nothing captured against $4.85B — coverage FAILS, which is the correct answer and the one the old checks could not give");
  assert(c.line.includes("$4.85B") && c.anchorCaptions.length === 2,
    `[1c] the line names the captions it summed rather than asserting a total from nowhere (${c.line.slice(0, 90)})`);
}

console.log("\n=== [2] REAL: UHS after 3a/3b — the acceptance test ===");
{
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
      { label: "Long-term debt", amount: "$4,079,937 thousands" },
    ] as never,
    proseInstruments: [
      prose({ category: "term-loan", name: "Tranche A term loan", amount: "$1,447,500 thousand" }),
      prose({ category: "senior-notes", name: "1.65% notes due 2026", amount: "$700 million" }),
      prose({ category: "senior-notes", name: "4.625% notes due 2029", amount: "$500 million" }),
      prose({ category: "senior-notes", name: "2.65% notes due 2030", amount: "$800 million" }),
      prose({ category: "senior-notes", name: "2.65% notes due 2032", amount: "$500 million" }),
      prose({ category: "senior-notes", name: "5.050% notes due 2034", amount: "$500 million" }),
      prose({ category: "revolver", name: "revolving credit facility", amount: "$225,000 thousand" }),
      prose({ category: "other", name: "other debt", amount: "$197,052 thousand" }),
      // Committed but undrawn — capacity, never debt.
      prose({ category: "delayed-draw-term-loan", name: "delayed draw term loan A", amount: "$400 million" }),
    ] as never,
  }));
  assert(Math.abs(c.capturedFace - 4_869_552_000) < 1_000_000,
    `[2a] captured face is term loan + five notes + revolver + other = $4.87B (got ${(c.capturedFace / 1e9).toFixed(3)}B)`);
  assert(c.residualPasses === true,
    `[2b] THE ACCEPTANCE TEST: residual ${((c.residualFraction ?? 1) * 100).toFixed(2)}% is inside the ${(COVERAGE_RESIDUAL_LIMIT * 100).toFixed(1)}% line — coverage climbs from 0% to ~100%`);
  assert(!c.entries.some((e) => e.category === "delayed-draw-term-loan"),
    "[2c] the $400M delayed-draw facility is EXCLUDED — committed capacity is not drawn debt, and counting it would overstate the position");
}

console.log("\n=== [3] Category completeness has no threshold ===");
{
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [{ label: "Long-term debt", amount: "$10,000 million" }] as never,
    scheduleSequence: [row("notes", "$9,990 million")],
    proseInstruments: [prose({ category: "term-loan", name: "small term loan", amount: null })] as never,
  }));
  assert(c.categoriesMissing.includes("term-loan"),
    "[3a] a stated term loan we hold no amount for is flagged REGARDLESS of size — 'small' is not 'accounted for'");
  assert(c.residualFraction !== null && c.residualFraction < COVERAGE_RESIDUAL_LIMIT,
    "[3b] and it flags even though residual materiality passes — the two tests are separate and a single percentage would hide this");
}

console.log("\n=== [4] The bridge is subtracted, not tolerated ===");
{
  // Molina's real shape: rows at face 3,800; issuance costs (31); stated 3,769.
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [{ label: "Long-term debt", amount: "$3,769 million" }] as never,
    scheduleSequence: [row("notes", "$3,800 million"), row("Deferred debt issuance costs", "($31 million)", "adjustment")],
  }));
  assert(c.residual !== null && Math.abs(c.residual) < 1_000_000,
    `[4a] face 3,800 less the note's own issuance costs 31 reconciles EXACTLY to the stated 3,769 — the bridge is itemised, so the threshold never has to absorb it (residual ${c.residual})`);
}

console.log("\n=== [5] A current-portion adjustment is not subtracted twice ===");
{
  // Stated total sums BOTH captions, so it already includes current maturities;
  // subtracting the note's "less current portion" as well removes them twice.
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current portion of long-term debt", amount: "$117 million" },
      { label: "Long-term debt", amount: "$10,664 million" },
    ] as never,
    scheduleSequence: [row("notes", "$10,847 million"), row("Discount and deferred financing costs", "($66 million)", "adjustment"), row("Less current portion", "($117 million)", "adjustment")],
  }));
  assert(c.residual !== null && Math.abs(c.residual) < 5_000_000,
    `[5a] matched by CATEGORY, never proximity — the current-portion line is skipped because the caption set already carries it (residual ${c.residual})`);
}

console.log("\n=== [6] Dedup before coverage ===");
{
  const rows = [row("2.65% Senior Notes due 2030", "$800 million")];
  const { kept, suppressed } = dedupAgainstRows(
    [prose({ category: "senior-notes", name: "2.65% notes due 2030", amount: "$800 million" }),
     prose({ category: "term-loan", name: "term loan A", amount: "$1,448 million" })] as never,
    rows
  );
  assert(kept.length === 1 && kept[0].category === "term-loan" && suppressed.length === 1,
    "[6a] a prose instrument duplicating a table row is ONE entry — matched on category+amount, never on name");
}

console.log("\n=== [7] Never suppress ===");
{
  const c = computeCoverage(dm({}));
  assert(c.statedTotalDebt === null && c.line.includes("unmeasured"),
    `[7a] no anchor caption renders "coverage unmeasured" — a reader must tell a book we checked from one we could not (${c.line})`);
}

console.log("\n=== [8] 3b — the revolver's free arithmetic ===");
{
  const ok = checkRevolverArithmetic({ facilitySize: "$1.5 billion", drawn: "$225 million",
    lettersOfCredit: "$3 million", available: "$1.272 billion", delayedDrawCapacity: null, asOfDate: null, sourceLine: "s" } as never);
  assert(ok.checked && ok.ok, `[8a] REAL: UHS's 225 + 3 + 1,272 = 1,500 reconciles (${ok.note})`);
  const bad = checkRevolverArithmetic({ facilitySize: "$1.5 billion", drawn: "$225 million",
    lettersOfCredit: "$3 million", available: "$900 million", delayedDrawCapacity: null, asOfDate: null, sourceLine: "s" } as never);
  assert(bad.checked && !bad.ok && bad.note.includes("DOES NOT RECONCILE"),
    "[8b] a mismatch renders as its OWN flag, never as a liquidity figure someone might act on");
  const partial = checkRevolverArithmetic({ facilitySize: "$1.5 billion", drawn: null,
    lettersOfCredit: null, available: null, delayedDrawCapacity: null, asOfDate: null, sourceLine: "s" } as never);
  assert(!partial.checked && partial.note.includes("not checkable"),
    "[8c] fewer than four figures is stated as not checkable — never derived, because deriving one makes the check circular");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
