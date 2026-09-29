/**
 * CIGNA'S THREE SAMPLES, SIDE BY SIDE. BILLS on the two re-tastes.
 *
 * The standing rule: the canonical run is sample 1, so this buys two more.
 * BOTH CALLS in each sample — the anchor extraction and the referenced-note
 * transcription — because the gate asks whether the 38 entries reproduce, and
 * a bust that reached only the anchor would serve the transcription from cache
 * and answer a question about a stored file.
 *
 * The gate, unchanged and checked on EVERY sample:
 *   1. the transcription returns its 38 entries
 *   2. both printed subtotals tie exactly
 *   3. the roll, on DERIVED deltas, lands within ±$50M
 *
 * Run: npx tsx lib/cache/s25cignasamples.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { assemblePosition, parseMoneyAmount } from "../events/position";
import { derivePlacedMovements, toRollDeltas, inBaseButMissing } from "../events/rollDeltas";
import { computeRollTie, toleranceFor } from "../events/rollForward";
import { locatorFor, resolvedAmountUsd } from "../agent/tableScale";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Cigna Group";
const BASE_DATE = "2025-12-31";
const CEILING = 0.5;
const BUST_TAG = "s25-cigna";
const SUBTOTALS = [{ label: "Total short-term debt", millions: 592 }, { label: "Total long-term debt", millions: 30_871 }];
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

interface Sample {
  label: string; cost: number;
  entries: number; subtotalsTie: boolean; subtotalsGot: string[];
  baseSum: number; rolled: number; residual: number; tolerance: number; rollTies: boolean;
  ladderRows: number; deltas: string[]; inBaseMissing: string[];
}

(async () => {
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === BASE_DATE)!;
  const { text: tenKText } = await getFilingText(tenK.primaryDocUrl);
  const baseLoc = locatorFor(tenKText);
  const baseTag = await fetchXbrlDebtTotal(f.cik, BASE_DATE);

  const millions = (amount: string, sourceLine: string): number | null => {
    const v = resolvedAmountUsd(amount, sourceLine, tenKText, baseLoc, parseMoneyAmount);
    if (v !== null && Math.abs(v) >= 1e6) return v / 1e6;
    const raw = parseMoneyAmount(amount);
    return raw === null ? null : raw >= 1e6 ? raw / 1e6 : raw;
  };

  const samples: Sample[] = [];
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST;
    else process.env.CACHE_BUST = `${BUST_TAG}-${n}`;
    const r = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;
    const cost = currentCompanySpend().totalUsd;

    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const nd = r.results.find((t) => t.triggerId === "new-debt-issuance") as unknown as Record<string, unknown> | undefined;
    const anchorDate = (dm?.debtScheduleSourceFiling as { reportDate?: string } | undefined)?.reportDate ?? "2026-06-30";
    const anchorTag = await fetchXbrlDebtTotal(f.cik, anchorDate);
    const base = dm?.priorPeriodBase as { rows?: { instrument: string; amount: string; sourceLine: string; kind: string }[]; statedSubtotals?: { label: string; amount: string }[] } | null | undefined;
    const rows = (base?.rows ?? []).filter((x) => x.kind === "row");

    const got: string[] = [];
    const subtotalsTie = SUBTOTALS.every((want) => {
      const s = (base?.statedSubtotals ?? []).find((x) => norm(x.label).includes(norm(want.label)));
      const v = s ? millions(s.amount, s.label) : null;
      got.push(`${want.label}=${s?.amount ?? "ABSENT"}`);
      return v !== null && Math.round(v) === want.millions;
    });

    const movements = derivePlacedMovements({
      baseDate: BASE_DATE, anchorDate,
      noteRetirements: (dm?.noteRetirements ?? []) as never,
      issuedTranches: (nd?.issuedTranches ?? []) as never,
      issuanceDate: (nd?.eventDate as string | null) ?? null,
      intendedRedemptions: (nd?.redeems ?? []) as never,
      anchorBalances: (dm?.proseInstruments ?? []) as never,
      baseRows: rows, parseMillions: millions,
    });
    const deltas = toRollDeltas(movements);
    const tie = computeRollTie(Math.round((baseTag.total ?? 0) / 1e6), deltas, Math.round((anchorTag.total ?? 0) / 1e6));

    samples.push({
      label: n === 0 ? "sample 1 (canonical)" : `sample ${n + 1} (re-taste)`,
      cost,
      entries: (base?.rows ?? []).length,
      subtotalsTie, subtotalsGot: got,
      baseSum: rows.reduce((a, x) => a + (millions(x.amount, x.sourceLine) ?? 0), 0),
      rolled: tie.computedMillions, residual: tie.residualMillions ?? NaN,
      tolerance: toleranceFor(deltas), rollTies: tie.ties,
      ladderRows: assemblePosition(r, new Date(`${anchorDate}T00:00:00Z`)).rows.length,
      deltas: deltas.map((d) => `${d.label.slice(0, 34)} ${d.amountMillions}M${d.statedApproximate ? "~" : ""}`),
      inBaseMissing: inBaseButMissing(movements, rows).map((m) => m.instrument),
    });
    console.log(`  ${samples[samples.length - 1].label}: ${samples[samples.length - 1].entries} entries, $${cost.toFixed(4)}`);
  }

  const total = samples.reduce((a, s) => a + s.cost, 0);
  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — three samples, the gate checked on each`);
  console.log("=".repeat(104));
  const col = (f: (s: Sample) => string) => samples.map((s) => f(s).padEnd(26)).join("");
  console.log(`\n  ${"".padEnd(24)}${samples.map((s) => s.label.padEnd(26)).join("")}`);
  console.log(`  ${"transcribed entries".padEnd(24)}${col((s) => String(s.entries))}`);
  console.log(`  ${"both subtotals tie".padEnd(24)}${col((s) => (s.subtotalsTie ? "YES" : "NO"))}`);
  console.log(`  ${"  short-term".padEnd(24)}${col((s) => s.subtotalsGot[0] ?? "—")}`);
  console.log(`  ${"  long-term".padEnd(24)}${col((s) => s.subtotalsGot[1] ?? "—")}`);
  console.log(`  ${"base rows sum ($M)".padEnd(24)}${col((s) => Math.round(s.baseSum).toLocaleString())}`);
  console.log(`  ${"rolled ($M)".padEnd(24)}${col((s) => s.rolled.toLocaleString())}`);
  console.log(`  ${"residual ($M)".padEnd(24)}${col((s) => `${s.residual} / ±${s.tolerance}`)}`);
  console.log(`  ${"roll ties".padEnd(24)}${col((s) => (s.rollTies ? "YES" : "NO"))}`);
  console.log(`  ${"anchor ladder rows".padEnd(24)}${col((s) => String(s.ladderRows))}`);
  console.log(`  ${"in-base missing".padEnd(24)}${col((s) => (s.inBaseMissing.length ? s.inBaseMissing.join(",") : "none"))}`);
  console.log(`  ${"derived deltas".padEnd(24)}${col((s) => String(s.deltas.length))}`);
  for (let i = 0; i < Math.max(...samples.map((s) => s.deltas.length)); i++) {
    console.log(`  ${`  delta ${i + 1}`.padEnd(24)}${col((s) => s.deltas[i] ?? "—")}`);
  }

  const allEntries = new Set(samples.map((s) => s.entries)).size === 1;
  const allSub = samples.every((s) => s.subtotalsTie);
  const allRoll = samples.every((s) => s.rollTies);
  console.log(`\n${"=".repeat(104)}`);
  console.log(`  GATE 1 — 38 entries reproduce:      ${allEntries ? `YES (${samples[0].entries} in every sample)` : "NO — the transcription moved"}`);
  console.log(`  GATE 2 — both subtotals tie:        ${allSub ? "YES in every sample" : "NO"}`);
  console.log(`  GATE 3 — derived roll within band:  ${allRoll ? "YES in every sample" : "NO"}`);
  console.log(`\n  VERDICT: ${allEntries && allSub && allRoll ? "ALL THREE GATES HOLD ACROSS ALL THREE SAMPLES" : "A GATE FAILED — Cigna stays unsigned, and the failure is named above"}`);
  console.log(`  SPEND: $${total.toFixed(4)} against a $${CEILING.toFixed(2)} ceiling`);
  console.log("=".repeat(104));
})();
