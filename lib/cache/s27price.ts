/**
 * SESSION 27 — PRICE THE RE-TASTES FROM PRE-CALL COUNTS (Akshay, Oct 23). $0: no call is made.
 *
 * Every figure is a worst case: input as the Messages API counts it, at the
 * model's rate, plus output at the call's max_tokens.
 *   base extraction   counted on the real prompt: the loop runs with the
 *                     re-taste's CACHE_BUST tag in price-only mode, so the
 *                     guard counts the base call and stops it
 *   referenced note   counted on the real prompt (Cigna's directed 10-K), price-only
 *   dig               counted on a real one-trigger prompt over CHS's one dig
 *                     candidate, price-only, times the dig budget (5)
 *   proceeds-use      the canonical run's exact API input count for the same
 *                     prompt (the ledger), max_tokens 200 — the call follows
 *                     the base answer and cannot be reached without one
 * A name not cached under its current read set is not priced (its re-taste
 * would be a new extraction on a new corpus).
 *
 * Needs an API key in the environment for the token counter only.
 * Run: npx tsx lib/cache/s27price.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { classifyOneTrigger } from "../agent/claude";
import { transcribeReferencedNote } from "../agent/referencedNote";
import { setPriceOnly, pricedCalls } from "../agent/spendGuard";
import { priceOf } from "../agent/costMeter";
import { getFilingText } from "../fetch";
import { checkFree } from "./freeRun";
import { readSetOf, digCandidatesOf } from "./readSet";
import { getRecentFilings } from "../fetch";
import { buildExtractionText } from "../fetch/noteLocation";
import { TRIGGERS } from "../agent/triggers";

const NAMES = ["TENET HEALTHCARE CORP", "Encompass Health Corp", "DAVITA INC.", "COMMUNITY HEALTH SYSTEMS INC", "MOLINA HEALTHCARE, INC.", "Cigna Group"];
const BUSTS = ["s27-retaste-1", "s27-retaste-2"];
const LEDGER = readFileSync("baselines/cost-log.jsonl", "utf-8").trim().split("\n").map((l) => JSON.parse(l));
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("the token counter needs a key; no call is made"); process.exit(1); }
  setPriceOnly(true);
  const rows: { company: string; base: number; proceeds: number; note: number; dig: number; perRun: number }[] = [];
  const sonnet = priceOf("claude-sonnet-5")!, haiku = priceOf("claude-haiku-4-5")!;
  for (const company of NAMES) {
    if (!(await checkFree(company)).cached) { console.log(`${company}: not cached under its current read set — its re-taste would be a new extraction on a new corpus; not priced`); continue; }
    // base: the real prompt, counted
    process.env.CACHE_BUST = BUSTS[0];
    const n0 = pricedCalls().length;
    await quiet(() => runAgentLoop(company)).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
    delete process.env.CACHE_BUST;
    const base = pricedCalls().slice(n0)[0];
    // proceeds-use: the canonical run's own count for the same prompt
    const canon = LEDGER.filter((j) => j.company === company && j.at >= "2026-10-22T18:00" && j.at <= "2026-10-22T18:30").pop();
    const puIn = canon?.byModel?.find((m: any) => /sonnet/.test(m.model))?.inputTokens ?? 0;
    const proceeds = puIn ? (puIn * sonnet.input + 200 * sonnet.output) / 1e6 : 0;
    // referenced note (a re-taste busts it too): the real prompt, counted
    let note = 0;
    if (/Cigna/.test(company)) {
      const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
      const tenK = f.filings.find((x) => x.form === "10-K")!;
      const { text } = await getFilingText(tenK.primaryDocUrl);
      const m0 = pricedCalls().length;
      await transcribeReferencedNote({ companyName: f.company, filingUrl: tenK.primaryDocUrl, filingForm: tenK.form, periodOfReport: tenK.reportDate, filingText: text, xbrlTotalForScale: null }).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
      note = pricedCalls().slice(m0)[0]?.worstUsd ?? 0;
    }
    // dig: only a name with a candidate not excerpted can dig; the budget is 5 calls
    let dig = 0;
    const f2 = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const rs = new Set(readSetOf(f2.filings).map((x) => x.accessionNumber));
    const cand = digCandidatesOf(f2.filings).find((x) => !rs.has(x.accessionNumber));
    if (cand) {
      const { text } = await getFilingText(cand.primaryDocUrl);
      const ex = buildExtractionText({ form: cand.form, url: cand.primaryDocUrl, fullText: text });
      const d0 = pricedCalls().length;
      await classifyOneTrigger({ companyName: f2.company, trigger: TRIGGERS[0], priorVerdict: { triggerId: TRIGGERS[0].id, fired: false, needsDig: true } as any, extraDoc: { form: cand.form, filingDate: cand.filingDate, url: cand.primaryDocUrl, text: ex.text } }).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
      dig = 5 * (pricedCalls().slice(d0)[0]?.worstUsd ?? 0);
    }
    const perRun = (base?.worstUsd ?? 0) + proceeds + note + dig;
    rows.push({ company, base: base?.worstUsd ?? NaN, proceeds, note, dig, perRun });
    console.log(`${company.padEnd(30)} base ${base?.inputTokens} in / ${base?.maxTokens} max -> $${base?.worstUsd.toFixed(4)}; proceeds-use $${proceeds.toFixed(4)}${puIn ? ` (${puIn} in)` : ""}; referenced note $${note.toFixed(4)}; dig $${dig.toFixed(4)}; per re-taste worst $${perRun.toFixed(4)}`);
  }
  const total = rows.reduce((a, r) => a + 2 * r.perRun, 0);
  console.log(`\nTwo re-tastes each, worst case: $${total.toFixed(4)} (cap $3.00)`);
  writeFileSync("sessions/27/retaste_pricing.json", JSON.stringify({ pricedAt: new Date().toISOString(), haikuRate: haiku, sonnetRate: sonnet, rows, totalWorstUsd: total }, null, 1) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
