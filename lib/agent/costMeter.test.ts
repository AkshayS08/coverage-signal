/**
 * Session 18 golden tests — lib/agent/costMeter.ts. Pure arithmetic against
 * hand-computed expected values; no API calls, no network.
 *
 * Run: npx tsx lib/agent/costMeter.test.ts
 */
import { beginCompanyCostScope, recordUsage, currentCompanySpend, formatUsd, formatCompanyCostLine } from "./costMeter";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}
/** Money comparison to the tenth of a cent — these are floating-point sums of per-token rates. */
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

console.log("=== costMeter golden tests ===\n");

// --- 1. Haiku arithmetic, hand-computed: 100,000 input @ $1/MTok = $0.10;
// 10,000 output @ $5/MTok = $0.05. Total $0.15. ---
{
  beginCompanyCostScope("TEST CO");
  recordUsage("claude-haiku-4-5", { input_tokens: 100_000, output_tokens: 10_000 });
  const s = currentCompanySpend();
  assert(near(s.totalUsd, 0.15), `[1a] Haiku 100k in + 10k out = $0.15 (got ${s.totalUsd})`);
  assert(s.totalCalls === 1, "[1b] one call counted");
}

// --- 2. Sonnet is priced separately, and the two accumulate independently
// within one company: Sonnet 10,000 in @ $3 = $0.03; 1,000 out @ $15 =
// $0.015. Added to case 1's $0.15 -> $0.195. ---
{
  recordUsage("claude-sonnet-5", { input_tokens: 10_000, output_tokens: 1_000 });
  const s = currentCompanySpend();
  assert(near(s.totalUsd, 0.195), `[2a] Haiku + Sonnet accumulate to $0.195 (got ${s.totalUsd})`);
  assert(s.byModel.length === 2, "[2b] both models tracked separately");
  assert(s.totalCalls === 2, "[2c] two calls total");
}

// --- 3. Repeat calls to the SAME model aggregate rather than replace —
// the dig loop can call Haiku several times for one company. ---
{
  beginCompanyCostScope("TEST CO");
  recordUsage("claude-haiku-4-5", { input_tokens: 100_000, output_tokens: 0 });
  recordUsage("claude-haiku-4-5", { input_tokens: 100_000, output_tokens: 0 });
  const s = currentCompanySpend();
  assert(near(s.totalUsd, 0.2) && s.byModel[0].calls === 2, `[3] two Haiku calls aggregate to $0.20 / 2 calls (got ${s.totalUsd} / ${s.byModel[0].calls})`);
}

// --- 4. Cache tokens are priced off the model's own INPUT rate at their
// own multipliers: 1M cache-read @ 0.1x$1 = $0.10; 1M cache-write @
// 1.25x$1 = $1.25. Tracked even though prompt caching is currently OFF, so
// the columns are correct the day it's switched on. ---
{
  beginCompanyCostScope("TEST CO");
  recordUsage("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 });
  assert(near(currentCompanySpend().totalUsd, 0.1), `[4a] cache read is 0.1x input rate (got ${currentCompanySpend().totalUsd})`);
  beginCompanyCostScope("TEST CO");
  recordUsage("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 });
  assert(near(currentCompanySpend().totalUsd, 1.25), `[4b] cache write is 1.25x input rate (got ${currentCompanySpend().totalUsd})`);
}

// --- 5. beginCompanyCostScope RESETS — per-company figures must never
// carry the previous company's spend. This is the invariant that makes a
// module-level accumulator safe under sequential runs. ---
{
  beginCompanyCostScope("COMPANY A");
  recordUsage("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 0 });
  assert(near(currentCompanySpend().totalUsd, 1.0), "[5a] company A billed $1.00");
  beginCompanyCostScope("COMPANY B");
  const b = currentCompanySpend();
  assert(b.totalUsd === 0 && b.totalCalls === 0, `[5b] company B starts at zero — no bleed from A (got ${b.totalUsd} / ${b.totalCalls})`);
  assert(b.company === "COMPANY B", "[5c] scope carries the right company name");
}

// --- 6. An UNKNOWN model is counted in tokens, charged nothing, and
// FLAGGED — a silently-unpriced model would make the total quietly wrong,
// which is worse than a visibly incomplete one. ---
{
  beginCompanyCostScope("TEST CO");
  recordUsage("some-future-model", { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  const s = currentCompanySpend();
  assert(s.totalUsd === 0, "[6a] an unpriced model contributes $0 rather than a guessed rate");
  assert(s.hasUnpricedModel && s.unpricedModels.includes("some-future-model"), "[6b] and it is flagged by name");
  assert(s.byModel[0].inputTokens === 1_000_000, "[6c] its tokens are still counted");
  assert(/UNPRICED MODEL/.test(formatCompanyCostLine(s)), "[6d] the log line states the total understates");
}

// --- 7. A missing/absent usage block is ignored rather than crashing the
// extraction — the meter must never be able to break a run. ---
{
  beginCompanyCostScope("TEST CO");
  recordUsage("claude-haiku-4-5", undefined);
  recordUsage("claude-haiku-4-5", null);
  const s = currentCompanySpend();
  assert(s.totalCalls === 0 && s.totalUsd === 0, "[7] absent usage is a no-op, never a throw");
}

// --- 8. A fully-cached company (zero calls) must read as CACHED, not as a
// free extraction — the distinction a bare "$0.00" would erase. ---
{
  beginCompanyCostScope("CACHED CO");
  assert(/fully cached/.test(formatCompanyCostLine()), `[8] zero-call company reads as cached (got: "${formatCompanyCostLine()}")`);
}

// --- 9. Sub-cent formatting: real per-company figures land well under a
// cent on cached runs, and 2-dp would render them "$0.00" — indistinguishable
// from free. ---
assert(formatUsd(0.0034) === "$0.0034", `[9a] sub-cent keeps 4dp (got ${formatUsd(0.0034)})`);
assert(formatUsd(1.234) === "$1.23", `[9b] dollar figures use 2dp (got ${formatUsd(1.234)})`);

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`); process.exit(1); }
else console.log("\nALL COST-METER GOLDEN TESTS PASSED");
