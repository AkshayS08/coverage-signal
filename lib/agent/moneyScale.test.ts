/**
 * Session 18 (post-v5) — lib/agent/moneyScale.ts, the code-level validator
 * added after three separate real bugs (row amounts in v3, statedTotal in
 * v4, reconcilingLines.amount found live in the v4 pilot) all had the
 * identical shape: a comma-grouped bare number with no scale word, silently
 * read as literal face-value dollars. Every case below is modeled directly
 * on a REAL string this session actually saw come back from the model,
 * labeled where applicable.
 *
 * Run: npx tsx lib/agent/moneyScale.test.ts
 */
import { checkMoneyScale, hasDeterminableMoneyScale, applyTableUnitToAmount, scaleWordFromDeclaration } from "./moneyScale";
import { extractFactTokens } from "./factTokens";

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

// --- Determinable: scale word attached (the correct shape, post-fix). ---
assert(hasDeterminableMoneyScale("$45,828 million"), "[1] REAL (HCA, v4-fixed) '$45,828 million' -- scale word attached -> determinable");
assert(hasDeterminableMoneyScale("$10,781,013 thousand"), "[2] REAL (DaVita, v4-fixed) '$10,781,013 thousand' -- determinable");
assert(hasDeterminableMoneyScale("($66,503 thousand)"), "[3] REAL (DaVita, v5-fixed) '($66,503 thousand)' -- whole value parenthesized, scale word attached inside -- determinable");
assert(hasDeterminableMoneyScale("$(66,503) thousand"), "[3b] REAL (DaVita, earlier documented raw shape) '$(66,503) thousand' -- dollar outside parens, scale word after -- determinable (must match parseMoneyAmount's own parens tolerance, or a value that parses fine downstream would be wrongly flagged here)");
assert(hasDeterminableMoneyScale("$1.0 billion"), "[4] '$1.0 billion' -- determinable");
assert(hasDeterminableMoneyScale("$500K"), "[5] '$500K' short-suffix form -- determinable");

// --- Indeterminate: the exact three real bug shapes, bare comma-grouped
// numbers with no scale word (regardless of whether a "$" is attached). ---
assert(!hasDeterminableMoneyScale("45,828"), "[6] REAL (HCA, v3 bug) bare '45,828' -- no unit -- indeterminate");
assert(!hasDeterminableMoneyScale("10,781,013"), "[7] REAL (DaVita, v3/pre-v4 bug) bare '10,781,013' -- indeterminate");
assert(!hasDeterminableMoneyScale("( 66,503 )"), "[8] REAL (DaVita, v4-pilot bug) '( 66,503 )' -- parens but no unit -- indeterminate");
assert(!hasDeterminableMoneyScale("$45,828"), "[9] '$45,828' -- a '$' alone is NOT proof of scale (SEC tables glue '$' onto thousands-scale figures) -- indeterminate");
assert(!hasDeterminableMoneyScale("$10,781,013"), "[10] '$10,781,013' -- same reasoning as [9] -- indeterminate");

// --- [11]/[12] INVERTED in post-v14, deliberately. These previously
// asserted that any small non-comma-grouped "$" figure is determinable
// "true face value". That was the same assumption that let Cigna's "$ 549"
// through as $549 when its table caption made it $549 MILLION. At this
// layer there is no sentence context to tell a per-share rate from a table
// cell, and this module's own doc comment already commits to being
// deliberately stricter here than anywhere downstream. Two things make the
// stricter rule safe rather than merely stricter: a genuine per-share
// figure carries "per share" and is still determinable (see [11b]), and a
// genuine table amount now gets its scale from the filing's own governing
// declaration before it ever reaches this check (loop.ts's
// deriveScaleFromFilingDeclaration). ---
assert(!hasDeterminableMoneyScale("$0.78"), "[11] '$0.78' with no unit and no context is INDETERMINATE -- indistinguishable from a scaled table cell at this layer");
assert(!hasDeterminableMoneyScale("$45.50"), "[12] '$45.50' -- same, indeterminate");
// The real dividend shape, which must still resolve — this is what keeps
// [11]'s inversion from breaking genuine per-share cashAmounts.
assert(hasDeterminableMoneyScale("$0.78 per share"), "[11b] REVERSE ASSERTION: a genuine per-share rate IS determinable -- a rate is never a scaled table cell");

// --- Edge cases: null/empty is a valid \"nothing stated\", not a failure —
// must not be conflated with a genuinely scale-indeterminate value. ---
assert(hasDeterminableMoneyScale(null), "[13] null -- valid 'nothing stated', not a scale failure");
assert(hasDeterminableMoneyScale(""), "[14] empty string -- same as null, not a failure");
assert(hasDeterminableMoneyScale("   "), "[15] whitespace-only -- same as null, not a failure");

// --- A string with no money-shaped token at all (e.g. a stray label) is
// indeterminate -- there's nothing to trust as an amount. ---
assert(!hasDeterminableMoneyScale("see note 7"), "[16] no money-shaped token at all -- indeterminate");

// --- checkMoneyScale exposes the raw failing value for logging. ---
{
  const check = checkMoneyScale("45,828");
  assert(!check.determinable && check.raw === "45,828", `[17] checkMoneyScale surfaces the raw failing value for logging (got determinable=${check.determinable}, raw=${check.raw})`);
}
{
  const check = checkMoneyScale("$45,828 million");
  assert(check.determinable && check.raw === undefined, `[18] checkMoneyScale on a determinable value has no raw (nothing to log) (got determinable=${check.determinable}, raw=${check.raw})`);
}

// ============================================================================
// Session 18 (post-v11) — table-level unit declarations. The FOURTH
// occurrence of the missing-scale class, and the first fixed by capturing
// what the filing itself declares rather than asking the prompt again.
// Every string below is modeled on REAL Cigna 10-K output.
// ============================================================================

// --- Declaration parsing: the closed, universal scale vocabulary only. ---
assert(scaleWordFromDeclaration("(In millions)") === "million", "[19] '(In millions)' -> million");
assert(scaleWordFromDeclaration("(amounts in thousands)") === "thousand", "[20] '(amounts in thousands)' -> thousand");
assert(scaleWordFromDeclaration("(dollars in billions)") === "billion", "[21] '(dollars in billions)' -> billion");
assert(scaleWordFromDeclaration("(unaudited)") === null, "[22] a caption declaring no scale -> null, never guessed");
assert(scaleWordFromDeclaration(null) === null, "[23] no caption at all -> null");

// --- REAL (Cigna 10-K), and the single most important case here: a
// comma-free "$ 549" ALREADY parses as a determinable $549 in literal
// dollars. That is the DANGEROUS shape — nothing downstream flags it, and
// Check 1 can't either (a running-total walk is scale-invariant, so a
// uniformly million-fold-wrong table still ties perfectly). So the
// row-wins test must be "does the row name its own scale word," never
// "does the row already parse." This assertion is what caught that
// distinction; do not weaken it. ---
{
  // [24-pre] INVERTED in post-v14. It used to assert that "$ 549" parses on
  // its own — true at the time, and the reason "already determinable" was
  // the wrong row-wins test. checkMoneyScale itself has since been fixed so
  // that it does NOT parse, which removes the trap at its source. The
  // row-wins test is still "does the row state its own scale", not "does it
  // parse" — see isSelfDescribingAmount — and [24] below still pins that.
  assert(!checkMoneyScale("$ 549").determinable, "[24-pre] '$ 549' no longer parses as $549 -- the silent million-fold trap is closed at the validator itself");
  const rescaled = applyTableUnitToAmount("$ 549", "(In millions)");
  assert(rescaled === "$ 549 million", `[24] REAL (Cigna) a bare "$ 549" under an "(In millions)" caption becomes "$ 549 million" (got ${JSON.stringify(rescaled)})`);
}

// --- REAL (Cigna 10-K): the comma-grouped rows that were DROPPED as
// indeterminate now resolve instead of being lost. ---
{
  const rescaled = applyTableUnitToAmount("$ 1,481", "(In millions)");
  assert(hasDeterminableMoneyScale(rescaled), `[25] REAL (Cigna) a dropped "$ 1,481" becomes determinable under its table's caption (got ${JSON.stringify(rescaled)})`);
}

// --- A row that states its OWN unit is never touched — the row always wins
// over the table caption, so a mixed-unit table can't be corrupted. ---
{
  const untouched = applyTableUnitToAmount("$2.75 billion", "(In millions)");
  assert(untouched === "$2.75 billion", `[26] a row with its own unit is left exactly as-is, never re-scaled by the caption (got ${JSON.stringify(untouched)})`);
}

// --- REVERSE ASSERTION: no declaration means no rescue. An amount with no
// unit and no table declaration stays indeterminate and is still dropped —
// this is not a fallback that guesses a scale. ---
{
  const unchanged = applyTableUnitToAmount("45,828", null);
  assert(unchanged === "45,828", "[27] no table declaration -> amount untouched");
  assert(!hasDeterminableMoneyScale(unchanged), "[27b] and it stays indeterminate, so it is still dropped downstream");
}

// --- A declaration with no recognizable scale word can't rescue anything
// either — never invents a unit. ---
{
  const unchanged = applyTableUnitToAmount("45,828", "(unaudited)");
  assert(!hasDeterminableMoneyScale(unchanged), "[28] a caption with no scale word cannot make an amount determinable");
}

// --- Accounting-negative parens survive the rewrite, and the result still
// parses — guards the exact paren-placement bug v4/v5 fought through. ---
{
  const rescaled = applyTableUnitToAmount("( 66,503 )", "(in thousands)");
  assert(hasDeterminableMoneyScale(rescaled), `[29] a parenthesized negative rescales and still parses (got ${JSON.stringify(rescaled)})`);
}

// ============================================================================
// Session 18 (post-v12) — checkMoneyScale was backwards at the top end. A
// figure written out to the dollar is unambiguous by construction; it was
// being rejected as indeterminate while a bare "$ 549" was accepted. Live
// cost: all 4 of Cigna's issuedTranches plus its cashAmount, dropped for
// being too precise.
// ============================================================================

// --- REAL (Cigna 8-K): fully-written dollar figures are determinate. ---
assert(hasDeterminableMoneyScale("$1,000,000,000"), "[30] REAL (Cigna) a fully-written $1,000,000,000 has determinate scale");
assert(hasDeterminableMoneyScale("$4,500,000,000"), "[31] REAL (Cigna) $4,500,000,000 (its cashAmount) has determinate scale");
assert(hasDeterminableMoneyScale("$750,000,000"), "[32] REAL (Cigna) $750,000,000 has determinate scale");

// --- REVERSE ASSERTION, and the reason the rule is a magnitude threshold
// rather than a digit count: DaVita's REAL "10,847,516" is an 8-digit
// comma-grouped figure that genuinely IS thousands-scaled ($10.8B). It must
// STILL be indeterminate — a digit-count or trailing-zeros rule would have
// broken exactly this case. ---
assert(!hasDeterminableMoneyScale("10,847,516"), "[33] REAL (DaVita) an 8-digit but genuinely thousands-scaled table figure stays INDETERMINATE");
assert(!hasDeterminableMoneyScale("$ 1,481"), "[34] REAL (Cigna) a small scaled table cell stays indeterminate");
assert(!hasDeterminableMoneyScale("45,828"), "[35] REAL (HCA) 45,828 stays indeterminate");

// --- THE INTERACTION between this session's two money fixes. Once
// "$1,000,000,000" became determinable, a row-wins test that only looked
// for a scale WORD would have appended the table caption's unit to it,
// producing "$1,000,000,000 million" — $1B turned into $1 quadrillion.
// This asserts the two fixes are reconciled. ---
{
  const untouched = applyTableUnitToAmount("$1,000,000,000", "(In millions)");
  assert(untouched === "$1,000,000,000", `[36] a fully-written amount is NOT re-scaled by a table caption (got ${JSON.stringify(untouched)})`);
  assert(hasDeterminableMoneyScale(untouched), "[36b] and it remains determinate afterwards");
}

// --- REVERSE ASSERTION for [36]: the caption still applies to genuinely
// scaled cells in the same table — the guard didn't disable the v12 fix. ---
{
  const rescaled = applyTableUnitToAmount("$ 549", "(In millions)");
  assert(rescaled === "$ 549 million", `[37] a scaled cell in the same table is still rescaled (got ${JSON.stringify(rescaled)})`);
}

// ============================================================================
// Session 18 (post-v13) — PLURAL scale words, found live in the v13 run.
// Failed in two different ways, one of them silent.
// ============================================================================

// REAL (UHS v13): all 16 of its entries came back carrying the plural
// "thousands" and were dropped as scale-indeterminate, taking the whole
// company's schedule with them. Its filing caption reads "(dollars and
// shares in thousands...)", so the plural is ordinary input, not malformed.
assert(hasDeterminableMoneyScale("$800,000 thousands"), "[38] REAL (UHS) plural 'thousands' is determinable -- all 16 of its entries were dropped over this");
assert(hasDeterminableMoneyScale("$3,769 millions"), "[39] plural 'millions' on a comma-grouped figure is determinable");

// THE SILENT HALF, and the worse one: "$1.5 millions" did not fail loudly.
// It fell through to the small-dollar matcher, which read the bare "$1.5"
// and returned ONE POINT FIVE DOLLARS -- a million-fold error nothing
// downstream would flag. Assert the VALUE, not just determinability: a
// determinability-only test passes on the bug.
{
  const v = extractFactTokens("$1.5 millions").filter((t) => t.kind === "money").find((t) => t.moneyValue !== undefined)?.moneyValue;
  assert(v === 1_500_000, `[40] '$1.5 millions' resolves to 1,500,000 -- NOT 1.5 dollars (got ${v})`);
}
{
  const v = extractFactTokens("$800,000 thousands").filter((t) => t.kind === "money").find((t) => t.moneyValue !== undefined)?.moneyValue;
  assert(v === 800_000_000, `[41] REAL (UHS) '$800,000 thousands' resolves to $800M (got ${v})`);
}
// REVERSE ASSERTION: singulars are unchanged.
{
  const v = extractFactTokens("$549 million").filter((t) => t.kind === "money").find((t) => t.moneyValue !== undefined)?.moneyValue;
  assert(v === 549_000_000, "[42] the singular form is unchanged");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFailed: ${failures.join(", ")}`);
  process.exit(1);
}
