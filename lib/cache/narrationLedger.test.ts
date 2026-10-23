/**
 * SESSION 27 (Akshay, Oct 23, 2026) — NARRATION SPEND IS RECORDED IN THE
 * LEDGER FROM NOW ON.
 *
 * The narration call records its usage into the current cost scope, but
 * nothing persisted that scope after narration: runAgentLoop persists at its
 * own end, and narration runs after it (captureBookSnapshot, the run route).
 * So narration billed outside the ledger (Rule 43 said so; Rule 68 says it
 * may not).
 *
 *   NL1  withLedgerDelta writes exactly the spend incurred inside it, as one
 *        line under its own label, priced as the meter prices it
 *   NL2  and writes it when the call inside throws, before rethrowing
 *   NL3  the wording cache's narration path goes through it (read off the source)
 *   control: a call that bills nothing writes no line
 *
 * Offline, $0: writes to a scratch ledger, never baselines/cost-log.jsonl.
 *
 * Run: npx tsx lib/cache/narrationLedger.test.ts
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "nl-"));
process.env.COST_LOG_PATH = join(dir, "ledger.jsonl");

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const lines = () => (existsSync(process.env.COST_LOG_PATH!) ? readFileSync(process.env.COST_LOG_PATH!, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

(async () => {
  const meter = await import("../agent/costMeter");
  const withLedgerDelta = (meter as any).withLedgerDelta as (<T>(label: string, fn: () => Promise<T>) => Promise<T>) | undefined;
  meter.beginCompanyCostScope("TEST CO");

  console.log("\n=== NL1 ===");
  const n0 = lines().length;
  await withLedgerDelta?.("TEST CO (narration)", async () => { meter.recordUsage("claude-sonnet-5", { input_tokens: 2000, output_tokens: 300 }); return 1; });
  const l1 = lines().slice(n0);
  assert(!!withLedgerDelta && l1.length === 1 && l1[0].company === "TEST CO (narration)" && Math.abs(l1[0].totalUsd - 0.0105) < 1e-9 && l1[0].totalCalls === 1, `[NL1] one line, "TEST CO (narration)", $0.0105 for 2,000 in / 300 out on Sonnet (got ${JSON.stringify(l1.map((x) => [x.company, x.totalUsd]))})`);

  console.log("\n=== NL2 ===");
  const n1 = lines().length;
  let threw = false;
  try { await withLedgerDelta?.("TEST CO (narration)", async () => { meter.recordUsage("claude-sonnet-5", { input_tokens: 1000, output_tokens: 0 }); throw new Error("write failed after the call"); }); } catch { threw = true; }
  const l2 = lines().slice(n1);
  assert(!!withLedgerDelta && threw && l2.length === 1 && Math.abs(l2[0].totalUsd - 0.003) < 1e-9, `[NL2] a call that billed and then threw still writes its line ($0.003) and rethrows`);

  console.log("\n=== control ===");
  const n2 = lines().length;
  await withLedgerDelta?.("TEST CO (narration)", async () => 1);
  assert(!!withLedgerDelta && lines().length === n2, `[control] a call that bills nothing writes no line`);

  console.log("\n=== NL3 ===");
  const src = readFileSync("lib/cache/wordingCache.ts", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(/withLedgerDelta\s*\(/.test(src) && /\(narration\)/.test(src), `[NL3] the wording cache's narration path records its spend through withLedgerDelta`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
