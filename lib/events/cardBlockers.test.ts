/**
 * Session 18 (post-v16) golden tests — the two defects that produced ZERO
 * cards from a book of ten companies whose ladders were all correct.
 *
 * 1. THE SCRAPE GUARD PENALISED CONCISION. Session 18's refi rebuild made a
 *    card that describes one ladder row, and the narration prompt requires
 *    callAbout to name that row's amount or date — so the shortest correct
 *    card is dense by construction. All four generated cards failed here.
 *
 * 2. A PRINTED MONTH WAS DISCARDED. 11 of 98 verified rows carried a month
 *    in their own verified sourceLine but came back as bare year, and a
 *    bare-year row is never carded. All 11 were Quest.
 *
 * The measurements behind both are in the doc comments at each fix site.
 *
 * Run: npx tsx lib/events/cardBlockers.test.ts
 */
import { isScrapeShapedText } from "./scrapeGuard";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

console.log("=== card blockers ===\n");

// ============================================================================
// 1. The guard: real cards accepted, real dumps still rejected.
// ============================================================================

// --- REAL: the exact shapes that failed live. Both sit at ratio 0.33. ---
assert(!isScrapeShapedText("Refinance the $1,481 million 3.400% notes due March 2027."), "[1a] REAL (Cigna) the concise refi call line is ACCEPTED (was rejected at ratio 0.33)");
assert(!isScrapeShapedText("Centene has a $2,500 million 4.25% senior note due December 15, 2027."), "[1b] REAL (Centene) its call line is ACCEPTED");

// --- THE CONTROL THAT PROVES RATIO ALONE COULDN'T WORK: an actual scraped
// dump scoring the IDENTICAL 0.33. If this ever starts passing, the fix has
// become permissiveness. ---
assert(isScrapeShapedText("Total debt 45,828 Current portion 6,264."), "[2a] a real table dump at the SAME ratio (0.33) is still REJECTED");
assert(isScrapeShapedText("Long-term debt 10,847,516 10,781,013 10,663,836."), "[2b] REAL (DaVita) a three-figure column dump is still rejected");
assert(isScrapeShapedText("4.625% 2030 2,750,000 Term Loan A-2 1,975,000."), "[2c] REAL (DaVita) a rate/amount juxtaposition is still rejected");

// --- The hardest control: a transcribed PAIR of table rows repeats one
// connective ("due"), so a naive function-word COUNT of two would pass it.
// Distinctness is what rejects it. ---
assert(isScrapeShapedText("5.125 % due 2027 1,500 4.250 % due 2029 1,400."), "[3] REAL (Tenet) two table rows sharing one repeated connective are REJECTED — distinct words, not a raw count");

// --- The sentence-ending signal is untouched and still primary. ---
assert(isScrapeShapedText("Total debt 45,828 Current portion 6,264"), "[4a] no terminal punctuation is still an immediate reject, regardless of grammar");
assert(!isScrapeShapedText("The company refinanced its notes."), "[4b] a normal sentence below the numeric floor is never suspected");
assert(!isScrapeShapedText("Cash was $2,170 million at June 30, 2026, down from $2,883 million."), "[4c] a genuine two-figure sentence still passes");

// --- Bullets keep their looser allowance and are unaffected. ---
assert(!isScrapeShapedText("$1,481 million principal outstanding at June 30, 2026.", "bullet"), "[5] a dense but genuine bullet still passes on the bullet threshold");

// ============================================================================
// 2. Month recovery — asserted through the same primitives loop.ts composes.
// ============================================================================
const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_NAMES.join("|")})\\s+((?:19|20)\\d{2})\\b`, "i");

/** Mirrors loop.ts's recoverStatedMonth exactly. */
function recover(maturityDate: string | null, gran: string | null, sourceLine: string) {
  if (gran !== "year" || !maturityDate) return { maturityDate, gran };
  const m = sourceLine.match(MONTH_YEAR_RE);
  if (!m || m[2] !== maturityDate.trim()) return { maturityDate, gran };
  const month = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1;
  if (month < 1) return { maturityDate, gran };
  return { maturityDate: `${m[2]}-${String(month).padStart(2, "0")}-01`, gran: "month" };
}

// --- REAL (Quest): the month is printed, the model said year. ---
{
  const r = recover("2027", "year", "4.60 % Senior Notes due December 2027 400 501");
  assert(r.maturityDate === "2027-12-01" && r.gran === "month", `[6a] REAL (Quest) "due December 2027" recovers to 2027-12-01 (got ${r.maturityDate}/${r.gran})`);
}
{
  const r = recover("2029", "year", "4.20 % Senior Notes due June 2029 500 499");
  assert(r.maturityDate === "2029-06-01" && r.gran === "month", `[6b] REAL (Quest) a second row recovers independently (got ${r.maturityDate})`);
}

// --- NEVER INVENTS: no month printed means the row stays a bare year and
// stays table-only, which is the correct outcome, not a failure. ---
{
  const r = recover("2027", "year", "5.125 % due 2027 1,500");
  assert(r.maturityDate === "2027" && r.gran === "year", "[7a] REAL (Tenet) a row printing only a year is left alone");
}

// --- NEVER MOVES A ROW: a month belonging to a DIFFERENT year is ignored,
// so this can only ever sharpen an answer, never relocate it. ---
{
  const r = recover("2030", "year", "Issued March 2026, 5.5% notes due 2030");
  assert(r.maturityDate === "2030" && r.gran === "year", "[7b] a month printed for a different year never overrides the stated maturity year");
}

// --- Only ever applies to year granularity; an existing day/month answer is
// authoritative and untouched. ---
{
  const r = recover("2027-12-15", "day", "due December 2027");
  assert(r.maturityDate === "2027-12-15" && r.gran === "day", "[8] a day-granularity row is never downgraded or rewritten");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL CARD-BLOCKER GOLDEN TESTS PASSED");
