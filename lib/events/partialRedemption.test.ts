/**
 * Session 18 (post-v16) golden tests — A PARTIAL REDEMPTION MUST NOT RETIRE
 * A TRANCHE.
 *
 * The live case, from Tenet's real 8-K: one sentence redeems two different
 * tranches, one in full and one in part. The old rate+maturity match retired
 * the PARTIALLY-called tranche outright, dropping a ~$1.0B still-outstanding
 * row off the live ladder — where it can never card, and never be seen.
 *
 * Run: npx tsx lib/events/partialRedemption.test.ts
 */
import { redemptionRetiresRow } from "./position";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

console.log("=== partial redemption ===\n");

/** REAL — Tenet's own `redeems` text, verbatim from the v16 run. */
const TENET_REDEEMS =
  "all $1.5 billion aggregate principal amount outstanding of its 6.250% senior secured second lien notes due February 2027 and the partial redemption of $0.75 billion outstanding of its 6.125% senior notes due October 2028";

const row = (rate: string | null, maturityDate: string | null, gran: "day" | "month" | "year" | null) => ({ rate, maturityDate, dateGranularity: gran });

// ============================================================================
// 1. THE REGRESSION — the partially-redeemed tranche stays live.
// ============================================================================
assert(
  !redemptionRetiresRow(row("6.125%", "2028", "year"), TENET_REDEEMS),
  "[1a] REAL (Tenet) the 6.125%/2028 tranche is only PARTIALLY redeemed — it stays LIVE (was wrongly retired)"
);
assert(
  redemptionRetiresRow(row("6.250%", "2027-02-01", "month"), TENET_REDEEMS),
  "[1b] ...while the 6.250%/Feb-2027 tranche, redeemed in FULL in the same sentence, IS retired"
);

// --- The two must be decided independently: one sentence, two answers. That
// is the whole point — any sentence-level test gets one of them wrong. ---
assert(
  !redemptionRetiresRow(row("6.125%", "2028", "year"), TENET_REDEEMS) && redemptionRetiresRow(row("6.250%", "2027-02-01", "month"), TENET_REDEEMS),
  "[1c] the SAME text yields opposite answers for the two tranches it names"
);

// ============================================================================
// 2. Ordinary full redemptions still retire — the fix must not make the
//    feature inert. These are the other real `redeems` values from the run.
// ============================================================================
assert(redemptionRetiresRow(row("4.500%", "2028", "year"), "4.500% senior notes due 2028"), "[2a] REAL (Encompass) a plain full redemption still retires");
assert(redemptionRetiresRow(row("3.45%", "2026-06-01", "month"), "3.45% Senior Notes due June 2026"), "[2b] REAL (Quest) its full redemption still retires");
assert(
  redemptionRetiresRow(row("5.250%", "2026", "year"), "all $ 1.500 billion aggregate principal amount of 5.250 % senior notes due 2026 and all $ 1.000 billion aggregate principal amount of 5.375 % senior notes due 2026"),
  "[2c] REAL (HCA) one of two tranches BOTH redeemed in full still retires"
);

// ============================================================================
// 3. Partial phrasing, however it is worded.
// ============================================================================
assert(!redemptionRetiresRow(row("5.000%", "2030", "year"), "a portion of its 5.000% notes due 2030"), "[3a] 'a portion of' does not retire");
assert(!redemptionRetiresRow(row("5.000%", "2030", "year"), "redeemed in part its 5.000% notes due 2030"), "[3b] 'in part' does not retire");
assert(!redemptionRetiresRow(row("5.000%", "2030", "year"), "partially redeemed its 5.000% notes due 2030"), "[3c] 'partially' does not retire");

// ============================================================================
// 4. Non-matches are unaffected — this narrows retirement, it does not widen
//    matching.
// ============================================================================
assert(!redemptionRetiresRow(row("7.000%", "2033", "year"), TENET_REDEEMS), "[4a] a tranche the text never mentions is not retired");
assert(!redemptionRetiresRow(row("6.125%", null, null), TENET_REDEEMS), "[4b] a row with no stated maturity can never be retired — nothing to confirm against");
assert(!redemptionRetiresRow(row("6.125%", "2028", "year"), ""), "[4c] empty redemption text retires nothing");

// --- A rate that appears in the text against a DIFFERENT maturity must not
// cross-match. Tenet's two 2027 tranches are why matching is never on amount
// and never on rate alone. ---
assert(
  !redemptionRetiresRow(row("6.250%", "2031", "year"), TENET_REDEEMS),
  "[5] the 6.250% rate paired with a maturity the text doesn't name is NOT retired"
);

// ============================================================================
// 6. AMBIGUITY FAILS SAFE. A match whose clause can't be isolated does not
//    retire — wrongly retiring silently removes real debt, wrongly keeping
//    shows a row the filing itself still lists.
// ============================================================================
{
  // Both tranches named with no separable clause structure at all.
  const jumbled = "6.125% notes due 2028 6.250% notes due 2028 partial";
  assert(!redemptionRetiresRow(row("6.125%", "2028", "year"), jumbled), "[6] an unseparable clause naming a partial does not retire");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL PARTIAL-REDEMPTION GOLDEN TESTS PASSED");
