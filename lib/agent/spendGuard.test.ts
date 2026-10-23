/**
 * SESSION 27 (Akshay, Oct 23, 2026) — THE GATE IS PREVENTIVE.
 *
 * Before every billed call: count the input tokens, price the call from that
 * count at the model's rate with output at its max_tokens, and refuse any
 * call whose worst case would cross its per-run or running limit. Today's
 * Tenet proceeds-use refill was approved to $0.064 and billed $0.0738,
 * because the gate could only measure a call after it was made.
 *
 *   G1  the worst case is priced from the count: 24,405 tokens in on Sonnet,
 *       max_tokens 200 -> $0.073215 + $0.003000 = $0.076215
 *   G2  CONTROL THAT WOULD HAVE CAUGHT TODAY'S CALL: that call under a $0.064
 *       running limit is refused before it is made (no call reaches the model)
 *   G3  the same call under a limit it fits is made, and its actual cost is
 *       counted toward the limits
 *   G4  the running limit holds across calls; G5 the per-run limit too, and a
 *       new run resets it but not the running total
 *   G6  a count that cannot be taken is a refusal, never an unguarded call
 *   G7  price-only mode counts and records without calling
 *   G8  every billed call site in the code goes through guardedCreate
 *
 * Offline, $0: the model client is a stub. Run: npx tsx lib/agent/spendGuard.test.ts
 */
import { readFileSync } from "node:fs";
import * as guard from "./spendGuard";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const g = guard as any;
function stub(inputTokens: number | Error, usage = { input_tokens: 24405, output_tokens: 42 }) {
  const s = { created: 0, counted: 0, messages: {
    countTokens: async () => { s.counted++; if (inputTokens instanceof Error) throw inputTokens; return { input_tokens: inputTokens }; },
    create: async () => { s.created++; return { usage, content: [], stop_reason: "end_turn" }; },
  } };
  return s;
}
const params = (model: string, max_tokens: number) => ({ model, max_tokens, messages: [{ role: "user", content: "x" }] });
const refused = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };

(async () => {
  console.log("\n=== G1-G3 ===");
  g.resetSpendGuard?.();
  const c1 = stub(24405);
  g.setSpendLimits?.({ totalUsd: 0.064 });
  const e2 = await refused(g.guardedCreate?.(c1, params("claude-sonnet-5", 200)) ?? Promise.reject(new Error("no guard")));
  assert(!!g.guardedCreate && Math.abs((g.lastPriced?.()?.worstUsd ?? 0) - 0.076215) < 1e-9, `[G1] worst case priced from the count: $${(g.lastPriced?.()?.worstUsd ?? 0).toFixed(6)} for 24,405 in, max_tokens 200, on Sonnet`);
  assert(e2?.name === "SpendRefusedError" && c1.created === 0, `[G2] today's call under its $0.064 limit is refused before it is made (${e2?.name ?? "not refused"}; ${c1.created} call(s) made)`);
  g.resetSpendGuard?.();
  g.setSpendLimits?.({ totalUsd: 0.08 });
  const c3 = stub(24405);
  await g.guardedCreate?.(c3, params("claude-sonnet-5", 200));
  assert(c3.created === 1 && Math.abs((g.spentTotal?.() ?? 0) - 0.073845) < 1e-6, `[G3] under a limit it fits ($0.08) it is made, and its actual $${(g.spentTotal?.() ?? 0).toFixed(6)} counts toward the limits`);

  console.log("\n=== G4-G5 ===");
  g.resetSpendGuard?.();
  g.setSpendLimits?.({ totalUsd: 0.09 });
  const c4 = stub(10000, { input_tokens: 10000, output_tokens: 0 });
  await g.guardedCreate?.(c4, params("claude-sonnet-5", 100)); // worst 0.0315, actual 0.03
  await g.guardedCreate?.(c4, params("claude-sonnet-5", 100)); // spent 0.03 + worst 0.0315 = 0.0615 fits
  const e4 = await refused(g.guardedCreate?.(c4, params("claude-sonnet-5", 100))); // spent 0.06 + worst 0.0315 = 0.0915 > 0.09
  assert(c4.created === 2 && e4?.name === "SpendRefusedError", `[G4] the running limit holds: a third call whose worst case would cross $0.09 is refused (${c4.created} made)`);
  g.resetSpendGuard?.();
  g.setSpendLimits?.({ perRunUsd: 0.05, totalUsd: 1 });
  const c5 = stub(10000, { input_tokens: 10000, output_tokens: 0 });
  g.beginGuardRun?.("A");
  await g.guardedCreate?.(c5, params("claude-sonnet-5", 100));
  const e5 = await refused(g.guardedCreate?.(c5, params("claude-sonnet-5", 100)));
  g.beginGuardRun?.("B");
  await g.guardedCreate?.(c5, params("claude-sonnet-5", 100));
  assert(e5?.name === "SpendRefusedError" && c5.created === 2 && Math.abs((g.spentTotal?.() ?? 0) - 0.06) < 1e-9, `[G5] the per-run limit refuses the second call of run A; run B starts fresh; the running total is kept ($${(g.spentTotal?.() ?? 0).toFixed(2)})`);

  console.log("\n=== G6-G7 ===");
  g.resetSpendGuard?.();
  const c6 = stub(new Error("network down"));
  const e6 = await refused(g.guardedCreate?.(c6, params("claude-haiku-4-5", 1000)));
  assert(e6?.name === "SpendRefusedError" && c6.created === 0, `[G6] a count that cannot be taken is a refusal (${e6?.name ?? "no error"}), and no call is made`);
  g.resetSpendGuard?.();
  g.setPriceOnly?.(true);
  const c7 = stub(5000);
  const e7 = await refused(g.guardedCreate?.(c7, params("claude-haiku-4-5", 2000)));
  assert(e7?.name === "PricedOnlyError" && c7.created === 0 && (g.pricedCalls?.() ?? []).length === 1 && Math.abs(g.pricedCalls()[0].worstUsd - (5000 * 1 + 2000 * 5) / 1e6) < 1e-12, `[G7] price-only: counted and recorded ($${g.pricedCalls?.()?.[0]?.worstUsd}), never called`);
  g.setPriceOnly?.(false);

  console.log("\n=== G8: every billed call site goes through the guard ===");
  for (const f of ["lib/agent/claude.ts", "lib/agent/proceedsUse.ts", "lib/agent/referencedNote.ts", "lib/events/sonnetEventBriefing.ts", "lib/cards/capture/facts.ts"]) {
    const code = readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!/messages\.create\s*\(/.test(code) && /guardedCreate\s*\(/.test(code), `[G8] ${f} makes no unguarded messages.create`);
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
