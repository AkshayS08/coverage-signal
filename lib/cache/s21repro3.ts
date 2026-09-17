/**
 * SESSION 21, STAGE 6 — CRITERION 9b: THREE INDEPENDENT RE-ASKS.
 *
 * CACHE_BUST forces the model to be re-asked at the SAME prompt version on
 * the SAME filings. It is the only lever that measures the model rather than
 * the pipeline, and it is billed. Warm re-runs prove determinism of the code
 * and say nothing about reproducibility of the extraction — the distinction
 * Rule 23 was learned from, when a hand-verified 98% did not survive the next
 * extraction.
 *
 * ALL NINE RE-ASKS ARE REPORTED IN FULL. Never best-of-three. A company that
 * does not reproduce three-for-three does not become a golden file and is
 * reported with its variance named.
 *
 * Cost is persisted per company as each closes (Rule 20).
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, type GoldenState } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { currentCompanySpend } from "../agent/costMeter";

const ASOF = new Date("2026-09-06T00:00:00Z");
const COST_LOG = join(process.cwd(), "baselines", "cost-log.jsonl");

function brief(s: GoldenState): string {
  return [
    `rows ${s.rows.length}`,
    `captured $${(s.coverage.capturedFace / 1e9).toFixed(3)}B`,
    `stated $${((s.coverage.statedTotalDebt ?? 0) / 1e9).toFixed(3)}B`,
    `resid ${s.coverage.residualPercent ?? "—"}%`,
    `src ${s.coverage.denominatorSource}`,
    `tier2 ${s.tier2.length}`,
  ].join("  ");
}

(async () => {
  const book = process.argv.slice(2);
  const verdicts: string[] = [];

  for (const company of book) {
    console.log(`\n${"=".repeat(100)}\nCRITERION 9b — ${company}: three independent re-asks at v28\n${"=".repeat(100)}`);
    const states: GoldenState[] = [];
    let spend = 0;

    for (let i = 1; i <= 3; i++) {
      process.env.CACHE_BUST = `s21-9b-${i}`;
      // NOT A DELTA. beginCompanyCostScope() resets the meter at the start of
      // every runAgentLoop call, so the meter after a run IS that run's cost.
      // Subtracting a "before" reading measures the previous run against this
      // one and reports every re-ask after the first as free — which is
      // exactly what it did on the first attempt, and is the kind of wrong
      // number that makes a cost log worse than no cost log.
      const result = await runAgentLoop(company);
      const cost = currentCompanySpend().totalUsd;
      spend += cost;
      const st = deriveGoldenState(result, ASOF);
      states.push(st);
      console.log(`\n  RE-ASK ${i}  ($${cost.toFixed(4)})`);
      console.log(`    ${brief(st)}`);
      for (const r of st.rows) console.log(`      ${r.status.padEnd(9)}${r.isCapacity ? "CAP " : "    "}${r.amount.padStart(22)}  ${r.instrument.slice(0, 60)}`);
      appendFileSync(COST_LOG, JSON.stringify({ session: 21, stage: "6-criterion-9b", company, reask: i, costUsd: Number(cost.toFixed(4)), at: ASOF.toISOString().slice(0, 10) }) + "\n", "utf-8");
    }

    // ALL THREE COMPARED AGAINST EACH OTHER, by the same comparator a golden
    // file is checked with — so "reproduces" means exactly what it means
    // everywhere else in this build.
    const d12 = compareToGolden(states[0], states[1]);
    const d13 = compareToGolden(states[0], states[2]);
    const reproduced = d12.kind === "matches" && d13.kind === "matches";
    console.log(`\n  RE-ASK 1 vs 2: ${d12.kind}${d12.kind === "diverged" ? `\n      ${d12.divergences.join("\n      ")}` : d12.kind === "not-applicable" ? ` — ${d12.reason}` : ""}`);
    console.log(`  RE-ASK 1 vs 3: ${d13.kind}${d13.kind === "diverged" ? `\n      ${d13.divergences.join("\n      ")}` : d13.kind === "not-applicable" ? ` — ${d13.reason}` : ""}`);
    console.log(`  SPEND: $${spend.toFixed(4)}`);
    console.log(`  ${reproduced ? "REPRODUCES THREE-FOR-THREE — criterion 9b holds" : "DOES NOT REPRODUCE — criterion 9b fails; this company does not golden"}`);
    verdicts.push(`${company}: ${reproduced ? "3/3 REPRODUCES" : "VARIANCE — does not golden"}  ($${spend.toFixed(4)})`);

    // And the full criteria, with 9b now decided by measurement.
    delete process.env.CACHE_BUST;
    const fresh = await runAgentLoop(company);
    const crit = evaluateGoldenCriteria(fresh, ASOF, {
      rowsCorrect: true, instrumentTypeFaithful: true, reproducedThreeTimes: reproduced,
      by: "Akshay Sahani", on: "2026-09-06",
    });
    console.log(`\n  ALL NINE: ${crit.allHold ? "HOLD" : "DO NOT HOLD"}`);
    for (const x of crit.criteria) console.log(`    [${x.id}] ${x.pass === true ? "ok" : x.pass === false ? "!!" : "??"} ${x.name}`);
    if (crit.failing.length) console.log(`    FAILING: ${crit.failing.join(" | ")}`);
    if (crit.unattested.length) console.log(`    UNATTESTED: ${crit.unattested.join(" | ")}`);
  }

  console.log(`\n${"=".repeat(100)}\nCRITERION 9b SUMMARY\n${"=".repeat(100)}`);
  for (const v of verdicts) console.log(`  ${v}`);
})();
