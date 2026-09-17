/**
 * SESSION 19 — items 2b and 2c, offline.
 *
 * Run: npx tsx lib/events/session19.test.ts
 */
import { statusFromProjectCompletion } from "./eligibility";
import { assemblePosition } from "./position";
import type { CompanyResult, VerifiedSequenceEntry, VerifiedNoteRetirement, TriggerResult } from "../agent";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

function baseTrigger(over: Partial<TriggerResult> & { triggerId: string }): TriggerResult {
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
    facilities: [], facilityRejections: [], seniorityStatement: null, proceedsUses: [],
    projectCompletionDate: null,
    projectCompletionGranularity: null,
    cashAmount: null,
    projectName: null,
    columnReadFailure: false,
    ...over,
  };
}

const NOW = new Date("2026-08-28T00:00:00Z");

console.log("=== Session 19: 2c project status derivation ===\n");

assert(
  statusFromProjectCompletion("2026-12-01", "month", NOW) === "upcoming",
  `[2c-1] REAL: a medical office building "scheduled to be completed in December 2026" is UPCOMING, never standing (got ${statusFromProjectCompletion("2026-12-01", "month", NOW)})`
);
assert(
  statusFromProjectCompletion("2026-06-30", "day", NOW) === "completed",
  "[2c-2] a project whose stated completion date has passed is COMPLETED"
);
assert(
  statusFromProjectCompletion("2027", "year", NOW) === "upcoming",
  "[2c-3] a bare year is compared at its END — a project completing 'in 2027' is not finished until 2027 is"
);
assert(
  statusFromProjectCompletion("2025", "year", NOW) === "completed",
  "[2c-4] ...and a bare year already past is completed"
);
assert(
  statusFromProjectCompletion(null, null, NOW) === null,
  "[2c-5] REVERSE: no stated completion date derives NOTHING — period spend with no project stays on the existing freshness path, and `standing` remains available for genuinely undated recurring disclosures"
);
assert(
  statusFromProjectCompletion("not a date", null, NOW) === null,
  "[2c-6] REVERSE: an unparseable date derives nothing rather than guessing a status"
);

// The rule the whole item exists for, stated as an assertion.
const dated = ["2026-12-01", "2027", "2026-06-30", "2025"].map((d) => statusFromProjectCompletion(d, d.length === 4 ? "year" : d.length === 7 ? "month" : "day", NOW));
assert(
  dated.every((s) => s === "upcoming" || s === "completed"),
  `[2c-7] THE RULE: every project with a stated completion date derives upcoming or completed, and never standing (got ${dated.join(", ")})`
);


// ============================================================================
// SESSION 19, ITEM 2b — a retirement the note states in its own prose.
//
// The instruction was "a partial reduces the balance and the row stays live".
// It does NOT reduce, deliberately: the note's table is as-of the period end
// and is ALREADY net of what its own prose describes. One filer prints
// $1,067 million for the 2027 notes and says two paragraphs below that $118
// million was repurchased in the quarter; $1,067 is the figure AFTER that.
// Subtracting again reports $949 million, a number in no filing. So the
// retirement supplies the CAUSE of a movement the ladder already shows.
// ============================================================================
{
  const seq = (over: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry =>
    ({
      kind: "row", rate: null, seniority: null, amount: "$ 1,067 million", maturityDate: "2027-12-15",
      dateGranularity: "day", sourceLine: `synthetic ${over.label}`, citedUrl: "https://example.com/q",
      section: null, periodColumn: null, ...over,
    }) as VerifiedSequenceEntry;

  const ret = (over: Partial<VerifiedNoteRetirement> = {}): VerifiedNoteRetirement => ({
    instrument: "4.25 % Senior Notes due December 15, 2027",
    amount: "$ 118 million",
    eventDate: null,
    dateGranularity: null,
    sourceLine: "the Company repurchased $ 118 million of its par value 4.25 % Senior Notes due December 15, 2027",
    citedUrl: "https://example.com/q",
    ...over,
  });

  const company = (rows: VerifiedSequenceEntry[], rets: VerifiedNoteRetirement[]): CompanyResult =>
    ({
      company: "SYNTHETIC CO.", cik: "0", ticker: "SYN", verdict: "CALL", relationshipFlags: [],
      results: [baseTrigger({ triggerId: "debt-maturity", scheduleSequence: rows, noteRetirements: rets })],
    }) as unknown as CompanyResult;

  // PARTIAL — the note still carries a balance.
  {
    const pos = assemblePosition(company([seq({ label: "4.25 % Senior Notes due December 15, 2027", rate: "4.25%" })], [ret()]), NOW);
    const row = pos.rows[0];
    assert(row.status === "live", `[2b-1] PARTIAL: the row stays LIVE (got ${row.status})`);
    assert(row.amount === "$ 1,067 million", `[2b-2] ...at the note's OWN figure, never re-reduced by its own prose (got ${row.amount})`);
    assert(row.retiredByNote?.evidence.includes("118") === true, "[2b-3] ...with the note's own sentence attached as what explains the movement");
  }

  // FULL — the note carries it at nil, so C1 has already marked it repaid.
  {
    const pos = assemblePosition(company([seq({ label: "4.25 % Senior Notes due December 15, 2027", rate: "4.25%", amount: "$ —" })], [ret()]), NOW);
    const row = pos.rows[0];
    assert(row.status === "repaid", `[2b-4] FULL: a tranche the note carries at nil is repaid (got ${row.status})`);
    assert(row.retiredBy?.evidence.includes("118") === true, "[2b-5] ...and the note's prose is what explains it, instead of 'dropped with nothing explaining it'");
  }

  // AMBIGUOUS — prose naming an instrument matchable to neither row uniquely.
  {
    const rows = [
      seq({ label: "Senior Notes", rate: null, maturityDate: null, dateGranularity: null }),
      seq({ label: "Other Senior Notes", rate: null, maturityDate: null, dateGranularity: null, amount: "$ 500 million" }),
    ];
    const pos = assemblePosition(company(rows, [ret({ instrument: "Senior Notes", sourceLine: "the Company repurchased some of its Senior Notes" })]), NOW);
    assert(pos.rows.length === 2, `[2b-6] AMBIGUOUS: both rows are KEPT — BRD 6.0, ambiguity fails safe toward keeping (got ${pos.rows.length})`);
    assert(pos.rows.every((r) => r.status === "live"), "[2b-7] ...still live");
    assert(pos.rows.every((r) => !r.retiredByNote && !r.retiredBy), "[2b-8] ...and nothing is attached, because the prose does not identify WHICH row it is about");
  }
}
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 19 TESTS PASSED");
}
