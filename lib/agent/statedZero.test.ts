/**
 * SESSION 23, B3 — a stated zero is $0. Offline, $0.
 *
 * Every sentence below is REAL, taken from the v30 cold pass's own rejection
 * messages. These are the figures the model read correctly and the verifier
 * threw away.
 */
import { zeroSupportFor, isZeroValue, clausesOf, fieldOfClause } from "./statedZero";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

console.log("=== [1] A stated zero resolves to $0, in whatever words the filer used ===");
{
  // TENET, real — the sentence whose rejection opened this item.
  const tenet = "On that date, we had no cash borrowings and less than $ 1 million of standby letters of credit outstanding under the Credit Agreement.";
  assert(zeroSupportFor(tenet, "drawn").kind === "asserts-absence",
    "[1a] REAL Tenet: \"we had no cash borrowings\" states drawn = $0");

  // CIGNA, real.
  assert(zeroSupportFor("As of December 31, 2025, there was no outstanding balance under the Credit Agreement.", "drawn").kind === "asserts-absence",
    "[1b] REAL Cigna: \"no outstanding balance\" states drawn = $0");

  // ENCOMPASS, real — the LC rejection from the cold pass.
  assert(zeroSupportFor("Credit available under this revolving line of credit is reduced by the amount of any letters of credit outstanding under it, of which there were none.", "lettersOfCredit").kind === "asserts-absence",
    "[1c] REAL Encompass shape: \"of which there were none\" states letters of credit = $0");

  // MOLINA / CHS shapes.
  assert(zeroSupportFor("There were no amounts outstanding under the Credit Facility as of June 30, 2026.", "drawn").kind === "asserts-absence",
    "[1d] REAL Molina shape: \"no amounts outstanding\" states drawn = $0");
  assert(zeroSupportFor("As of June 30, 2026, there were no borrowings outstanding under the ABL Facility.", "drawn").kind === "asserts-absence",
    "[1e] REAL CHS shape: \"no borrowings outstanding\" states drawn = $0");

  // THE RULE, NOT THE LIST. None of these phrasings is enumerated anywhere
  // in the module; each carries a member of the closed negative class.
  assert(zeroSupportFor("Nothing was drawn under the facility at period end.", "drawn").kind === "asserts-absence",
    "[1f] UNLISTED phrasing: \"nothing was drawn\" resolves — the class is grammatical, so a filer's new wording needs no code change");
  assert(zeroSupportFor("The revolver was undrawn at June 30, 2026, without any outstanding borrowings.", "drawn").kind === "asserts-absence",
    "[1g] UNLISTED phrasing: \"without any outstanding borrowings\" resolves too");
}

console.log("\n=== [2] And a zero is REFUSED where the filing states a quantity ===");
{
  // THE CASE THAT MAKES THE RULE A RULE. One sentence, two figures: absence
  // for one and a real quantity for the other. A blanket "contains 'no'"
  // test waves both through, and the letters of credit are NOT zero.
  const tenet = "On that date, we had no cash borrowings and less than $ 1 million of standby letters of credit outstanding under the Credit Agreement.";
  const lc = zeroSupportFor(tenet, "lettersOfCredit");
  assert(lc.kind === "states-a-quantity",
    "[2a] REAL Tenet, same sentence: letters of credit are \"less than $1 million\", which is NOT zero — the claim is refused");
  assert(zeroSupportFor(tenet, "drawn").kind === "asserts-absence" && lc.kind === "states-a-quantity",
    "[2b] and BOTH verdicts come from the one sentence at once — absence is scoped to the clause that asserts it (Rule 38's shape, one field over)");

  assert(zeroSupportFor("We had $ 225 million of outstanding borrowings under the revolving credit facility.", "drawn").kind === "states-a-quantity",
    "[2c] a plainly stated non-zero drawn balance refuses a zero claim");
}

console.log("\n=== [3] Silence is null, never zero ===");
{
  assert(zeroSupportFor("The Credit Agreement matures on November 4, 2030.", "drawn").kind === "silent",
    "[3a] a sentence about maturity says nothing about drawn — null, not $0. Absence of a mention is not an assertion of absence (Rule 10)");
  assert(zeroSupportFor("The facility provides for revolving loans in an aggregate principal amount of $ 1,900 million.", "drawn").kind === "silent",
    "[3b] a size sentence is silent on drawn, even though the facility is named — the figure stays null and the filing is not made to say something it did not");
  assert(zeroSupportFor("", "drawn").kind === "silent",
    "[3c] an empty sentence is silent");
}

console.log("\n=== [4] The primitives ===");
{
  assert(isZeroValue("$0") && isZeroValue("$0 thousand") && isZeroValue("—") && isZeroValue("0"),
    "[4a] every form the schema may carry a zero in is recognised as one");
  assert(!isZeroValue("$225 million") && !isZeroValue("$1,900 million"),
    "[4b] and a real amount is not");
  assert(clausesOf("we had no cash borrowings and less than $ 1 million of standby letters of credit").length === 2,
    "[4c] the sentence splits at the conjunction, which is what keeps one clause's absence off another's quantity");
  assert(fieldOfClause("less than $ 1 million of standby letters of credit outstanding") === "lettersOfCredit",
    "[4d] \"letters of credit outstanding\" reads as lettersOfCredit, not as drawn — the specific noun wins over the shared word \"outstanding\"");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
