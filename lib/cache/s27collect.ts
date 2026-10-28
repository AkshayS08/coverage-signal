/**
 * SESSION 27 — COLLECT THE RE-TASTE SAMPLES THAT EXIST, FROM CACHE. $0.
 *
 * The re-taste phase stopped twice (a DNS outage; then the account's credit
 * balance). The samples it completed are cached under their CACHE_BUST keys;
 * this replays each through the current loop with the key blank (a miss can
 * only fail, never bill) and writes baselines/s27-retaste.json for s27nineb.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27collect.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { checkFree, spendTracker } from "./freeRun";

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const pricing = JSON.parse(readFileSync("sessions/27/retaste_pricing.json", "utf-8")) as { rows: { company: string }[] };
  const spend = spendTracker();
  const results = [];
  const missing: string[] = [];
  for (const { company } of pricing.rows) for (const bust of ["s27-retaste-1", "s27-retaste-2"]) {
    if (!(await checkFree(company, bust)).cached) { missing.push(`${company} [${bust}]`); continue; }
    process.env.CACHE_BUST = bust;
    const quiet = console.log; console.log = () => {};
    const result = await runAgentLoop(company);
    console.log = quiet;
    delete process.env.CACHE_BUST;
    const usd = spend.record(`${company} (${bust})`);
    results.push({ company, bust, usd, result });
    console.log(`${company} [${bust}]: collected, $${usd.toFixed(4)}`);
  }
  for (const m of missing) console.log(`${m}: not yet extracted`);
  writeFileSync("baselines/s27-retaste.json", JSON.stringify({ collectedFromCache: true, missing, results }, null, 1) + "\n");
  console.log(spend.line());
})().catch((e) => { console.error(e); process.exit(1); });
