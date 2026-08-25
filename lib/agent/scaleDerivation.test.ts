/**
 * Session 18 (post-v14) golden tests — CODE-LEVEL SCALE DERIVATION.
 *
 * The headline case is the TENET REGRESSION PAIR: the same filing produced
 * per-row units on one run (v13, 32/32 verified) and neither per-row units
 * nor a caption on the next (v14, 24 of 28 rows dropped). Both shapes must
 * now resolve to the SAME scale, derived from the filing's own governing
 * declaration rather than from whatever the model happened to volunteer.
 *
 * The filing text below is a trimmed but VERBATIM-SHAPED excerpt of Tenet's
 * real 10-Q: the actual governing sentence ("dollar amounts presented in
 * our Condensed Consolidated Financial Statements and these accompanying
 * notes are expressed in millions"), sitting ~18k characters before the
 * debt table, exactly as it does in the real document. Confirmed live
 * against the real filing at zero API cost — detectDollarScaleAt resolves
 * Tenet's debt table (position 32,959) to MILLIONS from a declaration at
 * position 14,343.
 *
 * Run: npx tsx lib/agent/scaleDerivation.test.ts
 */
import { detectDollarScaleAt } from "./scaleNormalize";
import { checkMoneyScale, isSelfDescribingAmount } from "./moneyScale";
import { extractFactTokens } from "./factTokens";

/** The resolved dollar value of an amount string, or undefined if it has no scale-resolved token. */
const valueOf = (x: string) => extractFactTokens(x).filter((t) => t.kind === "money").find((t) => t.moneyValue !== undefined)?.moneyValue;

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/**
 * Mirrors loop.ts's deriveScaleFromFilingDeclaration for one amount, using
 * the identical primitives and the identical resolution order.
 */
function resolveScale(amount: string, sourceLine: string, filingText: string, modelCaption: string | null): string {
  if (isSelfDescribingAmount(amount)) return amount;                 // 1. the row's own unit wins
  const at = filingText.indexOf(sourceLine);
  if (at !== -1) {
    const scale = detectDollarScaleAt(filingText, at);               // 2. the FILING's declaration
    if (scale) {
      const candidate = `${amount} ${scale.scaleWord}`;
      if (checkMoneyScale(candidate).determinable) return candidate;
    }
  }
  if (modelCaption) {                                                 // 3. the model's caption
    const m = modelCaption.toLowerCase().match(/\b(billions?|millions?|thousands?)\b/);
    if (m) {
      const candidate = `${amount} ${m[1]}`;
      if (checkMoneyScale(candidate).determinable) return candidate;
    }
  }
  return amount;                                                      // 4. indeterminate -> dropped
}

const TENET_ROW = "6.125 % due 2028 $ 1,750";
const TENET_TOTAL_ROW = "Total long-term debt 13,248";

/** Real governing sentence + real debt-table rows, with realistic distance between them. */
const TENET_FILING = [
  "TENET HEALTHCARE CORPORATION Condensed Consolidated Financial Statements (Unaudited)",
  "Unless otherwise indicated, all dollar amounts presented in our Condensed Consolidated Financial Statements and these accompanying notes are expressed in millions.",
  "X".repeat(18000),
  "NOTE 6 LONG-TERM DEBT The table below shows our long-term debt as of June 30, 2026:",
  "Senior unsecured notes:",
  TENET_ROW,
  "5.125 % due 2027 $ 1,500",
  TENET_TOTAL_ROW,
].join("\n");

/** A filing that declares NO dollar scale anywhere — the "stays indeterminate" control. */
const NO_DECLARATION_FILING = [
  "SOME COMPANY Quarterly Report",
  "Weighted average shares outstanding (in thousands) 80,519",
  "Y".repeat(500),
  "NOTE 6 LONG-TERM DEBT",
  TENET_ROW,
].join("\n");

console.log("=== Session 18 code-level scale derivation ===\n");

// ============================================================================
// THE REGRESSION PAIR — same filing, two model behaviours, one answer.
// ============================================================================

// --- v13 shape: the model volunteered a per-row unit. ---
const v13 = resolveScale("$1,750 million", TENET_ROW, TENET_FILING, null);
// --- v14 shape: the model volunteered NEITHER a per-row unit NOR a caption.
// This is the run where 24 of 28 rows were dropped. ---
const v14 = resolveScale("$ 1,750", TENET_ROW, TENET_FILING, null);

assert(checkMoneyScale(v13).determinable, `[1a] REAL (Tenet v13, per-row unit) resolves (got ${JSON.stringify(v13)})`);
assert(checkMoneyScale(v14).determinable, `[1b] REAL (Tenet v14, bare amount, no caption) NOW resolves instead of being dropped (got ${JSON.stringify(v14)})`);
assert(
  valueOf(v13) === valueOf(v14) && valueOf(v13) === 1_750_000_000,
  `[1c] THE REGRESSION PAIR: both runs resolve to the SAME value, $1.75B (v13=${valueOf(v13)}, v14=${valueOf(v14)})`
);

// --- The same must hold for the subtotal that v14 dropped, taking Check 1
// with it. ---
{
  const a = resolveScale("$13,248 million", TENET_TOTAL_ROW, TENET_FILING, null);
  const b = resolveScale("13,248", TENET_TOTAL_ROW, TENET_FILING, null);
  assert(checkMoneyScale(a).determinable && checkMoneyScale(b).determinable, "[2a] Tenet's 'Total long-term debt' resolves from either shape");
  assert(/millions?/.test(b), `[2b] the bare subtotal picks up MILLIONS from the filing's own sentence (got ${JSON.stringify(b)})`);
}

// ============================================================================
// The guarantees around it.
// ============================================================================

// --- NOTHING INFERRED: no per-row unit, no caption, and no governing
// declaration in range -> still indeterminate, still dropped. The share-count
// "(in thousands)" in this control must NOT be mistaken for a money scale. ---
{
  const r = resolveScale("$ 1,750", TENET_ROW, NO_DECLARATION_FILING, null);
  assert(r === "$ 1,750", `[3a] no declaration -> amount untouched (got ${JSON.stringify(r)})`);
  assert(!checkMoneyScale(r).determinable, "[3b] and it stays INDETERMINATE, so it is still dropped — nothing inferred");
}

// --- A share-count "(in thousands)" is never read as a dollar scale, even
// when it sits before the table. This is why the derivation anchors on the
// word "dollar" rather than on any "(in thousands)" caption. ---
assert(detectDollarScaleAt(NO_DECLARATION_FILING, NO_DECLARATION_FILING.length - 1) === null, "[4] a share-count '(in thousands)' is not a dollar-scale declaration");

// --- PRECEDENCE 1: a row stating its own unit is never overridden by the
// filing's declaration, so a mixed-unit table can't be corrupted. ---
{
  const r = resolveScale("$2.75 billion", TENET_ROW, TENET_FILING, null);
  assert(r === "$2.75 billion", `[5] a row's own unit beats the filing declaration (got ${JSON.stringify(r)})`);
}

// --- PRECEDENCE 2 (the v13 fix, still intact): a fully-written amount is
// never re-scaled — appending "millions" here would turn $1B into $1
// quadrillion. ---
{
  const r = resolveScale("$1,000,000,000", TENET_ROW, TENET_FILING, null);
  assert(r === "$1,000,000,000", `[6] a fully-written amount is never re-scaled by a filing declaration (got ${JSON.stringify(r)})`);
}

// --- PRECEDENCE 3: the model's caption is a FALLBACK only, used when the
// entry's sourceLine can't be located in the filing text (a
// co-occurrence-verified entry has no literal position). ---
{
  const r = resolveScale("$ 1,750", "a sourceLine that is not in this document", TENET_FILING, "(In millions)");
  assert(checkMoneyScale(r).determinable && /millions?/.test(r), `[7] the model caption still resolves an unlocatable entry (got ${JSON.stringify(r)})`);
}

// --- REVERSE ASSERTION: the caption fallback cannot rescue an entry when
// the caption itself declares no scale. ---
{
  const r = resolveScale("$ 1,750", "not in this document either", TENET_FILING, "(unaudited)");
  assert(!checkMoneyScale(r).determinable, "[8] a caption with no scale word cannot make an amount determinable");
}

// --- The derivation is POSITIONAL: an entry earlier in the document than
// any declaration gets nothing, rather than borrowing a later one. ---
{
  const early = "EARLY LINE 4,242";
  const filing = [early, "X".repeat(200), "all dollar amounts are expressed in millions", "LATE LINE 1,111"].join("\n");
  const r = resolveScale("$ 4,242", early, filing, null);
  assert(!checkMoneyScale(r).determinable, "[9] a declaration AFTER an entry does not govern it — nearest-preceding only");
  const late = resolveScale("$ 1,111", "LATE LINE 1,111", filing, null);
  assert(checkMoneyScale(late).determinable, "[9b] but an entry after the declaration does resolve");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL SCALE-DERIVATION GOLDEN TESTS PASSED");
