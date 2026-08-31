/**
 * Session 18 (post-v11) golden tests — lib/fetch/scheduleCompleteness.ts,
 * entirely offline/synthetic (a hand-built debt-note-shaped fullText
 * string; no network, no model call). Exercises the completeness
 * cross-check built specifically to make visible the class of gap HCA's
 * v10/v11 pilots showed both checksum checks can miss entirely: a
 * transcription that passes Check 1 and Check 2 on a PARTIAL capture of the
 * source table.
 *
 * Run: npx tsx lib/fetch/scheduleCompleteness.test.ts
 */
import { computeScheduleCompleteness } from "./scheduleCompleteness";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ PASS — ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL — ${label}`);
    failed++;
    failures.push(label);
  }
}

// A synthetic debt note carrying a real coupon-near-year cluster (3 rows,
// same structural signature noteLocation.ts looks for in real filings)
// so locateDebtNoteSection finds this section exactly like it would a real
// one — the completeness check is only ever run against a located section.
const ROW_1 = "4.625% Senior Notes due 2030 $1,000";
const ROW_2 = "3.750% Senior Notes due 2031 $1,500";
const ROW_3 = "6.875% Senior Notes due 2032 $1,000";
const ADJ_1 = "Debt issuance costs and discounts ($200)";
const TOTAL_A = "Total long-term debt $3,300";
const ROW_4 = "Commercial paper (average life of 38 days, weighted average rate of 4.3%) $500";
const TOTAL_B = "Total debt $3,800";
const ADJ_2 = "Less amounts due within one year ($400)";
const FINAL_UNLABELED = "$3,400";
const CLOSING_NARRATIVE = "The Company was in compliance with all financial covenants as of the reporting date.";

function buildFullText(): string {
  return ["NOTE 7 — DEBT", ROW_1, ROW_2, ROW_3, ADJ_1, TOTAL_A, ROW_4, TOTAL_B, ADJ_2, FINAL_UNLABELED, CLOSING_NARRATIVE].join(
    "\n"
  );
}

const NARRATIVE_ONLY_TEXT =
  "This is a plain narrative paragraph with no debt schedule at all — no coupon rate ever sits near a maturity year anywhere in this text, so the locator should find nothing here, same as a real filing with no locatable table.";

console.log("=== scheduleCompleteness.ts golden tests ===\n");

// --- 1. Full, honest transcription — every row/adjustment/subtotal
// through the source section's real end — is reported complete. ---
{
  const fullText = buildFullText();
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    { kind: "subtotal", sourceLine: TOTAL_A },
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    { kind: "subtotal", sourceLine: FINAL_UNLABELED },
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(c.checked, "[1a] a real located section -> checked=true");
  assert(c.subtotalsTranscribed === 3, `[1b] 3 subtotal-kind entries counted (got ${c.subtotalsTranscribed})`);
  assert(c.missingLabeledTotals.length === 0, `[1c] every labeled total in source is accounted for (got ${JSON.stringify(c.missingLabeledTotals)})`);
  assert(c.trailingUnconsumedText === null, "[1d] transcription reached the source section's real end -> no trailing flag");
  assert(c.complete, "[1e] a full, honest transcription reads as complete");
}

// --- 2. A labeled total OMITTED FROM THE MIDDLE (transcription continues
// past it, so the trailing check alone would miss this) is still caught and
// named — this is what would have caught a Centene-style dropped subtotal,
// not just a stopped-short one. ---
{
  const fullText = buildFullText();
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    // TOTAL_A ("Total long-term debt $3,300") never transcribed
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    { kind: "subtotal", sourceLine: FINAL_UNLABELED },
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(!c.complete, "[2a] a middle-omitted labeled total is not reported complete");
  assert(
    c.missingLabeledTotals.some((t) => t.includes("Total long-term debt")),
    `[2b] the missing total is NAMED (its own source snippet), not just counted (got ${JSON.stringify(c.missingLabeledTotals)})`
  );
  assert(c.trailingUnconsumedText === null, "[2c] transcription still reaches the real end -> no trailing flag, this is a middle gap specifically");
}

// --- 3. REAL (HCA's actual v10/v11 failure shape): transcription stops
// before the source section's genuinely UNLABELED final subtotal — no
// "Total" word exists for check [2]'s scan to find, so only the trailing
// check catches it. Both checksum checks could still pass on what WAS
// captured; this must flag anyway. ---
{
  const fullText = buildFullText();
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    { kind: "subtotal", sourceLine: TOTAL_A },
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    // FINAL_UNLABELED ("$3,400") never transcribed -- exactly HCA's gap shape
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(!c.complete, "[3a] HCA-shaped gap (stopped before the unlabeled final subtotal) is not reported complete");
  assert(c.missingLabeledTotals.length === 0, "[3b] no LABELED total is missing -- this gap is invisible to the labeled-total scan by design, same as HCA's real one");
  assert(
    c.trailingUnconsumedText !== null && c.trailingUnconsumedText.includes("3,400"),
    `[3c] the trailing check catches it instead, and the leftover source text is surfaced (got ${JSON.stringify(c.trailingUnconsumedText)})`
  );
}

// --- 4. A company with no locatable debt-note section at all (per
// noteLocation's own "not_found" case) -> checked=false, never a false
// "complete" or "incomplete" verdict on nothing to compare against. ---
{
  const c = computeScheduleCompleteness(NARRATIVE_ONLY_TEXT, [{ kind: "row", sourceLine: "irrelevant" }]);
  assert(!c.checked, "[4a] no locatable section -> checked=false");
  assert(!c.complete, "[4b] unchecked never reads as complete");
}

// --- 5. Zero transcribed entries -> checked=false, no crash (a company
// with debt-maturity not firing, or every entry dropped by verification). ---
{
  const c = computeScheduleCompleteness(buildFullText(), []);
  assert(!c.checked, "[5a] zero entries -> checked=false");
  assert(c.subtotalsTranscribed === 0, "[5b] subtotalsTranscribed is 0, not a crash");
}

// --- 6. REGRESSION (REAL — Quest Diagnostics' and Encompass Health's live
// false positives): the SAME line printed twice in one filing (the debt
// note's own table, then MD&A restating the identical totals later). The
// original `indexOf` took the FIRST occurrence anywhere in the document, so
// a correctly-transcribed total resolved to a span OUTSIDE the located
// section and then read as "missing." Occurrence-aware resolution must pick
// the in-section occurrence and report nothing missing. ---
{
  // The restatement has to sit where a real one sits — in MD&A, thousands of
  // characters from the note, not three lines under it. It was adjacent here
  // only because the fixture is small, and the located section's own padding
  // then reached it, which made this test assert the opposite of what it
  // describes: a duplicate INSIDE the section is not the Quest case at all.
  const restatement = [
    "",
    "-".repeat(4000),
    "Management's Discussion and Analysis",
    "As discussed above, " + TOTAL_A + " and the related current portion are unchanged from the prior period.",
  ].join("\n");
  const fullText = buildFullText() + restatement;
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    { kind: "subtotal", sourceLine: TOTAL_A },
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    { kind: "subtotal", sourceLine: FINAL_UNLABELED },
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(
    c.missingLabeledTotals.length === 0,
    `[6a] a total that IS transcribed is not reported missing just because the filing prints it twice (got ${JSON.stringify(c.missingLabeledTotals)})`
  );
  assert(c.complete, "[6b] the duplicated-line filing reads as complete — this is Quest's exact live false positive");
}

// --- 7. REGRESSION (REAL — Encompass Health's and CHS's live false
// positives): trailing content that is adjacent NARRATIVE PROSE or a
// different neighbouring table must NOT flag. The locator's bounds are a
// padded density window, not a table boundary, so prose after the note is
// entirely ordinary and is not a missed row. ---
{
  const narrativeTail =
    "\nThe following chart shows scheduled principal payments due on long-term debt for the next five years and thereafter (in millions): Face Amount Net Amount July 2026";
  const fullText = buildFullText() + narrativeTail;
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    { kind: "subtotal", sourceLine: TOTAL_A },
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    { kind: "subtotal", sourceLine: FINAL_UNLABELED },
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(
    c.trailingUnconsumedText === null,
    `[7a] adjacent narrative prose does NOT flag as unconsumed table content (got ${JSON.stringify(c.trailingUnconsumedText)})`
  );
  assert(c.complete, "[7b] a complete transcription followed by prose reads as complete — Encompass/CHS's exact live false positive");
}

// --- 8. REVERSE ASSERTION for [7]: narrowing the trailing check to
// predominantly-numeric lines must NOT have silently disabled it. The
// HCA-shaped unlabeled-subtotal gap still flags even when prose follows it,
// because the bare figure sits on its own line. ---
{
  const narrativeTail = "\nThe following chart shows scheduled principal payments due on long-term debt (in millions): Face Amount";
  const fullText = buildFullText() + narrativeTail;
  const entries = [
    { kind: "row", sourceLine: ROW_1 },
    { kind: "row", sourceLine: ROW_2 },
    { kind: "row", sourceLine: ROW_3 },
    { kind: "adjustment", sourceLine: ADJ_1 },
    { kind: "subtotal", sourceLine: TOTAL_A },
    { kind: "row", sourceLine: ROW_4 },
    { kind: "subtotal", sourceLine: TOTAL_B },
    { kind: "adjustment", sourceLine: ADJ_2 },
    // FINAL_UNLABELED still missing, now with prose after it too
  ];
  const c = computeScheduleCompleteness(fullText, entries);
  assert(
    c.trailingUnconsumedText !== null && c.trailingUnconsumedText.includes("3,400"),
    `[8] the real unlabeled-subtotal gap still flags with prose present — the narrowing did not disable the check (got ${JSON.stringify(c.trailingUnconsumedText)})`
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL scheduleCompleteness.ts GOLDEN TESTS PASSED");
}
