/**
 * RULE 71 ON FIXTURES — offline, $0.
 *
 * Every sentence here is one a filing in this book actually prints, taken
 * from the three Cigna samples and from the Rule 57 / Rule 58 cases that
 * already cost something. A rule about predication is only worth having if it
 * separates the sentences that motivated it, so the negatives are the point
 * rather than the padding: the figures this rule must NOT touch outnumber the
 * ones it excludes, and a version of it that fails them would delete correct
 * current figures across the book.
 *
 * Run: npx tsx lib/agent/figurePeriod.test.ts
 */
import { figurePeriodOf, entersCurrentPosition } from "./figurePeriod";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const ANCHOR = "2026-06-30";

console.log("=== [1] THE FIGURE CIGNA'S SAMPLE 2 SOURCED AT THE WRONG DATE ===");
{
  const v = figurePeriodOf("As of December 31, 2025, there was no outstanding balance under the Credit Agreement.", ANCHOR);
  assert(v.period === "other" && v.predicated.join() === "2025-12-31",
    `[1a] "As of December 31, 2025, there was no outstanding balance" is a balance AT THE BASE DATE — excluded from the current position (got ${v.period}, ${v.predicated.join()})`);
  assert(!entersCurrentPosition(v),
    "[1b] so it does not enter the current position, its figureSources, or the position identity — which is the whole reason sample 2's identity was 3 documents against the other samples' 2");

  const w = figurePeriodOf("As of June 30, 2026, there was no outstanding balance under the Credit Agreement.", ANCHOR);
  assert(w.period === "anchor" && entersCurrentPosition(w),
    `[1c] THE SAME SENTENCE AT THE ANCHOR'S DATE IS KEPT — samples 1 and 3 read exactly this, and the rule must separate the two rather than distrust the field (got ${w.period})`);
}

console.log("\n=== [2] AN UNGOVERNED DATE IS NOT A PERIOD (Rule 57, one field over) ===");
{
  const v = figurePeriodOf(
    "In April 2025, the Company replaced its previous revolving credit agreements and entered into a $ 6.5 billion, five-year revolving credit and letter of credit agreement that matures in April 2030.",
    ANCHOR
  );
  assert(v.period === "unpredicated" && entersCurrentPosition(v),
    `[2a] A FACILITY'S SIZE IS A STANDING TERM. "entered into a $6.5 billion … agreement" in April 2025 is true at the anchor; April 2025 is predicated of the SIGNING and April 2030 of the MATURITY, and neither is this figure's period (got ${v.period})`);
  assert(v.ungoverned.length === 2,
    `[2b] and both dates are RECORDED rather than ignored — the never-silent path, because an ungoverned date is where the next defect hides (got ${v.ungoverned.length}: ${v.ungoverned.join(", ")})`);

  const m = figurePeriodOf("The Company maintains a $ 6.5 billion, five-year revolving credit and letter of credit agreement that will mature in April 2030, with an option to extend.", ANCHOR);
  assert(m.period === "unpredicated" && entersCurrentPosition(m),
    `[2c] "will mature in April 2030" is Rule 57's own case: a maturity word governs the date, so it is a maturity and not a balance date (got ${m.period})`);

  const u = figurePeriodOf(
    "The $700 million delayed draw term loan, which, if we elect to utilize, would be funded on or prior to September 30, 2026, with a maturity date 364 days after the initial funding.",
    ANCHOR
  );
  assert(u.period === "unpredicated" && entersCurrentPosition(u),
    `[2d] UHS's funding deadline — the date that carded a $700 million maturity twelve months early — is predicated of FUNDING and is not this figure's period either (got ${u.period})`);
}

console.log("\n=== [3] THE PERIOD WORDS FILINGS ACTUALLY USE ===");
{
  assert(figurePeriodOf("During the six months ended June 30, 2026, the Company repaid $ 550 million 1.250 % senior notes that matured in March 2026.", ANCHOR).period === "anchor",
    "[3a] \"the six months ENDED June 30, 2026\" is the anchor's own period — and the 'matured in March 2026' in the same sentence does not make it March's");
  assert(figurePeriodOf("The commercial paper program had approximately $ 1.0 billion outstanding as of June 30, 2026 and an average interest rate of 3.92 %.", ANCHOR).period === "anchor",
    "[3b] \"outstanding as of June 30, 2026\" — Rule 70's own sentence, now decided by the same function as every other figure");
  assert(figurePeriodOf("Long-term debt was $ 29.1 billion at June 30, 2026.", ANCHOR).period === "anchor",
    "[3c] \"at June 30, 2026\" where a balance word governs it");
  const cmp = figurePeriodOf("Total debt was $ 31,878 million as of June 30, 2026 and $ 31,463 million as of December 31, 2025.", ANCHOR);
  assert(cmp.period === "anchor" && cmp.predicated.length === 2,
    `[3d] A COMPARATIVE SENTENCE STATES BOTH PERIODS AND IS KEPT. Two columns in one sentence is how a filing prints a comparison, and excluding it because a prior date appears would delete the anchor's own figure (got ${cmp.period}, ${cmp.predicated.join(", ")})`);
}

console.log("\n=== [4] THE MODEL'S asOf IS ONE SIGNAL, AND THE SENTENCE WINS (Rule 70) ===");
{
  const s = "The commercial paper program had approximately $ 1.0 billion outstanding as of June 30, 2026.";
  const agree = figurePeriodOf(s, ANCHOR, "2026-06-30");
  assert(agree.modelAgrees === true && agree.period === "anchor",
    "[4a] where the model's asOfDate agrees with the sentence, that is recorded and nothing is decided by it");
  const disagree = figurePeriodOf(s, ANCHOR, "2025-12-31");
  assert(disagree.modelAgrees === false && disagree.period === "anchor",
    "[4b] AND WHERE IT DISAGREES THE SENTENCE STILL WINS — this is sample 2's commercial paper exactly, whose field said 2025-12-31 with a null amount while the anchor's sentence says June 30, 2026");
  assert(figurePeriodOf(s, ANCHOR).modelAgrees === null,
    "[4c] no field stated is not a disagreement — null, never false, because 'it did not say' and 'it said something else' are different answers");
}

console.log("\n=== [5] AN INPUT THAT CANNOT BE READ IS NEVER A FINDING ABOUT THE FIGURE ===");
{
  const v = figurePeriodOf("As of December 31, 2025, there was no outstanding balance.", null);
  assert(v.period === "no-anchor-date" && entersCurrentPosition(v),
    `[5a] with no anchor period to compare against, NOTHING is excluded. An unreadable input reported as a finding about the filing is this project's oldest defect, and it deleted a whole company's facilities once (got ${v.period})`);
  const e = figurePeriodOf("", ANCHOR);
  assert(e.period === "unpredicated" && entersCurrentPosition(e),
    "[5b] an empty sentence predicates nothing and excludes nothing — same direction, same reason");
}

console.log("\n=== [6] THE NUMERIC FORM, and a date belonging to a different clause ===");
{
  assert(figurePeriodOf("Borrowings outstanding as of 12/31/2025 were $ 400 million.", ANCHOR).period === "other",
    "[6a] the slash form resolves through the same isoFromStatedDate the ladder already uses (Rule 61) — one deciding function, not a second date parser");
  const v = figurePeriodOf("The facility, amended effective March 3, 2026, had $ 200 million drawn as of June 30, 2026.", ANCHOR);
  assert(v.period === "anchor" && v.predicated.join() === "2026-06-30",
    `[6b] TWO DATES, ONE GOVERNED. "amended effective March 3, 2026" is predicated of the amendment; "drawn as of June 30, 2026" is predicated of the figure. Proximity would have taken the wrong one (got ${v.predicated.join(", ")})`);
}

console.log("\n=== [7] \"at\" IS MOSTLY NOT TEMPORAL — the negative cases for the one loose word in the set ===");
{
  // Rule 59's discipline: the word "at" had to join the governor set for [3c],
  // and every widening of a rule is a new misfire surface that needs its own
  // measured negative before it ships.
  const priced = figurePeriodOf("The notes were priced at 99.5% of par on September 4, 2025 and bear interest at 4.500% per annum.", ANCHOR);
  assert(priced.period === "unpredicated" && entersCurrentPosition(priced),
    `[7a] "priced at 99.5% of par ON September 4, 2025" — the "at" belongs to the PRICE, and a window match would have read the event date as this figure's period and excluded a correct 8-K issuance figure (got ${priced.period})`);
  const rate = figurePeriodOf("Borrowings bear interest at a rate based on SOFR and the facility matures in April 2030.", ANCHOR);
  assert(rate.period === "unpredicated",
    `[7b] "at a rate of" is not a date at all, and the maturity in the same sentence is still a maturity (got ${rate.period})`);
  const mat = figurePeriodOf("The term loan matures at June 30, 2026 under the amended agreement.", ANCHOR);
  assert(mat.period === "unpredicated",
    `[7c] and an adjacent "at" hanging off a MATURITY word is still a maturity — adjacency admits the word, it does not override predication (got ${mat.period})`);
}

console.log("\n=== [8] ONLY THE STALE DIRECTION IS EXCLUDED ===");
{
  // The book-wide pass found exactly one figure the symmetric version caught,
  // and it was a correct one: UHS's July 2026 Delayed Draw Term Loan, which
  // is committed, real, and disclosed in an 8-K three weeks AFTER the anchor.
  const later = figurePeriodOf("The Twelfth Amendment provides for the amendment of the Existing Credit Facility as of July 20, 2026, providing a $ 700 million delayed draw term loan.", ANCHOR);
  assert(later.period === "after-anchor" && entersCurrentPosition(later),
    `[8a] a figure stated as of a date AFTER the anchor is KEPT — a later disclosure is fresher, not staler, and BRD 6.0's authority rule already prefers an 8-K that post-dates the note (got ${later.period})`);
  assert(later.predicated.join() === "2026-07-20",
    `[8b] and its own date is recorded rather than flattened into the anchor's (got ${later.predicated.join()})`);
  const earlier = figurePeriodOf("Borrowings outstanding as of December 31, 2025 were $ 400 million.", ANCHOR);
  assert(earlier.period === "other" && !entersCurrentPosition(earlier),
    "[8c] while an EARLIER date is still excluded — that is the direction that renders a stale balance as the current position, which is the whole harm");
  const mixed = figurePeriodOf("Commercial paper outstanding was $ 1.0 billion as of December 31, 2025 and $ 1.4 billion as of September 30, 2026.", ANCHOR);
  assert(mixed.period === "after-anchor",
    `[8d] where a sentence predicates both directions the LATER one governs — the newest disclosure wins, the same tie-break the ladder already applies to an 8-K (got ${mixed.period})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
