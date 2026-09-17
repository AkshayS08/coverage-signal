/**
 * SESSION 22, STAGE 7 — WHICH NAMES ARE SIGNABLE. $0.
 *
 * The nine criteria, per company, so the signature pass is a decision about
 * named facts rather than about a sheet's general appearance. Three of the
 * nine are ATTESTED — no tool can check them about itself — and they are
 * reported as unattested rather than as passing, because a criterion nobody
 * has confirmed is not a criterion that holds.
 *
 * Run: npx tsx lib/cache/s22criteria.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { filingSetOf } from "../events/golden";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  const summary: string[] = [];
  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const r = evaluateGoldenCriteria(result, PINNED_AS_OF);
    const filings = filingSetOf(result);

    console.log(`\n${"=".repeat(100)}\n${result.company}\n${"=".repeat(100)}`);
    for (const c of r.criteria) {
      const mark = c.pass === true ? "PASS" : c.pass === false ? "FAIL" : "UNATTESTED";
      console.log(`  [${c.id}] ${mark.padEnd(11)} ${c.name}`);
      console.log(`        ${c.detail.replace(/\s+/g, " ").slice(0, 150)}`);
    }
    const computed = r.criteria.filter((c) => c.kind === "computed");
    const computedPass = computed.filter((c) => c.pass === true).length;
    const failing = computed.filter((c) => c.pass === false);
    // THE FILING SET IS THE GOLDEN FILE'S IDENTITY. An empty one pins an
    // answer to no documents, so every future run "matches" it trivially —
    // a pin that cannot fail is not a pin.
    const emptySet = filings.length === 0;
    summary.push(
      `  ${result.company.padEnd(30)} computed ${computedPass}/${computed.length}` +
      `  filings ${String(filings.length).padStart(2)}` +
      (emptySet ? "  << EMPTY FILING SET — not signable" : "") +
      (failing.length ? `  << FAILS: ${failing.map((c) => c.id).join(", ")}` : "")
    );
  }
  console.log(`\n${"=".repeat(100)}\nSIGNABILITY\n${"=".repeat(100)}`);
  for (const s of summary) console.log(s);
  console.log(`\n  Three of the nine are attested by hand and are NOT counted above:`);
  console.log(`  rows correct against the filing, instrument type faithful, reproduced three times.`);
})();
