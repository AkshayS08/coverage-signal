/**
 * SESSION 27, STAGE 2 — RING 1, PRICED FROM PRE-CALL COUNTS (Akshay, Nov 13, 2026). $0: no billed call.
 *
 * Ring 1 puts the six signed names through the full pipeline — three samples (the canonical and the two re-tastes the
 * signed refreshes used), the referenced 10-K note where the anchor directs to it, the dig budget, proceeds-use, and the
 * card-facts stage with its debt-item 8-Ks — and compares each card with production, field by field. It runs AS OF the
 * production brief (read set and brief date 2026-11-09, on a filing list fetched fresh), so a difference is the
 * pipeline's, not a filing that landed since.
 *
 * The price is the call set the run would make (callSet rule, Nov 9): a sample whose answer is cached costs $0 and is
 * listed as such; each uncached call is counted from its real prompt in price-only mode, at its worst case. Card-facts
 * asks are priced only where uncached for the input the run builds (facts.ts --status, then --price). Declared figures
 * round up to the cent. Writes sessions/27/ring1/pricing.json.
 *
 * Needs an API key for the token counter only. Run: CACHE_NO_WRITE=1 npx tsx lib/cache/s27ring1.ts --price
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runAgentLoop } from "../agent";
import { classifyOneTrigger } from "../agent/claude";
import { setPriceOnly, pricedCalls } from "../agent/spendGuard";
import { priceOf } from "../agent/costMeter";
import { getFilingText, getRecentFilings } from "../fetch";
import { assertFilingListCurrent } from "../fetch/freshFilings";
import { readSetOf, digCandidatesOf, anchorOf } from "./readSet";
import { checkFree } from "./freeRun";
import { buildExtractionText } from "../fetch/noteLocation";
import { TRIGGERS } from "../agent/triggers";
import { readCache } from "../fetch/cache";
import { transcribeReferencedNote, REFERENCED_NOTE_PROMPT_VERSION } from "../agent/referencedNote";
import { captureCardInput } from "../cards/capture/snapshot";

export const RING1_BRIEF = "2026-11-09";
export const RING1_NAMES = ["TENET HEALTHCARE CORP", "Encompass Health Corp", "DAVITA INC.", "COMMUNITY HEALTH SYSTEMS INC", "MOLINA HEALTHCARE, INC.", "Cigna Group"];
export const RING1_SAMPLES: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const DIG_BUDGET = 5;
const DIR = "sessions/27/ring1";
const ceilCent = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };
const LEDGER = readFileSync("baselines/cost-log.jsonl", "utf-8").trim().split("\n").map((l) => JSON.parse(l));

(async () => {
  if (!process.argv.includes("--price")) { console.error("REFUSING: Ring 1 is priced first (--price); billing waits for Akshay's approval of the declared figure"); process.exit(1); }
  if (process.env.CACHE_NO_WRITE !== "1") { console.error("REFUSING: pricing never writes the shared cache; run with CACHE_NO_WRITE=1"); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("the token counter needs a key; no call is made"); process.exit(1); }
  process.env.READ_SET_AS_OF = RING1_BRIEF;
  setPriceOnly(true);
  const sonnet = priceOf("claude-sonnet-5")!;
  mkdirSync(`${DIR}/inputs`, { recursive: true });
  const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  const rows: any[] = [];
  for (const company of RING1_NAMES) {
    await quiet(() => assertFilingListCurrent(company));
    const f = await quiet(() => getRecentFilings(company, ["8-K", "10-Q", "10-K"]));
    const rs = readSetOf(f.filings), anchor = anchorOf(rs)!;
    // Stages 5-7, per sample: cached (free) or the calls the run would make.
    const samples: { sample: string; cached: boolean; fingerprint: string }[] = [];
    for (const b of RING1_SAMPLES) { const v = await quiet(() => checkFree(company, b ?? undefined)); samples.push({ sample: b ?? "canonical", cached: v.cached, fingerprint: v.fingerprint }); }
    const missing = samples.filter((s) => !s.cached);
    let base: any = null, dig = 0, proceeds = 0, noteWorst = 0;
    const noteCached: Record<string, boolean> = {};
    const golden = JSON.parse(readFileSync(`baselines/golden/${f.cik}.json`, "utf-8"));
    const directsToTenK = !!golden.sourceResult?.results?.find((t: any) => t.triggerId === "debt-maturity")?.priorPeriodBase;
    if (missing.length) {
      process.env.CACHE_BUST = missing[0].sample === "canonical" ? "" : missing[0].sample;
      if (!process.env.CACHE_BUST) delete process.env.CACHE_BUST;
      const n0 = pricedCalls().length;
      await quiet(() => runAgentLoop(company)).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
      delete process.env.CACHE_BUST;
      base = pricedCalls().slice(n0)[0];
      const rsAcc = new Set(rs.map((x) => x.accessionNumber));
      const cand = digCandidatesOf(f.filings).find((x) => !rsAcc.has(x.accessionNumber));
      if (cand) {
        const { text } = await getFilingText(cand.primaryDocUrl);
        const ex = buildExtractionText({ form: cand.form, url: cand.primaryDocUrl, fullText: text });
        const d0 = pricedCalls().length;
        await classifyOneTrigger({ companyName: f.company, trigger: TRIGGERS[0], priorVerdict: { triggerId: TRIGGERS[0].id, fired: false, needsDig: true } as any, extraDoc: { form: cand.form, filingDate: cand.filingDate, url: cand.primaryDocUrl, text: ex.text } } as any).catch((e: any) => { if (e?.name !== "PricedOnlyError") throw e; });
        dig = DIG_BUDGET * (pricedCalls().slice(d0)[0]?.worstUsd ?? 0);
      }
      const prior = LEDGER.filter((j) => j.company === company && j.at >= "2026-10-22T18:00" && j.at <= "2026-10-22T18:30").pop();
      const puIn = prior?.byModel?.find((m: any) => /sonnet/.test(m.model))?.inputTokens ?? 0;
      proceeds = puIn ? (Math.ceil(puIn * 1.25) * sonnet.input + 200 * sonnet.output) / 1e6 : 0;
      const tenK = rs.find((x) => x.form === "10-K") ?? f.filings.find((x) => x.form === "10-K");
      if (directsToTenK && tenK) {
        for (const s of missing) {
          const b = s.sample === "canonical" ? null : s.sample;
          const key = `answer/${f.cik}/referenced-note/${createHash("sha256").update(tenK.primaryDocUrl).digest("hex")}${b ? `-bust${b}` : ""}/rn-v${REFERENCED_NOTE_PROMPT_VERSION}.json`;
          noteCached[s.sample] = (await readCache(key, null)) !== null;
        }
        const { text } = await getFilingText(tenK.primaryDocUrl);
        const n1 = pricedCalls().length;
        await transcribeReferencedNote({ companyName: f.company, filingUrl: tenK.primaryDocUrl, filingForm: tenK.form, periodOfReport: tenK.reportDate ?? "", filingText: text, xbrlTotalForScale: null }).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
        noteWorst = pricedCalls().slice(n1)[0]?.worstUsd ?? NaN;
      }
    }
    const notesBilled = missing.filter((s) => directsToTenK && !noteCached[s.sample]).length;
    // The card-facts stage: on the card input the run builds. Where the canonical answer is cached, that input is
    // built now at $0 and its asks checked against the cache; where it is not, all three asks are priced as uncached.
    let factsUncached = 3, factsPerAsk = NaN, factsHash: string | null = null;
    const inPath = `${DIR}/inputs/${f.cik}.json`;
    if (samples[0].cached) {
      const result = JSON.parse(JSON.stringify(await quiet(() => runAgentLoop(company))));
      const input = await quiet(() => captureCardInput(result, { fingerprint: samples[0].fingerprint, commit, source: "RING 1: the full pipeline as of the production brief, $0 from cache", briefDate: RING1_BRIEF }));
      writeFileSync(inPath, JSON.stringify(input) + "\n");
      const st = execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", RING1_BRIEF, "--input", inPath, "--status"], { encoding: "utf-8", shell: true, env: { ...process.env, ANTHROPIC_API_KEY: "" } });
      const m = /hash (\w+) uncached-asks ([\d,]+|none)/.exec(st);
      factsHash = m?.[1] ?? null;
      factsUncached = !m ? 3 : m[2] === "none" ? 0 : m[2].split(",").length;
    }
    let factsStandIn = false;
    if (factsUncached > 0) {
      // Where the canonical is uncached, the run's facts input cannot exist before its extraction: the published card
      // input (the same anchor's documents) stands in for the count, and the record says so.
      const priceInput = samples[0].cached ? inPath : `lib/cards/inputs/${f.cik}.json`;
      factsStandIn = !samples[0].cached;
      const out = execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", RING1_BRIEF, "--input", priceInput, "--price"], { encoding: "utf-8", shell: true });
      factsPerAsk = Number((/worst \$([\d.]+)\/ask/.exec(out) ?? ["", "NaN"])[1]);
    }
    const facts = factsUncached * (factsUncached ? factsPerAsk : 0);
    const perSample = (base?.worstUsd ?? 0) + dig + proceeds;
    const worst = missing.length * perSample + notesBilled * noteWorst + facts;
    rows.push({
      company, cik: f.cik, anchor: `${anchor.form} ${anchor.filingDate} (period ${anchor.reportDate})`,
      samples, uncachedSamples: missing.length, basePerSampleWorst: base?.worstUsd ?? 0, digWorstPerSample: dig, proceedsEstimatePerSample: proceeds,
      referencedNote: directsToTenK ? { uncached: notesBilled, worstEach: noteWorst } : null,
      facts: { inputHash: factsHash, uncachedAsks: factsUncached, worstPerAsk: factsUncached ? factsPerAsk : 0, worst: facts, pricedOnPublishedInputAsStandIn: factsStandIn },
      worst, declared: ceilCent(worst),
    });
    console.log(`${company.padEnd(30)} ${anchor.form} ${anchor.filingDate}: samples cached ${samples.filter((s) => s.cached).length}/3${missing.length ? ` (uncached: ${missing.map((s) => s.sample).join(", ")}; $${perSample.toFixed(4)} each)` : ""}${directsToTenK ? `; note uncached ${notesBilled}` : ""}; facts uncached ${factsUncached}/3${factsUncached ? ` at $${factsPerAsk.toFixed(4)}/ask` : ""} → worst $${worst.toFixed(4)}, declared $${ceilCent(worst).toFixed(2)}`);
  }
  const total = rows.reduce((a, r) => a + r.worst, 0);
  const declared = ceilCent(total);
  console.log(`\nRING 1 (as of ${RING1_BRIEF}): worst case $${total.toFixed(4)}, declared $${declared.toFixed(2)}. Nothing billed.`);
  writeFileSync(`${DIR}/pricing.json`, JSON.stringify({ pricedAt: new Date().toISOString(), asOf: RING1_BRIEF, commit, rows, worstUsd: Number(total.toFixed(4)), declaredUsd: declared }, null, 1) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
