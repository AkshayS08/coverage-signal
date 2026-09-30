/**
 * CIGNA'S THREE SAMPLES THROUGH THE SWITCHED PATH. $0 — all cached.
 *
 * Every gate, criterion and identity re-asked after Rule 71, the annual-report
 * re-pointing, the tie fold and the coverage switch. Reported side by side,
 * because a signature rests on three samples agreeing and not on one of them
 * being good.
 *
 * Run: npx tsx lib/cache/s25switched.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { positionFilingSetOf, otherCitationsOf, deriveGoldenState } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { rolledCoverageFor, rolledCoverageLine } from "../events/rolledCoverage";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Cigna Group";
const BUST_TAG = "s25-cigna";
const doc = (u: string) => u.split("/").pop() ?? u;

interface S {
  label: string;
  identity: string[];
  other: number;
  rows: string[];
  baseTie: string;
  rollTie: string;
  counts: boolean;
  coverage: string;
  c4: string;
  c6: string;
  failing: string[];
  triggers: string[];
}

(async () => {
  const out: S[] = [];
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST;
    else process.env.CACHE_BUST = `${BUST_TAG}-${n}`;
    const r = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;

    const pos = assemblePosition(r, PINNED_AS_OF);
    const rc = rolledCoverageFor(r);
    const state = deriveGoldenState(r, PINNED_AS_OF);
    const crit = evaluateGoldenCriteria(r, PINNED_AS_OF);
    const c = (id: string) => crit.criteria.find((x) => x.id === id);

    out.push({
      label: n === 0 ? "sample 1 (canonical)" : `sample ${n + 1} (re-taste)`,
      identity: positionFilingSetOf(r, PINNED_AS_OF).map(doc),
      other: otherCitationsOf(r, PINNED_AS_OF).length,
      rows: pos.rows.map((x) => `${x.instrument}|${x.amount}|${x.maturityDate ?? "—"}|${x.status}`),
      baseTie: rc.baseTie ? `${rc.baseTie.computedMillions}M ${rc.baseTie.ties ? "TIES" : "MISSES"} (${rc.baseTie.sections.map((s) => `${s.rowCount}→${s.computedMillions}/${s.statedMillions}`).join(", ")})` : "—",
      rollTie: rc.rollTie ? `${rc.rollTie.computedMillions}M residual ${rc.rollTie.residualMillions} ${rc.rollTie.ties ? "TIES" : "MISSES"}` : "—",
      counts: rc.counts,
      coverage: `face=${state.coverage.capturedFace} residual=${state.coverage.residualPercent}% passes=${state.coverage.residualPasses}`,
      c4: `${c("4")?.pass} — ${String(c("4")?.detail ?? "").slice(0, 60)}`,
      c6: `${c("6")?.pass} — ${String(c("6")?.detail ?? "").slice(0, 60)}`,
      // `crit.failing` is the evaluator's OWN list. A local re-derivation here
      // read a field named `passes` that does not exist, so every criterion
      // compared undefined === false and the harness reported "none failing"
      // for a sample whose roll missed by 965 — a check whose inputs made its
      // answer predetermined, which is the class this session keeps finding.
      failing: crit.failing,
      triggers: r.results.filter((t) => t.fired).map((t) => t.triggerId),
    });
    console.log(`  ${out[out.length - 1].label} done`);
  }

  const col = (f: (s: S) => string) => out.map((s) => f(s).padEnd(34)).join("");
  const eq = (f: (s: S) => unknown) => new Set(out.map((s) => JSON.stringify(f(s)))).size === 1;

  console.log(`\n${"=".repeat(120)}`);
  console.log("  CIGNA — three samples through the SWITCHED path");
  console.log("=".repeat(120));
  console.log(`\n  ${"".padEnd(22)}${out.map((s) => s.label.padEnd(34)).join("")}`);
  console.log(`  ${"position identity".padEnd(22)}${col((s) => `${s.identity.length} docs`)}`);
  for (let i = 0; i < Math.max(...out.map((s) => s.identity.length)); i++) {
    console.log(`  ${`  doc ${i + 1}`.padEnd(22)}${col((s) => s.identity[i] ?? "—")}`);
  }
  console.log(`  ${"other citations".padEnd(22)}${col((s) => String(s.other))}`);
  console.log(`  ${"ladder rows".padEnd(22)}${col((s) => String(s.rows.length))}`);
  console.log(`  ${"base tie".padEnd(22)}${col((s) => s.baseTie)}`);
  console.log(`  ${"roll tie".padEnd(22)}${col((s) => s.rollTie)}`);
  console.log(`  ${"roll counts".padEnd(22)}${col((s) => (s.counts ? "YES" : "NO"))}`);
  console.log(`  ${"coverage".padEnd(22)}${col((s) => s.coverage)}`);
  console.log(`  ${"criterion 4".padEnd(22)}${col((s) => s.c4)}`);
  console.log(`  ${"criterion 6".padEnd(22)}${col((s) => s.c6)}`);
  console.log(`  ${"computed failing".padEnd(22)}${col((s) => (s.failing.length ? s.failing.join(",") : "none"))}`);
  console.log(`  ${"triggers fired".padEnd(22)}${col((s) => String(s.triggers.length))}`);

  console.log(`\n  --- the ladder, sample by sample ---`);
  for (const s of out) {
    console.log(`\n  ${s.label}:`);
    for (const row of s.rows) console.log(`    ${row}`);
  }

  console.log(`\n${"=".repeat(120)}`);
  console.log(`  IDENTICAL ACROSS ALL THREE SAMPLES`);
  console.log(`    position identity (the documents):  ${eq((s) => s.identity) ? "YES" : "NO"}`);
  console.log(`    the ladder itself (row for row):    ${eq((s) => s.rows) ? "YES" : "NO"}`);
  console.log(`    base tie:                           ${eq((s) => s.baseTie) ? "YES" : "NO"}`);
  console.log(`    roll tie:                           ${eq((s) => s.rollTie) ? "YES" : "NO"}`);
  console.log(`    coverage:                           ${eq((s) => s.coverage) ? "YES" : "NO"}`);
  console.log(`    criteria 4 and 6:                   ${eq((s) => [s.c4, s.c6]) ? "YES" : "NO"}`);
  console.log(`    the full computed-criteria verdict: ${eq((s) => s.failing) ? "YES" : "NO"}`);
  console.log(`\n  ${rolledCoverageLine(rolledCoverageFor(await (async () => { delete process.env.CACHE_BUST; return runAgentLoop(COMPANY); })()), 31878)}`);
  console.log(`\n  SPEND: $${currentCompanySpend().totalUsd.toFixed(4)}`);
  console.log("=".repeat(120));
})();
