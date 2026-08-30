/**
 * SESSION 19 — a stated deduction is negative, however it is punctuated.
 *
 * Tenet's note prints "Unamortized issue costs ( 85 )" and, two lines
 * later, "Less: Current portion 160" — both conventions in one table. The
 * walk read the sign only from punctuation and reported "off by $320M",
 * twice the figure, which is what a dropped sign looks like.
 *
 * Run: npx tsx lib/events/deductionSign.test.ts
 */
import { applyStatedDeductionSigns, normalizeScheduleSequence, computeWalkChecksum, parseMoneyAmount } from "./position";
import type { DeductionSignFix } from "./position";
import type { VerifiedSequenceEntry } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}
function entry(o: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry {
  return { kind: "row", rate: null, seniority: null, amount: "$1 million", maturityDate: "2030-01-01",
    dateGranularity: "day", sourceLine: `s: ${o.label}`, citedUrl: "u", section: null, periodColumn: null, ...o };
}

/** Tenet's note, transcribed exactly as v19 returned it. */
const TENET: VerifiedSequenceEntry[] = [
  entry({ label: "6.125 % due 2028", amount: "$ 1,750 million" }),
  entry({ label: "6.875 % due 2031", amount: "$ 362 million" }),
  entry({ label: "6.000 % due 2033", amount: "$ 750 million" }),
  entry({ label: "5.125 % due 2027", amount: "$ 1,500 million" }),
  entry({ label: "4.625 % due 2028", amount: "$ 600 million" }),
  entry({ label: "4.250 % due 2029", amount: "$ 1,400 million" }),
  entry({ label: "4.375 % due 2030", amount: "$ 1,450 million" }),
  entry({ label: "6.125 % due 2030", amount: "$ 2,000 million" }),
  entry({ label: "6.750 % due 2031", amount: "$ 1,350 million" }),
  entry({ label: "5.500 % due 2032", amount: "$ 1,500 million" }),
  entry({ label: "Finance leases, mortgages and other notes", amount: "$ 671 million" }),
  entry({ label: "Unamortized issue costs and note discounts", amount: "( $ 85 ) million", kind: "adjustment" }),
  entry({ label: "Total long-term debt", amount: "$ 13,248 million", kind: "subtotal" }),
  entry({ label: "Less: Current portion", amount: "$ 160 million", kind: "adjustment" }),   // ← unsigned in the filing
  entry({ label: "Long-term debt, net of current portion", amount: "$ 13,088 million", kind: "subtotal" }),
];

console.log("\n=== [1] REAL: Tenet's split ties once the label is read ===");
{
  const before = computeWalkChecksum(TENET.map((e) => ({ ...e })));
  assert(before.pass === true, `[1a] THE FIX: Check 1 ties — 13,248 − 160 = 13,088 (pass=${before.pass})`);
  const fixes: DeductionSignFix[] = [];
  applyStatedDeductionSigns(TENET, (f) => fixes.push(f));
  assert(fixes.length === 1 && fixes[0].label === "Less: Current portion",
    `[1b] exactly one correction, and it names the line (got ${fixes.length})`);
  const out = applyStatedDeductionSigns(TENET);
  const cur = out.find((e) => e.label === "Less: Current portion")!;
  assert(parseMoneyAmount(cur.amount)! < 0, `[1c] the current portion parses NEGATIVE (${cur.amount})`);
}

console.log("\n=== [2] The already-parenthesised line is untouched ===");
{
  const out = applyStatedDeductionSigns(TENET);
  const disc = out.find((e) => e.label === "Unamortized issue costs and note discounts")!;
  assert(disc.amount === "( $ 85 ) million" && parseMoneyAmount(disc.amount)! < 0,
    `[2a] a line the filing ALREADY parenthesises is left exactly as printed — never double-negated back to positive (${disc.amount})`);
  const twice = applyStatedDeductionSigns(applyStatedDeductionSigns(TENET));
  assert(JSON.stringify(twice) === JSON.stringify(out), "[2b] idempotent — applying twice is applying once");
}

console.log("\n=== [3] Scope: the rule is narrow on purpose ===");
{
  const fixes: DeductionSignFix[] = [];
  applyStatedDeductionSigns([entry({ label: "Less: Current portion", amount: "$ 160 million" })], (f) => fixes.push(f));
  assert(fixes.length === 0, `[3a] a ROW is a position, never a deduction — only adjustments are signed (got ${fixes.length})`);

  const f2: DeductionSignFix[] = [];
  applyStatedDeductionSigns([entry({ label: "Notes issued at less than par", amount: "$ 40 million", kind: "adjustment" })], (f) => f2.push(f));
  assert(f2.length === 0, `[3b] the marker must LEAD the label — "less" inside a sentence is not a deduction (got ${f2.length})`);

  const f3: DeductionSignFix[] = [];
  applyStatedDeductionSigns([entry({ label: "Less: Current portion", amount: "$ —", kind: "adjustment" })], (f) => f3.push(f));
  assert(f3.length === 0, `[3c] a nil deduction is left alone — negating zero states a change the filing does not (got ${f3.length})`);

  const f4: DeductionSignFix[] = [];
  const out4 = applyStatedDeductionSigns([entry({ label: "Deduct: unamortized discount", amount: "$ 12 million", kind: "adjustment" })], (f) => f4.push(f));
  assert(f4.length === 1 && parseMoneyAmount(out4[0].amount)! < 0,
    "[3d] the rule is the CONVENTION, not the company — 'Deduct:' is signed the same way 'Less:' is");
}

console.log("\n=== [4] One normalizer, both corrections ===");
{
  const mixed: VerifiedSequenceEntry[] = [
    entry({ label: "A", amount: "$ 100 million" }),
    entry({ label: "B", amount: "$ 200 million" }),
    entry({ label: "Total A and B", amount: "$ 300 million" }),          // mistyped subtotal
    entry({ label: "Less: current portion", amount: "$ 50 million", kind: "adjustment" }), // unsigned deduction
  ];
  const out = normalizeScheduleSequence(mixed);
  assert(out[2].kind === "subtotal", "[4a] normalizeScheduleSequence re-types the embedded subtotal");
  assert(parseMoneyAmount(out[3].amount)! < 0, "[4b] and signs the stated deduction — one call, both shape corrections");
  assert(JSON.stringify(normalizeScheduleSequence(out)) === JSON.stringify(out),
    "[4c] idempotent together, which is what lets every reader apply it without coordinating");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
