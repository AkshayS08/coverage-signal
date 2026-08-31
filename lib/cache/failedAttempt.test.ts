/**
 * SESSION 20 (1b) — A COMPANY ATTEMPTED AND FAILED RENDERS AS A FAILED
 * ATTEMPT, ON BOTH SURFACES.
 *
 * The rendered surface: the assessed count counts ATTEMPTS, and what failed
 * is named where the count is. The persistence surface: a baseline is
 * written only from a clean pass, and a narration failure blocks the write
 * exactly as an incomplete fetch does.
 *
 * Run: npx tsx lib/cache/failedAttempt.test.ts
 */
import { runPassWithRetries, CompanyFetchError, CompanyNarrationError, formatPassErrors } from "./passHarness";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}
const silent = () => {};
const CLEAN = { json: '[{"company":"A"}]', elapsedMs: 1, hitSummary: "hit", asOf: "2026-08-31" };

async function main() {
  console.log("\n=== [1] A narration failure invalidates the pass, exactly as a fetch failure does ===");
  {
    let calls = 0;
    const r = await runPassWithRetries(async () => {
      calls++;
      if (calls === 1) throw new CompanyNarrationError("Tenet Healthcare", "thc::debt-maturity", "structural check failed after one retry");
      return CLEAN;
    }, 3, silent);
    assert(r.status === "clean", `[1a] the pass RETRIES — a failed briefing is never cached, so a fresh pass is a fresh attempt (status=${r.status})`);
    assert(r.status === "clean" && r.attempts === 2, `[1a2] and it took two attempts`);
    assert(r.errors.length === 1 && r.errors[0].company === "Tenet Healthcare",
      `[1b] the failure is logged to the separate channel, naming the company (got ${r.errors[0]?.company})`);
    assert(r.status === "clean" && !r.json.includes("Tenet Healthcare"),
      "[1c] and it never enters the compared bytes — the whole reason the log is a separate channel");
  }

  console.log("\n=== [2] A pass that cannot narrate cleanly is INCOMPLETE, never a baseline ===");
  {
    const r = await runPassWithRetries(async () => {
      throw new CompanyNarrationError("Tenet Healthcare", "thc::debt-maturity", "structural check failed after one retry");
    }, 3, silent);
    assert(r.status === "incomplete", `[2a] THE RULE: three narration failures is INCOMPLETE, so no baseline is written (status=${r.status})`);
    assert(r.errors.length === 3, `[2b] every attempt is logged, not just the last (got ${r.errors.length})`);
    assert(formatPassErrors(r.errors).join(" ").includes("structural check failed"),
      "[2c] the error log carries the reason, so the next reader knows which fix this needs");
  }

  console.log("\n=== [3] The two failure kinds do not read alike ===");
  {
    const lines: string[] = [];
    await runPassWithRetries(async () => { throw new CompanyFetchError("DaVita", new Error("socket hang up")); }, 1, (l) => lines.push(l));
    const fetchLine = lines.join(" ");
    lines.length = 0;
    await runPassWithRetries(async () => { throw new CompanyNarrationError("Tenet Healthcare", "c", "guard rejected"); }, 1, (l) => lines.push(l));
    const narrLine = lines.join(" ");
    assert(fetchLine.includes("a fetch failure") && narrLine.includes("a narration failure"),
      "[3a] each names its KIND — they need different fixes and collapsing them misdiagnoses which happened");
    assert(fetchLine.includes("DaVita") && narrLine.includes("Tenet Healthcare"),
      "[3b] and each names its company, whichever error type carried it");
  }

  console.log("\n=== [4] The as-of date is pinned, so a month rollover is not a regression ===");
  {
    const r = await runPassWithRetries(async () => CLEAN, 1, silent);
    assert(r.status === "clean" && r.asOf === "2026-08-31",
      `[4a] the capture carries its own as-of date through the harness (got ${r.status === "clean" ? r.asOf : "n/a"})`);
    // The real proof: Session 20's first byte-identity check differed only
    // because the calendar rolled — CHS "29mo out" -> "28mo out".
    const meta = JSON.parse(readFileSync("baselines/s20-stage1a.meta.json", "utf8")) as { asOf: string };
    assert(/^\d{4}-\d{2}-\d{2}$/.test(meta.asOf),
      `[4b] and a written baseline records it beside the bytes, so a diff can say "different as-of" instead of "changed" (got ${meta.asOf})`);
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }

}
main();
