/**
 * THE NEGATIVE CASE FOR THE v31 UNIT RULE, MEASURED BEFORE THE PASS. $0.
 *
 * The rule is "copy the filing's printed unit, never convert" — NOT "prefer
 * billions". A rule that over-fires is worse than the bug it fixes, so the
 * population it must leave alone is counted first, the way the copula
 * widening was measured at 68 figures and 1 move before it shipped.
 *
 * Counts every ladder amount in the book by the scale it prints, so the
 * declaration can say exactly how many figures a unit instruction must NOT
 * disturb — and what fraction of them are millions, which is the form a
 * "prefer billions" reading would break.
 *
 * Run: npx tsx lib/cache/s23v31baseline.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const SCALE = /\b(thousand|million|billion|trillion)s?\b/i;

(async () => {
  const byScale: Record<string, number> = {};
  const byCompany: Record<string, Record<string, number>> = {};
  let rows = 0, noScale = 0, spend = 0;

  for (const company of ALL) {
    let state;
    try { const r = await runAgentLoop(company); spend += currentCompanySpend().totalUsd; state = deriveGoldenState(r, PINNED_AS_OF); }
    catch { console.log(`  ${company.padEnd(30)} unreachable at the current fingerprint (corpus moved)`); continue; }
    byCompany[company] = {};
    for (const row of state.rows) {
      rows++;
      const m = SCALE.exec(String(row.amount ?? ""));
      if (!m) { noScale++; continue; }
      const s = m[1].toLowerCase();
      byScale[s] = (byScale[s] ?? 0) + 1;
      byCompany[company][s] = (byCompany[company][s] ?? 0) + 1;
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`THE POPULATION A v31 UNIT RULE MUST NOT DISTURB`);
  console.log("=".repeat(104));
  for (const [c, m] of Object.entries(byCompany)) {
    const parts = Object.entries(m).map(([k, v]) => `${v} ${k}`).join(", ");
    console.log(`  ${c.padEnd(30)} ${parts || "no scaled amounts"}`);
  }
  console.log(`\n  ${rows} ladder rows · ${noScale} print no scale word`);
  for (const [k, v] of Object.entries(byScale).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)} print in ${k.toUpperCase()}${k === "million" ? "   ← the form a \"prefer billions\" reading would break" : ""}`);
  }
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
