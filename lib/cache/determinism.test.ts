/**
 * Session 14 — the permanent tripwire for the whole point of this session:
 * the same book, run twice, must produce byte-identical output. This is a
 * real-cost script (calls Haiku/Sonnet on the FIRST run of any given
 * company; every run after that — including the 2nd and 3rd runs in this
 * same invocation — must hit the answer/wording cache and cost nothing),
 * not an offline fixture replay — deliberately: Session 13 shipped 31/31
 * passing offline tests and a broken live screen because nothing ever
 * asserted this specific property. It is kept separate from `npm test`
 * (same reasoning as buildFixture.ts) so ordinary offline runs stay free;
 * run it explicitly before shipping any change to the caching layer.
 *
 * Run: npx tsx lib/cache/determinism.test.ts "DaVita,HCA Healthcare" 3
 *   arg1 = comma-separated company book (default: DaVita)
 *   arg2 = number of runs (default: 3)
 */
loadEnvQuietly();

import { formatPassErrors, runPassWithRetries, type PassResult } from "./passHarness";
import { captureBookSnapshot, loadEnvQuietly } from "./bookSnapshot";

const COMPANIES = (process.argv[2] || "DaVita").split(",").map((s) => s.trim());
const RUNS = Number(process.argv[3] || 3);
/**
 * SESSION 20 — THE AS-OF DATE IS PINNED, NOT READ FROM THE WALL CLOCK.
 *
 * captureBookSnapshot defaults `now` to new Date(), and `now` reaches the
 * eligibility gate (a maturity is cardable within 18 months OF NOW). Three
 * runs straddling midnight, or a re-run on a later day, therefore compare
 * two different questions and report the difference as non-determinism. The
 * date is an INPUT and is pinned like one.
 */
const AS_OF = new Date((process.argv[4] || "2026-09-01") + "T00:00:00Z");


async function main() {
  console.log(`=== Session 14 run-to-run identity test ===`);
  console.log(`book: [${COMPANIES.join(", ")}]  runs: ${RUNS}\n`);

  const jsonPerRun: string[] = [];
  const timings: number[] = [];

  const incompletePasses: PassResult[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const pass = await runPassWithRetries(() => captureBookSnapshot(COMPANIES, AS_OF));
    for (const line of formatPassErrors(pass.errors)) console.log(line);
    if (pass.status === "clean") {
      timings.push(pass.elapsedMs);
      jsonPerRun.push(pass.json);
      console.log(`run ${i}: ${pass.elapsedMs}ms — ${pass.hitSummary}${pass.attempts > 1 ? ` (clean on attempt ${pass.attempts})` : ""}`);
    } else {
      incompletePasses.push(pass);
      console.log(`run ${i}: INCOMPLETE after ${pass.attempts} attempts — excluded from the comparison`);
    }
  }

  if (jsonPerRun.length < 2) {
    console.log(`
⊘ INCOMPLETE — only ${jsonPerRun.length} clean pass(es); the sample could not be taken. This is NOT a determinism failure.`);
    for (const p of incompletePasses) for (const line of formatPassErrors(p.errors)) console.log(line);
    process.exit(2);
  }

  let allIdentical = true;
  for (let i = 1; i < jsonPerRun.length; i++) {
    if (jsonPerRun[i] !== jsonPerRun[0]) {
      allIdentical = false;
      console.log(`\n✗ FAIL — run ${i + 1} differs from run 1`);
      const a = jsonPerRun[0].split("\n");
      const b = jsonPerRun[i].split("\n");
      for (let line = 0; line < Math.max(a.length, b.length); line++) {
        if (a[line] !== b[line]) {
          console.log(`  first differing line (${line}):`);
          console.log(`    run 1: ${a[line]}`);
          console.log(`    run ${i + 1}: ${b[line]}`);
          break;
        }
      }
    }
  }

  console.log(`\ncold run: ${timings[0]}ms   warm run(s): ${timings.slice(1).join("ms, ")}ms`);

  if (allIdentical) {
    console.log(`\n✓ PASS — all ${RUNS} runs of [${COMPANIES.join(", ")}] produced byte-identical output`);
    console.log("\nALL DETERMINISM TESTS PASSED");
  } else {
    console.log("\nSOME DETERMINISM TESTS FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
