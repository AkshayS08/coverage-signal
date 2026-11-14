/**
 * SESSION 27, STAGE 2 — STEP 6, PRICE A COLD BUILD (pipeline_design §6). $0: token counts only.
 *
 * Every call the run would make (the call-set rule, Nov 9), each counted from its real prompt in price-only mode at its
 * worst case (max_tokens): per uncached sample the base extraction, the referenced 10-K note where the anchor is a 10-Q
 * and a 10-K is on file, the dig budget (5) over the first candidate outside the read set, and proceeds-use (an
 * estimate: it reads a base answer that does not exist yet); then the card-facts stage, three asks over the anchor.
 * The expected cost beside it is the ledger's range for a name of this shape. Declared figures round up to the cent.
 */
import { runAgentLoop } from "../agent";
import { classifyOneTrigger } from "../agent/claude";
import { setPriceOnly, pricedCalls, guardedCreate } from "../agent/spendGuard";
import { priceOf } from "../agent/costMeter";
import { getFilingText } from "../fetch";
import { buildExtractionText } from "../fetch/noteLocation";
import { TRIGGERS } from "../agent/triggers";
import { transcribeReferencedNote } from "../agent/referencedNote";
import { inputFor, SYSTEM, SCHEMA, MODEL, ASKS } from "../cards/capture/facts";
import type { ResolvedReadSet } from "../cache/readSet";
import { digCandidatesOf } from "../cache/readSet";
import { ceilCent } from "./caps";
import Anthropic from "@anthropic-ai/sdk";

export const DIG_BUDGET = 5;
/** The ledger's range for a cold build of three samples (Oct 22 canonical runs; Encompass's refresh $0.65). */
export const EXPECTED_RANGE_USD: [number, number] = [0.5, 0.9];
const PROCEEDS_ESTIMATE_INPUT_TOKENS = 6000;

export interface PricedBuild { worstUsd: number; declaredUsd: number; expectedRangeUsd: [number, number]; calls: { stage: string; sample: string; count: number; worstEachUsd: number; estimate?: boolean }[] }

export async function priceColdBuild(company: string, rs: ResolvedReadSet, uncachedSamples: (string | null)[]): Promise<PricedBuild> {
  const calls: PricedBuild["calls"] = [];
  const counted = async (fn: () => Promise<unknown>) => { const n0 = pricedCalls().length; await fn().catch((e) => { if (e?.name !== "PricedOnlyError") throw e; }); return pricedCalls().slice(n0)[0]?.worstUsd ?? NaN; };
  setPriceOnly(true);
  try {
    if (uncachedSamples.length) {
      const prior = process.env.CACHE_BUST;
      const s0 = uncachedSamples[0];
      if (s0) process.env.CACHE_BUST = s0; else delete process.env.CACHE_BUST;
      const base = await counted(() => runAgentLoop(company));
      if (prior === undefined) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = prior;
      for (const s of uncachedSamples) calls.push({ stage: "base extraction", sample: s ?? "canonical", count: 1, worstEachUsd: base });
      const inRs = new Set(rs.readSet.map((f) => f.accessionNumber));
      const cand = digCandidatesOf(rs.filingsResult.filings).find((f) => !inRs.has(f.accessionNumber));
      if (cand) {
        const { text } = await getFilingText(cand.primaryDocUrl);
        const ex = buildExtractionText({ form: cand.form, url: cand.primaryDocUrl, fullText: text });
        const dig = await counted(() => classifyOneTrigger({ companyName: rs.filingsResult.company, trigger: TRIGGERS[0], priorVerdict: { triggerId: TRIGGERS[0].id, fired: false, needsDig: true } as any, extraDoc: { form: cand.form, filingDate: cand.filingDate, url: cand.primaryDocUrl, text: ex.text } } as any));
        for (const s of uncachedSamples) calls.push({ stage: "dig budget", sample: s ?? "canonical", count: DIG_BUDGET, worstEachUsd: dig });
      }
      const sonnet = priceOf("claude-sonnet-5")!;
      const proceeds = (PROCEEDS_ESTIMATE_INPUT_TOKENS * sonnet.input + 200 * sonnet.output) / 1e6;
      for (const s of uncachedSamples) calls.push({ stage: "proceeds-use", sample: s ?? "canonical", count: 1, worstEachUsd: proceeds, estimate: true });
      const tenK = rs.filingsResult.filings.find((f) => f.form === "10-K");
      if (rs.anchor?.form === "10-Q" && tenK) {
        const { text } = await getFilingText(tenK.primaryDocUrl);
        const note = await counted(() => transcribeReferencedNote({ companyName: rs.filingsResult.company, filingUrl: tenK.primaryDocUrl, filingForm: tenK.form, periodOfReport: tenK.reportDate ?? "", filingText: text, xbrlTotalForScale: null }));
        for (const s of uncachedSamples) calls.push({ stage: "referenced 10-K note", sample: s ?? "canonical", count: 1, worstEachUsd: note });
      }
    }
    // The card-facts stage over the anchor's own text (its input before extraction: the anchor alone).
    if (rs.anchor) {
      const { text } = await getFilingText(rs.anchor.primaryDocUrl);
      const stub = { cik: rs.filingsResult.cik, company: rs.filingsResult.company, result: { cik: rs.filingsResult.cik, company: rs.filingsResult.company, results: [{ triggerId: "debt-maturity", debtScheduleSourceFiling: { form: rs.anchor.form, date: rs.anchor.filingDate, reportDate: rs.anchor.reportDate, url: rs.anchor.primaryDocUrl } }] }, docs: { [rs.anchor.primaryDocUrl]: { label: `${rs.anchor.form} ${rs.anchor.filingDate}`, text } }, laterFilings: [], debtEightKs: [] };
      const client = new Anthropic();
      const facts = await counted(() => guardedCreate(client, { model: MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: inputFor(stub) }], tools: [{ name: "submit_facts", description: "Submit the transcribed facts.", input_schema: SCHEMA as any }], tool_choice: { type: "tool", name: "submit_facts" } } as any));
      calls.push({ stage: "card facts", sample: "facts", count: ASKS, worstEachUsd: facts });
    }
  } finally { setPriceOnly(false); }
  const worst = calls.reduce((a, c) => a + c.count * c.worstEachUsd, 0);
  return { worstUsd: worst, declaredUsd: ceilCent(worst), expectedRangeUsd: EXPECTED_RANGE_USD, calls };
}
