/**
 * Session 14, Step 5 acceptance protocol, run as written:
 *   1. Book A (5 names), 3 runs — byte-identical.
 *   2. Book B (5 different names), 3 runs — byte-identical.
 *   3. Book A a 4th time, after book B — still identical to runs 1-3.
 *
 * Real-cost script (see determinism.test.ts's doc comment for why this is
 * kept separate from `npm test`). Prints cache hit/miss and cold-vs-warm
 * timing for every run, and a final pass/fail per requirement.
 *
 * Run: npx tsx lib/cache/acceptance.test.ts
 */
loadEnvQuietly();

import { formatPassErrors, runPassWithRetries, type PassResult } from "./passHarness";
import { captureBookSnapshot, loadEnvQuietly } from "./bookSnapshot";

const BOOK_A = ["DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health"];
const BOOK_B = ["Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare"];

const runBookOnce = captureBookSnapshot;

function diffFirstLine(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i}:\n  a: ${al[i]}\n  b: ${bl[i]}`;
  }
  return "(no textual diff found — lengths differ?)";
}

/**
 * Session 19, item 1b: returns CLEAN passes only. A pass that could not
 * complete after its retries is reported INCOMPLETE and excluded from the
 * comparison — a sample that was never taken is not evidence either way.
 */
async function runBookNTimes(label: string, companies: string[], n: number): Promise<{ jsons: string[]; incomplete: PassResult[] }> {
  console.log(`\n=== ${label}: [${companies.join(", ")}] ===`);
  const jsons: string[] = [];
  const incomplete: PassResult[] = [];
  for (let i = 1; i <= n; i++) {
    const pass = await runPassWithRetries(() => runBookOnce(companies));
    if (pass.status === "clean") {
      jsons.push(pass.json);
      const retried = pass.attempts > 1 ? ` (clean on attempt ${pass.attempts} of ${pass.attempts})` : "";
      console.log(`  run ${i}: ${pass.elapsedMs}ms — ${pass.hitSummary}${retried}`);
    } else {
      incomplete.push(pass);
      console.log(`  run ${i}: INCOMPLETE after ${pass.attempts} attempts — excluded from the comparison`);
    }
    for (const line of formatPassErrors(pass.errors)) console.log(line);
  }
  return { jsons, incomplete };
}

async function main() {
  // Session 19, item 1b: three outcomes, not two. INCOMPLETE says the sample
  // could not be taken; FAIL says it was taken and the code is
  // non-deterministic. Only the second is a defect in this repository, and
  // collapsing them is what let a network blip read as one.
  const results: { name: string; pass: boolean; incomplete?: boolean }[] = [];
  const allIncomplete: PassResult[] = [];

  const a = await runBookNTimes("BOOK A, runs 1-3", BOOK_A, 3);
  allIncomplete.push(...a.incomplete);
  const aComparable = a.jsons.length >= 2;
  const aIdentical = aComparable && a.jsons.every((j) => j === a.jsons[0]);
  results.push({ name: `Book A: ${a.jsons.length} clean runs byte-identical`, pass: aIdentical, incomplete: !aComparable });
  if (aComparable && !aIdentical) {
    for (let i = 1; i < a.jsons.length; i++) {
      if (a.jsons[i] !== a.jsons[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(a.jsons[0], a.jsons[i])}`);
    }
  }

  const b = await runBookNTimes("BOOK B, runs 1-3", BOOK_B, 3);
  allIncomplete.push(...b.incomplete);
  const bComparable = b.jsons.length >= 2;
  const bIdentical = bComparable && b.jsons.every((j) => j === b.jsons[0]);
  results.push({ name: `Book B: ${b.jsons.length} clean runs byte-identical`, pass: bIdentical, incomplete: !bComparable });
  if (bComparable && !bIdentical) {
    for (let i = 1; i < b.jsons.length; i++) {
      if (b.jsons[i] !== b.jsons[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(b.jsons[0], b.jsons[i])}`);
    }
  }

  console.log(`\n=== BOOK A, run 4 (after book B) ===`);
  const a4 = await runPassWithRetries(() => runBookOnce(BOOK_A));
  for (const line of formatPassErrors(a4.errors)) console.log(line);
  if (a4.status === "clean") {
    console.log(`  run 4: ${a4.elapsedMs}ms — ${a4.hitSummary}`);
  } else {
    allIncomplete.push(a4);
    console.log(`  run 4: INCOMPLETE after ${a4.attempts} attempts — excluded from the comparison`);
  }
  const a4Comparable = a4.status === "clean" && aComparable;
  const a4Identical = a4Comparable && a4.status === "clean" && a4.json === a.jsons[0];
  results.push({ name: "Book A: run 4 (post-book-B) still identical to runs 1-3", pass: a4Identical, incomplete: !a4Comparable });
  if (a4Comparable && !a4Identical && a4.status === "clean") {
    console.log(`  ✗ run 4 vs run 1 — ${diffFirstLine(a.jsons[0], a4.json)}`);
  }

  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    console.log(`  ${r.incomplete ? "⊘ INCOMPLETE" : r.pass ? "✓ PASS" : "✗ FAIL"} — ${r.name}`);
  }

  if (allIncomplete.length > 0) {
    console.log(`\n${allIncomplete.length} pass(es) could not complete cleanly. Full error log:`);
    for (const p of allIncomplete) for (const line of formatPassErrors(p.errors)) console.log(line);
  }

  const anyIncomplete = results.some((r) => r.incomplete);
  const anyFailed = results.some((r) => !r.incomplete && !r.pass);
  if (anyFailed) {
    console.log("\nACCEPTANCE FAILED — clean passes differ from each other");
    process.exit(1);
  } else if (anyIncomplete) {
    console.log("\nACCEPTANCE INCOMPLETE — the sample could not be taken; this is not a determinism failure");
    process.exit(2);
  } else {
    console.log("\nACCEPTANCE PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
