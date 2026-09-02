/**
 * Session 18 Part B/C golden tests — position.ts, entirely offline/
 * synthetic. Every case here is a hand-built CompanyResult, same SYNTHETIC
 * convention the rest of this project's test suites already use for shapes
 * a real fixture can't reproduce — each pinned to a real worked example
 * wherever one exists (Tenet's Nov 2025 redemption; HCA's and DaVita's real
 * debt-note walks, hand-verified against the actual filings, from the
 * post-v9 checksum redesign), so the logic is validated against a real,
 * specified scenario, not an arbitrary one.
 *
 * Run: npx tsx lib/events/position.test.ts
 */
import type { CompanyResult, TriggerResult, VerifiedBalanceSheetCaption, VerifiedSequenceEntry } from "../agent";
import { assemblePosition, computeWalkChecksum, computeBalanceSheetCheck } from "./position";

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

function row(over: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry {
  return {
    kind: "row",
    rate: null,
    seniority: null,
    amount: "$1.0 billion",
    maturityDate: "2027-01-01",
    dateGranularity: "day",
    sourceLine: `synthetic: ${over.label}`,
    citedUrl: "https://example.com/base-filing",
    section: null,
    periodColumn: null,
    ...over,
  };
}

function adjustment(over: Partial<VerifiedSequenceEntry> & { label: string; amount: string }): VerifiedSequenceEntry {
  return {
    kind: "adjustment",
    rate: null,
    seniority: null,
    maturityDate: null,
    dateGranularity: null,
    sourceLine: `synthetic: ${over.label}`,
    citedUrl: "https://example.com/base-filing",
    section: null,
    periodColumn: null,
    ...over,
  };
}

function subtotal(over: Partial<VerifiedSequenceEntry> & { amount: string }): VerifiedSequenceEntry {
  return {
    kind: "subtotal",
    label: null,
    rate: null,
    seniority: null,
    maturityDate: null,
    dateGranularity: null,
    sourceLine: `synthetic subtotal: ${over.amount}`,
    citedUrl: "https://example.com/base-filing",
    section: null,
    periodColumn: null,
    ...over,
  };
}

function caption(label: string, amount: string): VerifiedBalanceSheetCaption {
  return { label, amount, sourceLine: `synthetic: ${label} ${amount}`, citedUrl: "https://example.com/base-filing", periodColumn: null };
}

function baseTriggerResult(over: Partial<TriggerResult> & { triggerId: string }): TriggerResult {
  return {
    triggerName: "synthetic",
    fired: true,
    dataAvailable: true,
    evidence: null,
    mappedNeed: "synthetic",
    needType: "credit",
    confidence: 1,
    citations: [{ form: "10-Q", date: "2026-06-30", reportDate: "", url: "https://example.com/base-filing" }],
    quoteVerified: true,
    verifiedQuote: null,
    verifiedQuoteNormalized: null,
    quoteMatchType: null,
    quoteHasFigure: false,
    eventDate: null,
    dateGranularity: null,
    eventStatus: "standing",
    proceedsUse: null,
    scheduleSequence: [],
    priorScheduleSequence: [],
    balanceSheetDebtCaptions: [],
    debtScheduleSourceFiling: null,
    debtSchedulePriorFiling: null,
    rowsExtracted: 0,
    rowsVerified: 0,
    baseRowsExtracted: 0,
    scheduleCompleteness: null,
    redeems: [],
    issuedTranches: [],
    eventInstances: [],
    noteRetirements: [],
    proseInstruments: [],
    revolver: null,
    projectCompletionDate: null,
    projectCompletionGranularity: null,
    cashAmount: null,
    projectName: null,
    columnReadFailure: false,
    ...over,
  };
}

function companyWith(results: TriggerResult[]): CompanyResult {
  return {
    company: "SYNTHETIC CO.",
    cik: "0000000000",
    ticker: "SYN",
    verdict: "CALL",
    relationshipFlags: [],
    results,
  };
}

console.log("=== Session 18 Part B/C golden tests (position.ts) ===\n");

// ============================================================================
// Part B — ladder assembly (unaffected in spirit by the checksum redesign;
// now built from scheduleSequence's "row"-kind entries).
// ============================================================================

// --- 1. Base ladder rows are `live` by construction — no "confirming" a
// row the newest filing itself lists (the inverted-first-draft bug: base
// rows must NEVER default to unconfirmed). ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "4.625% notes", rate: "4.625%", maturityDate: "2030-06-01", dateGranularity: "day", amount: "$2.75 billion" }),
      row({ label: "Term Loan A-2", rate: "SOFR + 1.50%", maturityDate: "2028-01-01", dateGranularity: "year", amount: "$1.9 billion" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  assert(pos.rows.length === 2, `[1a] base ladder has 2 rows (got ${pos.rows.length})`);
  assert(pos.rows.every((r) => r.status === "live"), "[1b] every base-ladder row is live by default — nothing needs 'confirming'");
}

// --- 2. Redemption matches on rate+maturity, never amount — two SAME-SIZE,
// SAME-YEAR tranches distinguished only by rate/seniority (Part B's own
// worked warning: "Tenet holds two $1.5B 2027 tranches distinguished only
// by lien"). Amount-alone matching would retire the wrong one, or both. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "5.125% senior secured first lien notes", seniority: "Senior secured first lien notes:", rate: "5.125%", maturityDate: "2027-11-01", dateGranularity: "month", amount: "$1.5 billion" }),
      row({ label: "6.250% senior secured second lien notes", seniority: "Senior secured second lien notes:", rate: "6.250%", maturityDate: "2027-02-01", dateGranularity: "month", amount: "$1.5 billion" }),
    ],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    redeems: [{ instrument: "the 6.250% senior secured second lien notes due February 2027", amount: null, status: "completed" as const, sourceLine: "the 6.250% senior secured second lien notes due February 2027", verified: true }],
    citations: [{ form: "8-K", date: "2025-11-18", reportDate: "", url: "https://example.com/8k-nov2025" }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]));
  const firstLien = pos.rows.find((r) => r.rate === "5.125%")!;
  const secondLien = pos.rows.find((r) => r.rate === "6.250%")!;
  assert(firstLien.status === "live", "[2a] REVERSE ASSERTION (Tenet worked example): the 5.125% first lien due Nov 2027 stays LIVE — the retirement logic does nothing to it");
  assert(secondLien.status === "retired", "[2b] the 6.250% second lien due Feb 2027 — the one actually named in redeems — is retired");
  assert(secondLien.retiredBy?.evidence === issuance.redeems[0]?.sourceLine, "[2c] the retired row carries the redemption evidence that explains it");
}

// --- 3. issuedTranches append as new live rows — the newly priced notes
// join the ladder, not just remove the old one. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "6.250% second lien notes", rate: "6.250%", maturityDate: "2027-02-01", dateGranularity: "month" })],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    redeems: [{ instrument: "the 6.250% second lien notes due February 2027", amount: null, status: "completed" as const, sourceLine: "the 6.250% second lien notes due February 2027", verified: true }],
    issuedTranches: [
      { instrument: "5.500% first lien notes", rate: "5.500%", seniority: null, maturityDate: "2032-01-01", dateGranularity: "year", amount: "$1.5 billion", sourceLine: "synthetic", citedUrl: "https://example.com/8k" },
      { instrument: "6.000% senior notes", rate: "6.000%", seniority: null, maturityDate: "2033-01-01", dateGranularity: "year", amount: "$750 million", sourceLine: "synthetic", citedUrl: "https://example.com/8k" },
    ],
  });
  const pos = assemblePosition(companyWith([dm, issuance]));
  assert(pos.rows.length === 3, `[3a] ladder has 3 rows: 1 retired + 2 newly issued (got ${pos.rows.length})`);
  assert(pos.rows.filter((r) => r.status === "live").length === 2, "[3b] exactly 2 live rows — the two newly issued tranches");
  assert(pos.rows.find((r) => r.rate === "6.250%")?.status === "retired", "[3c] the old tranche is retired, not deleted — still on the ladder, just marked");
}

// --- 4. Unconfirmed: a row in priorScheduleSequence that's absent from the
// current scheduleSequence, with NO redemption explaining it, is added back
// as `unconfirmed` — not silently dropped, not assumed still outstanding. ---
// NOTE (post-v11): the base ladder here carries a reconciling subtotal AND
// a matching balance-sheet caption on purpose. The unconfirmed pass is only
// meaningful when the CURRENT filing's own schedule is trustworthy — see
// assemblePosition's baseLadderUntrustworthy rule and test [18] below. A
// base ladder that fails both checks makes "this row vanished" a statement
// about the extraction, not the company.
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "4.625% notes", rate: "4.625%", maturityDate: "2030-06-01", dateGranularity: "day" }),
      subtotal({ label: "Total debt", amount: "$1.0 billion" }),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$1.0 billion")],
    priorScheduleSequence: [
      row({ label: "4.625% notes", rate: "4.625%", maturityDate: "2030-06-01", dateGranularity: "day" }),
      row({ label: "3.750% notes", rate: "3.750%", maturityDate: "2026-03-01", dateGranularity: "month", citedUrl: "https://example.com/prior-filing" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  assert(!pos.baseLadderUntrustworthy, "[4-setup] the base ladder reconciles, so the unconfirmed pass is meaningful here");
  const dropped = pos.rows.find((r) => r.rate === "3.750%");
  assert(!!dropped, "[4a] the row that disappeared between filings is still present on the position (never silently dropped)");
  assert(dropped?.status === "unconfirmed", "[4b] it's marked unconfirmed — extraction gap or genuine unannounced retirement, checksum settles which");
  assert(pos.rows.find((r) => r.rate === "4.625%")?.status === "live", "[4c] the row present in BOTH periods stays live, not re-flagged");
  assert(pos.rows.length === 2, "[4d] no duplicate — the still-present row isn't ALSO re-added from priorScheduleSequence");
}

// --- 5. A prior-period row that WAS explained by a redemption is not also
// flagged unconfirmed — retired and unconfirmed are mutually exclusive
// explanations for the same disappearance. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    // Reconciling base ladder, same reason as [4] above.
    scheduleSequence: [
      row({ label: "5.125% first lien", rate: "5.125%", maturityDate: "2027-11-01", dateGranularity: "month" }),
      subtotal({ label: "Total debt", amount: "$1.0 billion" }),
    ],
    balanceSheetDebtCaptions: [caption("Long-term debt", "$1.0 billion")],
    priorScheduleSequence: [
      row({ label: "5.125% first lien", rate: "5.125%", maturityDate: "2027-11-01", dateGranularity: "month" }),
      row({ label: "6.250% second lien", rate: "6.250%", maturityDate: "2027-02-01", dateGranularity: "month" }),
    ],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    redeems: [{ instrument: "the 6.250% second lien notes due February 2027", amount: null, status: "completed" as const, sourceLine: "the 6.250% second lien notes due February 2027", verified: true }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]));
  const secondLien = pos.rows.find((r) => r.rate === "6.250%");
  assert(secondLien?.status === "retired", "[5] a prior-period row explained by a redemption is retired, not ALSO added again as unconfirmed");
  assert(pos.rows.length === 2, "[5b] no duplicate row for the explained tranche");
}

// --- 6. Sort order: ascending by maturity, bare-year rows ordered
// correctly relative to full dates (year-end convention, ordering only —
// never displayed as a real date). ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "C", maturityDate: "2033-01-01", dateGranularity: "year" }),
      row({ label: "A", maturityDate: "2027-06-01", dateGranularity: "day" }),
      row({ label: "B", maturityDate: "2029-01-01", dateGranularity: "month" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  assert(
    pos.rows.map((r) => r.instrument).join(",") === "A,B,C",
    `[6] rows sorted ascending by maturity regardless of granularity (got: ${pos.rows.map((r) => r.instrument).join(",")})`
  );
}

// --- 7. adjustments and finalSubtotal exposed for display, unchanged. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "A" }),
      adjustment({ label: "unamortized discount", amount: "-$45 million" }),
      subtotal({ label: "Total debt", amount: "$13.3 billion" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  assert(pos.adjustments.length === 1 && pos.adjustments[0].label === "unamortized discount", "[7a] adjustments exposed for display");
  assert(pos.finalSubtotal?.amount === "$13.3 billion", "[7b] finalSubtotal is the last subtotal in the sequence");
}

// --- 8. No debt-maturity trigger at all (e.g. a company with no debt
// disclosed) — empty position, no crash. ---
{
  const pos = assemblePosition(companyWith([baseTriggerResult({ triggerId: "large-cash-balance" })]));
  assert(pos.rows.length === 0 && pos.adjustments.length === 0 && pos.finalSubtotal === null, "[8] no debt-maturity trigger present -> empty position, no crash");
}

// ============================================================================
// Part C, redesigned post-v9 — Check 1 (internal walk) and Check 2
// (balance-sheet anchor), reported and tested SEPARATELY. Three rounds of
// label-matching (category, feedsIntoTotal, a proposed numeric fallback)
// all tried to answer "which total does this line belong to" — a question
// the filing never poses. A debt note is a running total: every printed
// subtotal equals the sum of everything printed above it.
// ============================================================================

// --- 9. Check 1, REAL (HCA, hand-verified against the actual filing),
// post-v10 NESTED/section model: the filing prints "Commercial paper" FIRST
// under its own "Short-term borrowings" heading — printed order, never
// repositioned — then the "Long-term debt" section's own rows/adjustment/
// subtotal, then a rollup "Total debt" (section null) that folds in BOTH
// "Total long-term debt" and the still-open "Short-term borrowings" section,
// then a final unlabeled rollup subtotal. Every subtotal must reconcile
// independently. ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "Commercial paper", amount: "$3,890 million", section: "Short-term borrowings" }),
    row({ label: "Other debt", amount: "$1,069 million", section: "Long-term debt" }),
    row({ label: "Senior unsecured credit facility", amount: "$1,010 million", section: "Long-term debt" }),
    row({ label: "Senior unsecured notes payable through 2095", amount: "$44,200 million", section: "Long-term debt" }),
    adjustment({ label: "Debt issuance costs and discounts", amount: "-$451 million", section: "Long-term debt" }),
    subtotal({ label: "Total long-term debt", amount: "$45,828 million", section: "Long-term debt" }),
    subtotal({ label: "Total debt", amount: "$49,718 million", section: null }),
    adjustment({ label: "Less amounts due within one year", amount: "-$6,264 million", section: null }),
    subtotal({ label: null, amount: "$43,454 million", section: null }),
  ];
  const c = computeWalkChecksum(sequence);
  assert(c.pass, `[9a] REAL (HCA) all 3 subtotals in the chain reconcile -> Check 1 passes (failures: ${c.subtotalChecks.filter((s) => !s.tie).map((s) => s.label).join(", ")})`);
  assert(c.subtotalChecks.length === 3, `[9b] 3 subtotals walked (got ${c.subtotalChecks.length})`);
  assert(c.subtotalChecks.every((s) => s.gap === 0), `[9c] every subtotal ties EXACTLY, not just within tolerance (gaps: ${c.subtotalChecks.map((s) => s.gap).join(", ")})`);
  assert(c.rowCount === 4 && c.adjustmentCount === 2, `[9d] 4 rows (incl. commercial paper) + 2 adjustments counted (got rows=${c.rowCount}, adjustments=${c.adjustmentCount})`);
  assert(c.subtotalChecks[0].section === "Long-term debt", "[9e] the first subtotal reports which section it closed");
  assert(c.subtotalChecks[1].section === null, "[9f] 'Total debt' is a rollup, section null — it doesn't belong to one heading");
}

// --- 10. Check 1, REAL (DaVita, hand-verified against the actual filing):
// 9 real tranche rows, then the SAME two-subtotal-adjustment chain pattern
// as HCA. DaVita's tie must be exact — the explicit bar this session set
// before any further spend. ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "Term Loan A-2", amount: "$1,975,000 thousand" }),
    row({ label: "Term Loan B-2", amount: "$2,357,910 thousand" }),
    row({ label: "Revolving line of credit", amount: "$65,000 thousand" }),
    row({ label: "4.625% Senior Notes", amount: "$2,750,000 thousand" }),
    row({ label: "3.75% Senior Notes", amount: "$1,500,000 thousand" }),
    row({ label: "6.875% Senior Notes", amount: "$1,000,000 thousand" }),
    row({ label: "6.75% Senior Notes", amount: "$1,000,000 thousand" }),
    row({ label: "Acquisition obligations and other notes payable", amount: "$39,463 thousand" }),
    row({ label: "Financing lease obligations", amount: "$160,143 thousand" }),
    subtotal({ label: "Total debt principal outstanding", amount: "$10,847,516 thousand" }),
    adjustment({ label: "Discount, premium and deferred financing costs", amount: "$(66,503) thousand" }),
    subtotal({ label: null, amount: "$10,781,013 thousand" }),
    adjustment({ label: "Less current portion", amount: "($117,177) thousand" }),
    subtotal({ label: null, amount: "$10,663,836 thousand" }),
  ];
  const c = computeWalkChecksum(sequence);
  assert(c.pass, `[10a] REAL (DaVita) all 3 subtotals reconcile -> Check 1 passes (failures: ${c.subtotalChecks.filter((s) => !s.tie).map((s) => s.gap).join(", ")})`);
  assert(c.subtotalChecks.every((s) => s.gap === 0), `[10b] every subtotal ties to the EXACT dollar (gaps: ${c.subtotalChecks.map((s) => s.gap).join(", ")})`);
  assert(c.rowCount === 9, `[10c] all 9 real tranches counted (got ${c.rowCount})`);
}

// --- 11. A single dropped/fabricated row corrupts EVERY subtotal after it,
// not just the nearest one — the property that makes Check 1 robust against
// exactly the Centene-shaped fabrication risk (a whole row silently wrong
// or missing). Same nested HCA shape as [9], with "Senior unsecured credit
// facility" (section "Long-term debt") dropped: the section-closing subtotal
// fails, and because the section's COMPUTED (not claimed) sum is what folds
// into the rollup, "Total debt" fails too. ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "Commercial paper", amount: "$3,890 million", section: "Short-term borrowings" }),
    row({ label: "Other debt", amount: "$1,069 million", section: "Long-term debt" }),
    // "Senior unsecured credit facility" row MISSING (simulates a dropped/fabricated row)
    row({ label: "Senior unsecured notes payable through 2095", amount: "$44,200 million", section: "Long-term debt" }),
    adjustment({ label: "Debt issuance costs and discounts", amount: "-$451 million", section: "Long-term debt" }),
    subtotal({ label: "Total long-term debt", amount: "$45,828 million", section: "Long-term debt" }),
    subtotal({ label: "Total debt", amount: "$49,718 million", section: null }),
  ];
  const c = computeWalkChecksum(sequence);
  assert(!c.pass, "[11a] a missing row breaks Check 1 -- never a false pass");
  assert(c.subtotalChecks.every((s) => !s.tie), "[11b] EVERY subtotal after the missing row fails, not just the first one -- the corruption propagates through the whole chain, section boundary included");
  assert(c.subtotalChecks[0].gap === 1_010_000_000, `[11c] the section-closing subtotal's gap is exactly the missing row's own amount (1,069+44,200-451=44,818 vs claimed 45,828, gap=1,010M) (got ${c.subtotalChecks[0].gap})`);
  assert(c.subtotalChecks[1].gap === 1_010_000_000, `[11d] the rollup's gap is the SAME 1,010M -- the section's computed (not claimed) sum folded upward, carrying the corruption across the section boundary (got ${c.subtotalChecks[1].gap})`);
}

// --- 12. No subtotals at all (empty or malformed sequence) -> Check 1
// fails honestly rather than vacuously passing on nothing to check. ---
{
  const c = computeWalkChecksum([row({ label: "A", amount: "$1.0 billion" })]);
  assert(!c.pass, "[12] zero subtotals -> Check 1 does not pass -- nothing was actually verified");
  assert(c.subtotalChecks.length === 0, "[12b] no subtotal checks recorded");
}

// --- 13. computeWalkChecksum handles undefined/empty input without
// crashing (a company with no debt-maturity trigger, or legacy cached
// data). ---
{
  const c = computeWalkChecksum(undefined);
  assert(!c.pass && c.subtotalChecks.length === 0, "[13] undefined sequence -> Check 1 fails cleanly, no crash");
}

// --- 14. Check 2, REAL (DaVita, hand-verified): balance-sheet captions
// ("current portion of long-term debt" + "long-term debt") sum to EXACTLY
// the note's own post-discount subtotal (10,781,013) -- proves the note
// belongs to this period. ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "A", amount: "$1.0 billion" }),
    subtotal({ label: "Total debt principal outstanding", amount: "$10,847,516 thousand" }),
    adjustment({ label: "Discount, premium and deferred financing costs", amount: "$(66,503) thousand" }),
    subtotal({ label: null, amount: "$10,781,013 thousand" }),
  ];
  const captions: VerifiedBalanceSheetCaption[] = [
    caption("Current portion of long-term debt", "$117,177 thousand"),
    caption("Long-term debt", "$10,663,836 thousand"),
  ];
  const c = computeBalanceSheetCheck(captions, sequence);
  assert(c.pass, `[14a] REAL (DaVita) balance-sheet captions (117,177 + 10,663,836 = 10,781,013) match the note's own post-discount subtotal -> Check 2 passes (nearestGap=${c.nearestGap})`);
  assert(c.matchedSubtotalAmount === 10_781_013_000, `[14b] matched the correct (unlabeled) subtotal, not the labeled pre-discount one (got ${c.matchedSubtotalAmount})`);
  assert(c.captionSum === 10_781_013_000, `[14c] caption sum computed correctly (got ${c.captionSum})`);
}

// --- 15. Check 2 fails honestly when captions don't match ANY subtotal in
// the sequence (a stale/wrong-period note) -- reports the nearest gap,
// never forces a match, never suppresses the failure. ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "A", amount: "$1.0 billion" }),
    subtotal({ label: "Total debt", amount: "$10,000,000 thousand" }),
  ];
  const captions: VerifiedBalanceSheetCaption[] = [caption("Long-term debt", "$8,500,000 thousand")];
  const c = computeBalanceSheetCheck(captions, sequence);
  assert(!c.pass, "[15a] captions don't match any subtotal -> Check 2 fails, not forced to tie");
  assert(c.nearestGap === -1_500_000_000, `[15b] the gap to the nearest subtotal is reported even on failure, never suppressed (got ${c.nearestGap})`);
  assert(c.matchedSubtotalLabel === null, "[15c] no subtotal falsely reported as matched on failure");
}

// --- 16. Check 2 with zero balance-sheet captions extracted -> fails
// honestly (nothing to check), never a false pass. ---
{
  const c = computeBalanceSheetCheck([], [subtotal({ label: "Total debt", amount: "$1.0 billion" })]);
  assert(!c.pass && c.captionCount === 0, "[16] zero captions -> Check 2 does not pass");
}

// --- 17. Check 1 and Check 2 are genuinely independent — a company can
// pass one and fail the other, and each names its own failure (the whole
// point of splitting them, per the redesign: "they fail differently"). ---
{
  const sequence: VerifiedSequenceEntry[] = [
    row({ label: "A", amount: "$1.0 billion" }),
    subtotal({ label: "Total debt", amount: "$1.0 billion" }),
  ];
  const walk = computeWalkChecksum(sequence);
  const bs = computeBalanceSheetCheck([caption("Long-term debt", "$5.0 billion")], sequence); // deliberately wrong -- simulates a stale note
  assert(walk.pass, "[17a] Check 1 passes on its own (the internal arithmetic is self-consistent)");
  assert(!bs.pass, "[17b] Check 2 independently fails (the note doesn't match the balance sheet) -- Check 1 passing does not paper over this");
}

// --- 18. Session 18 (post-v11), REAL (CHS-shaped): when the base ladder
// fails BOTH checks, the unconfirmed pass is suppressed entirely. CHS's
// newest 10-Q carries two maturity mentions and no table at all; running
// the pass anyway would merge every row of the 10-K's real 36-row schedule
// into the current ladder, one "unconfirmed" row at a time — a stale ladder
// presented as the current position. The prior schedule is surfaced as
// explicitly-labelled CONTEXT instead (portfolioTable.ts), never merged. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    // No subtotal -> Check 1 fails; no captions -> Check 2 fails.
    scheduleSequence: [row({ label: "8.000% Senior Secured Notes due 2027", rate: "8.000%", maturityDate: "2027-01-01", dateGranularity: "year" })],
    priorScheduleSequence: [
      row({ label: "PRIOR A", rate: "3.111%", maturityDate: "2028-01-01", dateGranularity: "year" }),
      row({ label: "PRIOR B", rate: "3.222%", maturityDate: "2029-01-01", dateGranularity: "year" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  assert(pos.baseLadderUntrustworthy, "[18a] both checks failing marks the base ladder untrustworthy");
  assert(pos.rows.length === 1, `[18b] the prior schedule is NOT merged in as unconfirmed rows (got ${pos.rows.length} rows: ${pos.rows.map((r) => r.instrument).join(", ")})`);
  assert(pos.rows.every((r) => r.status !== "unconfirmed"), "[18c] no row is marked unconfirmed — that label is only meaningful against a base ladder that reconciles");
  // [18d] RETIRED with CompanyPosition.priorSequence (Session 18, post-v16).
  // It asserted the prior sequence was carried through for the render layer
  // to show as labelled context; that render path is gone, superseded by the
  // locator search-order rule which advances the BASE filing instead. The
  // trigger's own priorScheduleSequence is untouched and still drives the
  // unconfirmed pass — which is exactly what [18b] and [18c] above verify,
  // so the behaviour that mattered is still covered.
  assert(
    dm.priorScheduleSequence.length === 2 && pos.rows.every((r) => !r.instrument.startsWith("PRIOR")),
    "[18d] priorScheduleSequence is still available to the unconfirmed pass, and still never merged into the ladder"
  );
}

// ============================================================================
// A3 — A LADDER THAT MISSES BY A MATERIAL SHARE OF ITS OWN STATED TOTAL DOES
// NOT PRESENT ITS ROWS AS THE POSITION.
//
// CHS's real numbers: five rows summing to $3.50B against a stated total of
// $9.578B, so the walk misses by 79% — and three of those five rows were
// fabricated. Check 2 TIED throughout (captions and subtotals were both
// transcribed correctly; only the rows between them were wrong), so
// `baseLadderUntrustworthy`, which needs BOTH checks to fail, never fired.
//
// The distinction A3 has to hold is between "does not tie" and "cannot be
// shown as the position". A rounding-sized miss is the first; most of the
// ladder missing is the second.
// ============================================================================
{
  const materiallyShort = companyWith([
    baseTriggerResult({
      triggerId: "debt-maturity",
      scheduleSequence: [
        row({ label: "4.750% Senior Secured Notes due 2031", amount: "$689 million" }),
        row({ label: "10.875% Senior Secured Notes due 2032", amount: "$1,549 million" }),
        subtotal({ label: "Total debt", amount: "$9,578 million" }),
      ],
    }),
  ]);
  const p = assemblePosition(materiallyShort);
  assert(p.walkGapFraction !== null && Math.round(p.walkGapFraction * 100) === 77, `[A3-1] the gap is reported as a fraction of the ladder's own stated total (got ${p.walkGapFraction})`);
  assert(p.rowsNotVerifiedAsTranscribed, "[A3-2] ...and a ladder missing three quarters of itself does not present its rows as the position");
  assert(p.rows.length === 2, "[A3-3] NEVER SUPPRESSED — the rows are still assembled and still rendered; only the claim about them changes");

  // --- REVERSE: a rounding-sized miss is not a material one. ---
  const roundingShort = companyWith([
    baseTriggerResult({
      triggerId: "debt-maturity",
      scheduleSequence: [
        row({ label: "Tranche A", amount: "$5,000 million" }),
        row({ label: "Tranche B", amount: "$5,000 million" }),
        subtotal({ label: "Total debt", amount: "$10,150 million" }),
      ],
    }),
  ]);
  const r = assemblePosition(roundingShort);
  assert(r.walkGapFraction !== null && !r.rowsNotVerifiedAsTranscribed, `[A3-4] REVERSE: a 1.5% miss still fails Check 1 but does NOT suppress the position claim (got ${r.walkGapFraction})`);

  // --- REVERSE: a clean walk reports no gap at all. ---
  const clean = companyWith([
    baseTriggerResult({
      triggerId: "debt-maturity",
      scheduleSequence: [
        row({ label: "Tranche A", amount: "$5,000 million" }),
        row({ label: "Tranche B", amount: "$5,000 million" }),
        subtotal({ label: "Total debt", amount: "$10,000 million" }),
      ],
    }),
  ]);
  const c = assemblePosition(clean);
  assert(c.walkGapFraction === null && !c.rowsNotVerifiedAsTranscribed, "[A3-5] REVERSE: a ladder that ties reports no gap and makes no disclaimer");

}

// ============================================================================
// C1 / D3 — REPAID AND MATURED ARE FACTS, NOT ABSENCES.
//
// Both render, neither cards, and they are different statements: "the filing
// says this tranche is at nil" and "the date the filing stated has passed"
// carry different information for an RM, and collapsing either into a bare
// disappearance loses it.
// ============================================================================
{
  const NOW = new Date("2026-08-25T00:00:00Z");
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "1.250 % Notes due March 2026", rate: "1.250%", maturityDate: "2026-03-01", dateGranularity: "month", amount: "$549 million" }),
      row({ label: "3.250 % Notes due April 2025", rate: "3.250%", maturityDate: "2025-04-01", dateGranularity: "month", amount: "$ —" }),
      row({ label: "4.500 % Notes due September 2030", rate: "4.500%", maturityDate: "2030-09-15", dateGranularity: "day", amount: "$993 million" }),
      row({ label: "Notes due 2026", rate: "5.000%", maturityDate: "2026", dateGranularity: "year", amount: "$400 million" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]), NOW);
  const byLabel = (l: string) => pos.rows.find((r) => r.instrument === l)!;

  assert(byLabel("3.250 % Notes due April 2025").status === "repaid", "[C1-8] a row the filing states at nil is REPAID — not dropped, and not merely matured");
  assert(byLabel("1.250 % Notes due March 2026").status === "matured", "[D3-1] a row whose stated maturity has passed is MATURED, never live");
  assert(byLabel("4.500 % Notes due September 2030").status === "live", "[D3-2] REVERSE: a future maturity is untouched");
  assert(byLabel("Notes due 2026").status === "live", "[D3-3] REVERSE: a BARE YEAR is not matured until the WHOLE year is — the filing never said which month of 2026");
  assert(pos.rows.length === 4, "[C1-9] NEVER SUPPRESSED — all four rows are still on the ladder");
  assert(!byLabel("1.250 % Notes due March 2026").retiredBy, "[D3-4] with nothing in the corpus explaining the repayment, nothing is claimed about it");
}

// --- D3, the other half: where an issuance DOES name the matured tranche,
// that explanation is attached rather than inferred. ---
{
  const NOW = new Date("2026-08-25T00:00:00Z");
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "3.45 % Senior Note due June 2026", rate: "3.45%", maturityDate: "2026-06-01", dateGranularity: "month", amount: "$501 million" })],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    redeems: [{ instrument: "3.45% Senior Notes due June 2026", amount: null, status: "completed" as const, sourceLine: "3.45% Senior Notes due June 2026", verified: true }],
    citations: [{ form: "8-K", date: "2026-05-08", reportDate: "", url: "https://example.com/8k" }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]), NOW);
  const r = pos.rows[0];
  assert(r.status === "retired" || (r.status === "matured" && !!r.retiredBy), `[D3-5] a matured tranche an issuance names carries that explanation (status ${r.status}, explained ${!!r.retiredBy})`);
}

// ============================================================================
// ISSUED-TRANCHE DEDUP — THE NOTE'S ROW WINS.
//
// A tranche disclosed in both the debt note and its own pricing 8-K rendered
// twice, as two separate live rows for one borrowing. Measured live: Tenet's
// 5.500% due 2032 and 6.000% due 2033, Encompass's 5.875% due 2034 three
// times over, Molina's 6.500% due 2031, four of Cigna's.
//
// The two sources describe the same instrument differently and only one is
// the position: the note states what is OUTSTANDING at period end, the 8-K
// states what was ISSUED on one day. The note wins and keeps its amount; the
// 8-K contributes only the pricing date.
// ============================================================================
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      // The note carries it NET of a repurchase — 1,450 outstanding against 1,500 issued.
      row({ label: "5.500 % due 2032", rate: "5.500%", maturityDate: "2032", dateGranularity: "year", amount: "$1,450 million" }),
    ],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    citations: [{ form: "8-K", date: "2025-11-18", reportDate: "", url: "https://example.com/8k-nov" }],
    issuedTranches: [
      { instrument: "5.500% senior secured first lien notes due 2032", rate: "5.500%", seniority: null, maturityDate: "2032", dateGranularity: "year", amount: "$1,500 million", sourceLine: "synthetic", citedUrl: "https://example.com/8k-nov" },
      // A post-period pricing the note cannot carry — this one DOES earn a row.
      { instrument: "6.250% senior notes due 2035", rate: "6.250%", seniority: null, maturityDate: "2035", dateGranularity: "year", amount: "$800 million", sourceLine: "synthetic", citedUrl: "https://example.com/8k-nov" },
    ],
  });
  const pos = assemblePosition(companyWith([dm, issuance]), new Date("2026-08-25T00:00:00Z"));

  assert(pos.rows.length === 2, `[DEDUP-1] one borrowing is one row — the note's 2032 tranche and its pricing 8-K do not both render (got ${pos.rows.length})`);
  const y2032 = pos.rows.find((r) => (r.maturityDate ?? "").startsWith("2032"))!;
  assert(y2032.amount === "$1,450 million", `[DEDUP-2] the surviving row carries the NOTE's outstanding amount, not the 8-K's issue size (got ${y2032.amount})`);
  assert(y2032.instrument === "5.500 % due 2032", `[DEDUP-3] ...and the note's own instrument label (got ${JSON.stringify(y2032.instrument)})`);
  assert(y2032.issuedOn?.date === "2025-11-18", `[DEDUP-4] the 8-K contributes its pricing date and nothing else (got ${JSON.stringify(y2032.issuedOn ?? null)})`);

  const y2035 = pos.rows.find((r) => (r.maturityDate ?? "").startsWith("2035"));
  assert(!!y2035, "[DEDUP-5] REVERSE: a tranche the note does NOT carry — the post-period issuance — still gets its own row");
  assert(y2035?.amount === "$800 million" && y2035?.issuedOn?.date === "2025-11-18", "[DEDUP-6] ...with the 8-K's own amount, because there is no note row to defer to");
}

// --- The dedup must not resurrect a row the note reports at nil, nor
// un-retire one a redemption already explained. ---
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "4.500 % due 2028", rate: "4.500%", maturityDate: "2028", dateGranularity: "year", amount: "$ —" })],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    citations: [{ form: "8-K", date: "2026-06-01", reportDate: "", url: "https://example.com/8k-jun" }],
    issuedTranches: [{ instrument: "4.500% senior notes due 2028", rate: "4.500%", seniority: null, maturityDate: "2028", dateGranularity: "year", amount: "$400 million", sourceLine: "synthetic", citedUrl: "https://example.com/8k-jun" }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]), new Date("2026-08-25T00:00:00Z"));
  assert(pos.rows.length === 1, "[DEDUP-7] still one row");
  assert(pos.rows[0].status === "repaid", `[DEDUP-8] a tranche the note reports at nil stays REPAID — an old pricing 8-K does not put it back on the ladder (got ${pos.rows[0].status})`);
  assert(pos.rows[0].amount === "$ —", "[DEDUP-9] ...and keeps the note's nil balance, not the 8-K's original issue size");
}

console.log("\n=== [S21] BOTH GATES, AND EACH ONE ALONE IS NOT ENOUGH ===");
{
  // A retirement removes real debt from a banker's screen, so it needs both
  // halves of the claim to hold: the sentence must BE in the filing
  // (verifiedRedemption) and the sentence must SAY the payment happened
  // (status "completed", after corroboration). Confirmed here as two
  // independent gates rather than one, because if only one were
  // load-bearing the other would be decoration and nobody would know which.
  //
  // Molina at v26 is the live case: "We used the net proceeds for repayment
  // of $740 million in term loan debt" corroborates on tense — it is a real
  // past-tense payment — and its sourceLine is not in the filing it cites.
  // It must not retire, and the reason must be the missing evidence.
  const ladder = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "6.250% senior secured second lien notes", seniority: "Senior secured second lien notes:", rate: "6.250%", maturityDate: "2027-02-01", dateGranularity: "month", amount: "$1.5 billion" }),
    ],
  });
  const issuanceWith = (status: "completed" | "intended", verified: boolean) =>
    baseTriggerResult({
      triggerId: "new-debt-issuance",
      redeems: [{ instrument: "the 6.250% senior secured second lien notes due February 2027", amount: null, status, sourceLine: "we redeemed the 6.250% senior secured second lien notes due February 2027", verified }],
      citations: [{ form: "8-K", date: "2026-08-20", reportDate: "", url: "https://example.com/8k" }],
    });
  const statusOf = (status: "completed" | "intended", verified: boolean) =>
    assemblePosition(companyWith([ladder, issuanceWith(status, verified)])).rows.find((r) => r.rate === "6.250%")?.status;

  assert(statusOf("completed", true) === "retired",
    "[S21a] corroborated completed AND a verified sourceLine — this is the only combination that retires anything");
  assert(statusOf("completed", false) === "live",
    "[S21b] MOLINA'S CASE: the status corroborates on tense, but the sourceLine is not in the cited filing — the tranche stays LIVE. Verification is load-bearing on its own");
  assert(statusOf("intended", true) === "live",
    "[S21c] TENET AND CIGNA'S CASE: the sourceLine verifies, but it states an intention — the tranche stays LIVE. Corroboration is load-bearing on its own");
  assert(statusOf("intended", false) === "live",
    "[S21d] and neither alone, which is the trivial case and is asserted so the table of four is complete rather than three-quarters checked");
}

console.log(`\n${passed} passed, ${failed} failed.`);

// ============================================================================
// STAGE-2 REVIEW — THE NOTE IS THE POSITION. A redemption cannot retire a
// tranche the current note still reports at a balance.
//
// REAL shape (Encompass): an 8-K redeems "4.500% senior notes due 2028",
// naming no quantity and using no partial-redemption wording, while that
// filer's own debt note reports the tranche at $396.9 million, down from
// $792.0 million. Half of it was called. Retiring it dropped the company's
// NEAREST maturity off the ladder — a retired row neither renders nor cards.
// ============================================================================
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    debtScheduleSourceFiling: { form: "10-Q", date: "2026-08-07", reportDate: "2026-06-30", url: "https://example.com/base-filing" },
    scheduleSequence: [row({ label: "4.50 % Senior Notes due 2028", rate: "4.50%", maturityDate: "2028", dateGranularity: "year", amount: "$ 396.9 million" })],
  });
  const issuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    fired: true,
    // Filed BEFORE the note's own period end, so the note already reflects it.
    citations: [{ form: "8-K", date: "2026-05-20", reportDate: "", url: "https://example.com/8k" }],
    redeems: [{ instrument: "4.500% senior notes due 2028", amount: null, status: "completed" as const, sourceLine: "4.500% senior notes due 2028", verified: true }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]));
  assert(pos.rows.length === 1 && pos.rows[0].status === "live", `[NOTE-WINS-1] a redemption does NOT retire a tranche the note still carries at a balance (got ${pos.rows.map((r) => r.status).join(", ")})`);

  // REVERSE: the same redemption, filed AFTER the note's period end, IS the
  // newer fact and does retire the row.
  const laterIssuance = baseTriggerResult({
    triggerId: "new-debt-issuance",
    fired: true,
    citations: [{ form: "8-K", date: "2026-08-20", reportDate: "", url: "https://example.com/8k" }],
    redeems: [{ instrument: "4.500% senior notes due 2028", amount: null, status: "completed" as const, sourceLine: "4.500% senior notes due 2028", verified: true }],
  });
  const posLater = assemblePosition(companyWith([dm, laterIssuance]));
  assert(posLater.rows[0].status === "retired", `[NOTE-WINS-2] REVERSE: an 8-K filed AFTER the note's period of report describes what the note could not know, and does retire it (got ${posLater.rows[0].status})`);

  // ...and a tranche the note itself reports at nil is retired either way.
  const nilDm = baseTriggerResult({
    triggerId: "debt-maturity",
    debtScheduleSourceFiling: { form: "10-Q", date: "2026-08-07", reportDate: "2026-06-30", url: "https://example.com/base-filing" },
    scheduleSequence: [row({ label: "4.50 % Senior Notes due 2028", rate: "4.50%", maturityDate: "2028", dateGranularity: "year", amount: "$ —" })],
  });
  assert(assemblePosition(companyWith([nilDm, issuance])).rows[0].status === "retired", "[NOTE-WINS-3] a tranche the note reports at NIL is retired — the note and the 8-K agree");
}

// ============================================================================
// STAGE-2 REVIEW — A ROW THAT CANNOT BE MATCHED CANNOT BE MISSING.
//
// REAL shape (Encompass): "Advances under revolving credit facility", "Other
// notes payable" and "Finance lease obligations" carry no rate and no
// maturity, so rowsRepresentSameTranche can never match them against their
// own counterparts on the current ladder. All three were declared vanished
// and re-added as `unconfirmed` beside the identical live rows — six of nine
// ladder rows were three instruments counted twice.
// ============================================================================
{
  const dm = baseTriggerResult({
    triggerId: "debt-maturity",
    scheduleSequence: [
      row({ label: "Advances under revolving credit facility", rate: null, maturityDate: null, dateGranularity: null, amount: "$ 200.0 million" }),
      row({ label: "5.875 % Senior Notes due 2034", rate: "5.875%", maturityDate: "2034", dateGranularity: "year", amount: "$ 491.0 million" }),
      // A tying subtotal, so the base ladder is trustworthy and the
      // unconfirmed pass actually runs (it is skipped wholesale when the
      // base ladder reconciles against nothing — see assemblePosition).
      subtotal({ label: "Total debt", amount: "$ 691.0 million" }),
    ],
    priorScheduleSequence: [
      row({ label: "Advances under revolving credit facility", rate: null, maturityDate: null, dateGranularity: null, amount: "$ 220.0 million" }),
      row({ label: "4.75 % Senior Notes due 2030", rate: "4.75%", maturityDate: "2030", dateGranularity: "year", amount: "$ 787.7 million" }),
    ],
  });
  const pos = assemblePosition(companyWith([dm]));
  const unconfirmed = pos.rows.filter((r) => r.status === "unconfirmed");
  assert(
    !unconfirmed.some((r) => r.instrument.includes("revolving credit facility")),
    `[UNMATCHABLE-1] an undated, unrated caption is NOT re-added as unconfirmed — it could never have matched, so its non-match proves nothing (got ${unconfirmed.map((r) => r.instrument).join(", ")})`
  );
  assert(
    unconfirmed.some((r) => r.instrument.includes("4.75")),
    "[UNMATCHABLE-2] REVERSE: an IDENTIFIED tranche that genuinely dropped off is still reported unconfirmed — the rule narrows what can be checked, it does not stop checking"
  );
}

if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 18 POSITION GOLDEN TESTS PASSED");
}
