/**
 * SESSION 21, RULE 22 — THE PROSE-NOTE CLASS, PINNED ON A FILER THAT DOES
 * NOT EXIST.
 *
 * Deliberately NOT UHS. UHS is the instance that exposed the defect, and a
 * suite built on it proves only that we fixed UHS. "Meridian Health Partners"
 * below is invented — its numbers are impossible on purpose — and it is
 * written to the SHAPE the rule is about: a combined treasury note whose debt
 * disclosure is bullets and sentences with principal in words, followed by a
 * hedge table that carries the note's only comma-grouped figures.
 *
 * If this passes and UHS regresses, the rule is right and something else
 * broke. If this fails, the rule is wrong. That separation is the point.
 *
 * HISTORY WORTH KEEPING: [1c] and [2a] failed for two rounds. The first
 * boundary cut on a coupon-contiguity test and removed real debt content
 * from three filers — DaVita's revolver, Quest's maturity schedule,
 * Centene's repurchase — because a maturity-year ladder, a facility balance
 * and a repurchase all carry no coupon. The second cut on a 1,500-character
 * distance, which fired on UHS and let this compactly-written fixture
 * through at 200. Both are recorded in the assertions below.
 *
 * Run: npx tsx lib/fetch/proseNoteRouting.test.ts
 */
import { locateDebtNoteSection, narrowToDebtDisclosure, spanIsTabular } from "./noteLocation";
import { verdictSchemaFor, anchorNoteShapeOf } from "../agent/claude";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/**
 * Meridian's own XBRL stated total debt: term loan B $2.111B + revolver drawn
 * $111M + $3.3B of senior notes + $55M of sale-leaseback liabilities. The
 * boundary is allowed the filer's own tags and the figures printed in the
 * span, and nothing else — see debtContent.ts's circularity guard.
 */
const MERIDIAN_XBRL_TOTAL = 5_577_000_000;

/** A prose-only debt note, followed by a hedge table sharing the same note. */
const PROSE_FILER =
  "MERIDIAN HEALTH PARTNERS INC NOTES TO CONDENSED CONSOLIDATED FINANCIAL STATEMENTS " +
  "(3) Treasury Arrangements and Outstanding Debt Securities " +
  "In March, 2026, we entered into the Fourth Amendment to our credit agreement, which increased the term loan B to $ 2.222 billion " +
  "($ 2.111 billion outstanding as of June 30, 2026) from $ 1.777 billion previously. " +
  "As of June 30, 2026, we had $ 999 million of available borrowing capacity pursuant to the terms of our $ 1.111 billion revolving " +
  "credit facility (net of $ 111 million of outstanding borrowings and $ 1 million of letters of credit). " +
  "As of June 30, 2026, we had combined aggregate principal of $ 3.3 billion from the following senior secured notes: " +
  "• $ 900 million of aggregate principal amount of 3.33 % senior secured notes due in April, 2029 (\"2029 Notes\") which were issued on April 2, 2022. " +
  "• $ 900 million of aggregate principal amount of 4.44 % senior secured notes due in April, 2031 (\"2031 Notes\") which were issued on April 2, 2022. " +
  "• $ 900 million of aggregate principal amount of 5.55 % senior secured notes due in April, 2033 (\"2033 Notes\") which were issued on April 2, 2022. " +
  "• $ 600 million of aggregate principal amount of 6.66 % senior secured notes due in April, 2035 (\"2035 Notes\") which were issued on April 2, 2022. " +
  "All the Notes are guaranteed on a senior secured basis by our material subsidiaries and are secured by first-priority liens. " +
  "In connection with a sale and leaseback completed in 2021, our consolidated balance sheets reflect financial liabilities, which are " +
  "included in debt, of approximately $ 55 million and $ 57 million, respectively. " +
  "The average outstanding borrowings under our revolving credit, term loan B and senior notes were approximately $ 5.4 billion during the quarter. " +
  "Derivative instruments Foreign currency forward exchange contracts $ ( 7,777 ) $ ( 8,888 ) $ 9,999 $ ( 6,666 ) " +
  "Cash and cash equivalents $ 222,222 $ 333,333 $ 444,444 Restricted cash 55,555 66,666 77,777 " +
  "(4) Segment Reporting The Company operates in two reportable segments.";

console.log("\n=== [1] The locator finds the note, and the note ends before the hedge table ===");
{
  const loc = locateDebtNoteSection(PROSE_FILER);
  assert(loc.status === "found", `[1a] a bulleted disclosure is still a locatable debt note (${loc.status})`);
  if (loc.status !== "found") process.exit(1);
  const n = narrowToDebtDisclosure(PROSE_FILER, { start: loc.start, end: loc.end }, MERIDIAN_XBRL_TOTAL);
  const kept = PROSE_FILER.slice(loc.start, n.end);
  assert(kept.includes("$ 55 million"),
    "[1b] the boundary KEEPS the sale-leaseback liability, which is debt content stated in prose with no coupon anywhere near it — the cut must not be a coupon-contiguity rule in disguise");
  assert(!kept.includes("7,777") && !kept.includes("222,222"),
    "[1c] and EXCLUDES the currency-contract and cash tables, which share the note and carry no debt content");
}

console.log("\n=== [2] Measured on the narrowed note, this filer is prose-only ===");
{
  const loc = locateDebtNoteSection(PROSE_FILER) as { status: "found"; start: number; end: number };
  const n = narrowToDebtDisclosure(PROSE_FILER, { start: loc.start, end: loc.end }, MERIDIAN_XBRL_TOTAL);
  const wide = spanIsTabular(PROSE_FILER, loc.start, loc.end);
  const narrow = spanIsTabular(PROSE_FILER, loc.start, n.end);
  assert(narrow.groupedFigures === 0 && narrow.tabular === false,
    `[2a] the debt disclosure prints NO comma-grouped figure — it cannot be a table of balances (got ${narrow.groupedFigures})`);
  assert(wide.tabular === true,
    `[2b] AND ON THE UN-NARROWED SPAN THE SAME TEST SAYS TABULAR (${wide.groupedFigures} grouped figures) — which is Rule 24 in one assertion: the measurement was never wrong, the region was`);
}

console.log("\n=== [3] The schema WITHHOLDS the field it cannot have ===");
{
  const prose = verdictSchemaFor("prose-only").properties as Record<string, unknown>;
  const table = verdictSchemaFor("tabular").properties as Record<string, unknown>;
  const absent = verdictSchemaFor("not-located").properties as Record<string, unknown>;
  assert(!("scheduleSequence" in prose) && !("priorScheduleSequence" in prose),
    "[3a] a prose-only note is not OFFERED scheduleSequence — removed from the schema, not discouraged in prose. An instruction is a request; a schema is a fact");
  assert("proseInstruments" in prose && "balanceSheetDebtCaptions" in prose,
    "[3b] and everything it CAN fill is still there — the instruments and the balance-sheet captions");
  assert("scheduleSequence" in table && "proseInstruments" in table,
    "[3c] a tabular note keeps BOTH fields and the existing per-source rule routes within it — this change is scoped to the filer that cannot have a table");

  // SESSION 23, RULE 51 — THE THIRD SHAPE.
  //
  // Measured on Cigna: the anchor 10-Q locates NO debt note, the field was
  // offered anyway (undefined read as "tabular"), and the model filled it
  // with three rows of the 10-K's table carrying the ANCHOR's period column
  // and the ANCHOR's citations. The prompt already said "never substitute
  // another filing's" — and an instruction the model can decline is not a
  // constraint.
  assert(!("scheduleSequence" in absent) && !("priorScheduleSequence" in absent),
    "[3d] an anchor with NO located note is not offered scheduleSequence either — there is no field to fill from another filing, and none to stamp with the anchor's period");
  assert(!("scheduleTableUnit" in absent) && !("priorScheduleTableUnit" in absent),
    "[3e] and the table's unit declarations go with it — a unit for a table that was never transcribed is a field describing nothing");
  assert("proseInstruments" in absent && "facilities" in absent,
    "[3f] but what the ANCHOR ITSELF states in sentences is still wanted — withholding the table is not suppressing the filing (Rule 3)");
}

console.log(`\n=== [4] Rule 51 — undefined is not a no ===`);
{
  // THE BUG, AS A TEST. The old call site asked `tabular !== false`, and
  // `tabular` is undefined whenever the locator found no note — so the
  // absence of an answer was read as a yes.
  assert(anchorNoteShapeOf({ status: "not_found" }) === "not-located",
    "[4a] a status of not_found is not-located, whatever `tabular` says — this is the Cigna case, and the old test read it as tabular");
  assert(anchorNoteShapeOf({ status: "not_found", tabular: true }) === "not-located",
    "[4b] and a stale `tabular: true` beside not_found does NOT reinstate the field — status decides first, because a tabular verdict about a note nobody located describes nothing");
  assert(anchorNoteShapeOf(undefined) === "not-located",
    "[4c] no anchor at all (a corpus with no 10-Q or 10-K) is also not-located");
  assert(anchorNoteShapeOf({ status: "found", tabular: false }) === "prose-only",
    "[4d] located and not a table is prose-only — v28's case, unchanged");
  assert(anchorNoteShapeOf({ status: "found", tabular: true }) === "tabular",
    "[4e] located and a table is tabular — the ordinary case, unchanged");
  assert(anchorNoteShapeOf({ status: "found" }) === "tabular",
    "[4f] located with no tabular verdict recorded stays tabular — the field is offered when a note EXISTS and nothing has said it is prose, which is the pre-Session-21 default and is deliberately not widened here");
  assert(anchorNoteShapeOf({ status: "under_cap" }) === "not-located",
    "[4g] and every non-found status withholds, not just not_found — under_cap located nothing either");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
