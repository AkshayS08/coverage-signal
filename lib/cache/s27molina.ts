/**
 * SESSION 27 — MOLINA'S QUARTERLY REFRESH ON ITS OCT 22 10-Q. BILLS.
 * Approved by Akshay, Oct 29: worst case $1.5353 (canonical + two re-tastes),
 * priced in sessions/27/molina_refresh_pricing.json.
 *
 * All three runs are bound to ONE read set, resolved before the first call:
 * before each run the read set is resolved again, and a different
 * fingerprint stops the run before it bills (a re-taste on a moved corpus is
 * a new extraction, not a sample). The preventive gate holds the approved
 * total and each run's counted worst case rounded up to the cent ($0.52).
 * Every run must bill non-zero and leave its answer at the key checkFree
 * names. Results go to baselines/s27-molina-refresh.json.
 *
 * Run: S27_APPROVED=molina-refresh npx tsx lib/cache/s27molina.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { checkFree, spendTracker } from "./freeRun";
import { setSpendLimits, beginGuardRun } from "../agent/spendGuard";

const COMPANY = "MOLINA HEALTHCARE, INC.";
const APPROVED_TOTAL = 1.5353;
const PER_RUN = 0.52;
const BUSTS: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };

(async () => {
  if (process.env.S27_APPROVED !== "molina-refresh") stop("this bills; set S27_APPROVED=molina-refresh only after approval");
  if (!process.env.ANTHROPIC_API_KEY) stop("no API key in the environment");
  const bound = await checkFree(COMPANY);
  console.log(`bound read set ${bound.fingerprint} (canonical key ${bound.key})`);
  for (const b of BUSTS) { const v = await checkFree(COMPANY, b); if (v.cached) stop(`${v.key} is already cached, so the forced misses do not equal the declared runs`); }
  setSpendLimits({ totalUsd: APPROVED_TOTAL });
  const spend = spendTracker();
  const results: { company: string; bust: string | null; usd: number; key: string; fingerprint: string; result: unknown }[] = [];
  for (const bust of BUSTS) {
    const pre = await checkFree(COMPANY, bust);
    if (pre.fingerprint !== bound.fingerprint) stop(`the read set moved (${bound.fingerprint} -> ${pre.fingerprint}) before ${bust ?? "canonical"}; nothing more billed`);
    if (bust) process.env.CACHE_BUST = bust; else delete process.env.CACHE_BUST;
    setSpendLimits({ perRunUsd: PER_RUN, totalUsd: APPROVED_TOTAL });
    beginGuardRun(`${COMPANY} [${bust ?? "canonical"}]`);
    const result = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;
    const usd = spend.record(`${COMPANY}${bust ? ` (${bust})` : " (refresh)"}`);
    const after = await checkFree(COMPANY, bust);
    console.log(`  ${bust ?? "canonical"}: $${usd.toFixed(4)}, answer ${after.cached ? "written" : "MISSING"} at ${after.key}`);
    results.push({ company: COMPANY, bust, usd, key: after.key, fingerprint: after.fingerprint, result });
    writeFileSync("baselines/s27-molina-refresh.json", JSON.stringify({ boundFingerprint: bound.fingerprint, approvedTotal: APPROVED_TOTAL, spentTotal: spend.totalUsd, results }, null, 1) + "\n");
    if (usd === 0) stop(`${bust ?? "canonical"} billed $0: the answer came from somewhere other than this extraction`);
    if (!after.cached) stop(`${bust ?? "canonical"}: no answer at ${after.key}`);
  }
  console.log(spend.line());
})().catch((e) => { console.error(e); process.exit(1); });
