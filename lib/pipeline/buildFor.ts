/**
 * SESSION 27, STAGE 2 — A CARD FOR ANY COMPANY (sessions/27/stage2_summary.md; pipeline_design §1-§3).
 *
 * The eleven stages, each reported as it runs (the progress view). A cached build is proven free first (assertFree)
 * and rebuilt at $0. A cold build is priced from pre-call counts and decided against the caps and the demo allowance;
 * in this build no stage bills (BILLING is off until Akshay approves a billed build): a cold build stops at its price,
 * and a facts stage that would bill is reported as not run.
 */
import { checkFree, assertFree } from "../cache/freeRun";
import { resolveReadSet } from "../cache/readSet";
import { runAgentLoop } from "../agent";
import { captureCardInput } from "../cards/capture/snapshot";
import { factsForBuild } from "../cards/capture/factsForBuild";
import { buildCard } from "../cards/build";
import { briefDateFor } from "../cards/briefDate";
import { deriveGoldenState, compareToGolden } from "../events/golden";
import { EXTRACTION_PROMPT_VERSION } from "../cache/promptVersion";
import { anchorTextOf } from "../cache/anchorText";
import { assertFilingListCurrent } from "../fetch/freshFilings";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decideBadge, type Badge } from "./badge";
import { decide, allowanceUsd, type SpendDecision } from "./caps";
import { priceColdBuild, type PricedBuild } from "./price";
import type { CompanyMatch } from "./resolve";

export const STAGES = [
  "Find the company", "Get its filings", "Choose the anchor", "Decide what to read", "Check the cache", "Price it",
  "Read the debt (3 samples)", "Extra reads, only when needed", "Read the card facts", "Apply the rules and checks", "Render",
] as const;
export type StageName = typeof STAGES[number];
export type BuildEvent = { stage: StageName; status: "running" | "done" | "skipped" | "stopped"; detail: string };
export type BuildOutcome =
  | { kind: "card"; badge: Badge; reasons: string[]; card: any; costUsd: number }
  | { kind: "could-not-build"; stage: StageName; reason: string }
  | { kind: "priced"; decision: SpendDecision; price: PricedBuild; company: CompanyMatch };

const SAMPLES: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

export async function buildFor(company: CompanyMatch, opts: { emit: (e: BuildEvent) => void; userSpentToday?: number; globalSpentToday?: number; paying?: boolean }): Promise<BuildOutcome> {
  const emit = opts.emit;
  const stop = (stage: StageName, reason: string): BuildOutcome => { emit({ stage, status: "stopped", detail: reason }); return { kind: "could-not-build", stage, reason }; };
  emit({ stage: "Find the company", status: "done", detail: `${company.title} (${company.ticker}, CIK ${company.cik})` });
  const name = company.title;
  try {
    emit({ stage: "Get its filings", status: "running", detail: "re-fetching the filing list from EDGAR" });
    await quiet(() => assertFilingListCurrent(name));
    const rs = await quiet(() => resolveReadSet(name));
    emit({ stage: "Get its filings", status: "done", detail: `${rs.filingsResult.filings.length} filings in the list this card's read set may see` });
    if (!rs.anchor) return stop("Choose the anchor", "no quarterly or annual report on file");
    emit({ stage: "Choose the anchor", status: "done", detail: `${rs.anchor.form} filed ${rs.anchor.filingDate}, for the period ended ${rs.anchor.reportDate}` });
    emit({ stage: "Decide what to read", status: "done", detail: `${rs.readSet.length} documents (read set ${rs.fingerprint.slice(0, 8)}): ${rs.readSet.map((f) => `${f.form} ${f.filingDate}`).join(", ")}` });
    const verdicts = [];
    for (const b of SAMPLES) verdicts.push({ b, v: await quiet(() => checkFree(name, b)) });
    const uncached = verdicts.filter((x) => !x.v.cached).map((x) => x.b);
    emit({ stage: "Check the cache", status: "done", detail: uncached.length ? `${3 - uncached.length} of 3 samples built before on these documents` : "built before on these exact documents: rebuilt free" });
    if (uncached.length) {
      emit({ stage: "Price it", status: "running", detail: "counting every call the build would make" });
      const price = await quiet(() => priceColdBuild(name, rs, uncached));
      const decision = decide({ cached: false, worstUsd: price.worstUsd, userSpentToday: opts.userSpentToday ?? 0, globalSpentToday: opts.globalSpentToday ?? 0, allowanceUsd: allowanceUsd(), paying: !!opts.paying });
      emit({ stage: "Price it", status: decision.kind === "refused" ? "stopped" : "done", detail: `worst case $${price.declaredUsd.toFixed(2)}; typical $${price.expectedRangeUsd[0].toFixed(2)}–$${price.expectedRangeUsd[1].toFixed(2)}` });
      return { kind: "priced", decision, price, company };
    }
    emit({ stage: "Price it", status: "done", detail: "$0: every answer is cached" });
    await quiet(() => assertFree(SAMPLES.map((b) => ({ company: name, bust: b }))));
    delete process.env.CACHE_BUST;
    const result = JSON.parse(JSON.stringify(await quiet(() => runAgentLoop(name))));
    const samples = [result];
    for (const b of SAMPLES.slice(1)) { process.env.CACHE_BUST = b!; samples.push(JSON.parse(JSON.stringify(await quiet(() => runAgentLoop(name))))); }
    delete process.env.CACHE_BUST;
    emit({ stage: "Read the debt (3 samples)", status: "done", detail: "3 samples served from cache, $0" });
    emit({ stage: "Extra reads, only when needed", status: "done", detail: "served with each sample's cached answer, $0" });
    const briefDate = briefDateFor();
    const input = await quiet(() => captureCardInput(result, { fingerprint: rs.fingerprint, commit: "live", source: "Stage 2 pipeline", briefDate }));
    const adopted = factsForBuild(input);
    emit({ stage: "Read the card facts", status: adopted.source === "adopted" ? "done" : "skipped", detail: adopted.source === "adopted" ? "the facts reviewed for this anchor, $0" : "not run: no reviewed facts for this anchor, and running the stage would bill (billing is off); the card says which sections are not yet read" });
    // Checks: the card's own, stability across the three samples, and the signed golden.
    const anchorText = await quiet(() => anchorTextOf(result));
    const asOf = new Date(`${rs.anchor.reportDate}T00:00:00Z`);
    const canon = deriveGoldenState(result, asOf, { anchorText });
    const reproducing = 1 + samples.slice(1).filter((s) => compareToGolden(canon, deriveGoldenState(s, asOf, { anchorText })).kind === "matches").length;
    const gPath = join("baselines", "golden", `${company.cik}.json`);
    let goldenReproduces = false;
    if (existsSync(gPath)) {
      const g = JSON.parse(readFileSync(gPath, "utf-8"));
      if (g.extractionVersion === EXTRACTION_PROMPT_VERSION) goldenReproduces = compareToGolden(g.state, deriveGoldenState(result, new Date(`${g.state.asOf}T00:00:00Z`), { anchorText })).kind === "matches";
    }
    const weekFrom = new Date(Date.parse(`${briefDate}T00:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
    const weekFilings = (input.laterFilings ?? []).filter((f: any) => f.filingDate >= weekFrom && f.filingDate <= briefDate).map((f: any) => ({ form: f.form, filingDate: f.filingDate, items: f.items ?? "", primaryDocUrl: f.url, accessionNumber: "", reportDate: "", primaryDocument: "" }));
    const card = buildCard({ result, briefDate, previousBrief: null, weekFilings, cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= briefDate).map((x: any) => x.url), facts: adopted.facts });
    const bd = decideBadge({ stoppedAt: null, goldenReproduces, cardChecksFailed: card.v3?.checks === "failed", failures: [], samplesReproducing: reproducing, samples: 3 });
    emit({ stage: "Apply the rules and checks", status: "done", detail: `${reproducing} of 3 samples reproduce; ${card.v3?.checks === "failed" ? "the coverage check fails" : "the card's checks hold"}${goldenReproduces ? "; matches its signed review" : ""}` });
    emit({ stage: "Render", status: "done", detail: "the card, every figure linked to its sentence" });
    return { kind: "card", badge: bd.badge, reasons: bd.reasons, card, costUsd: 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = /ReadFailed|could not be read|fetch/i.test(msg) ? `a filing could not be read (${msg.slice(0, 160)})` : /REFUSING TO RUN/.test(msg) ? "the answers this build needs are not cached, and billing is off" : msg.slice(0, 200);
    return stop("Render", reason);
  }
}
