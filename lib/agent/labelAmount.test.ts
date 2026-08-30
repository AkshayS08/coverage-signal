/**
 * SESSION 19 — an amount that verifies only inside the instrument's own
 * label is not a verified balance.
 *
 * UHS's locator landed on the INTEREST-EXPENSE table, whose columns hold
 * 5,357 and 10,713. The model reported $800,000 thousands for that row —
 * a figure in no column — by reading the issue size out of the row's own
 * name, "$800 million, 2.65% Senior Notes due 2030". Value-equality
 * corroboration then matched the claim against the claim's own title, and
 * five interest rows verified as a debt ladder.
 *
 * Run: npx tsx lib/agent/labelAmount.test.ts
 */
import { amountCorroborated } from "./loop";
import { splitIssueSizeFromName, textOutsideInstrumentLabel } from "./issueSize";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

// UHS's real interest-expense table, verbatim.
const UHS_NOTE =
  "Revolving credit facility (a.) $ 3,371 $ 2,692 $ 9,273 $ 4,486 " +
  "Tranche A term loan, 2029 (a.) 17,211 16,996 31,847 34,188 " +
  "$800 million, 2.65% Senior Notes due 2030 5,357 5,357 10,713 10,713 " +
  "$700 million, 1.65% Senior Notes due 2026 2,931 2,931 5,863 5,863 " +
  "Subtotal-revolving credit, term loan A and Senior Notes 44,358 43,464 88,673 86,227 ";
const UHS_SPAN = { start: 0, end: UHS_NOTE.length };

console.log("\n=== [1] REAL: UHS's five rows must NOT corroborate ===");
{
  const line = "$800 million, 2.65% Senior Notes due 2030";
  const at = UHS_NOTE.indexOf(line);
  const span = { start: at, end: at + line.length };
  assert(!amountCorroborated("$800,000 thousands", line, UHS_NOTE, span, UHS_SPAN),
    "[1a] THE FIX: $800,000 thousands does not corroborate — its only match is the issue size in its own name");
  const line2 = "$700 million, 1.65% Senior Notes due 2026";
  const at2 = UHS_NOTE.indexOf(line2);
  assert(!amountCorroborated("$700,000 thousands", line2, UHS_NOTE, { start: at2, end: at2 + line2.length }, UHS_SPAN),
    "[1b] and the same for $700,000 thousands");
}

console.log("\n=== [2] CONTROL: the interest figure that IS in the column corroborates ===");
{
  const line = "$800 million, 2.65% Senior Notes due 2030 5,357";
  const at = UHS_NOTE.indexOf(line);
  assert(amountCorroborated("$5,357 thousands", line, UHS_NOTE, { start: at, end: at + line.length }, UHS_SPAN),
    "[2a] REVERSE: a figure the row actually PRINTS still corroborates — the rule removes the label, not the row");
}

console.log("\n=== [3] REAL: a legitimate balance beside an issue-size name still passes ===");
{
  // Centene: the name leads with the issue size AND the row prints a real,
  // different balance. This is the case the rule must not break.
  const note = "$ 2,500 million 4.25 % Senior Notes due December 15, 2027 $ 1,067 $ 2,211 ";
  const line = "$ 2,500 million 4.25 % Senior Notes due December 15, 2027 $ 1,067";
  const at = note.indexOf(line);
  assert(amountCorroborated("$ 1,067 million", line, note, { start: at, end: at + line.length }, { start: 0, end: note.length }),
    "[3a] Centene's $1,067M balance corroborates — stripping the leading issue size leaves the real figure");
  assert(!amountCorroborated("$ 2,500 million", line, note, { start: at, end: at + line.length }, { start: 0, end: note.length }),
    "[3b] and its ISSUE SIZE does not — $2,500M is the note's name, not its position");
}

console.log("\n=== [4] REAL: Molina, whose labels carry no issue size ===");
{
  const note = "4.375 % Notes due June 15, 2028 $ 800 $ 800 3.875 % Notes due November 15, 2030 650 650 ";
  const line = "4.375 % Notes due June 15, 2028 $ 800";
  const at = note.indexOf(line);
  assert(amountCorroborated("$800 million", line, note, { start: at, end: at + line.length }, { start: 0, end: note.length }),
    "[4a] a name that does not begin with an issue size is untouched by the rule");
}

console.log("\n=== [5] The splitter itself ===");
{
  assert(splitIssueSizeFromName("$800 million, 2.65% Senior Notes due 2030").issueSize === "$800 million",
    "[5a] a leading issue size is identified");
  assert(splitIssueSizeFromName("4.375 % Notes due June 15, 2028").issueSize === null,
    "[5b] a name with no leading issue size returns null, not a guess");
  assert(textOutsideInstrumentLabel("$800 million, 2.65% Senior Notes due 2030") === "2.65% Senior Notes due 2030",
    "[5c] what a balance must corroborate against carries no money at all here");
  assert(splitIssueSizeFromName("$500 million").issueSize === null,
    "[5d] a bare figure with no name after it is not split — there would be nothing left to be an instrument");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
