/**
 * SESSION 27 — MOLINA'S QUARTERLY REFRESH, PRICED FROM PRE-CALL COUNTS. $0: no billed call.
 *
 * The first live quarterly-refresh test (Akshay, Oct 29): Molina refreshes on
 * its Oct 22 Q3 10-Q, the new anchor. Declared: the canonical extraction on
 * the new read set plus two re-tastes bound to that read set, each a worst
 * case (input as the Messages API counts it at the model's rate, plus output
 * at max_tokens):
 *   base extraction  counted on the real prompt over the new read set,
 *                    price-only (the guard counts and stops the call)
 *   dig              counted on a real one-trigger prompt over the first dig
 *                    candidate not in the read set, times the budget (5)
 *   proceeds-use     NOT countable before a base answer exists: priced from the
 *                    canonical v33 run's own count (19,331 in) plus a 25%
 *                    margin, max_tokens 200, and flagged as the one estimate
 * Also prints what the card should change: the read set before and after,
 * the anchor and position date, and the filer's tagged debt at both dates
 * (SEC company facts, free).
 *
 * Needs an API key in the environment for the token counter only.
 * Run: npx tsx lib/cache/s27priceMolina.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { classifyOneTrigger } from "../agent/claude";
import { setPriceOnly, pricedCalls } from "../agent/spendGuard";
import { priceOf } from "../agent/costMeter";
import { getFilingText, getRecentFilings } from "../fetch";
import { readSetOf, digCandidatesOf, anchorOf } from "./readSet";
import { buildExtractionText } from "../fetch/noteLocation";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { TRIGGERS } from "../agent/triggers";

const COMPANY = "MOLINA HEALTHCARE, INC.";
const BUSTS = [undefined, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("the token counter needs a key; no call is made"); process.exit(1); }
  setPriceOnly(true);
  const sonnet = priceOf("claude-sonnet-5")!;
  const old = JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")).results.find((x: any) => x.company === COMPANY).result;
  const oldDm = old.results.find((t: any) => t.triggerId === "debt-maturity");
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const rs = readSetOf(f.filings), anchor = anchorOf(rs)!;
  console.log(`read set now (${rs.length}): ${rs.map((x) => `${x.form} ${x.filingDate}`).join(", ")}`);
  console.log(`anchor: ${oldDm.debtScheduleSourceFiling.form} ${oldDm.debtScheduleSourceFiling.date} (period ${oldDm.debtScheduleSourceFiling.reportDate}) → ${anchor.form} ${anchor.filingDate} (period ${anchor.reportDate})`);
  const [x0, x1] = await Promise.all([fetchXbrlDebtTotal(old.cik, oldDm.debtScheduleSourceFiling.reportDate), fetchXbrlDebtTotal(old.cik, anchor.reportDate)]);
  console.log(`tagged debt: ${x0.asOf} $${x0.total} (${x0.parts.map((p) => p.tag).join("+")}) → ${x1.asOf} ${x1.total === null ? `none (${x1.unavailableReason})` : `$${x1.total} (${x1.parts.map((p) => p.tag).join("+")})`}`);

  const runs: { label: string; base: number; inputTokens: number; maxTokens: number }[] = [];
  for (const bust of BUSTS) {
    if (bust) process.env.CACHE_BUST = bust; else delete process.env.CACHE_BUST;
    const n0 = pricedCalls().length;
    await quiet(() => runAgentLoop(COMPANY)).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
    delete process.env.CACHE_BUST;
    const p = pricedCalls().slice(n0)[0];
    if (!p) { console.log(`${bust ?? "canonical"}: the base call was not reached (cached?) — not priced`); continue; }
    runs.push({ label: bust ?? "canonical", base: p.worstUsd, inputTokens: p.inputTokens, maxTokens: p.maxTokens });
  }
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
  const proceeds = (Math.ceil(19_331 * 1.25) * sonnet.input + 200 * sonnet.output) / 1e6;
  const rows = runs.map((r) => ({ ...r, dig, proceeds, perRun: r.base + dig + proceeds }));
  for (const r of rows) console.log(`${r.label.padEnd(24)} base ${r.inputTokens} in / ${r.maxTokens} max → $${r.base.toFixed(4)}; dig $${dig.toFixed(4)}${cand ? ` (${cand.form} ${cand.filingDate})` : " (no candidate)"}; proceeds-use $${proceeds.toFixed(4)} (estimate); worst $${r.perRun.toFixed(4)}`);
  const total = rows.reduce((a, r) => a + r.perRun, 0);
  console.log(`\nMolina refresh, canonical + ${rows.length - 1} re-tastes, worst case: $${total.toFixed(4)}`);
  writeFileSync("sessions/27/molina_refresh_pricing.json", JSON.stringify({ pricedAt: new Date().toISOString(), readSet: rs.map((x) => ({ form: x.form, filingDate: x.filingDate, accessionNumber: x.accessionNumber })), anchor: { form: anchor.form, filingDate: anchor.filingDate, reportDate: anchor.reportDate }, taggedDebt: { before: x0, after: x1 }, rows, totalWorstUsd: total }, null, 1) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
