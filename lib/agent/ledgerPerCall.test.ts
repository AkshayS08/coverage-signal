/**
 * SESSION 27 (Akshay, Nov 16): EVERY BILLED CALL WRITES THE COST LOG FROM THE PIPELINE ITSELF. A billed call whose
 * ledger write fails is an error.
 *
 * The Nov 16 CHS facts stage billed $0.1393 in three calls and wrote no ledger line: its usage was recorded in memory
 * (recordUsage) into a scope the loop had already persisted. Every billed call goes through one gate (guardedCreate),
 * so the gate writes the line.
 *   L1  a billed call writes exactly one ledger line, with its actual cost, kind and company
 *   L2  a billed call whose ledger write fails throws LedgerWriteError
 *   L3  no double count: a scope that persists after the gate's lines adds none of the same spend; a scope with no
 *       billed call still writes its $0 line (the release checks read them)
 *   L4  no call reaches the API except through the gate (the one place the line is written)
 *   L5  every test that drives the gate with a stub writes a scratch ledger, never baselines/cost-log.jsonl
 *   control: usage recorded without the gate (the Nov 16 facts stage's path) writes no line
 *
 * Offline, $0: a stub client; the ledger is a scratch file. Run: ANTHROPIC_API_KEY="" npx tsx lib/agent/ledgerPerCall.test.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

const dir = join(process.env.TEMP ?? ".", "ledgerPerCall");
mkdirSync(dir, { recursive: true });
const LOG = join(dir, "cost-log.jsonl");
writeFileSync(LOG, "");
process.env.COST_LOG_PATH = LOG;
const lines = () => readFileSync(LOG, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const stub = (inTok: number, outTok: number) => ({ messages: { countTokens: async () => ({ input_tokens: inTok }), create: async () => ({ usage: { input_tokens: inTok, output_tokens: outTok }, content: [], stop_reason: "end_turn" }) } }) as any;
const params = { model: "claude-haiku-4-5", max_tokens: 8000, messages: [{ role: "user" as const, content: "x" }] };

(async () => {
  const { guardedCreate, withGuard, asKind, LedgerWriteError } = await import("./spendGuard");
  const meter = await import("./costMeter");
  const { withCostScope } = await import("./costScope");

  // Control: the facts stage's old path, usage recorded in memory only.
  meter.beginCompanyCostScope("CONTROL CO");
  meter.recordUsage("claude-haiku-4-5", { input_tokens: 20000, output_tokens: 3000 });
  assert(lines().length === 0, `[control] usage recorded without the gate writes no ledger line (the Nov 16 facts stage: $0.1393 billed, no line)`);

  // L1
  writeFileSync(LOG, "");
  const g = await withGuard({ totalUsd: 1 }, () => withCostScope("TEST CO", () => asKind("card facts", async () => { const r = await guardedCreate(stub(20000, 3000), params as any); meter.recordUsage("claude-haiku-4-5", r.usage as any); return r; })));
  const after = lines();
  const per = after.filter((l) => l.perCall);
  const want = (20000 * 1 + 3000 * 5) / 1e6;
  assert(per.length === 1 && Math.abs(per[0].totalUsd - want) < 1e-9 && per[0].kind === "card facts" && /TEST CO/.test(per[0].company) && Math.abs(g.spentUsd - want) < 1e-9, `[L1] one line per billed call: ${JSON.stringify(per.map((l) => ({ company: l.company, kind: l.kind, usd: l.totalUsd })))}`);
  // L3
  const total = after.reduce((t, l) => t + (l.totalUsd ?? 0), 0);
  assert(Math.abs(total - want) < 1e-9, `[L3] the scope's own line adds none of it: ledger total $${total.toFixed(6)} for $${want.toFixed(6)} billed (${after.length} line(s))`);
  writeFileSync(LOG, "");
  await withCostScope("CACHED CO", async () => 1);
  const z = lines();
  assert(z.length === 1 && z[0].totalUsd === 0 && z[0].totalCalls === 0, `[L3] a scope with no billed call still writes its $0 line`);

  // L2
  process.env.COST_LOG_PATH = dir; // a directory: the append fails
  let threw: unknown = null;
  try { await withGuard({ totalUsd: 1 }, () => guardedCreate(stub(1000, 100), params as any)); } catch (e) { threw = e; }
  process.env.COST_LOG_PATH = LOG;
  assert(threw instanceof LedgerWriteError, `[L2] a billed call whose ledger write fails is an error: ${threw instanceof Error ? `${threw.name}: ${threw.message.slice(0, 120)}` : "no error"}`);

  // L4
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); } else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p); } };
  for (const d of ["lib", "app"]) if (existsSync(d)) walk(d);
  const outside = files.filter((f) => !/spendGuard\.ts$/.test(f) && /\.messages\.create\(|\.messages\.stream\(|\.beta\.messages\.create\(/.test(readFileSync(f, "utf-8")));
  assert(outside.length === 0, `[L4] no call reaches the API outside the gate${outside.length ? `: ${outside.join(", ")}` : ""}`);

  // L5
  const tests: string[] = [];
  const walkT = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkT(p); else if (/\.test\.ts$/.test(f)) tests.push(p); } };
  walkT("lib");
  const unscoped = tests.filter((f) => { const t = readFileSync(f, "utf-8"); return /guardedCreate|withGuard\(/.test(t) && !/COST_LOG_PATH/.test(t); });
  assert(unscoped.length === 0, `[L5] every test driving the gate writes a scratch ledger${unscoped.length ? `: not ${unscoped.join(", ")}` : ""}`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
