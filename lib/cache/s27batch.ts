/**
 * SESSION 27 — THE REFRESH BATCH: TENET, DAVITA, CHS ON THEIR OCT 29 10-Qs. BILLS.
 * Approved by Akshay, Oct 31: $5.41 worst case (canonical + two re-tastes +
 * proceeds-use + facts run per name), on pre-call counts, under the cap rule.
 *
 * Per name, one build under the $2.00 per-build cap (a hard ceiling, never
 * raised): the spend guard holds the build's running spend to $2.00, and the
 * DIG ALLOWANCE is the cap less the other stages' counted worst case
 * (sessions/27/refresh_batch_pricing.json): a dig that would not fit is
 * refused and its trigger renders unresolved. The batch total is held to the
 * approved $5.41.
 *
 * All three samples are bound to one read set, resolved before the first call;
 * a moved read set stops the name before it bills. Every sample must bill
 * non-zero and leave its answer at its key. Then the card input is captured
 * on the new anchor and the verified-facts stage runs on it (facts.ts --bill
 * --limit <what is left of the build's cap>).
 *
 * Run: S27_APPROVED=refresh-batch npx tsx lib/cache/s27batch.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { runAgentLoop } from "../agent";
import { checkFree, spendTracker } from "./freeRun";
import { assertFilingListCurrent } from "../fetch/freshFilings";
import { setSpendLimits, beginGuardRun, setDigAllowance, spentThisRun } from "../agent/spendGuard";
import { captureCardInput } from "../cards/capture/snapshot";
import { briefDateArg } from "../cards/briefDate";

const CAP = 2.0;
// Nov 6: one script for any approved refresh. The Oct 31 batch is the default; another run names its pricing, its
// approved total and its own record (never the Oct 31 record), e.g. Encompass on its Nov 3 10-Q, approved up to $1.80.
const PRICING = process.env.S27_PRICING ?? "sessions/27/refresh_batch_pricing.json";
const APPROVED_TOTAL = Number(process.env.S27_APPROVED_TOTAL ?? "5.41");
const RECORD = process.env.S27_RECORD ?? "baselines/s27-refresh-batch.json";
const BUSTS: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };

(async () => {
  if (process.env.S27_APPROVED !== "refresh-batch") stop("this bills; set S27_APPROVED=refresh-batch only after approval");
  if (!process.env.ANTHROPIC_API_KEY) stop("no API key in the environment");
  if (process.env.READ_SET_AS_OF) stop("a refresh reads the CURRENT read set; unset READ_SET_AS_OF");
  const pricing = JSON.parse(readFileSync(PRICING, "utf-8")).rows as any[];
  const declared = pricing.reduce((a, r) => a + r.declared, 0);
  if (!(APPROVED_TOTAL > 0) || declared > APPROVED_TOTAL + 1e-9) stop(`declared $${declared.toFixed(2)} exceeds the approved $${APPROVED_TOTAL.toFixed(2)}: re-declare first`);
  if (PRICING !== "sessions/27/refresh_batch_pricing.json" && RECORD === "baselines/s27-refresh-batch.json") stop("another run must name its own record (S27_RECORD), never the Oct 31 batch's");
  mkdirSync("sessions/27/refresh/facts", { recursive: true });
  const spend = spendTracker();
  const ledgerAt = (since: string) => readFileSync("baselines/cost-log.jsonl", "utf-8").trim().split("\n").map((l) => JSON.parse(l)).filter((j) => j.at >= since).reduce((a, j) => a + (j.totalUsd ?? 0), 0);
  const started = new Date().toISOString();
  const out: any = { approvedTotal: APPROVED_TOTAL, cap: CAP, names: [] };
  for (const p of pricing) {
    const company = p.company as string;
    // Stage 2 rule (Nov 3): never extract on a filing list older than the request (lib/fetch/freshFilings.ts).
    try { await assertFilingListCurrent(company); } catch (e) { stop((e as Error).message); }
    const bound = await checkFree(company);
    for (const b of BUSTS) { const v = await checkFree(company, b); if (v.cached) stop(`${company} [${b ?? "canonical"}] is already cached: the forced misses do not equal the declared runs`); }
    // The dig allowance: the cap less the other stages' counted worst case (base and proceeds-use x3, facts).
    // Nov 9: the referenced 10-K note calls the pricing counted (per uncached sample) are other stages' worst case too.
    const others = 3 * (p.baseWorst + p.proceedsEstimate) + p.factsWorst + (p.notesBilled ?? 0) * (p.noteWorst ?? 0);
    const allowance = Math.max(0, CAP - others);
    const leftInBatch = APPROVED_TOTAL - ledgerAt(started);
    setSpendLimits({ perRunUsd: CAP, totalUsd: Math.min(leftInBatch, APPROVED_TOTAL) });
    beginGuardRun(`${company} refresh build`);
    setDigAllowance(allowance);
    console.log(`\n${company}: bound read set ${bound.fingerprint}; cap $${CAP.toFixed(2)}; other stages' counted worst $${others.toFixed(4)}; dig allowance $${allowance.toFixed(4)}; batch left $${leftInBatch.toFixed(4)}`);
    const samples: any[] = [];
    for (const bust of BUSTS) {
      const pre = await checkFree(company, bust);
      if (pre.fingerprint !== bound.fingerprint) stop(`${company}: the read set moved before ${bust ?? "canonical"}; nothing more billed for it`);
      if (bust) process.env.CACHE_BUST = bust; else delete process.env.CACHE_BUST;
      const q = console.log; console.log = () => {};
      let result: any;
      try { result = JSON.parse(JSON.stringify(await runAgentLoop(company))); } finally { console.log = q; delete process.env.CACHE_BUST; }
      const usd = spend.record(`${company} (${bust ?? "refresh"})`);
      const after = await checkFree(company, bust);
      const unresolved = result.results.filter((t: any) => t.unresolved).map((t: any) => t.triggerId);
      console.log(`  ${bust ?? "canonical"}: $${usd.toFixed(4)}; answer ${after.cached ? "written" : "MISSING"}${unresolved.length ? `; unresolved (dig refused): ${unresolved.join(", ")}` : ""}`);
      if (usd === 0) stop(`${company} ${bust ?? "canonical"} billed $0: the answer came from somewhere other than this extraction`);
      if (!after.cached) stop(`${company} ${bust ?? "canonical"}: no answer at ${after.key}`);
      samples.push({ bust, usd, key: after.key, result });
    }
    const canonical = samples[0].result;
    const input = await captureCardInput(canonical, { fingerprint: bound.fingerprint, commit: execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(), source: `REFRESH of ${company} on its new anchor; not the committed card`, briefDate: briefDateArg() });
    const inPath = `sessions/27/refresh/${canonical.cik}_input.json`;
    writeFileSync(inPath, JSON.stringify(input) + "\n");
    const left = CAP - spentThisRun();
    console.log(`  facts: running under what is left of the build's cap, $${left.toFixed(4)}`);
    const factsOut = execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", "--input", inPath, "--out", "sessions/27/refresh/facts", "--bill", "--limit", left.toFixed(4)], { encoding: "utf-8", shell: true });
    const fm = /\$([\d.]+) \((\d+) calls\)\s+kept: ([^\n]+)/.exec(factsOut);
    console.log(`  facts: ${fm ? `$${fm[1]} (${fm[2]} calls), kept ${fm[3]}` : factsOut.split("\n").filter((l) => /STOP|Error|REFUS/.test(l)).join(" ") || "see output"}`);
    out.names.push({ company, cik: canonical.cik, boundFingerprint: bound.fingerprint, allowance, samples, factsUsd: fm ? Number(fm[1]) : null });
    writeFileSync(RECORD, JSON.stringify(out, null, 1) + "\n");
  }
  console.log(`\nBATCH SPEND (ledger since start): $${ledgerAt(started).toFixed(4)} of $${APPROVED_TOTAL.toFixed(2)} approved.`);
})().catch((e) => { console.error(e); process.exit(1); });
