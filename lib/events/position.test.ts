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
    citations: [{ form: "10-Q", date: "2026-06-30", url: "https://example.com/base-filing" }],
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
    scheduleCompleteness: null,
    redeems: null,
    issuedTranches: [],
    cashAmount: null,
    projectName: null,
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
    redeems: "the 6.250% senior secured second lien notes due February 2027",
    citations: [{ form: "8-K", date: "2025-11-18", url: "https://example.com/8k-nov2025" }],
  });
  const pos = assemblePosition(companyWith([dm, issuance]));
  const firstLien = pos.rows.find((r) => r.rate === "5.125%")!;
  const secondLien = pos.rows.find((r) => r.rate === "6.250%")!;
  assert(firstLien.status === "live", "[2a] REVERSE ASSERTION (Tenet worked example): the 5.125% first lien due Nov 2027 stays LIVE — the retirement logic does nothing to it");
  assert(secondLien.status === "retired", "[2b] the 6.250% second lien due Feb 2027 — the one actually named in redeems — is retired");
  assert(secondLien.retiredBy?.evidence === issuance.redeems, "[2c] the retired row carries the redemption evidence that explains it");
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
    redeems: "the 6.250% second lien notes due February 2027",
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
    redeems: "the 6.250% second lien notes due February 2027",
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

  if (failed > 0) {
    console.error(`\nA3 FAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`A3: ${passed} total assertions passed.`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 18 POSITION GOLDEN TESTS PASSED");
}
