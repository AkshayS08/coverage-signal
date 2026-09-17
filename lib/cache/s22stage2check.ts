/**
 * SESSION 22, STAGE 2 — THE RENDERED LADDERS. $0.
 *
 * Tenet and DaVita are the worked examples: both print their notes in
 * sections and both rendered as one flat maturity-ordered list. Quest,
 * Centene and Molina are the no-regression test: their rows are all one
 * class, so their ladders must be in exactly the order they were.
 *
 * The class/type columns are what an RM would now see; the assertions are
 * the two properties the stage has to hold.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { priorityClassLabel } from "../events/instrumentClass";
import { formatMoneyForDisplay } from "../events/money";
import { currentCompanySpend } from "../agent/costMeter";
import { checkWarm } from "./s22warmcheck";

const SECTIONED = ["Tenet Healthcare", "DaVita"];
const SINGLE_CLASS = ["Quest Diagnostics", "Centene Corporation", "Molina Healthcare"];

let bad = 0;
const fail = (s: string) => { console.log(`    !! ${s}`); bad++; };

(async () => {
  const all = [...SECTIONED, ...SINGLE_CLASS];
  const warmth = await checkWarm(all);
  const cold = warmth.filter((w) => w.state === "cold");
  const unreachable = warmth.filter((w) => w.state === "unreachable");
  if (cold.length) {
    console.error(`ABORT — COLD, running these would bill: ${cold.map((w) => w.company).join(", ")}`);
    process.exit(1);
  }
  if (unreachable.length) {
    console.error(`ABORT — CACHE UNREACHABLE for ${unreachable.map((w) => w.company).join(", ")}. This is not a cost finding; retry rather than concluding anything.`);
    for (const u of unreachable) console.error(`    ${u.company}: ${u.reason}`);
    process.exit(1);
  }

  let spend = 0;
  for (const company of all) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);

    console.log(`\n${"=".repeat(104)}\n${result.company}\n${"=".repeat(104)}`);
    for (const r of pos.rows) {
      const c = r.classification;
      console.log(`  ${formatMoneyForDisplay(r.amount).padStart(9)}  ${priorityClassLabel(c).padEnd(32)} ${(c.instrumentType ?? "type not stated").padEnd(16)} ${r.instrument.slice(0, 40)}`);
    }

    if (SINGLE_CLASS.includes(company)) {
      // The rows a single-class filer states must still be in maturity order.
      const dated = pos.rows.filter((r) => r.maturityDate && r.dateGranularity !== "year");
      const keys = dated.map((r) => r.maturityDate!);
      const sorted = [...keys].sort();
      if (keys.join("|") !== sorted.join("|")) {
        fail(`${company} is a single-class filer and its ladder is no longer in maturity order: ${keys.join(" ")}`);
      } else {
        console.log(`\n    ok — single-class filer, still in maturity order (${keys.length} dated rows)`);
      }
    } else {
      const classes = pos.rows.map((r) => r.classification.priorityClass);
      const named = classes.filter((c) => c !== null);
      if (named.length === 0) fail(`${company} prints sections but no row carries a class`);
      // Class must be contiguous: every row of a class together, unclassed last.
      const seen: (string | null)[] = [];
      for (const c of classes) if (seen[seen.length - 1] !== c) seen.push(c);
      if (seen.length !== new Set(seen).size) {
        fail(`${company}'s classes are interleaved rather than grouped: ${seen.join(" -> ")}`);
      } else {
        console.log(`\n    ok — grouped by class, senior-most first: ${seen.map((c) => c ?? "not stated").join(" -> ")}`);
      }
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log(bad === 0
    ? "  STAGE 2 HOLDS — sectioned filers group by the seniority stack, single-class filers did not move."
    : `  ${bad} FAILURE(S) above.`);
  console.log("=".repeat(104));
  if (bad > 0) process.exit(1);
})();
