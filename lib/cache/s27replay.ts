/**
 * SESSION 27 — REPLAY THE SIX CACHED v33 ANSWERS THROUGH THE CURRENT LOOP. $0.
 *
 * The canonical run's results were produced by the code of that moment. The
 * position rules (a)-(c) and the loop's recorded claim sources changed after
 * it, and both act on the cached answer without a model, so the replay is
 * what the diffs must be read from. assertFree first; refuses unless the key
 * is blank, so a miss can only fail, never bill.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27replay.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { assertFree, spendTracker } from "./freeRun";

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const canonical = JSON.parse(readFileSync("baselines/s27-canonical.json", "utf-8"));
  const names: string[] = canonical.results.map((r: { company: string }) => r.company);
  await assertFree(names.map((company) => ({ company })));
  const spend = spendTracker();
  const results = [];
  for (const company of names) {
    delete process.env.CACHE_BUST;
    const quiet = console.log; console.log = () => {};
    const result = await runAgentLoop(company);
    console.log = quiet;
    const usd = spend.record(company);
    results.push({ company, bust: null, usd, result });
    console.log(`${company}: replayed, $${usd.toFixed(4)}`);
  }
  writeFileSync("baselines/s27-replay.json", JSON.stringify({ replayedFrom: "baselines/s27-canonical.json (the cached v33 answers)", spentTotal: spend.totalUsd, results }, null, 1) + "\n");
  console.log(spend.line());
  if (spend.totalUsd !== 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
