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
  ({ name: null, amount: null, amountBasis: "outstanding", asOfDate: null, dateGranularity: null, maturityDate: null, rate: null,
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

console.log("\n=== [2] REAL: UHS at the anchor — THE ACCEPTANCE TEST, in the shape routing actually produces ===");
{
  // Every figure is copied from UHS's 10-Q filed 2026-08-07 (period June 30
  // 2026), in the unit that filing prints it in.
  //
  // ZERO SCHEDULE ROWS IS THE POINT. This note contains no table — measured:
  // its six issue-size statements sit a median 270 characters apart, where a
  // table's rows sit 60–90 apart. So every instrument routes to
  // proseInstruments and NOTHING can be double-routed. The v24 run failed
  // precisely because the two fields both took the same three instruments,
  // in different units, and dedup could not see across "$1,448,000 thousand"
  // and "$1,448 billion".
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
      { label: "Long-term debt", amount: "$4,079,937 thousands" },
    ] as never,
    scheduleSequence: [],
    proseInstruments: [
      prose({ category: "term-loan", name: "term loan A", amount: "$ 1.448 billion", amountBasis: "outstanding" }),
      prose({ category: "revolver", name: "revolving credit facility", amount: "$ 225 million", amountBasis: "outstanding" }),
      prose({ category: "senior-notes", name: "2026 Notes", amount: "$ 700 million", amountBasis: "outstanding", rate: "1.65 %", maturityDate: "2026-09-01" }),
      prose({ category: "senior-notes", name: "2029 Notes", amount: "$ 500 million", amountBasis: "outstanding", rate: "4.625 %", maturityDate: "2029-10-15" }),
      prose({ category: "senior-notes", name: "2030 Notes", amount: "$ 800 million", amountBasis: "outstanding", rate: "2.65 %", maturityDate: "2030-10-15" }),
      prose({ category: "senior-notes", name: "2032 Notes", amount: "$ 500 million", amountBasis: "outstanding", rate: "2.65 %", maturityDate: "2032-01-15" }),
      prose({ category: "senior-notes", name: "2034 Notes", amount: "$ 500 million", amountBasis: "outstanding", rate: "5.050 %", maturityDate: "2034-10-15" }),
      prose({ category: "other", name: "Trust financial liabilities included in debt", amount: "$ 68 million", amountBasis: "outstanding" }),
      // Committed but undrawn, twice over.
      prose({ category: "delayed-draw-term-loan", name: "delayed draw term loan A", amount: "$ 400 million", amountBasis: "commitment" }),
      prose({ category: "other", name: "delayed draw short term loan", amount: "$ 700 million", amountBasis: "commitment" }),
    ] as never,
    revolver: { facilitySize: "$ 1.5 billion", drawn: "$ 225 million", lettersOfCredit: "$ 3 million", available: "$ 1.272 billion", delayedDrawCapacity: "$ 400 million", asOfDate: "2026-06-30", sourceLine: "s" } as never,
  }));
  assert(Math.abs(c.capturedFace - 4_741_000_000) < 1_000_000,
    `[2a] five notes ($3.0B) + term loan A ($1.448B) + drawn revolver ($225M) + Trust liabilities ($68M) = $4.741B (got ${(c.capturedFace / 1e9).toFixed(3)}B)`);
  assert(c.residualPasses === true,
    `[2b] THE ACCEPTANCE TEST: residual ${((c.residualFraction ?? 1) * 100).toFixed(2)}% against $4,851,847K stated is inside the ${(COVERAGE_RESIDUAL_LIMIT * 100).toFixed(1)}% line — coverage 98%`);
  assert(c.entries.filter((e) => e.from === "prose").length === 8 && c.entries.every((e) => e.from === "prose"),
    `[2c] EIGHT entries, all from one field — no instrument can appear twice when only one field is populated (got ${c.entries.length} entries, ${c.entries.filter((e) => e.from === "row").length} of them rows)`);
  assert(c.capacity.length === 2 && !c.entries.some((e) => e.category === "delayed-draw-term-loan"),
    "[2d] the $400M delayed draw and the $700M Twelfth Amendment facility are excluded from debt and reported as $1.1B of capacity");
  assert(c.impossible.length === 0 && c.categoriesMissing.length === 0,
    `[2e] nothing impossible, nothing stated-but-uncaptured (${c.impossible.length} / ${c.categoriesMissing.join(", ") || "none"})`);
  assert(
    c.entries.filter((e) => e.category === "senior-notes").length === 5 &&
      c.entries.filter((e) => e.category === "senior-notes" && e.amount === 500_000_000).length === 3,
    "[2f] all five notes survive, and the three that are each $500 million stay three — same category, same size, different maturities"
  );
}

console.log("\n=== [2R] REAL: the acceptance test turns on the span reaching the whole note ===");
{
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
      { label: "Long-term debt", amount: "$4,079,937 thousands" },
    ] as never,
    scheduleSequence: [
      row("1.65 % notes 2026", "$700 million"), row("4.625 % notes 2029", "$500 million"),
      row("2.65 % notes 2030", "$800 million"), row("2.65 % notes 2032", "$500 million"),
      row("5.050 % notes 2034", "$500 million"),
    ],
    proseInstruments: [
      prose({ category: "term-loan", name: "term loan A", amount: "$ 1.448 billion", amountBasis: "outstanding" }),
      prose({ category: "revolver", name: "revolver", amount: "$ 225 million", amountBasis: "outstanding" }),
    ] as never,
    revolver: { facilitySize: "$ 1.5 billion", drawn: "$ 225 million", lettersOfCredit: "$ 3 million", available: "$ 1.272 billion", delayedDrawCapacity: null, asOfDate: null, sourceLine: "s" } as never,
  }));
  assert(c.residualPasses === false && c.residualFraction !== null && c.residualFraction > 0.036,
    `[2R] WITHOUT the note's "$ 68 million ... included in debt" sentence the residual is ${((c.residualFraction ?? 0) * 100).toFixed(2)}% and coverage FAILS — that sentence sits 2,100 characters past where the old span ended, which is the whole reason the span had to become the note rather than the table`);
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

console.log("\n=== [9] REAL: the two facility sizes v22 counted as debt ===");
{
  // Molina's note states a $1.25 billion revolving facility and NO drawn
  // balance at all. v22 added the whole $1.25B to coverage and read 134%.
  const molina = computeCoverage(dm({
    balanceSheetDebtCaptions: [{ label: "Long-term debt", amount: "$3,769 million" }] as never,
    scheduleSequence: [row("notes", "$3,800 million"), row("Deferred debt issuance costs", "($31 million)", "adjustment")],
    proseInstruments: [prose({ category: "revolver", name: "Credit Facility", amount: "$ 1.25 billion", amountBasis: "commitment" })] as never,
    revolver: { facilitySize: "$ 1.25 billion", drawn: null, lettersOfCredit: null, available: null, delayedDrawCapacity: "$ 800 million", asOfDate: "2026-06-30", sourceLine: "s" } as never,
  }));
  assert(Math.abs(molina.capturedFace - 3_800_000_000) < 1_000_000,
    `[9a] Molina: the $1.25B facility contributes NOTHING, because nothing is drawn against it — captured stays $3.80B (got ${(molina.capturedFace / 1e9).toFixed(3)}B, was $5.05B and 134%)`);
  assert(molina.capacity.length === 1 && molina.capacity[0].amount === 1_250_000_000,
    "[9b] and the $1.25B is REPORTED as capacity rather than deleted — an RM wants to know the headroom exists");

  // Tenet states the facility size AND that drawn is zero. Same answer, by
  // the drawn figure rather than by the missing one.
  const tenet = computeCoverage(dm({
    balanceSheetDebtCaptions: [{ label: "Long-term debt", amount: "$13,300 million" }] as never,
    scheduleSequence: [row("notes", "$13,385 million"), row("Unamortized issue costs and note discounts", "($85 million)", "adjustment")],
    proseInstruments: [prose({ category: "revolver", name: "senior secured revolving credit facility", amount: "$ 1.900 billion", amountBasis: "commitment" })] as never,
    revolver: { facilitySize: "$ 1.900 billion", drawn: "$ 0 million", lettersOfCredit: "$ 105 million", available: "$ 1.900 billion", delayedDrawCapacity: null, asOfDate: "2026-06-30", sourceLine: "s" } as never,
  }));
  assert(Math.abs(tenet.capturedFace - 13_385_000_000) < 1_000_000,
    `[9c] Tenet: drawn is stated as $0, so the revolver contributes $0 — captured stays $13.385B (got ${(tenet.capturedFace / 1e9).toFixed(3)}B, was $15.285B and 115%)`);
  assert(tenet.residualPasses === true && (tenet.residualFraction ?? 1) < 0.001,
    `[9d] and Tenet now reconciles instead of over-reading (residual ${((tenet.residualFraction ?? 0) * 100).toFixed(2)}%)`);
}

console.log("\n=== [10] REAL: Cigna's commercial paper is NOT capacity ===");
{
  // The distinction has to cut both ways or it is just a different exclusion
  // list. Cigna's "$ 1.0 billion outstanding as of June 30, 2026" is drawn
  // money under a program whose SIZE is $6.5 billion; the outstanding figure
  // counts and the program size does not.
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Short-term debt", amount: "$2,792 million" },
      { label: "Long-term debt", amount: "$29,086 million" },
    ] as never,
    proseInstruments: [
      prose({ category: "other", name: "Commercial paper program", amount: "$ 1.0 billion", amountBasis: "outstanding" }),
      prose({ category: "revolver", name: "Revolving Credit Agreement", amount: null, amountBasis: "commitment" }),
    ] as never,
    revolver: { facilitySize: "$ 6.5 billion", drawn: null, lettersOfCredit: null, available: "$ 6.5 billion", delayedDrawCapacity: null, asOfDate: "2026-06-30", sourceLine: "s" } as never,
  }));
  assert(c.capturedFace === 1_000_000_000,
    `[10a] the $1.0B outstanding commercial paper COUNTS (got ${(c.capturedFace / 1e9).toFixed(2)}B) — a drawn balance is debt whatever the facility is called`);
  assert(c.residualPasses === false,
    "[10b] and Cigna's anchor 10-Q states no ladder, so coverage correctly FAILS at 3% against $31.9B — the honest answer, where a 10-K ladder would have shown a tidy stale one");
}

console.log("\n=== [11] Dedup across units, and the three notes that stay three ===");
{
  // UHS's term loan A: the note writes "$ 1.448 billion" in a sentence and
  // 1,447,500 in a table stated in thousands. One instrument.
  const kept1 = dedupAgainstRows(
    [prose({ category: "term-loan", name: "term loan A", amount: "$ 1.448 billion" })] as never,
    [row("Tranche A term loan", "$1,447,500 thousand")]
  );
  assert(kept1.kept.length === 0 && kept1.suppressed.length === 1,
    "[11a] $1.448 billion and $1,447,500 thousand are ONE term loan — units normalised, and the 0.03% is the filing rounding its own figure for prose");

  // The same loan eight months earlier is a DIFFERENT balance, not a
  // rounding of this one, and must not be silently merged into it.
  const kept2 = dedupAgainstRows(
    [prose({ category: "term-loan", name: "term loan A", amount: "$ 1.155 billion" })] as never,
    [row("Tranche A term loan", "$1,447,500 thousand")]
  );
  assert(kept2.kept.length === 1,
    "[11b] $1.155 billion does NOT round to $1,447,500 thousand at its own printed precision, so it is not merged — a balance from another date is a different number, and the anchor rule is what keeps it out, not dedup");

  // Three real notes, same category, same size, different maturities.
  const three = dedupAgainstRows(
    [prose({ category: "senior-notes", name: "2029 Notes", amount: "$ 500 million", maturityDate: "2029-10-15" }),
     prose({ category: "senior-notes", name: "2032 Notes", amount: "$ 500 million", maturityDate: "2032-01-15" }),
     prose({ category: "senior-notes", name: "2034 Notes", amount: "$ 500 million", maturityDate: "2034-10-15" })] as never,
    [row("4.625 % senior secured notes due in October, 2029", "$500 million", "row")]
  );
  assert(three.suppressed.length === 1 && three.kept.length === 2,
    `[11c] only the 2029 note matches the 2029 ROW — the 2032 and 2034 notes survive because their maturities contradict it (kept ${three.kept.map((k) => k.name).join(", ")})`);
}

console.log("\n=== [12] REAL: one instrument cannot be larger than the total it is part of ===");
{
  // UHS at v24. Its note prints "$ 1.448 billion" and the model returned
  // "$1,448 billion" — one misplaced decimal, $1.448 TRILLION, on a ladder
  // line reading "Tranche A term loan". Coverage read 29,880%, so nothing was
  // silently wrong; but a line is what an RM reads, and that line was wrong.
  const c = computeCoverage(dm({
    balanceSheetDebtCaptions: [
      { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
      { label: "Long-term debt", amount: "$4,079,937 thousands" },
    ] as never,
    scheduleSequence: [
      row("Tranche A term loan", "$1,448,000 thousand"),
      row("Revolving credit facility", "$225,000 thousand"),
      row("Financial liabilities from failed sale leaseback", "$68,000 thousand"),
    ],
    proseInstruments: [
      prose({ category: "term-loan", name: "Tranche A term loan", amount: "$1,448 billion", amountBasis: "outstanding" }),
    ] as never,
  }));
  assert(c.impossible.length === 1 && Math.abs(c.capturedFace - 1_741_000_000) < 1_000_000,
    `[12a] the $1.448 TRILLION entry is excluded and the sum is the three real rows, $1.741B (got $${(c.capturedFace / 1e9).toFixed(3)}B) — a component of a total cannot exceed it, which is arithmetic and needs no vocabulary`);
  assert(c.line.includes("IMPOSSIBLE AMOUNT, EXCLUDED") && c.line.includes("Read the filing"),
    `[12b] and it is RENDERED as a transcription error rather than dropped — excluding it silently would leave a reader with a ladder short by a term loan and no reason why (${c.line.slice(-190)})`);
  assert(c.residualPasses === false,
    "[12c] coverage still fails, on the real gap (the five senior-note bullets) rather than on the typo — the guard removes a wrong number, it does not manufacture a pass");
}

console.log("\n=== [13] The denominator, its provenance, and the disagreement rule ===");
{
  const caps = [
    { label: "Current maturities of long-term debt", amount: "$771,910 thousands" },
    { label: "Long-term debt", amount: "$4,079,937 thousands" },
  ] as never;
  const rows = [row("notes", "$4,000 million")];

  // 1. XBRL present and agreeing — the ordinary case, nine of ten in the book.
  const agree = computeCoverage(dm({
    balanceSheetDebtCaptions: caps,
    scheduleSequence: rows,
    xbrlDebtTotal: { total: 4_851_847_000, asOf: "2026-06-30", parts: [{ tag: "LongTermDebtCurrent", value: 771_910_000 }, { tag: "LongTermDebtNoncurrent", value: 4_079_937_000 }], separateLeases: [], unavailableReason: null },
  } as never));
  assert(agree.denominatorSource === "xbrl" && agree.statedTotalDebt === 4_851_847_000 && agree.denominatorDisagreement === null,
    "[13a] where the filer tags a total, that is the denominator and the source says so");
  assert(agree.line.includes("the filer's own XBRL tags"),
    `[13b] and the LINE says which source it divided by — a percentage whose denominator is unstated is a percentage a reader cannot check (${agree.line.slice(0, 130)})`);

  // 2. XBRL absent — HCA's real state, whose company-facts data stops a
  //    quarter before its anchor. The read captions stand and are LABELLED.
  const fallback = computeCoverage(dm({
    balanceSheetDebtCaptions: caps,
    scheduleSequence: rows,
    xbrlDebtTotal: { total: null, asOf: "2026-06-30", parts: [], separateLeases: [], unavailableReason: "its company-facts data does not reach the anchor's period end" },
  } as never));
  assert(fallback.denominatorSource === "model-read" && fallback.statedTotalDebt === 4_851_847_000,
    "[13c] HCA'S CASE: no XBRL total, so the read captions stand — never a hole where a stable correct number was");
  assert(fallback.line.includes("read from the anchor's balance sheet"),
    `[13d] and it is labelled as read rather than tagged, so the two are never confused (${fallback.line.slice(0, 130)})`);

  // 3. BOTH present and DISAGREEING. This happens nowhere in the ten-name
  //    book — nine of ten agree to the dollar — and it will at forty names.
  //    Decided now so it is a rule rather than a discovery.
  const conflict = computeCoverage(dm({
    balanceSheetDebtCaptions: caps,
    scheduleSequence: rows,
    xbrlDebtTotal: { total: 5_036_000_000, asOf: "2026-06-30", parts: [{ tag: "LongTermDebtAndCapitalLeaseObligations", value: 5_036_000_000 }], separateLeases: [], unavailableReason: null },
  } as never));
  assert(conflict.statedTotalDebt === 5_036_000_000 && conflict.denominatorSource === "xbrl",
    "[13e] THE RULE: when both exist and disagree, XBRL IS THE NUMBER — it is the company's own tag, and it does not move when our prompt does");
  assert(conflict.denominatorDisagreement !== null && conflict.line.includes("DENOMINATOR DISAGREEMENT"),
    "[13f] and the model-read discrepancy renders as a FLAG, never a silent choice between two totals");
  assert((conflict.denominatorDisagreement ?? "").includes("$184M"),
    `[13g] the flag states the size of the gap, which is what tells a reader whether to go and read the balance sheet (${conflict.denominatorDisagreement})`);

  // 4. Neither.
  const none = computeCoverage(dm({ scheduleSequence: rows } as never));
  assert(none.denominatorSource === "none" && none.statedTotalDebt === null && none.line.includes("unmeasured"),
    "[13h] neither source is still a rendered state — coverage unmeasured, never a blank");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
