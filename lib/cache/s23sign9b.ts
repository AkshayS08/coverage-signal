/**
 * THE SIGNING RUN — one name at a time, diff first, 9b second.
 *
 * TWO THINGS, REPORTED SEPARATELY, because the signer clears them separately:
 *
 *   [A] THE DIFF. What changes if this golden is written — the canonical
 *       answer against the golden already on disk, field by field. Costs
 *       NOTHING: the canonical answer is the cold pass, already cached.
 *
 *   [B] 9b. Does the position reproduce at this version? Under the standing
 *       rule the CANONICAL COLD-PASS RUN IS SAMPLE 1, so this buys two
 *       re-tastes, not three. That rule is why sample 1 below is a cache hit
 *       and is compared as an equal against the two that bill — it is not a
 *       baseline the re-tastes are measured against, it is one of the three.
 *
 * REPRO_RUNS=0 does [A] alone, at $0. That is the intended first pass: every
 * diff read before any re-taste is bought.
 *
 * AND THE FACILITY FIGURES, measured separately and never folded into 9b —
 * 9b covers the POSITION, and `drawn` has given two different answers at one
 * version in this session. A pass on one with a failure on the other is a
 * real outcome and has to be readable as one.
 *
 * Run: npx tsx lib/cache/s23sign9b.ts "Tenet Healthcare" ...
 *      REPRO_RUNS=0 npx tsx lib/cache/s23sign9b.ts "Tenet Healthcare"   ($0, diff only)
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import {
  deriveGoldenState, compareToGolden, compareGoldenFile, unsupportedAmountRows,
  filingSetOf, amountKey, sameAmount, type GoldenFile, type GoldenState,
} from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const RETASTES = Number(process.env.REPRO_RUNS ?? 2);
const BUST_TAG = process.env.REPRO_TAG ?? "s23-sign";
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;
const COMPANIES = process.argv.slice(2);

interface Fig { value: string; sourceLine: string }
interface Snap { label: string; state: GoldenState; figures: string[]; cost: number }

function figuresOf(result: { results: { triggerId: string; facilities?: unknown }[] }): string[] {
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
  return facs.flatMap((f) => FIELDS.map((k) => `${String(f.name)}.${k} = ${(f[k] as Fig | null)?.value ?? "null"}`)).sort();
}

/**
 * 9b BY THE COMPARATOR THE SIGNATURE IS MADE UNDER, not by string equality.
 * A harness stricter than the signature it gates is measuring a different
 * thing and reporting it under the signature's name — Session 23 printed
 * fourteen "divergences" for UHS that way, eleven of which were whitespace
 * and renames.
 */
function nineB(snaps: Snap[]): { holds: boolean; divergences: string[]; tolerated: string[] } {
  const divergences: string[] = [], tolerated: string[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const v = compareToGolden(snaps[0].state, snaps[i].state);
    if (v.kind === "not-applicable") {
      // THE VERDICT IS RIGHT AND THE SENTENCE IS NOT. `compareToGolden`'s
      // not-applicable text says the corpus "is no longer the one on EDGAR"
      // — true when a golden signed weeks ago is checked today, and false
      // here. `filingSetOf` reads CITATIONS, and these two runs are minutes
      // apart at one version, so a moved filing set means the MODEL cited a
      // different set of documents. That is not a reason to stop comparing;
      // it is precisely the instability 9b exists to catch, and it is named
      // as that rather than quoted as a corpus move.
      const a = snaps[0].state.filingSet, b = snaps[i].state.filingSet;
      const added = b.filter((u) => !a.includes(u)), removed = a.filter((u) => !b.includes(u));
      divergences.push(
        `${snaps[0].label} vs ${snaps[i].label}: THE TWO RUNS CITED DIFFERENT DOCUMENTS — ${added.length} cited only by the later run, ${removed.length} cited only by the canonical run. ` +
        `EDGAR did not move between these runs; the model's own citation set did.` +
        added.map((u) => `\n              + only in ${snaps[i].label}: ${u}`).join("") +
        removed.map((u) => `\n              − only in ${snaps[0].label}: ${u}`).join("")
      );
      continue;
    }
    for (const t of v.tolerated) tolerated.push(`${snaps[0].label} vs ${snaps[i].label}: ${t}`);
    if (v.kind === "diverged") divergences.push(...v.divergences.map((d) => `${snaps[0].label} vs ${snaps[i].label}: ${d}`));
  }
  return { holds: divergences.length === 0, divergences, tolerated };
}

/**
 * Row identity off the LABEL and off the WHITESPACE, the same way the
 * signature's comparator does it. The first draft keyed on the raw amount
 * string, so v29's "$1,500 million" against v31's "$ 1,500    millions"
 * printed twelve Tenet rows as twelve gone and twelve arrived — a diff
 * stricter than the signature it is shown in support of.
 */
const rowKey = (r: GoldenState["rows"][number]) => `${amountKey(r.amount) ?? r.amount}|${r.maturityDate}|${r.isCapacity}`;

function diffAgainstGolden(g: GoldenFile, now: GoldenState): void {
  console.log(`\n  [A] THE DIFF — golden v${g.extractionVersion} signed ${g.signature.signedOn}, against the canonical answer at v${EXTRACTION_PROMPT_VERSION}\n`);
  console.log(`      rows   ${g.state.rows.length} signed → ${now.rows.length} now`);

  const byKey = new Map(now.rows.map((r) => [rowKey(r), r]));
  const diffs: string[] = [];
  for (const p of g.state.rows) {
    const f = byKey.get(rowKey(p));
    if (!f) { diffs.push(`ROW GONE: ${p.instrument} | ${p.amount} | ${p.maturityDate}`); continue; }
    byKey.delete(rowKey(p));
    for (const field of ["instrument", "amount", "maturityDate", "dateGranularity", "provenance", "isCapacity", "sourceLine"] as const) {
      // `amount` is judged by value and unit, by the same function the
      // comparator uses. Every other field is a string and compares as one.
      const same = field === "amount" ? sameAmount(p[field], f[field]) : String(p[field]) === String(f[field]);
      if (same) continue;
      diffs.push(`${p.instrument} · ${field}\n            was "${String(p[field]).replace(/\s+/g, " ")}"\n            now "${String(f[field]).replace(/\s+/g, " ")}"`);
    }
  }
  for (const [, r] of byKey) diffs.push(`ROW NEW: ${r.instrument} | ${r.amount} | ${r.maturityDate}`);
  console.log(`      ${diffs.length === 0 ? "no row field moved" : `${diffs.length} row field(s) moved:`}`);
  for (const d of diffs) console.log(`          ${d}`);

  const cov: string[] = [];
  for (const k of ["denominatorSource", "statedTotalDebt", "capturedFace", "statedBridge", "residualPercent", "residualPasses"] as const) {
    const a = (g.state.coverage as Record<string, unknown>)[k], b = (now.coverage as Record<string, unknown>)[k];
    if (String(a) !== String(b)) cov.push(`coverage.${k}: ${String(a)} → ${String(b)}`);
  }
  console.log(`      ${cov.length === 0 ? "coverage unchanged" : `${cov.length} coverage field(s) moved:`}`);
  for (const c of cov) console.log(`          ${c}`);
  console.log(`      cards  ${g.state.cards.length} signed → ${now.cards.length} now`);

  const added = now.filingSet.filter((u) => !g.state.filingSet.includes(u));
  const removed = g.state.filingSet.filter((u) => !now.filingSet.includes(u));
  console.log(`      filing set  ${g.state.filingSet.length} signed → ${now.filingSet.length} now`);
  for (const a of added) console.log(`          + ${a}`);
  for (const r of removed) console.log(`          − ${r}   (pinned by the signature, no longer in the set)`);

  // THE DISPOSITION, which is a different question from the content of the
  // diff. Across a version bump the guard declines to judge at all, and that
  // is correct — but declining to judge is not the same as nothing having
  // moved, so the STATE comparison is run and shown underneath it.
  const verdict = compareGoldenFile(g, now, EXTRACTION_PROMPT_VERSION);
  console.log(`\n      disposition (version guard first): ${verdict.kind.toUpperCase()}`);
  if (verdict.kind === "not-applicable") console.log(`          ${verdict.reason}`);

  const stateVerdict = compareToGolden(g.state, now);
  console.log(`\n      and the STATE comparison underneath it: ${stateVerdict.kind.toUpperCase()}`);
  if (stateVerdict.kind === "not-applicable") console.log(`          ${stateVerdict.reason}`);
  if (stateVerdict.kind === "diverged") for (const d of stateVerdict.divergences) console.log(`          ${d}`);
  if ("tolerated" in stateVerdict && stateVerdict.tolerated.length) {
    console.log(`          TOLERATED (${stateVerdict.tolerated.length}) — these go into the signature basis, never dropped:`);
    for (const t of stateVerdict.tolerated) console.log(`              ${t}`);
  }
}

(async () => {
  if (COMPANIES.length === 0) { console.error("Name at least one company."); process.exit(1); }
  let grand = 0;

  for (const company of COMPANIES) {
    console.log(`\n${"=".repeat(104)}`);
    console.log(`${company} — v${EXTRACTION_PROMPT_VERSION}, as-of ${PINNED_AS_OF_DAY}`);
    console.log("=".repeat(104));

    // SAMPLE 1 IS THE CANONICAL ANSWER — the cold-pass run, by the standing
    // rule. A cache hit, so it costs nothing, and it is what a golden pins.
    const canonical = await runAgentLoop(company);
    const c1 = currentCompanySpend().totalUsd;
    grand += c1;
    const state1 = deriveGoldenState(canonical, PINNED_AS_OF);
    const snaps: Snap[] = [{ label: "run 1 (canonical)", state: state1, figures: figuresOf(canonical), cost: c1 }];

    const path = join(GOLDEN_DIR, `${canonical.cik.padStart(10, "0")}.json`);
    if (existsSync(path)) diffAgainstGolden(JSON.parse(readFileSync(path, "utf-8")) as GoldenFile, state1);
    else console.log(`\n  [A] THE DIFF — no golden on disk. FIRST SIGNATURE: there is nothing to diff against, and ${state1.rows.length} row(s) would be pinned.`);

    const unsupported = unsupportedAmountRows(state1);
    console.log(`\n      Rule 58: ${unsupported.length === 0 ? "every row's amount is stated by the sentence shown beside it" : `${unsupported.length} row(s) would REFUSE a signature:`}`);
    for (const u of unsupported) console.log(`          ${u}`);
    console.log(`      filings pinned: ${filingSetOf(canonical).length}`);

    if (RETASTES <= 0) { console.log(`\n  [B] 9b — not run (REPRO_RUNS=0). $0 pass: the diff only.`); continue; }

    console.log(`\n  [B] 9b — ${RETASTES} re-taste(s); sample 1 is the canonical run above\n`);
    for (let i = 1; i <= RETASTES; i++) {
      process.env.CACHE_BUST = `${BUST_TAG}-${company.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${i}`;
      const r = await runAgentLoop(company);
      delete process.env.CACHE_BUST;
      const cost = currentCompanySpend().totalUsd;
      grand += cost;
      const s = deriveGoldenState(r, PINNED_AS_OF);
      snaps.push({ label: `run ${i + 1} (re-taste)`, state: s, figures: figuresOf(r), cost });
      console.log(`      run ${i + 1}: ${s.rows.length} rows   $${cost.toFixed(4)}`);
    }

    const rowCounts = snaps.map((s) => s.state.rows.length);
    const coverage = snaps.map((s) => `${s.state.coverage.statedTotalDebt}|${s.state.coverage.capturedFace}|${s.state.coverage.statedBridge}|${s.state.coverage.denominatorSource}`);
    const covSame = new Set(coverage).size === 1;
    const v = nineB(snaps);
    const holds = v.holds && covSame && new Set(rowCounts).size === 1;

    console.log(`\n      rows per run: ${rowCounts.join(", ")}`);
    console.log(`      coverage:     ${covSame ? "identical across all three" : "MOVED"}`);
    if (!covSame) for (const s of snaps) console.log(`          ${s.label}: ${s.state.coverage.capturedFace} of ${s.state.coverage.statedTotalDebt}`);
    if (v.tolerated.length) {
      console.log(`\n      TOLERATED by the gate — reported, and written into the signature basis:`);
      for (const t of v.tolerated) console.log(`          ${t}`);
    }
    if (!v.holds) { console.log(`\n      ${v.divergences.length} divergence(s):`); for (const d of v.divergences) console.log(`          ${d}`); }
    else console.log(`      every row reproduces under compareToGolden across all three`);

    // THE FACILITY FIGURES — not 9b, and the reason they are measured.
    // Keyed VALUES with labels stripped first: keying by facility NAME turned
    // four renames into "40 figures MOVED" once already.
    const valuesOnly = snaps.map((s) => s.figures.map((l) => l.slice(l.indexOf(".") + 1).replace(/\s+/g, " ").replace(/\$ /g, "$")).sort().join("\n"));
    const namesPerRun = snaps.map((s) => [...new Set(s.figures.map((l) => l.slice(0, l.indexOf("."))))].sort().join(" | "));
    const valuesStable = new Set(valuesOnly).size === 1;
    const namesStable = new Set(namesPerRun).size === 1;
    console.log(`\n      FACILITY FIGURES (not covered by 9b):`);
    console.log(`          values, labels stripped: ${valuesStable ? "IDENTICAL across all three" : "MOVED"}`);
    console.log(`          facility labels:         ${namesStable ? "identical across all three" : "MOVED — the filing names these more than one way"}`);
    if (!valuesStable) {
      const keys = new Set(snaps.flatMap((s) => s.figures.map((l) => l.slice(0, l.indexOf(" = ")))));
      for (const k of keys) {
        const vals = new Set(snaps.map((s) => s.figures.find((l) => l.startsWith(`${k} = `))?.slice(k.length + 3) ?? "(absent this run)"));
        if (vals.size > 1) { console.log(`          ${k}`); for (const x of vals) console.log(`              ${x}`); }
      }
    }
    if (!namesStable) for (let i = 0; i < snaps.length; i++) console.log(`          ${snaps[i].label}: ${namesPerRun[i]}`);

    console.log(`\n      9b: ${holds ? "HOLDS — the position reproduced three times at this version" : "DOES NOT HOLD — the position moved between runs at one version"}`);
    console.log(`      spend this name: $${snaps.reduce((a, s) => a + s.cost, 0).toFixed(4)}`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  TOTAL SPEND: $${grand.toFixed(4)}   (${RETASTES} re-taste(s) per name across ${COMPANIES.length} name(s))`);
  console.log("=".repeat(104));
})();
