/**
 * SESSION 27 (Akshay, Nov 16): THE PRICE-ONLY SWITCH IS PER REQUEST, NOT SERVER-WIDE.
 *
 * The spend guard's state (price-only, the priced calls, the limits and what has been spent) and the cache-bust tag that
 * picks a sample were process-wide. On a server two requests share a process: a pricing that set price-only made a
 * concurrent billed build's calls "priced only", and each pricing read the other's priced calls and sample tag.
 *
 *   R1  a pricing and a billed build at once: the pricing's call is priced, not made; the build's call is made
 *   R2  two pricings at once: each counts only its own calls
 *   R3  two requests at once, each with its own sample tag: each reads its own after every await; the process env is
 *       untouched
 *   R4  two billed builds at once, each under its own ceiling: each is held to its own; neither's spend counts on the other
 *   control: the server-wide switch interferes — a pricing's switch turns a concurrent build's call into "priced only"
 *
 * Offline, $0: the model client is a stub. Run: ANTHROPIC_API_KEY="" npx tsx lib/agent/requestScope.test.ts
 */
import * as guard from "./spendGuard";
import { inRequestScope, cacheBustNow } from "./requestScope";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const tick = () => new Promise((r) => setTimeout(r, 2 + Math.random() * 8));
const MODEL = "claude-haiku-4-5";
function stub(inputTokens: number) {
  let made = 0;
  const client: any = { messages: {
    countTokens: async () => { await tick(); return { input_tokens: inputTokens }; },
    create: async () => { await tick(); made++; return { usage: { input_tokens: inputTokens, output_tokens: 10 }, content: [], stop_reason: "end_turn" }; },
  } };
  return { client, made: () => made };
}
const call = (c: any) => guard.guardedCreate(c, { model: MODEL, max_tokens: 100, messages: [{ role: "user", content: "x" }] } as any);
const priced = (e: unknown) => (e as any)?.name === "PricedOnlyError";

(async () => {
  // R1
  const pA = stub(1111), bB = stub(2222);
  const [pricing, build] = await Promise.all([
    guard.withPriceOnly(async () => { for (let i = 0; i < 3; i++) await call(pA.client).catch((e) => { if (!priced(e)) throw e; }); }),
    guard.withGuard({}, async () => { const out: string[] = []; for (let i = 0; i < 3; i++) out.push(await call(bB.client).then(() => "made", (e) => (priced(e) ? "priced" : "error"))); return out; }),
  ]);
  assert(pA.made() === 0 && pricing.priced.length === 3 && bB.made() === 3 && build.result.every((x) => x === "made"), `[R1] pricing: ${pricing.priced.length} priced, ${pA.made()} made; build at once: ${build.result.join(", ")}`);

  // R2
  const p1 = stub(1000), p2 = stub(5000);
  const [a, b] = await Promise.all([
    guard.withPriceOnly(async () => { for (let i = 0; i < 4; i++) await call(p1.client).catch(() => {}); }),
    guard.withPriceOnly(async () => { for (let i = 0; i < 2; i++) await call(p2.client).catch(() => {}); }),
  ]);
  assert(a.priced.length === 4 && a.priced.every((c) => c.inputTokens === 1000) && b.priced.length === 2 && b.priced.every((c) => c.inputTokens === 5000), `[R2] two pricings at once: ${a.priced.length} calls of 1000 tokens, ${b.priced.length} of 5000; none crossed`);

  // R3
  const envBefore = process.env.CACHE_BUST;
  const seen = await Promise.all(["s27-refresh-retaste-1", "s27-refresh-retaste-2", null].map((tag) => inRequestScope({ cacheBust: tag }, async () => { const out: (string | undefined)[] = []; for (let i = 0; i < 5; i++) { await tick(); out.push(cacheBustNow()); } return { tag, out }; })));
  assert(seen.every((s) => s.out.every((x) => x === (s.tag ?? undefined))) && process.env.CACHE_BUST === envBefore, `[R3] each request reads its own sample tag after every await (${seen.map((s) => s.tag ?? "canonical").join(", ")}); env untouched`);

  // R4
  const c1 = stub(10000), c2 = stub(10000);
  const worst = (10000 * 1 + 100 * 5) / 1e6; // claude-haiku-4-5: $1/M in, $5/M out
  const run = (c: any, ceiling: number, n: number) => guard.withGuard({ totalUsd: ceiling }, async () => { let made = 0, refused = 0; for (let i = 0; i < n; i++) { try { await call(c); made++; } catch (e) { if ((e as any)?.name === "SpendRefusedError") refused++; else throw e; } } return { made, refused }; });
  const [x, y] = await Promise.all([run(c1.client, worst * 2.5, 4), run(c2.client, worst * 10, 4)]);
  assert(x.result.made === 2 && x.result.refused === 2 && y.result.made === 4 && y.result.refused === 0 && Math.abs(x.spentUsd - 2 * (10000 + 10 * 5) / 1e6) < 1e-9, `[R4] two builds at once: one held to its own ceiling (${x.result.made} made, ${x.result.refused} refused), the other to its own (${y.result.made} made); spends kept apart ($${x.spentUsd.toFixed(6)})`);

  // Control: the server-wide switch.
  guard.resetSpendGuard();
  const g1 = stub(1111), g2 = stub(2222);
  const [, other] = await Promise.all([
    (async () => { guard.setPriceOnly(true); try { for (let i = 0; i < 3; i++) await call(g1.client).catch(() => {}); } finally { guard.setPriceOnly(false); } })(),
    (async () => { const out: string[] = []; for (let i = 0; i < 3; i++) out.push(await call(g2.client).then(() => "made", (e) => (priced(e) ? "priced" : "error"))); return out; })(),
  ]);
  assert(other.includes("priced"), `[control] with the server-wide switch, a concurrent build's calls became: ${other.join(", ")}`);
  guard.resetSpendGuard();

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
