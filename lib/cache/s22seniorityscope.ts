/**
 * SESSION 22, STAGE 3 (finish) — WHAT DOES THE SENIORITY SENTENCE COVER? $0.
 *
 * The field is extracted and verified and nothing consumes it. Before wiring
 * it into the classifier, this prints the two things the wiring depends on
 * and that no amount of reasoning about the schema can supply: the actual
 * `appliesTo` strings the filers wrote, and which rows currently carry no
 * class. A scope rule designed against imagined strings would be a rule
 * designed against nothing.
 *
 * Also re-checks the statement guard itself against the FETCHED corpus rather
 * than the model's self-reported citedUrls (Rule 37), to see whether any
 * company is silently losing a real statement the way Centene lost its
 * facilities.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { priorityClassLabel } from "../events/instrumentClass";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

const one = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

(async () => {
  let unclassedTotal = 0, rowsTotal = 0;
  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(result, PINNED_AS_OF);
    const unclassed = pos.rows.filter((r) => r.classification.priorityClass === null);
    rowsTotal += pos.rows.length;
    unclassedTotal += unclassed.length;

    console.log(`\n${"=".repeat(96)}\n${result.company}   ${pos.rows.length} row(s), ${unclassed.length} with NO class`);
    if (dm?.seniorityStatement) {
      console.log(`  appliesTo: "${dm.seniorityStatement.appliesTo}"`);
      console.log(`  statement: "${one(dm.seniorityStatement.statement)}"`);
    } else {
      console.log(`  (no seniority statement)`);
    }
    for (const r of unclassed) {
      console.log(`    UNCLASSED  type=${(r.classification.instrumentType ?? "—").padEnd(16)} seniority=${r.seniority === null ? "null" : `"${r.seniority}"`}  ${r.instrument.slice(0, 56)}`);
    }
    for (const r of pos.rows.filter((x) => x.classification.priorityClass !== null)) {
      console.log(`    classed    ${`[${r.classification.priorityClassFrom}]`.padEnd(17)}${priorityClassLabel(r.classification).slice(0, 30).padEnd(32)} ${r.instrument.slice(0, 50)}`);
    }
  }
  console.log(`\n${"=".repeat(96)}\nBOOK: ${rowsTotal} rows, ${unclassedTotal} with no class, ${rowsTotal - unclassedTotal} with one`);
})();
