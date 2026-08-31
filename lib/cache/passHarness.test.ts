/**
 * SESSION 19, ITEM 1b — fault injection for the pass harness.
 *
 * Offline and free: no network, no model, no cache. That is the point. The
 * harness's behaviour WHEN A FETCH FAILS is the one condition a live
 * determinism run cannot be made to reproduce on demand — the flake that
 * motivated this appeared once in eight passes and never again.
 *
 * Run: npx tsx lib/cache/passHarness.test.ts
 */
import { CompanyFetchError, formatPassErrors, runPassWithRetries } from "./passHarness";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** The bytes a clean pass produces — identical every time, by construction. */
const CLEAN_JSON = JSON.stringify([{ company: "SYNTHETIC CO.", rows: 3 }], null, 2);
const silent = () => {};

async function main() {
  console.log("=== pass harness, fault injection ===\n");

  // ==========================================================================
  // 1. ONE FETCH THROWS MID-PASS — the pass retries, and the compared bytes
  //    are exactly what a fault-free pass would have produced.
  // ==========================================================================
  {
    let attempts = 0;
    const result = await runPassWithRetries(async () => {
      attempts++;
      // Fail the FIRST attempt part-way through the book, the way a real
      // EDGAR or blob timeout does.
      if (attempts === 1) throw new CompanyFetchError("Universal Health Services", new Error("fetch failed: ETIMEDOUT"));
      return { json: CLEAN_JSON, elapsedMs: 10, hitSummary: "answer cache 10/10 (100%) hit", asOf: "2026-08-31" };
    }, 3, silent);

    assert(result.status === "clean", `[1a] a pass whose fetch throws once still completes CLEAN on retry (got ${result.status})`);
    assert(result.status === "clean" && result.attempts === 2, "[1b] ...on the second attempt");
    const cleanJson = result.status === "clean" ? result.json : "";
    assert(cleanJson === CLEAN_JSON, "[1c] ...and the compared bytes are byte-identical to a fault-free pass");
    assert(
      result.errors.length === 1 && result.errors[0].company === "Universal Health Services",
      `[1d] the failure is logged to the separate channel, naming the company (got ${JSON.stringify(result.errors.map((e) => e.company))})`
    );
    assert(
      !cleanJson.includes("ETIMEDOUT") && !cleanJson.includes("error"),
      "[1e] REGRESSION: the error text is nowhere in the compared bytes — pushing it in there is what reported a network blip as non-determinism"
    );
  }

  // ==========================================================================
  // 2. THE TIMESTAMP IS WHY THE LOG IS A SEPARATE CHANNEL.
  // ==========================================================================
  {
    const err = new CompanyFetchError("DaVita", new Error("socket hang up"));
    const r1 = await runPassWithRetries(async () => { throw err; }, 1, silent);
    const r2 = await runPassWithRetries(async () => { throw err; }, 1, silent);
    assert(typeof r1.errors[0].timestamp === "string" && r1.errors[0].timestamp.length > 0, "[2a] the log carries a timestamp");
    assert(formatPassErrors(r1.errors).join("\n").includes("DaVita"), "[2b] the rendered log names the company and its error");
    assert(
      r1.errors[0].timestamp <= r2.errors[0].timestamp,
      "[2c] two identical faults produce logs differing by time — exactly why this must never be part of a byte comparison"
    );
  }

  // ==========================================================================
  // 3. A PASS THAT NEVER COMPLETES IS INCOMPLETE, NOT FAILED.
  // ==========================================================================
  {
    let attempts = 0;
    const result = await runPassWithRetries(async () => {
      attempts++;
      throw new CompanyFetchError("HCA Healthcare", new Error("fetch failed: ENOTFOUND"));
    }, 3, silent);
    assert(result.status === "incomplete", `[3a] a pass that cannot complete after its retries reports INCOMPLETE, never FAIL (got ${result.status})`);
    assert(attempts === 3, `[3b] ...having retried up to twice, three attempts total (got ${attempts})`);
    assert(result.errors.length === 3, `[3c] ...with every attempt's failure in the log (got ${result.errors.length})`);
    assert(!("json" in result), "[3d] an INCOMPLETE pass carries NO compared bytes — there is nothing to compare, and offering something would invite comparing it");
  }

  // ==========================================================================
  // 4. REVERSE — a clean pass is untouched by any of this.
  // ==========================================================================
  {
    let calls = 0;
    const result = await runPassWithRetries(async () => { calls++; return { json: CLEAN_JSON, elapsedMs: 5, hitSummary: "hit", asOf: "2026-08-31" }; }, 3, silent);
    assert(result.status === "clean" && result.attempts === 1, "[4a] REVERSE: a pass with no fault runs exactly once");
    assert(calls === 1, `[4b] REVERSE: ...the runner is called once, never speculatively retried (got ${calls})`);
    assert(result.errors.length === 0 && formatPassErrors(result.errors).length === 0, "[4c] REVERSE: ...and its error log is empty, so a clean report stays clean");
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  } else {
    console.log("\nALL PASS-HARNESS FAULT-INJECTION TESTS PASSED");
  }
}

main();
