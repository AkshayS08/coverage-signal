/**
 * SESSION 27, STAGE 2 — A CARD FOR ANY COMPANY (sessions/27/stage2_summary.md; pipeline_design §1-§3).
 *
 * The eleven stages, each reported as it runs (the progress view). A cached build is proven free first (assertFree)
 * and rebuilt at $0. A cold build is priced from pre-call counts and decided against the caps and the demo allowance.
 *
 * Nov 16: A BILLED BUILD runs only when billing is switched on (BUILD_BILLING=on), the build is confirmed, and its
 * declared price is within the approval. It runs under its own spend guard whose ceiling is that declared price, so no
 * call is made whose counted worst case would cross it; each uncached sample and the facts stage take a lease first, so
 * two builds never pay for the same answer. Every call made is reported with its worst case and its actual cost. A
 * build without billing bills nothing: a facts answer is served only if every ask is cached and not awaiting review.
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
import { factsValidFor } from "../cards/factsValidity";
import { cardFactsKey, isUnadopted } from "../cache/answerCache";
import { answerExists } from "../cache/freeRun";
import { existsSync as fileExists, readFileSync as readFile } from "node:fs";

/** The card facts for a read set: adopted (reviewed over it), cached (every ask answered over it), awaiting review, or needed. */
async function factsStateFor(cik: string, anchorUrl: string, readSetKey: string): Promise<"adopted" | "cached" | "awaiting review" | "needed"> {
  const p = `lib/cards/inputs/facts/${cik.padStart(10, "0")}.json`;
  if (fileExists(p)) { const a = JSON.parse(readFile(p, "utf-8")); if (a.anchorUrl === anchorUrl && a.readSet === readSetKey) return "adopted"; }
  const keys = [1, 2, 3].map((ask) => cardFactsKey(cik, readSetKey, CARD_FACTS_PROMPT_VERSION, ask));
  if (keys.some(isUnadopted)) return "awaiting review";
  for (const k of keys) if (!(await answerExists(k))) return "needed";
  return "cached";
}
import { decide, allowanceUsd, billingGate, type SpendDecision } from "./caps";
import { acquireLease, releaseLease, leaseKey } from "./leases";
import { withGuard, withPriceOnly, setDigAllowance, type MadeCall } from "../agent/spendGuard";
import { inRequestScope } from "../agent/requestScope";
import { extractFacts, factsReadOf, CARD_FACTS_PROMPT_VERSION } from "../cards/capture/facts";
import Anthropic from "@anthropic-ai/sdk";
import { priceColdBuild, type PricedBuild } from "./price";
import type { CompanyMatch } from "./resolve";

export const STAGES = [
  "Find the company", "Get its filings", "Choose the anchor", "Decide what to read", "Check the cache", "Price it",
  "Read the debt (3 samples)", "Extra reads, only when needed", "Read the card facts", "Apply the rules and checks", "Render",
] as const;
export type StageName = typeof STAGES[number];
export type BuildEvent = { stage: StageName; status: "running" | "done" | "skipped" | "stopped"; detail: string };
export type BuildOutcome =
  | { kind: "card"; badge: Badge; reasons: string[]; card: any; costUsd: number; price?: PricedBuild; calls?: MadeCall[]; facts?: { source: "adopted" | "read now" | "cached" | "not run"; keys: string[] } }
  | { kind: "could-not-build"; stage: StageName; reason: string; costUsd?: number; calls?: MadeCall[] }
  | { kind: "priced"; decision: SpendDecision; price: PricedBuild; company: CompanyMatch };

const SAMPLES: (string | null)[] = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

export interface BuildOpts {
  emit: (e: BuildEvent) => void; userSpentToday?: number; globalSpentToday?: number; paying?: boolean;
  /** The reader confirmed the price (the allowance's button, or the approval screen). */
  confirm?: boolean;
  /** The figure approved for this build; the build runs only if its declared price is within it. */
  approvedUsd?: number;
  /** Receives the card input and the facts the card was built with (the review scripts keep them). */
  keep?: (input: any, facts: any) => void;
}

export async function buildFor(company: CompanyMatch, opts: BuildOpts): Promise<BuildOutcome> {
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
    // Nov 16: the card facts too. They are needed unless adopted facts were read over this read set, or every ask is
    // cached under it; an answer awaiting review is neither served nor billed again.
    const fr = factsReadOf(rs);
    const factsState = await quiet(() => factsStateFor(company.cik, rs.anchor!.primaryDocUrl, fr.fingerprint));
    if (factsState === "awaiting review") return stop("Check the cache", "this read set's card facts were read and are awaiting review; nothing was charged");
    const factsNeeded = factsState === "needed";
    emit({ stage: "Check the cache", status: "done", detail: `${uncached.length ? `${3 - uncached.length} of 3 samples built before on these documents` : "every sample built before on these exact documents"}; card facts ${factsNeeded ? "not yet read for this read set" : factsState === "adopted" ? "reviewed for this read set" : "read before for this read set"}` });
    if (uncached.length || factsNeeded) {
      emit({ stage: "Price it", status: "running", detail: "counting every call the build would make" });
      const price = await quiet(() => priceColdBuild(name, rs, uncached, factsNeeded));
      const decision = decide({ cached: false, worstUsd: price.worstUsd, userSpentToday: opts.userSpentToday ?? 0, globalSpentToday: opts.globalSpentToday ?? 0, allowanceUsd: allowanceUsd(), paying: !!opts.paying });
      emit({ stage: "Price it", status: decision.kind === "refused" ? "stopped" : "done", detail: `worst case $${price.declaredUsd.toFixed(2)}; typical $${price.expectedRangeUsd[0].toFixed(2)}–$${price.expectedRangeUsd[1].toFixed(2)}` });
      const gate = billingGate({ billingOn: process.env.BUILD_BILLING === "on", confirm: !!opts.confirm, decision, declaredUsd: price.declaredUsd, approvedUsd: opts.approvedUsd });
      if (!gate.bill) return gate.why === "priced only" ? { kind: "priced", decision, price, company } : stop("Price it", gate.why);
      // Its own guard: the ceiling is the declared price (never above the approval); no call may cross it.
      // Digs draw only on what is left under it after the other stages' counted worst case (Oct 31).
      const others = price.calls.filter((c) => c.stage !== "dig budget").reduce((t, c) => t + c.count * c.worstEachUsd, 0);
      const g = await withGuard({ totalUsd: gate.ceilingUsd }, () => { setDigAllowance(gate.ceilingUsd - others); return read(true); });
      if (g.result.kind === "card") return { ...g.result, costUsd: g.spentUsd, price, calls: g.made };
      return g.result;
    }
    emit({ stage: "Price it", status: "done", detail: "$0: every answer is cached" });
    return await read(false);

    async function read(billing: boolean): Promise<BuildOutcome> {
    if (!billing) await quiet(() => assertFree(SAMPLES.map((b) => ({ company: name, bust: b }))));
    const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const leased = async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (!(await acquireLease(key, owner))) throw new Error("another build is reading this company's filings right now; nothing was charged for this one — try again in a few minutes");
      try { return await fn(); } finally { await releaseLease(key, owner); }
    };
    // Each sample read in this request's own scope (its cache-bust tag), never through the process env.
    const samples: any[] = [];
    for (const b of SAMPLES) {
      const one = () => inRequestScope({ cacheBust: b }, () => quiet(() => runAgentLoop(name)));
      const r = billing && uncached.includes(b) ? await leased(leaseKey(company.cik, rs.fingerprint, EXTRACTION_PROMPT_VERSION, b), one) : await one();
      samples.push(JSON.parse(JSON.stringify(r)));
    }
    const result = samples[0];
    emit({ stage: "Read the debt (3 samples)", status: "done", detail: billing ? `${uncached.length} of 3 samples read now, ${3 - uncached.length} from cache` : "3 samples served from cache, $0" });
    emit({ stage: "Extra reads, only when needed", status: "done", detail: billing ? "digs, the referenced 10-K note and proceeds-use read where each sample needed them" : "served with each sample's cached answer, $0" });
    const briefDate = briefDateFor();
    const input = await quiet(() => captureCardInput(result, { fingerprint: rs.fingerprint, commit: "live", source: "Stage 2 pipeline", briefDate }));
    // The card facts: production's adopted facts for this anchor; else the stage over the read set — read now when
    // billing, else served only if every ask is cached and not awaiting review, never billed.
    const adopted = factsForBuild(input);
    let factsUsed = adopted.facts;
    let factsInfo: { source: "adopted" | "read now" | "cached" | "not run"; keys: string[] } = { source: adopted.source === "adopted" ? "adopted" : "not run", keys: [] };
    if (adopted.source === "adopted") emit({ stage: "Read the card facts", status: "done", detail: "the facts reviewed for this anchor, $0" });
    else {
      const readFacts = () => extractFacts(input, factsReadOf(rs), new Anthropic());
      if (billing) {
        const run = await leased(leaseKey(company.cik, rs.fingerprint, CARD_FACTS_PROMPT_VERSION, `card-facts-v${CARD_FACTS_PROMPT_VERSION}`), readFacts);
        factsUsed = run.facts; factsInfo = { source: run.hits === 3 ? "cached" : "read now", keys: run.keys };
        emit({ stage: "Read the card facts", status: "done", detail: `${3 - run.hits} of 3 asks read now over the read set, ${run.hits} from cache; not yet reviewed` });
      } else {
        const served = await withPriceOnly(readFacts).then((x) => x.result, (e: unknown) => (e instanceof Error ? e : new Error(String(e))));
        if (served instanceof Error) emit({ stage: "Read the card facts", status: "skipped", detail: served.name === "UnadoptedAnswerError" ? "not shown: this read set's facts are awaiting review" : "not run: no reviewed facts for this read set, and reading them would bill; the card says which sections are not yet read" });
        else { factsUsed = served.facts; factsInfo = { source: "cached", keys: served.keys }; emit({ stage: "Read the card facts", status: "done", detail: "the facts read before over this read set, $0" }); }
      }
    }
    opts.keep?.(input, factsUsed);
    // Checks: the card's own, stability across the three samples, and the signed golden.
    const anchorText = await quiet(() => anchorTextOf(result));
    const asOf = new Date(`${rs.anchor!.reportDate}T00:00:00Z`);
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
    const card = buildCard({ result, briefDate, previousBrief: null, weekFilings, cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= briefDate).map((x: any) => x.url), facts: factsUsed });
    const bd = decideBadge({ stoppedAt: null, goldenReproduces, cardChecksFailed: card.v3?.checks === "failed", failures: [], samplesReproducing: reproducing, samples: 3, factsRead: factsValidFor(factsUsed, result, rs.anchor!.primaryDocUrl) });
    emit({ stage: "Apply the rules and checks", status: "done", detail: `${reproducing} of 3 samples reproduce; ${card.v3?.checks === "failed" ? "the coverage check fails" : "the card's checks hold"}${goldenReproduces ? "; matches its signed review" : ""}` });
    emit({ stage: "Render", status: "done", detail: "the card, every figure linked to its sentence" });
    return { kind: "card", badge: bd.badge, reasons: bd.reasons, card, costUsd: 0, facts: factsInfo };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = /ReadFailed|could not be read|fetch/i.test(msg) ? `a filing could not be read (${msg.slice(0, 160)})` : /REFUSING TO RUN/.test(msg) ? "the answers this build needs are not cached, and billing is off" : msg.slice(0, 200);
    const spent = (e as any)?.spentUsd as number | undefined;
    return { ...stop("Render", spent ? `${reason} (spent ${spent.toFixed(4)} before stopping)` : reason), ...(spent !== undefined ? { costUsd: spent, calls: (e as any).made } : {}) };
  }
}
