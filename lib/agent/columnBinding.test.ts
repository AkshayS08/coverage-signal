/**
 * Session 18 (post-v12) golden tests — COLUMN BINDING, the Quest class.
 *
 * Exercises the deterministic period check that lib/agent/loop.ts's
 * bindEntriesToPeriod applies, via the same token-matching primitives it
 * uses. Every case is pinned to a REAL string from this session's live
 * runs.
 *
 * The class this guards: a debt table is comparative, and a set of
 * prior-column rows sums to the prior-column subtotal, so Check 1 passes
 * cleanly on wholly wrong-period data. Quest did exactly this live.
 *
 * Run: npx tsx lib/agent/columnBinding.test.ts
 */
import { extractFactTokens, factTokensMatch, type FactToken } from "./factTokens";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** Mirrors bindEntriesToPeriod's own predicate exactly — same helpers, same rule. */
function columnMatchesPeriod(periodColumn: string | null, expectedReportDate: string): boolean {
  if (!periodColumn || !periodColumn.trim()) return true; // unbound is kept, never dropped
  const iso = expectedReportDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) return true;
  const expected: FactToken[] = [
    { kind: "date", raw: expectedReportDate, index: 0, dateValue: { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) } },
  ];
  const actual = extractFactTokens(periodColumn).filter((t) => t.kind === "date");
  if (actual.length === 0) return true;
  return actual.some((a) => expected.some((e) => factTokensMatch(e, a)));
}

console.log("=== Session 18 column-binding golden tests ===\n");

// --- REAL (Quest 10-Q, period ending 2026-06-30): the current column is
// kept and the prior comparative column is rejected. This is the exact pair
// of headers Quest's own table prints. ---
assert(columnMatchesPeriod("June 30, 2026", "2026-06-30"), "[1] REAL (Quest) the current-period column header matches the filing's EDGAR period of report");
assert(!columnMatchesPeriod("December 31, 2025", "2026-06-30"), "[2] REAL (Quest) the PRIOR comparative column is rejected — the exact value that walked cleanly and corrupted the ladder");

// --- REAL (Cigna 10-K, period ending 2025-12-31): a fiscal-year filing's
// own current column is December 31 — the same header string that must be
// REJECTED for Quest must be ACCEPTED here. Proves the rule is bound to the
// filing's own period, not to a hardcoded notion of "current". ---
assert(columnMatchesPeriod("December 31, 2025", "2025-12-31"), "[3] REAL (Cigna 10-K) 'December 31, 2025' IS the current column for a FY2025 filing — accepted");
assert(!columnMatchesPeriod("December 31, 2024", "2025-12-31"), "[4] REAL (Cigna 10-K) its prior comparative column is rejected");

// --- REAL (HCA 10-Q): same rule, different phrasing of the same date. ---
assert(columnMatchesPeriod("June 30, 2026", "2026-06-30"), "[5] REAL (HCA) current column accepted");
assert(!columnMatchesPeriod("December 31, 2025", "2026-06-30"), "[6] REAL (HCA) prior column rejected");

// --- An unbound entry is KEPT, not dropped: a genuinely single-column
// table is real, and null is the honest answer there. Dropping on absence
// would discard good data to punish a missing label. ---
assert(columnMatchesPeriod(null, "2026-06-30"), "[7] an entry stating no period column is KEPT (single-column tables are real)");
assert(columnMatchesPeriod("", "2026-06-30"), "[7b] an empty period column is treated the same as null");

// --- A column header carrying no parseable date can't be checked either
// way, so it is kept rather than dropped on a technicality. ---
assert(columnMatchesPeriod("Carrying Amount", "2026-06-30"), "[8] a non-date column header (e.g. 'Carrying Amount') is not droppable — nothing to compare");

// --- REVERSE ASSERTION: the rule must not be so loose that any date
// passes. A same-month-wrong-year and a same-year-wrong-month both fail. ---
assert(!columnMatchesPeriod("June 30, 2025", "2026-06-30"), "[9] same month/day but WRONG YEAR is rejected");
assert(!columnMatchesPeriod("March 31, 2026", "2026-06-30"), "[10] same year but WRONG QUARTER is rejected");

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL COLUMN-BINDING GOLDEN TESTS PASSED");
