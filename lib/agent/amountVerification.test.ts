/**
 * Session 18 (post-v15) golden tests — the two fixes the v15 live run forced.
 *
 * 1. THE CHS SHAPE. CHS's verified sequence came back holding HCA's exact
 *    figures, copied out of this repo's own prompt example. Not one of them
 *    appears in CHS's 183,593-char filing. They survived because
 *    verification checked `sourceLine` and never the amount, and the
 *    subtotals' sourceLine was the bare caption "Total long-term debt" —
 *    text present in nearly every debt note ever filed.
 *
 * 2. THE DAVITA SHAPE. cashAmount was the fourth field of the missing-scale
 *    class and the only one still on bare checkMoneyScale, so five real
 *    thousands-scale figures were nulled and DaVita carded nothing.
 *
 * The amount-in-filing logic is asserted through its own exported helper;
 * the cashAmount resolution order is asserted against the same primitives
 * loop.ts's deriveCashAmountScale composes, in the same order.
 *
 * Run: npx tsx lib/agent/amountVerification.test.ts
 */
import { amountAppearsIn, amountCorroborated } from "./loop";
import { checkMoneyScale, isSelfDescribingAmount } from "./moneyScale";
import { detectDollarScaleAt } from "./scaleNormalize";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

console.log("=== amount verification + cashAmount scale ===\n");

// ============================================================================
// PART 1 — the amount must be in the filing.
// ============================================================================

/** CHS's real filing shape: genuine captions, genuine instruments, none of HCA's numbers. */
const CHS_FILING = [
  "COMMUNITY HEALTH SYSTEMS, INC. Condensed Consolidated Financial Statements",
  "Dollar amounts are expressed in millions.",
  "NOTE 5 — LONG-TERM DEBT",
  "8.000% Senior Secured Notes due 2027 1,535",
  "5.625% Senior Secured Notes due 2027 1,010",
  "Total long-term debt 11,624",
  "Less: current maturities ( 24 )",
].join("\n");

// --- THE REGRESSION CASE: a real caption carrying a fabricated figure. This
// is exactly what walked through before, and the only thing that caught it
// downstream was a $36B balance-sheet gap. ---
assert(CHS_FILING.includes("Total long-term debt"), "[1a] precondition — the caption 'Total long-term debt' IS genuinely in CHS's filing");
assert(!amountAppearsIn("$ 45,828 million", CHS_FILING), "[1b] ...but HCA's 45,828 riding on that real caption is REJECTED");
assert(!amountAppearsIn("$ 49,718 million", CHS_FILING), "[1c] and so is the rollup 49,718");
assert(!amountAppearsIn("$ 44,200 million", CHS_FILING), "[1d] and so is the row 44,200");

// --- REVERSE ASSERTION: CHS's own real figures are kept. A check that
// dropped these would be worse than the bug it fixes. ---
assert(amountAppearsIn("$ 11,624 million", CHS_FILING), "[2a] CHS's own real subtotal is KEPT");
assert(amountAppearsIn("$ 1,535 million", CHS_FILING), "[2b] and its own real row is kept");
assert(amountAppearsIn("$ 1,010 million", CHS_FILING), "[2c] a figure that happens to be real in this filing is kept even though the example also used it");

// --- The scale-derived form must still match. By this point the amount may
// legitimately read "$ 1,535 million" where the filing printed only "1,535";
// digits survive that rewrite, decoration does not. ---
assert(amountAppearsIn("1,535", CHS_FILING) && amountAppearsIn("$1,535", CHS_FILING) && amountAppearsIn("$ 1,535 million", CHS_FILING), "[3] the same figure passes bare, $-prefixed, and scale-derived");

// --- ABSTENTION: a figure with no discriminating digit group is passed
// through unchecked rather than dropped. "( 24 )" is real here, but a
// 2-digit number proves nothing either way — the check must not invent a
// failure it cannot substantiate. ---
assert(amountAppearsIn("( 24 ) million", CHS_FILING), "[4a] a real 2-digit adjustment is kept");
assert(amountAppearsIn("$ 99 million", "text containing no such number at all"), "[4b] and an ABSENT 2-digit figure is also kept — the check abstains below 3 digits rather than guess");

// --- Negative/parenthesised and decimal forms still resolve on their digits. ---
assert(amountAppearsIn("$( 1,010 ) million", CHS_FILING), "[5a] a parenthesised negative matches on its digits");
assert(!amountAppearsIn("$ 7,777.5 million", CHS_FILING), "[5b] a decimal figure absent from the filing is rejected");

// --- Multi-group amounts: ANY group matching is enough, deliberately
// permissive — a false drop corrupts every subtotal after it, while a false
// keep still has both checksums waiting for it. ---
assert(amountAppearsIn("$ 1,535 million (of 99,999 authorized)", CHS_FILING), "[6] any one discriminating group matching is enough");

// ============================================================================
// PART 1b — THE UHS FALSE DROP. The same value printed two ways shares no
// digits, so the digit scan alone rejects a CORRECT amount. Caught live on
// UHS by the zero-cost cache replay, before this ever reached a paid run.
// ============================================================================

const UHS_FILING = [
  "UNIVERSAL HEALTH SERVICES, INC.",
  "Dollar amounts below are reflected in thousands.",
  "Interest expense by instrument (amounts in thousands):",
  "$800 million, 2.65% Senior Notes due 2030 (a.) 5,300 5,100",
  "$700 million, 1.65% Senior Notes due 2026 (a.) 2,888 2,900",
].join("\n");
const UHS_LINE = "$800 million, 2.65% Senior Notes due 2030 (a.) 5,300 5,100";

assert(!amountAppearsIn("$800,000 thousands", UHS_FILING), "[6b] precondition — the digit group '800,000' genuinely does NOT appear in UHS's filing");

// A1 (post-stage-2): amountCorroborated is now BOUNDED — it takes the row's
// own matched span and the located note span, because an unbounded scan over
// a whole filing corroborates almost anything. `spanOf` gives each assertion
// the row's real position in its own fixture rather than a hand-picked
// number, so these stay honest if the fixtures are edited.
const spanOf = (text: string, row: string) => {
  const at = text.indexOf(row);
  return at < 0 ? null : { start: at, end: at + row.length };
};
const WHOLE = (text: string) => ({ start: 0, end: text.length });

assert(
  amountCorroborated("$800,000 thousands", UHS_LINE, UHS_FILING, spanOf(UHS_FILING, UHS_LINE), null),
  "[6c] $800,000 thousands is KEPT, because its VALUE matches the '$800 million' its own verified row prints"
);
assert(
  !amountCorroborated("$373,000 thousands", "Revolving credit facility (a.) 3,371 2,692", UHS_FILING, null, null),
  "[6d] a revolver balance neither printed nor value-matched anywhere is still REJECTED — the fallback still bites"
);
// --- The CHS case must survive the escape hatch: a caption with no figure in
// it can never corroborate anything by value. ---
const CHS_TOTAL_ROW = "Total long-term debt 11,624";
assert(
  !amountCorroborated("$ 45,828 million", "Total long-term debt", CHS_FILING, spanOf(CHS_FILING, CHS_TOTAL_ROW), WHOLE(CHS_FILING)),
  "[6e] CHS's fabricated subtotal is still rejected — its caption carries no figure to match against, and 45,828 is not printed beside it"
);
assert(
  amountCorroborated("$ 11,624 million", "Total long-term debt", CHS_FILING, spanOf(CHS_FILING, CHS_TOTAL_ROW), WHOLE(CHS_FILING)),
  "[6f] and CHS's real subtotal on that same caption is still kept — 11,624 IS printed on that row"
);
// --- Value matching is EXACT: near-misses are different figures. ---
assert(!amountCorroborated("$801,000 thousands", UHS_LINE, "no digits here", null, null), "[6g] $801,000 does not match a printed $800 million — exact value equality, never a tolerance");

// ============================================================================
// PART 1c — A1: THE BOUNDS THEMSELVES. Live case: CHS's ladder carried an
// $708M "ABL Facility" row whose sourceLine — "Proceeds from ABL Facility
// 708" — is a genuine line of the filing, from the CASH FLOW STATEMENT. The
// real debt note prints that facility as zero. It verified literally and the
// amount scan found "708" because "708" was right there in the cash-flow
// line. Only the note-span bound separates the two.
// ============================================================================
const CHS_WITH_CASHFLOW = [
  "COMMUNITY HEALTH SYSTEMS, INC. Condensed Consolidated Statements of Cash Flows",
  "Issuance of long-term debt — 700 Proceeds from ABL Facility 708 2,189 Repayments of long-term debt",
  "................................................................",
  "NOTE 5 — LONG-TERM DEBT",
  "Dollar amounts are expressed in millions.",
  "ABL Facility — —",
  "Total long-term debt 11,624",
].join("\n");
const NOTE_START = CHS_WITH_CASHFLOW.indexOf("NOTE 5 — LONG-TERM DEBT");
const NOTE_SPAN = { start: NOTE_START, end: CHS_WITH_CASHFLOW.length };
const CASHFLOW_ROW = "Proceeds from ABL Facility 708";

assert(
  amountCorroborated("$ 708 million", CASHFLOW_ROW, CHS_WITH_CASHFLOW, spanOf(CHS_WITH_CASHFLOW, CASHFLOW_ROW), null),
  "[6h] precondition — with NO note bound, the cash-flow row corroborates its own $708M perfectly. This is the bug."
);
assert(
  !amountCorroborated("$ 708 million", CASHFLOW_ROW, CHS_WITH_CASHFLOW, spanOf(CHS_WITH_CASHFLOW, CASHFLOW_ROW), NOTE_SPAN),
  "[6i] ...and with the note bound applied it is REJECTED — the row is real, but it is not a debt-schedule row"
);
assert(
  amountCorroborated("$ 11,624 million", "Total long-term debt 11,624", CHS_WITH_CASHFLOW, spanOf(CHS_WITH_CASHFLOW, "Total long-term debt 11,624"), NOTE_SPAN),
  "[6j] REVERSE: a real row INSIDE the note is unaffected by the same bound"
);
assert(
  !amountCorroborated("$ 2,189 million", "ABL Facility — —", CHS_WITH_CASHFLOW, spanOf(CHS_WITH_CASHFLOW, "ABL Facility — —"), NOTE_SPAN),
  "[6k] a figure printed elsewhere in the SAME filing no longer corroborates a row it is not printed beside"
);

// ============================================================================
// PART 2 — cashAmount resolves from the filing's own declaration.
// ============================================================================

/** DaVita's real shape: a thousands declaration governing the whole document. */
const DAVITA_FILING = [
  "DAVITA INC. Condensed Consolidated Financial Statements",
  "(dollars and shares in thousands, except per share data)",
  "Z".repeat(4000),
  "The Company had cash and cash equivalents of $ 668,963 at June 30, 2026.",
].join("\n");

const DAVITA_ANCHOR = "The Company had cash and cash equivalents of $ 668,963 at June 30, 2026.";

/** Mirrors loop.ts's deriveCashAmountScale for one amount — same primitives, same order. */
function resolveCash(amount: string, anchor: string, filingText: string): string {
  if (isSelfDescribingAmount(amount)) return amount;
  const at = filingText.indexOf(anchor);
  if (at === -1) return amount;
  const scale = detectDollarScaleAt(filingText, at);
  if (!scale) return amount;
  const candidate = `${amount} ${scale.scaleWord}`;
  return checkMoneyScale(candidate).determinable ? candidate : amount;
}

// --- THE REGRESSION CASE: all five of DaVita's real v15-nulled figures. ---
const DAVITA_NULLED = ["$ 986,000", "$ 271,836", "$ 2,000,000", "$ 668,963", "$ 4,392"];
{
  const resolved = DAVITA_NULLED.map((a) => resolveCash(a, DAVITA_ANCHOR, DAVITA_FILING));
  assert(resolved.every((r) => checkMoneyScale(r).determinable), `[7a] all five of DaVita's v15-nulled cashAmounts now resolve (${JSON.stringify(resolved)})`);
  assert(resolved.every((r) => /thousands?/.test(r)), "[7b] and every one resolves to THOUSANDS, from the filing's own declaration");
  assert(DAVITA_NULLED.every((a) => !checkMoneyScale(a).determinable), "[7c] precondition — each was genuinely indeterminate on its own, so this is a real recovery and not a no-op");
}

// --- The silent direction this closes too: pre-v15 "$ 986,000" was ACCEPTED
// as 986 thousand dollars, a thousand-fold understatement. ---
{
  const r = resolveCash("$ 986,000", DAVITA_ANCHOR, DAVITA_FILING);
  assert(/thousands?/.test(r), `[8] "$ 986,000" resolves to $986.0M, not $986,000 — the silent direction is closed too (got ${JSON.stringify(r)})`);
}

// --- NOTHING INFERRED: no governing declaration means still null. ---
{
  const bare = ["SOME CO Report", "Cash on hand was $ 668,963 at period end."].join("\n");
  const r = resolveCash("$ 668,963", "Cash on hand was $ 668,963 at period end.", bare);
  assert(!checkMoneyScale(r).determinable, "[9] a filing that declares no scale leaves cashAmount indeterminate — still nulled, nothing guessed");
}

// --- A share-count "(in thousands)" must never be read as a money scale. ---
{
  const shares = ["SOME CO", "Weighted average shares outstanding (in thousands) 80,519", "Cash was $ 4,392."].join("\n");
  const r = resolveCash("$ 4,392", "Cash was $ 4,392.", shares);
  assert(!checkMoneyScale(r).determinable, "[10] a share-count caption does not resolve a cashAmount");
}

// --- PRECEDENCE: a self-describing cashAmount is never re-scaled. ---
assert(resolveCash("$2.75 billion", DAVITA_ANCHOR, DAVITA_FILING) === "$2.75 billion", "[11a] an amount stating its own scale wins over the filing declaration");
assert(resolveCash("$1,000,000,000", DAVITA_ANCHOR, DAVITA_FILING) === "$1,000,000,000", "[11b] and a fully-written amount is never re-scaled into $1 quadrillion");

// --- No verified anchor means no lookup: unverified text must never be used
// to position a scale derivation. ---
{
  const r = resolveCash("$ 668,963", "a quote that never verified", DAVITA_FILING);
  assert(r === "$ 668,963" && !checkMoneyScale(r).determinable, "[12] an unlocatable anchor derives nothing — the amount is left alone and still nulled");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL AMOUNT-VERIFICATION GOLDEN TESTS PASSED");
