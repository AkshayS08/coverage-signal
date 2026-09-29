import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { deriveGoldenState, positionFilingSetOf, otherCitationsOf, unsupportedAmountRows } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { currentCompanySpend } from "../agent/costMeter";
const BUST = "s25-cigna";
(async () => {
  let spend = 0;
  console.log(`\n${"=".repeat(96)}\nTHE EXTRA TRIGGER, and what a Cigna signature would pin\n${"=".repeat(96)}`);
  const ROLL_INPUTS = ["debt-maturity", "new-debt-issuance"];
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const fired = r.results.filter((t) => t.fired).map((t) => t.triggerId);
    const pos = positionFilingSetOf(r, PINNED_AS_OF);
    console.log(`\n  sample ${n + 1}: ${fired.length} fired — ${fired.join(", ")}`);
    console.log(`      position filing set (${pos.length}): ${pos.map((u) => u.split("/").pop()).join(", ")}`);
    console.log(`      ladder rows: ${assemblePosition(r, PINNED_AS_OF).rows.length}`);
  }
  delete process.env.CACHE_BUST;
  const r = await runAgentLoop("Cigna Group");
  spend += currentCompanySpend().totalUsd;
  const st = deriveGoldenState(r, PINNED_AS_OF);
  const crit = evaluateGoldenCriteria(r, PINNED_AS_OF, { rowsCorrect: true, instrumentTypeFaithful: true, reproducedThreeTimes: true, by: "probe", on: "2026-09-29" });
  console.log(`\n${"─".repeat(96)}\n  WHAT A CIGNA SIGNATURE WOULD PIN (canonical)\n${"─".repeat(96)}`);
  console.log(`      rows ${st.rows.length}   identity ${st.filingSet.length} doc(s)   otherCitations ${(st.otherCitations ?? []).length}`);
  for (const row of st.rows) console.log(`        ${row.instrument.slice(0, 50).padEnd(52)} ${row.amount.padEnd(18)} ${row.status}`);
  console.log(`      coverage: captured ${st.coverage.capturedFace} of ${st.coverage.statedTotalDebt} — residual ${st.coverage.residualPercent}% passes=${st.coverage.residualPasses}`);
  console.log(`      Rule 58 unsupported: ${unsupportedAmountRows(st).length}`);
  const failing = crit.criteria.filter((c) => c.kind === "computed" && c.pass === false);
  console.log(`      computed criteria failing: ${failing.length ? failing.map((c) => c.id).join(", ") : "none"}`);
  for (const c of failing) console.log(`         ${c.id}. ${c.detail.replace(/\s+/g, " ").slice(0, 150)}`);
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
})();
