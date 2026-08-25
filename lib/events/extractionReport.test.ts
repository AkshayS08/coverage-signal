/**
 * Session 18 golden tests — lib/events/extractionReport.ts.
 *
 * The case this file exists for is [2]: HCA's real shape, where both checks
 * tie on a transcription that stopped before the source section's last two
 * subtotals. A boolean "reconciled" would report that company as passing.
 * Every other case here is a control around that one.
 *
 * SYNTHETIC by design — hand-built sequences, no fixture and no API. The
 * shapes are drawn from real observed runs (HCA's nested two-section note,
 * DaVita's flat single-section note, Tenet's dropped rows) but the numbers
 * are chosen to make each assertion unambiguous.
 *
 * Run: npx tsx lib/events/extractionReport.test.ts
 */
import type { CompanyResult, TriggerResult, VerifiedBalanceSheetCaption, VerifiedSequenceEntry } from "../agent";
import type { ScheduleCompletenessResult } from "../fetch/scheduleCompleteness";
import { buildExtractionReport, formatBookSummary, formatExtractionReport, summarizeBook } from "./extractionReport";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

// --- Builders: only the fields this module reads are meaningful; the rest
// are filled with the same neutral defaults every trigger carries. ---

function entry(kind: "row" | "adjustment" | "subtotal", label: string | null, amount: string, section: string | null): VerifiedSequenceEntry {
  return {
    kind,
    label,
    section,
    rate: null,
    amount,
    maturityDate: null,
    dateGranularity: null,
    seniority: null,
    periodColumn: null,
    sourceLine: `${label ?? "(unlabeled)"} ${amount}`,
    citedUrl: "https://example.gov/base",
  };
}

function caption(label: string, amount: string): VerifiedBalanceSheetCaption {
  return { label, amount, periodColumn: null, sourceLine: `${label} ${amount}`, citedUrl: "https://example.gov/base" };
}

function trigger(over: Partial<TriggerResult> = {}): TriggerResult {
  return {
    triggerId: "debt-maturity",
    triggerName: "Debt maturity",
    fired: true,
    dataAvailable: true,
    evidence: null,
    mappedNeed: "refi",
    needType: "credit",
    confidence: 1,
    citations: [],
    quote: null,
    quoteVerified: false,
    verifiedQuote: null,
    quoteMatchType: null,
    quoteHasFigure: false,
    verifiedQuoteNormalized: null,
    eventDate: null,
    dateGranularity: null,
    eventStatus: "upcoming",
    proceedsUse: null,
    scheduleSequence: [],
    priorScheduleSequence: [],
    balanceSheetDebtCaptions: [],
    debtScheduleSourceFiling: { form: "10-Q", date: "2026-06-30", url: "https://example.gov/base" },
    debtSchedulePriorFiling: null,
    rowsExtracted: 0,
    rowsVerified: 0,
    scheduleCompleteness: null,
    redeems: null,
    issuedTranches: [],
    cashAmount: null,
    projectName: null,
    ...over,
  } as TriggerResult;
}

function company(name: string, dm: TriggerResult, others: TriggerResult[] = []): CompanyResult {
  return { company: name, cik: "0000000000", ticker: "XXX", results: [dm, ...others], verdict: "CALL", relationshipFlags: [] };
}

const COMPLETE: ScheduleCompletenessResult = { checked: true, subtotalsTranscribed: 2, labeledTotalCandidatesInSource: 2, missingLabeledTotals: [], trailingUnconsumedText: null, complete: true };
const INCOMPLETE: ScheduleCompletenessResult = { checked: true, subtotalsTranscribed: 1, labeledTotalCandidatesInSource: 3, missingLabeledTotals: ["Total debt 49,718"], trailingUnconsumedText: null, complete: false };

console.log("=== extractionReport golden tests ===\n");

// ============================================================================
// 1. DaVita's shape — flat single-section note, both checks tie at exactly
//    zero, nothing left unconsumed. The clean baseline.
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [
      entry("row", "Term Loan B-1", "$1,000 million", null),
      entry("row", "4.625% senior notes", "$2,000 million", null),
      entry("subtotal", "Total debt principal outstanding", "$3,000 million", null),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$3,000 million")],
    scheduleCompleteness: { ...COMPLETE, subtotalsTranscribed: 1, labeledTotalCandidatesInSource: 1 },
    rowsExtracted: 4,
    rowsVerified: 4,
  });
  const r = buildExtractionReport(company("DAVITA", dm));
  assert(r.verdict === "pass", `[1a] a flat, complete, tying company is "pass" (got ${r.verdict})`);
  assert(r.check1.pass && r.check2.pass, "[1b] both checks tie");
  assert(r.check2.nearestGap === 0, `[1c] Check 2 ties at EXACTLY zero, not merely within tolerance (got ${r.check2.nearestGap})`);
  assert(r.causes.length === 0, `[1d] a clean pass names no causes (got ${JSON.stringify(r.causes)})`);
}

// ============================================================================
// 2. THE CASE THIS FILE EXISTS FOR — HCA's shape. A nested two-section note
//    whose transcription stops before the last subtotals. Both checks tie on
//    what WAS captured; only the completeness cross-check can see the gap.
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [
      entry("row", "Senior secured notes", "$40,000 million", "Long-term debt"),
      entry("row", "Term loans", "$5,828 million", "Long-term debt"),
      entry("subtotal", "Total long-term debt", "$45,828 million", "Long-term debt"),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt, less current portion", "$45,828 million")],
    scheduleCompleteness: INCOMPLETE,
    rowsExtracted: 4,
    rowsVerified: 4,
  });
  const r = buildExtractionReport(company("HCA", dm));
  assert(r.check1.pass && r.check2.pass, "[2a] both checks TIE — neither can see a table that ends early");
  assert(r.verdict === "pass-partial", `[2b] and yet the verdict is NOT "pass" — it is "pass-partial" (got ${r.verdict})`);
  assert(
    r.causes.some((c) => c.includes("COMPLETENESS") && c.includes("Total debt 49,718")),
    `[2c] the missing subtotal is NAMED, not merely counted (got ${JSON.stringify(r.causes)})`
  );
  const text = formatExtractionReport(r).join("\n");
  assert(/PASS \(PARTIAL TRANSCRIPTION\)/.test(text), "[2d] the rendered headline cannot be skim-read as a clean pass");
  assert(/INCOMPLETE/.test(text), "[2e] and the completeness line says INCOMPLETE in the body too");
}

// ============================================================================
// 3. Check 1 failure — a dropped row. The gap and the offending subtotal are
//    both named, and the drop is reported as the mechanism alongside it.
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [
      entry("row", "5.125% notes", "$1,500 million", null),
      // the $1,750 row was dropped by verification
      entry("subtotal", "Total long-term debt", "$3,250 million", null),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$3,250 million")],
    scheduleCompleteness: COMPLETE,
    rowsExtracted: 4,
    rowsVerified: 2,
  });
  const r = buildExtractionReport(company("TENET", dm));
  assert(r.verdict === "fail", `[3a] a non-tying walk is "fail" (got ${r.verdict})`);
  assert(r.causes.some((c) => c.startsWith("CHECK 1") && c.includes("$1.75B")), `[3b] the gap is stated in dollars (got ${JSON.stringify(r.causes)})`);
  assert(r.rowsDropped === 2 && r.causes.some((c) => c.startsWith("DROPS")), "[3c] the 2 dropped entries are reported as the mechanism");
  assert(r.check2.pass, "[3d] Check 2 still ties here — reported SEPARATELY, never blended into a single verdict bit");
}

// ============================================================================
// 4. Check 1 ties but Check 2 does not — the stale-note case, and the whole
//    reason the two checks are never merged. A uniformly mis-scaled or
//    wrong-period table walks perfectly against itself.
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [
      entry("row", "Notes", "$1,000 million", null),
      entry("row", "Term loan", "$2,000 million", null),
      entry("subtotal", "Total debt", "$3,000 million", null),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$4,200 million")],
    scheduleCompleteness: COMPLETE,
    rowsExtracted: 4,
    rowsVerified: 4,
  });
  const r = buildExtractionReport(company("CHS", dm));
  assert(r.check1.pass, "[4a] the internal walk ties perfectly against itself");
  assert(!r.check2.pass && r.verdict === "fail", "[4b] but the balance-sheet anchor catches it, and the company fails");
  assert(r.causes.some((c) => c.startsWith("CHECK 2") && c.includes("$1.20B")), `[4c] the anchor gap is named (got ${JSON.stringify(r.causes)})`);
}

// ============================================================================
// 5. No subtotal transcribed at all (UHS's shape) — the walk has nothing to
//    reconcile, which must read as its own cause rather than a silent
//    "does not tie".
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [entry("row", "Revolving credit", "$500 million", null)],
    balanceSheetDebtCaptions: [],
    rowsExtracted: 1,
    rowsVerified: 1,
  });
  const r = buildExtractionReport(company("UHS", dm));
  assert(r.verdict === "fail", "[5a] zero subtotals is a failure, not a pass by vacuity");
  assert(r.causes.some((c) => c.includes("no subtotal was transcribed")), "[5b] and the cause says so explicitly");
  assert(r.causes.some((c) => c.includes("no balance-sheet debt caption")), "[5c] the missing Check 2 anchor is named separately");
}

// ============================================================================
// 6. No locatable schedule — reported as its own outcome, NOT as a failure.
//    Finding the table and transcribing it correctly are different fixes.
// ============================================================================
{
  const r = buildExtractionReport(company("QUEST", trigger({ debtScheduleSourceFiling: null })));
  assert(r.verdict === "no-schedule", `[6a] no schedule is its own verdict (got ${r.verdict})`);
  assert(r.causes.some((c) => c.includes("no filing had a locatable debt-note section")), "[6b] with the locator named as the cause");
  const r2 = buildExtractionReport(company("QUEST2", trigger({ rowsExtracted: 12, rowsVerified: 0 })));
  assert(
    r2.verdict === "no-schedule" && r2.causes.some((c) => c.includes("no entry survived")),
    "[6c] 'located but everything dropped' is distinguished from 'never located'"
  );
}

// ============================================================================
// 7. Row accounting spans EVERY trigger — a drop in new-debt-issuance's
//    issuedTranches must be as loud as one in the ladder.
// ============================================================================
{
  const dm = trigger({
    scheduleSequence: [entry("row", "Notes", "$1,000 million", null), entry("subtotal", "Total debt", "$1,000 million", null)],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$1,000 million")],
    scheduleCompleteness: COMPLETE,
    rowsExtracted: 3,
    rowsVerified: 3,
  });
  const issuance = trigger({ triggerId: "new-debt-issuance", rowsExtracted: 4, rowsVerified: 1 });
  const r = buildExtractionReport(company("CIGNA", dm, [issuance]));
  assert(r.rowsExtracted === 7 && r.rowsVerified === 4 && r.rowsDropped === 3, `[7a] drops sum across triggers (got ${r.rowsExtracted}/${r.rowsVerified})`);
  assert(r.verdict === "pass-partial" || r.causes.some((c) => c.startsWith("DROPS")), "[7b] and a drop outside the ladder is still reported");
}

// ============================================================================
// 8. Cost: unmeasured must never render as $0.00, and a genuinely cached
//    company must read as cached rather than free.
// ============================================================================
{
  const dm = trigger({ scheduleSequence: [entry("row", "Notes", "$1 million", null), entry("subtotal", "Total", "$1 million", null)], balanceSheetDebtCaptions: [caption("Long-term debt", "$1 million")] });
  const unmeasured = formatExtractionReport(buildExtractionReport(company("A", dm))).join("\n");
  assert(/cost:\s+not measured/.test(unmeasured), "[8a] no spend captured reads as 'not measured', never $0.00");
  const cached = formatExtractionReport(
    buildExtractionReport(company("B", dm), { company: "B", byModel: [], totalCalls: 0, totalUsd: 0, hasUnpricedModel: false, unpricedModels: [] })
  ).join("\n");
  assert(/fully cached/.test(cached), "[8b] a zero-call company reads as cached, not as a free extraction");
}

// ============================================================================
// 9. The book summary — the tie rate excludes no-schedule companies from its
//    denominator, and "pass" is reported separately from "both checks tie".
// ============================================================================
{
  const tying = (name: string, comp: ScheduleCompletenessResult) =>
    buildExtractionReport(
      company(
        name,
        trigger({
          scheduleSequence: [entry("row", "Notes", "$1,000 million", null), entry("subtotal", "Total debt", "$1,000 million", null)],
          balanceSheetDebtCaptions: [caption("Long-term debt", "$1,000 million")],
          scheduleCompleteness: comp,
        })
      )
    );
  const failing = buildExtractionReport(
    company("F", trigger({ scheduleSequence: [entry("row", "Notes", "$1,000 million", null), entry("subtotal", "Total debt", "$9,000 million", null)], balanceSheetDebtCaptions: [caption("Long-term debt", "$9,000 million")] }))
  );
  const none = buildExtractionReport(company("N", trigger({ debtScheduleSourceFiling: null })));
  const s = summarizeBook([tying("P", COMPLETE), tying("PP", INCOMPLETE), failing, none]);

  assert(s.passCount === 1 && s.passPartialCount === 1 && s.failCount === 1 && s.noScheduleCount === 1, `[9a] four outcomes counted separately (got ${JSON.stringify([s.passCount, s.passPartialCount, s.failCount, s.noScheduleCount])})`);
  assert(s.tieRate?.of === 3, `[9b] the no-schedule company is excluded from the tie-rate DENOMINATOR (got ${s.tieRate?.of})`);
  assert(s.tieRate?.tied === 2, `[9c] and the pass-partial company still counts as tying (got ${s.tieRate?.tied})`);
  assert(s.passCount !== s.tieRate?.tied, "[9d] 'pass' and 'both checks tie' are deliberately different numbers — they differ by exactly the partial transcriptions");
  assert(s.totalUsd === null, "[9e] a book where nothing was measured totals 'not measured', never $0.00");
  assert(/both checks tie: 2\/3/.test(formatBookSummary(s).join("\n")), "[9f] the summary states the tie rate over the checkable companies");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL EXTRACTION-REPORT GOLDEN TESTS PASSED");
