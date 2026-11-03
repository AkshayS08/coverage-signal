/**
 * SESSION 27 — THE REFRESH BATCH, PRICED FROM PRE-CALL COUNTS. $0: no billed call.
 *
 * A refresh re-runs every billed stage on the new anchor (Akshay, Oct 30):
 * Tenet, DaVita and CHS on their Oct 29 10-Qs, declared as one batch with
 * Molina (already run on its Oct 22 10-Q). Per name, each a worst case:
 *   base extraction  the real prompt over the new read set, counted (price-only), for the
 *                    canonical and each of the two re-tastes (the same prompt, three asks)
 *   dig              a real one-trigger prompt over the first dig candidate not in the read
 *                    set, counted, times the budget (5), per ask
 *   proceeds-use     NOT countable before a base answer exists: that name's Oct 22 count
 *                    plus 25%, max_tokens 200, per ask; flagged as the estimate
 *   verified facts   the facts prompt over the new anchor's own text, counted (facts.ts
 *                    --price), three asks
 * Declared figures round up to the cent. Writes sessions/27/refresh_batch_pricing.json.
 *
 * Needs an API key for the token counter only. Run: npx tsx lib/cache/s27priceBatch.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runAgentLoop } from "../agent";
import { classifyOneTrigger } from "../agent/claude";
import { setPriceOnly, pricedCalls } from "../agent/spendGuard";
import { priceOf } from "../agent/costMeter";
import { getFilingText, getRecentFilings } from "../fetch";
import { readSetOf, digCandidatesOf, anchorOf } from "./readSet";
import { checkFree } from "./freeRun";
import { buildExtractionText } from "../fetch/noteLocation";
import { TRIGGERS } from "../agent/triggers";

// Names and output from the command line (Nov 3: Encompass on its Q3 10-Q); the Oct 31 batch by default.
const NAMES_ARG = process.argv.find((x) => x.startsWith("--names="));
const NAMES = NAMES_ARG ? NAMES_ARG.slice(8).split("|") : ["TENET HEALTHCARE CORP", "DAVITA INC.", "COMMUNITY HEALTH SYSTEMS INC"];
const OUT = (process.argv.find((x) => x.startsWith("--out=")) ?? "--out=sessions/27/refresh_batch_pricing.json").slice(6);
const BUSTS: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const LEDGER = readFileSync("baselines/cost-log.jsonl", "utf-8").trim().split("\n").map((l) => JSON.parse(l));
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };
const ceilCent = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("the token counter needs a key; no call is made"); process.exit(1); }
  if (process.env.READ_SET_AS_OF) { console.error("REFUSING: a refresh prices the CURRENT read set; unset READ_SET_AS_OF"); process.exit(1); }
  setPriceOnly(true);
  const sonnet = priceOf("claude-sonnet-5")!;
  mkdirSync("sessions/27/refresh_inputs", { recursive: true });
  const rows: any[] = [];
  for (const company of NAMES) {
    const f = await quiet(() => getRecentFilings(company, ["8-K", "10-Q", "10-K"]));
    const rs = readSetOf(f.filings), anchor = anchorOf(rs)!;
    for (const b of BUSTS) { const v = await checkFree(company, b); if (v.cached) throw new Error(`${company} [${b ?? "canonical"}] is already cached on the new read set — not a forced miss`); }
    // base: the real prompt, counted once (the three asks share it)
    process.env.CACHE_BUST = BUSTS[1]!;
    const n0 = pricedCalls().length;
    await quiet(() => runAgentLoop(company)).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
    delete process.env.CACHE_BUST;
    const base = pricedCalls().slice(n0)[0];
    // dig
    const rsAcc = new Set(rs.map((x) => x.accessionNumber));
    const cand = digCandidatesOf(f.filings).find((x) => !rsAcc.has(x.accessionNumber));
    let dig = 0;
    if (cand) {
      const { text } = await getFilingText(cand.primaryDocUrl);
      const ex = buildExtractionText({ form: cand.form, url: cand.primaryDocUrl, fullText: text });
      const d0 = pricedCalls().length;
      await classifyOneTrigger({ companyName: f.company, trigger: TRIGGERS[0], priorVerdict: { triggerId: TRIGGERS[0].id, fired: false, needsDig: true } as any, extraDoc: { form: cand.form, filingDate: cand.filingDate, url: cand.primaryDocUrl, text: ex.text } }).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
      dig = 5 * (pricedCalls().slice(d0)[0]?.worstUsd ?? 0);
    }
    // proceeds-use: the Oct 22 canonical count + 25% (the estimate)
    const prior = LEDGER.filter((j) => j.company === company && j.at >= "2026-10-22T18:00" && j.at <= "2026-10-22T18:30").pop();
    const puIn = prior?.byModel?.find((m: any) => /sonnet/.test(m.model))?.inputTokens ?? 0;
    const proceeds = puIn ? (Math.ceil(puIn * 1.25) * sonnet.input + 200 * sonnet.output) / 1e6 : 0;
    // verified facts on the new anchor's own text
    const { text: anchorText } = await getFilingText(anchor.primaryDocUrl);
    const input = { cik: f.cik, company: f.company, result: { cik: f.cik, company: f.company, results: [{ triggerId: "debt-maturity", debtScheduleSourceFiling: { form: anchor.form, date: anchor.filingDate, reportDate: anchor.reportDate, url: anchor.primaryDocUrl } }] }, docs: { [anchor.primaryDocUrl]: { label: `${anchor.form} ${anchor.filingDate}`, text: anchorText } }, laterFilings: [] };
    const inPath = `sessions/27/refresh_inputs/${f.cik}.json`;
    writeFileSync(inPath, JSON.stringify(input) + "\n");
    const out = execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", "--input", inPath, "--price"], { encoding: "utf-8", shell: true });
    const fm = /worst \$([\d.]+)\/ask, \$([\d.]+) for 3 asks/.exec(out);
    const facts = fm ? Number(fm[2]) : NaN;
    const perAsk = (base?.worstUsd ?? NaN) + dig + proceeds;
    const total = 3 * perAsk + facts;
    rows.push({ company, anchor: `${anchor.form} ${anchor.filingDate} (period ${anchor.reportDate})`, baseInputTokens: base?.inputTokens, baseWorst: base?.worstUsd, digWorst: dig, digCandidate: cand ? `${cand.form} ${cand.filingDate}` : null, proceedsEstimate: proceeds, factsWorst: facts, worst: total, declared: ceilCent(total) });
    console.log(`${company.padEnd(30)} ${anchor.form} ${anchor.filingDate}: base ${base?.inputTokens} in → $${base?.worstUsd.toFixed(4)}/ask; dig $${dig.toFixed(4)}/ask${cand ? ` (${cand.form} ${cand.filingDate})` : ""}; proceeds-use $${proceeds.toFixed(4)}/ask (estimate); ×3 asks; facts $${facts.toFixed(4)} (3 asks) → worst $${total.toFixed(4)}, declared $${ceilCent(total).toFixed(2)}`);
  }
  const batch = rows.reduce((a, r) => a + r.declared, 0);
  console.log(`\nBatch (Tenet, DaVita, CHS) declared: $${batch.toFixed(2)}. Molina, already run: extraction $0.6165 + facts $0.0574 = $0.6739, nothing further.`);
  writeFileSync(OUT, JSON.stringify({ pricedAt: new Date().toISOString(), rows, batchDeclaredUsd: Number(batch.toFixed(2)), molinaSpentUsd: 0.6739 }, null, 1) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
