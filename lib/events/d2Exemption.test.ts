/**
 * Session 18 (post-v16) golden tests — THE ONE D2 EXEMPTION.
 *
 * Reverse assertion R1 exists to tell discrimination apart from blanket
 * suppression, and it caught D2 doing the latter: UHS's Miller Medical Plaza
 * is a named, dated, discrete construction project, and D2 held it to the
 * table because the filing prints no cost for it. Verified against the real
 * filing text — no money within 700 characters of any mention of the
 * project, in either filing. There was no figure to capture.
 *
 * The exemption is scoped to capex-program ONLY. These tests pin the three
 * real book cases that a blanket "named project cards" rule would conflate:
 * neither cashAmount nor projectName separates them, only the trigger does.
 *
 * Run: npx tsx lib/events/d2Exemption.test.ts
 */
import { evaluateEligibility } from "./eligibility";
import type { TriggerResult } from "../agent";

/** REAL — UHS's own capex evidence, verbatim from the v16 run. Carries the
 * "newly constructed" freshness signal capex-program independently requires,
 * so these tests exercise D2 and not the freshness gate. */
const UHS_EVIDENCE =
  "Alan B. Miller Medical Center, a newly constructed acute care hospital owned and operated by a wholly-owned subsidiary of UHS, was completed and opened during the second quarter of 2026. Miller Medical Plaza, a multi-tenant medical office building consisting of 80,000 rentable square feet, is scheduled to be completed in December 2026 on the campus of Alan B. Miller Medical Center.";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** Only the fields D2 and the timing gate read; everything else is neutral. */
function trig(over: Partial<TriggerResult>): TriggerResult {
  return {
    triggerId: "capex-program", triggerName: "Capex program", fired: true, dataAvailable: true,
    evidence: UHS_EVIDENCE, mappedNeed: "capex", needType: "credit", confidence: 1, citations: [],
    quote: null, quoteVerified: true, verifiedQuote: null, quoteMatchType: "literal", quoteHasFigure: true,
    verifiedQuoteNormalized: null, eventDate: "2026-12-01", dateGranularity: "month",
    eventStatus: "upcoming", proceedsUse: null, scheduleSequence: [], priorScheduleSequence: [],
    balanceSheetDebtCaptions: [], debtScheduleSourceFiling: null, debtSchedulePriorFiling: null,
    rowsExtracted: 0, rowsVerified: 0, scheduleCompleteness: null, redeems: [], issuedTranches: [],
    cashAmount: null, projectName: null, ...over,
  } as TriggerResult;
}
const NOW = new Date("2026-08-24T00:00:00Z");
const cards = (t: TriggerResult) => evaluateEligibility(t, NOW).cardEligible;

console.log("=== D2 exemption ===\n");

// --- THE REGRESSION: R1's own case. ---
assert(
  cards(trig({ projectName: "Alan B. Miller Medical Center and Miller Medical Plaza", cashAmount: null })),
  "[1] REAL (UHS) a named capex project with NO stated amount now CARDS — R1 satisfied"
);

// --- The two the exemption must NOT touch. Same null amount, same present
// projectName — only the trigger differs. ---
assert(
  !cards(trig({ triggerId: "new-subsidiary", triggerName: "New subsidiary", projectName: "Evernorth EnGuide Pharmacy", cashAmount: null })),
  "[2a] REAL (Cigna) EnGuide — named entity, no amount — stays TABLE (item 7 intact)"
);
assert(
  !cards(trig({ triggerId: "new-subsidiary", triggerName: "New subsidiary", projectName: "Michigan laboratory testing joint venture entity", cashAmount: null })),
  "[2b] REAL (Quest) Corewell JV — named entity, no amount — stays TABLE (item 8 intact)"
);

// --- The exemption is the TRIGGER, not the presence of a name. Proof: the
// identical projectName under a different trigger does not card. ---
assert(
  cards(trig({ projectName: "X", cashAmount: null })) &&
    !cards(trig({ triggerId: "new-subsidiary", triggerName: "New subsidiary", projectName: "X", cashAmount: null })),
  "[3] the SAME project name cards under capex-program and does not under new-subsidiary — the rule is over the trigger"
);

// --- Item 10 must be undisturbed: ROUTINE capex is period spend with no
// named project, and stays a table line. This is the distinction item 10 and
// R1 draw between two capex facts. ---
assert(
  !cards(trig({ projectName: null, cashAmount: null })),
  "[4a] capex with NO named project and no amount stays TABLE — routine period spend never cards"
);
assert(
  !cards(trig({ projectName: "   ", cashAmount: null })),
  "[4b] a blank/whitespace projectName is not a named project"
);

// --- A capex project WITH an amount was already eligible and still is —
// the exemption widens, it never narrows. ---
assert(cards(trig({ projectName: "New hospital campus", cashAmount: "$450 million" })), "[5a] named project WITH an amount still cards");
assert(cards(trig({ projectName: null, cashAmount: "$450 million" })), "[5b] an amount with no named project still cards, exactly as before");

// --- The exemption is scoped to D2 ALONE. It must not smuggle a fact past
// the two restrictions that sit above it. ---
assert(
  !cards(trig({ projectName: "Named project", cashAmount: null, eventStatus: "standing" })),
  "[6a] a standing condition still never cards, named project or not"
);
assert(
  !cards(trig({ projectName: "Named project", cashAmount: null, eventStatus: "completed" })),
  "[6b] a completed capex event still never cards — nothing left to win"
);

// --- Every other trigger still requires an amount. Spot-check across the
// buckets so this can't quietly widen. ---
for (const id of ["asset-sale", "ipo-secondary", "dividend-buyback", "acquisition-announced", "large-cash-balance"]) {
  assert(
    !cards(trig({ triggerId: id, triggerName: id, projectName: "Some Named Thing", cashAmount: null })),
    `[7] ${id}: still held to table with no amount, name or not`
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL D2-EXEMPTION GOLDEN TESTS PASSED");
