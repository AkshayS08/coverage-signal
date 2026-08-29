/**
 * SESSION 19 (run B diagnosis) — the embedded-subtotal re-typing.
 *
 * Centene's v17 note emitted "Total senior notes 14,204" as kind="row",
 * exactly the sum of the seven rows above it, so the walk counted it
 * alongside them and reported $30.4B against a stated $16.0B. These
 * assertions cover the correction AND the false-positive mode it creates.
 *
 * Run: npx tsx lib/events/subtotalRetype.test.ts
 */
import { retypeEmbeddedSubtotals, computeWalkChecksum, resetRetypeLog } from "./position";
import type { SubtotalRetype } from "./position";
import type { VerifiedSequenceEntry } from "../agent";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

function entry(over: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry {
  return {
    kind: "row", rate: null, seniority: null, amount: "$1 million",
    maturityDate: "2030-01-01", dateGranularity: "day",
    sourceLine: `synthetic: ${over.label}`, citedUrl: "https://example.com/f",
    section: null, periodColumn: null, ...over,
  };
}

/** Centene's real note, transcribed as v17 actually emitted it. */
const CENTENE: VerifiedSequenceEntry[] = [
  entry({ label: "$ 2,500 million 4.25 % Senior Notes due December 15, 2027", amount: "$ 1,067 million" }),
  entry({ label: "$ 2,300 million 2.45 % Senior Notes due July 15, 2028", amount: "$ 2,160 million" }),
  entry({ label: "$ 3,500 million 4.625 % Senior Notes due December 15, 2029", amount: "$ 3,277 million" }),
  entry({ label: "$ 2,000 million 3.375 % Senior Notes due February 15, 2030", amount: "$ 2,000 million" }),
  entry({ label: "$ 2,200 million 3.00 % Senior Notes due October 15, 2030", amount: "$ 2,200 million" }),
  entry({ label: "$ 2,200 million 2.50 % Senior Notes due March 1, 2031", amount: "$ 2,200 million" }),
  entry({ label: "$ 1,300 million 2.625 % Senior Notes due August 1, 2031", amount: "$ 1,300 million" }),
  entry({ label: "Total senior notes", amount: "$ 14,204 million" }),           // ← emitted as kind="row"
  entry({ label: "Term Loan Facility", amount: "$ 1,975 million" }),
  entry({ label: "Debt issuance costs", amount: "( $ 74 ) million", kind: "adjustment" }),
  entry({ label: "Total debt", amount: "$ 16,105 million", kind: "subtotal" }),
  entry({ label: "Less: current portion", amount: "( $ 75 ) million", kind: "adjustment" }),
  entry({ label: "Long-term debt", amount: "$ 16,030 million", kind: "subtotal" }),
];

console.log("\n=== [1] REAL: Centene's mistyped inner subtotal ===");
{
  resetRetypeLog();
  const seen: SubtotalRetype[] = [];
  const out = retypeEmbeddedSubtotals(CENTENE, (r) => seen.push(r));
  const retyped = out.find((e) => e.label === "Total senior notes");
  assert(retyped?.kind === "subtotal", `[1a] "Total senior notes" is re-typed to subtotal (got ${retyped?.kind})`);
  assert(seen.length === 1, `[1b] exactly one re-typing reported, not a cascade (got ${seen.length})`);
  // parseMoneyAmount resolves to ABSOLUTE DOLLARS, so "$14,204 million" is 1.4204e10.
  assert(seen[0]?.rowsSummed === 7 && seen[0]?.runningSum === 14_204_000_000,
    `[1c] the log states WHAT it summed: 7 rows to $14,204M (got ${seen[0]?.rowsSummed} rows to ${seen[0]?.runningSum})`);
  assert(out.filter((e) => e.kind === "row").length === 8,
    `[1d] the eight genuine rows are untouched — seven notes plus the term loan (got ${out.filter((e) => e.kind === "row").length})`);
}

console.log("\n=== [2] REAL: Check 1 ties once the entry is typed correctly ===");
{
  resetRetypeLog();
  const before = computeWalkChecksum(CENTENE.map((e) => e.label === "Total senior notes" ? { ...e } : e));
  // computeWalkChecksum normalizes internally, so the "before" case is
  // reconstructed by walking the raw sequence through the same arithmetic
  // the walk would have done WITHOUT the fix: rows summed, subtotal included.
  const rawRowSum = CENTENE.filter((e) => e.kind === "row")
    .map((e) => Number(String(e.amount).replace(/[^0-9.]/g, "")))
    .reduce((a, b) => a + b, 0);
  assert(rawRowSum === 30383, `[2a] CONTROL: untyped, the nine "rows" sum to 30,383 against a stated 16,030 — the defect (got ${rawRowSum})`);
  assert(before.pass === true, `[2b] with the re-typing applied, Check 1 TIES (pass=${before.pass})`);
  assert(before.rowCount === 8, `[2c] the walk now counts 8 rows, not 9 (got ${before.rowCount})`);
}

console.log("\n=== [3] The false-positive mode, bounded ===");
{
  resetRetypeLog();
  const seen: SubtotalRetype[] = [];
  // A single preceding row whose amount is repeated by the next row. Two
  // equal tranches in sequence are common; this must NOT re-type.
  retypeEmbeddedSubtotals([
    entry({ label: "5.0% Notes due 2029", amount: "$500 million" }),
    entry({ label: "5.5% Notes due 2031", amount: "$500 million" }),
  ], (r) => seen.push(r));
  assert(seen.length === 0, `[3a] two equal tranches in a row are NOT a subtotal — one preceding row is not evidence (got ${seen.length})`);

  const seen2: SubtotalRetype[] = [];
  retypeEmbeddedSubtotals([
    entry({ label: "A", amount: "$100 million" }),
    entry({ label: "B", amount: "$200 million" }),
    entry({ label: "C", amount: "$299 million" }),
  ], (r) => seen2.push(r));
  assert(seen2.length === 0, `[3b] a NEAR miss (299 against 300) does not re-type — the epsilon is float representation, not a tolerance (got ${seen2.length})`);

  const seen3: SubtotalRetype[] = [];
  const out3 = retypeEmbeddedSubtotals([
    entry({ label: "A", amount: "$100 million" }),
    entry({ label: "B", amount: "$200 million" }),
    entry({ label: "Total Return Swap Facility", amount: "$300 million" }),
  ], (r) => seen3.push(r));
  assert(seen3.length === 1 && out3[2].kind === "subtotal",
    `[3c] KNOWN, ACCEPTED: a genuine row that coincidentally equals the rows above it IS re-typed. Arithmetic is the test, so this case is unavoidable — it is why every re-typing logs (got ${seen3.length})`);
}

console.log("\n=== [4] Structure ===");
{
  resetRetypeLog();
  const once = retypeEmbeddedSubtotals(CENTENE);
  const twice = retypeEmbeddedSubtotals(once);
  assert(JSON.stringify(once) === JSON.stringify(twice),
    "[4a] idempotent — four read sites normalize the same sequence and must not disagree");

  const seen: SubtotalRetype[] = [];
  retypeEmbeddedSubtotals([
    entry({ label: "A", amount: "$100 million" }),
    entry({ label: "B", amount: "$200 million" }),
    entry({ label: "Issuance costs", amount: "($5 million)", kind: "adjustment" }),
    entry({ label: "C", amount: "$300 million" }),
  ], (r) => seen.push(r));
  assert(seen.length === 0, `[4b] an adjustment CLOSES the run — C does not sum against rows on the far side of it (got ${seen.length})`);

  const seen2: SubtotalRetype[] = [];
  retypeEmbeddedSubtotals([
    entry({ label: "A", amount: "$100 million" }),
    entry({ label: "B", amount: "no amount stated" }),
    entry({ label: "C", amount: "$100 million" }),
  ], (r) => seen2.push(r));
  assert(seen2.length === 0, `[4c] an indeterminate amount closes the run rather than being treated as zero (got ${seen2.length})`);

  assert(retypeEmbeddedSubtotals(undefined).length === 0, "[4d] undefined sequence is empty, never a crash");

  // FOUND BY THE BOOK-WIDE LOG, not by design: Cigna carries two matured
  // tranches stated "$ —". A run of nil rows sums to zero, so the third nil
  // row equalled the running sum and was re-typed out of the ladder.
  const seen3: SubtotalRetype[] = [];
  const out4 = retypeEmbeddedSubtotals([
    entry({ label: "4.125 % Notes due November 2025", amount: "$ —" }),
    entry({ label: "1.250 % Notes due March 2026", amount: "$ —" }),
    entry({ label: "3.05 % Notes due October 2027", amount: "$ —" }),
  ], (r) => seen3.push(r));
  assert(seen3.length === 0 && out4.every((e) => e.kind === "row"),
    `[4e] REGRESSION: nil-balance rows never re-type each other — a repaid tranche must render as repaid, not vanish into a subtotal of zero (got ${seen3.length})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
