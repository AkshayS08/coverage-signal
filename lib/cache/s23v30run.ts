/**
 * SESSION 23 — THE v30 COLD PASS. PAID.
 *
 * Cost and result shape declared before this ran, and the reconciliation gate
 * is the first thing it reports: 10 forced misses, 10 base calls. A run that
 * comes back cheaper than its shape allows is suspect before any of its
 * values are read (Rule 13), so the miss count is checked before a single
 * number below it is trusted.
 *
 * Reports, per company:
 *   - cache miss / hit, and the per-company cost AFTER narration would run
 *     (this harness makes no narration call; the log's figure is extraction
 *     only, and Rule 43 says so out loud rather than letting the total read
 *     as complete)
 *   - ladder rows, and the anchor note shape the schema was built from
 *   - the roll-forward trio, for the one company that can have them
 *   - every facility's four figures and its availability basis
 *
 * Run: npx tsx lib/cache/s23v30run.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

interface Snap {
  company: string;
  rows: number;
  scheduleEntries: number;
  proseInstruments: number;
  crossReference: string | null;
  referencedEntries: number;
  referencedCaptions: number;
  facilities: { name: string; size: string; drawn: string; lcs: string; avail: string; maturity: string; basis: string }[];
  cost: number;
}

const fig = (f: { value: string } | null | undefined) => (f ? f.value : "—");

(async () => {
  const names = process.argv.length > 2 ? process.argv.slice(2) : ALL;
  console.log(`\n${"=".repeat(110)}`);
  console.log(`v${EXTRACTION_PROMPT_VERSION} COLD PASS — ${names.length} companies, as-of ${PINNED_AS_OF.toISOString().slice(0, 10)}`);
  console.log("=".repeat(110));

  const snaps: Snap[] = [];
  let spend = 0;
  for (const company of names) {
    const result = await runAgentLoop(company);
    const cost = currentCompanySpend().totalUsd;
    spend += cost;
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(result, PINNED_AS_OF);
    snaps.push({
      company: result.company,
      rows: pos.rows.length,
      scheduleEntries: (dm?.scheduleSequence ?? []).length,
      proseInstruments: (dm?.proseInstruments ?? []).length,
      crossReference: dm?.noteCrossReference
        ? `${dm.noteCrossReference.referencedSubject ?? "(no subject)"} / ${dm.noteCrossReference.referencedNote ?? "(no note)"} / ${dm.noteCrossReference.referencedFiling ?? "(no filing)"}`
        : null,
      referencedEntries: (dm?.referencedScheduleSequence ?? []).length,
      referencedCaptions: (dm?.referencedBalanceSheetDebtCaptions ?? []).length,
      facilities: (dm?.facilities ?? []).map((f) => ({
        name: f.name,
        size: fig(f.facilitySize),
        drawn: fig(f.drawn),
        lcs: fig(f.lettersOfCredit),
        avail: fig(f.available),
        maturity: fig(f.maturity),
        basis: f.availabilityBasis ? f.availabilityBasis.limitedBy : "—",
      })),
      cost,
    });
    console.log(`\n  ${result.company}: ${pos.rows.length} ladder rows, ${(dm?.scheduleSequence ?? []).length} schedule entries  ($${cost.toFixed(4)})`);
  }

  console.log(`\n${"=".repeat(110)}\nRESULT SHAPE\n${"=".repeat(110)}`);
  console.log(`\n  ${"company".padEnd(30)} ${"rows".padEnd(6)} ${"sched".padEnd(7)} ${"prose".padEnd(7)} ${"refSeq".padEnd(8)} ${"refCap".padEnd(8)} cost`);
  for (const s of snaps) {
    console.log(
      `  ${s.company.slice(0, 29).padEnd(30)} ${String(s.rows).padEnd(6)} ${String(s.scheduleEntries).padEnd(7)} ` +
        `${String(s.proseInstruments).padEnd(7)} ${String(s.referencedEntries).padEnd(8)} ${String(s.referencedCaptions).padEnd(8)} $${s.cost.toFixed(4)}`
    );
  }

  console.log(`\n  CROSS-REFERENCES (subject / note / filing) — the roll-forward conjunction's first half:`);
  for (const s of snaps) {
    if (s.crossReference) console.log(`    ${s.company.slice(0, 29).padEnd(30)} ${s.crossReference}`);
  }
  if (!snaps.some((s) => s.crossReference)) console.log(`    none reported`);

  console.log(`\n  FACILITIES — B3 (a stated zero is a figure) and B4 (availability basis):`);
  console.log(`    ${"company".padEnd(22)} ${"facility".padEnd(34)} ${"size".padEnd(14)} ${"drawn".padEnd(12)} ${"LCs".padEnd(12)} ${"avail".padEnd(14)} ${"maturity".padEnd(18)} limited by`);
  for (const s of snaps) {
    for (const f of s.facilities) {
      console.log(
        `    ${s.company.slice(0, 21).padEnd(22)} ${f.name.slice(0, 33).padEnd(34)} ${f.size.slice(0, 13).padEnd(14)} ` +
          `${f.drawn.slice(0, 11).padEnd(12)} ${f.lcs.slice(0, 11).padEnd(12)} ${f.avail.slice(0, 13).padEnd(14)} ${f.maturity.slice(0, 17).padEnd(18)} ${f.basis}`
      );
    }
  }

  console.log(`\n${"=".repeat(110)}`);
  console.log(`  SPEND THIS RUN (extraction only — narration is metered but NOT persisted, Rule 43): $${spend.toFixed(4)}`);
  console.log("=".repeat(110));
})();
