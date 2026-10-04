/**
 * RULES 76–78 ON FIXTURES — offline, $0.
 *
 * Every sentence here is one this book's filings actually print. The cases
 * that motivated the rules are the negatives: a sentence that states a
 * coarser date must not approve a finer one, and the symmetric identity match
 * the redemption matcher depends on must not move while that is fixed.
 *
 * Run: npx tsx lib/agent/datePrecision.test.ts
 */
import { extractFactTokens, factTokensMatch, dateSupportedBy, statedDatePrecision, clampDateToken, datePrecisionOf, type FactToken } from "./factTokens";
import { verifyEventDate } from "./factGuard";
import { sentenceSupportsMaturity } from "../events/position";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const date = (year: number, month: number | null, day: number | null): FactToken => ({ kind: "date", raw: "", index: 0, dateValue: { year, month, day } });
const firstDate = (s: string) => extractFactTokens(s).find((t) => t.kind === "date")!;

// The sentences, as printed.
const CIGNA_REVOLVER = "The Company maintains a $ 6.5 billion, five-year revolving credit and letter of credit agreement that will mature in April 2030, with an option to extend the maturity date for additional one-year periods, subject to consent of the banks.";
const CHS_TABLE_ROW = "6 % Senior Secured Notes due 2029 644";
const CHS_COUPON = "The 9¾% Senior Secured Notes due 2034 bear interest at a rate of 9.750% per year payable semi-annually in arrears on March 15 and September 15 of each year, commencing on March 15, 2026.";
const CIGNA_TRANCHE = "The 2030 Notes will bear interest at a rate of 4.500% per annum, and interest will be payable on March 15 and September 15 of each year, beginning March 15, 2026 until the maturity date of September 15, 2030.";

console.log("=== [1] SUPPORT IS DIRECTIONAL (Rule 77) ===");
{
  const april2030 = firstDate("will mature in April 2030");
  assert(datePrecisionOf(april2030) === "month", `[1a] "April 2030" parses at month precision`);
  assert(dateSupportedBy(date(2030, 4, null), april2030), `[1b] "April 2030" supports April 2030`);
  assert(!dateSupportedBy(date(2030, 4, 1), april2030), `[1c] "April 2030" does NOT support April 1, 2030 — the Cigna revolver's model-supplied day`);
  const y2029 = firstDate("due 2029");
  assert(!dateSupportedBy(date(2029, 1, 15), y2029), `[1d] "due 2029" does NOT support 2029-01-15 — the CHS table row against a day taken from the 10-K`);
  assert(dateSupportedBy(date(2029, null, null), y2029), `[1e] "due 2029" supports 2029`);
  const full = firstDate("due and payable in full on June 5, 2029");
  assert(dateSupportedBy(date(2029, 6, 5), full) && dateSupportedBy(date(2029, null, null), full),
    `[1f] a sentence stating a day supports that day and anything coarser that agrees with it`);
  assert(!dateSupportedBy(date(2029, 6, 6), full), `[1g] and never a different day`);
}

console.log("\n=== [2] THE IDENTITY MATCH IS UNCHANGED — its callers still need the symmetry ===");
{
  assert(factTokensMatch(date(2034, 9, 15), date(2034, null, null)) && factTokensMatch(date(2034, null, null), date(2034, 9, 15)),
    "[2a] factTokensMatch still treats \"2034\" and 2034-09-15 as compatible in both directions — two mentions of one tranche are recognised as one; only SUPPORT tightened");
}

console.log("\n=== [3] THE PRECISION A SENTENCE STATES, AND THE CLAMP (Rule 76) ===");
{
  assert(statedDatePrecision(date(2030, 4, 1), CIGNA_REVOLVER) === "month", "[3a] the Cigna revolver sentence states its maturity to the month");
  assert(statedDatePrecision(date(2029, 1, 15), CHS_TABLE_ROW) === "year", "[3b] the CHS table row states its maturity to the year");
  assert(statedDatePrecision(date(2034, 9, 15), CHS_COUPON) === "year",
    "[3c] THE INTEREST-DATE TRAP: \"March 15 and September 15 of each year\" carries no year and supports no September 15, 2034 — the v29 reading of the 9¾% notes");
  assert(statedDatePrecision(date(2030, 9, 15), CIGNA_TRANCHE) === "day", "[3d] \"until the maturity date of September 15, 2030\" states the day");
  assert(statedDatePrecision(date(2031, 1, 1), CHS_TABLE_ROW) === null, "[3e] a sentence with no date in the claim's year states nothing about it");
  const toYear = clampDateToken(date(2029, 1, 15), "year");
  assert(toYear.date === "2029" && toYear.granularity === "year", `[3f] clamped to the year it is the bare year, the pipeline's own spelling (got ${toYear.date} ${toYear.granularity})`);
  const toMonth = clampDateToken(date(2030, 4, 1), "month");
  assert(toMonth.date === "2030-04-01" && toMonth.granularity === "month", `[3g] clamped to the month it is the first of the month at month granularity, as recoverStatedMonth writes it`);
  const noop = clampDateToken(date(2029, null, null), "day");
  assert(noop.date === "2029" && noop.granularity === "year", "[3h] a clamp never ADDS precision: a year asked to be a day stays a year");
}

console.log("\n=== [4] THE LADDER'S QUESTION: DOES THIS SENTENCE STATE THIS MATURITY AT THE PRECISION SHOWN? ===");
{
  assert(sentenceSupportsMaturity("2030-04-01", "month", CIGNA_REVOLVER), "[4a] April 2030 at month precision, beside the revolver sentence: supported");
  assert(!sentenceSupportsMaturity("2030-04-01", "day", CIGNA_REVOLVER), "[4b] the same date at DAY precision beside the same sentence: not supported");
  assert(sentenceSupportsMaturity("2034", "year", CHS_TABLE_ROW.replace("6 % Senior Secured Notes due 2029 644", "9 ¾% Senior Secured Notes due 2034 1,790")), "[4c] the 9¾% notes at 2034 beside their table row: supported");
  assert(!sentenceSupportsMaturity("2034-09-15", "day", CHS_COUPON), "[4d] and 2034-09-15 beside the coupon sentence: not supported");
  assert(!sentenceSupportsMaturity("2029", "year", null), "[4e] no sentence supports nothing — a date with no maturity sentence is never reported as sourced");
}

console.log("\n=== [5] THE EVENT-DATE GUARD CLAMPS RATHER THAN APPROVING A FINER CLAIM ===");
{
  const url = "https://example.test/filing.htm";
  const textByUrl = new Map([[url, "The 6% Senior Secured Notes mature in 2029 and are secured by first-priority liens."]]);
  const r = verifyEventDate({ eventDate: "2029-01-15", eventDateGranularity: "day", anchorText: "Senior Secured Notes secured liens", citedUrls: [url], textByUrl });
  assert(r.accepted && r.eventDate === "2029" && r.eventDateGranularity === "year" && r.clampedFrom === "2029-01-15",
    `[5a] a day claimed against a filing that states only the year is accepted AT THE YEAR, with what was claimed recorded (got ${r.eventDate} ${r.eventDateGranularity})`);
  const dayText = new Map([[url, "The notes mature on January 15, 2029 and are secured by first-priority liens."]]);
  const d = verifyEventDate({ eventDate: "2029-01-15", eventDateGranularity: "day", anchorText: "notes secured liens", citedUrls: [url], textByUrl: dayText });
  assert(d.accepted && d.eventDate === "2029-01-15" && d.eventDateGranularity === "day" && d.clampedFrom === undefined, "[5b] a day the filing states is accepted unchanged");
  const monthText = new Map([[url, "The revolving facility matures in November 2027 under the credit agreement."]]);
  const m = verifyEventDate({ eventDate: "2027-11-01", eventDateGranularity: "month", anchorText: "revolving facility credit agreement", citedUrls: [url], textByUrl: monthText });
  assert(m.accepted && m.eventDate === "2027-11-01" && m.eventDateGranularity === "month" && m.clampedFrom === undefined,
    "[5c] a MONTH claim is read at month precision — its \"-01\" is spelling, not a claimed day — so \"November 2027\" supports it unchanged");
  const other = new Map([[url, "The notes mature in 2031 and are secured by first-priority liens."]]);
  const o = verifyEventDate({ eventDate: "2029-01-15", eventDateGranularity: "day", anchorText: "notes secured liens", citedUrls: [url], textByUrl: other });
  assert(!o.accepted && o.eventDate === null, "[5d] a different year is still rejected outright — clamping narrows precision, it never moves a date");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
