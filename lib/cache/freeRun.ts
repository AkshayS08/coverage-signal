/**
 * RULE 75 — A RUN DESCRIBED AS FREE IS CHECKED BEFORE IT RUNS, NOT AFTER.
 *
 * `preflight.ts` has said this since it was written: "a replay is only free
 * INSIDE a TTL window, and 'I replayed from cache' is a claim about a moment,
 * not a property of the code." It was built after two runs were reported as
 * free that had re-extracted live.
 *
 * It happened again, on an instruction that said "no spend". Cigna's
 * filing-list cache passed its 24-hour TTL mid-session, EDGAR returned a
 * catalog differing somewhere in 160 filings, the corpus fingerprint moved
 * 813c7d6b → f1237506, and every cached answer for that company became
 * unreachable. Three re-renders that had cost $0 an hour earlier re-extracted
 * live and billed **$0.5714**.
 *
 * TWO SEPARATE FAILURES, AND THE SECOND IS THE WORSE ONE:
 *
 *   1. The harness never asked whether the run would be free. `preflight.ts`
 *      existed, answers exactly this, makes no model calls, and was not
 *      called — a guard nobody invokes is not a guard.
 *
 *   2. The harness then PRINTED "SPEND: $0.0000" while $0.5714 billed. It
 *      read `currentCompanySpend()` once at the end, and the last thing it
 *      had done was an extra fully-cached run that opened a fresh scope. So
 *      the figure was real, current, and about the wrong thing. The ledger
 *      itself was correct throughout (Rule 68 held); the REPORT was not.
 *
 * So: ask first, and total what you actually spent rather than sampling a
 * scope. `assertFree` throws before a single call is made; `spendTracker`
 * accumulates per-run and cannot report a total it did not observe.
 */
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint, baseAnswerKey } from "./answerCache";
import { currentCompanySpend } from "../agent/costMeter";

export interface FreeVerdict {
  company: string;
  fingerprint: string;
  key: string;
  cached: boolean;
}

/**
 * Would a run of this company hit the answer cache? Reads the filing list
 * (cached, free) and does ONE blob HEAD. Zero model calls by construction.
 *
 * `bust` must be the CACHE_BUST tag the run will use, because a busted run
 * writes to its own key and a check against the canonical key would answer a
 * question about a different file.
 */
export async function checkFree(company: string, bust?: string | null): Promise<FreeVerdict> {
  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  // The SAME builder the loop uses (Rule 12): a hand-copied key here would
  // report "cached" about a key nothing reads.
  const base = baseAnswerKey(f.cik, fp);
  const key = bust ? base.replace(/\/v(\d+)\.json$/, `-bust${bust}/v$1.json`) : base;
  let cached = false;
  try {
    await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
    cached = true;
  } catch {
    cached = false;
  }
  return { company, fingerprint: fp, key, cached };
}

/**
 * Throws BEFORE any model call if the run would re-bill. The message names
 * the fingerprint, because "the corpus moved" is the answer every single time
 * and the next reader should not have to rediscover that.
 */
export async function assertFree(runs: { company: string; bust?: string | null }[]): Promise<FreeVerdict[]> {
  const verdicts: FreeVerdict[] = [];
  for (const r of runs) verdicts.push(await checkFree(r.company, r.bust ?? null));
  const cold = verdicts.filter((v) => !v.cached);
  if (cold.length > 0) {
    throw new Error(
      `REFUSING TO RUN — ${cold.length} of ${verdicts.length} run(s) would RE-EXTRACT LIVE and bill:\n` +
        cold.map((v) => `  ${v.company}${v.key.includes("-bust") ? " (busted)" : ""} — fingerprint ${v.fingerprint.slice(0, 8)}, no cached answer at ${v.key}`).join("\n") +
        `\n\nThe usual cause is the 24-hour filing-list TTL lapsing and EDGAR returning a changed catalog, which moves the corpus ` +
        `fingerprint and makes every cached answer for that company unreachable. This is not a fault to work around: it means the ` +
        `run is a NEW EXTRACTION on a NEW CORPUS, which has to be authorised on its own terms and priced first (Rule 13).`
    );
  }
  return verdicts;
}

/**
 * Accumulates spend across runs. `currentCompanySpend()` reports the CURRENT
 * scope, so reading it once at the end reports the last run — which is how a
 * harness printed $0.0000 over $0.5714 of billing.
 */
export function spendTracker() {
  let total = 0;
  const perRun: { label: string; usd: number }[] = [];
  return {
    /** Call immediately after each run, while its scope is still current. */
    record(label: string): number {
      const usd = currentCompanySpend().totalUsd;
      total += usd;
      perRun.push({ label, usd });
      return usd;
    },
    get totalUsd() { return total; },
    get runs() { return [...perRun]; },
    line(): string {
      return total === 0
        ? `SPEND: $0.0000 across ${perRun.length} run(s) — each measured as it finished, not sampled at the end`
        : `SPEND: $${total.toFixed(4)} across ${perRun.length} run(s) — ${perRun.map((r) => `${r.label} $${r.usd.toFixed(4)}`).join(", ")}`;
    },
  };
}
