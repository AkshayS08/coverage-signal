/**
 * SESSION 22, STAGE 2 — WHAT THE CLASSIFIER RECOVERS, AND WHAT IT MOVES. $0.
 *
 * Two questions, both answered before anything is wired into the ladder:
 *
 *   COMPLETENESS  how many of the 85 rows now carry a class and a type, and
 *                 — the part that matters — is every remaining `null` a row
 *                 whose corpus genuinely states no class, rather than one
 *                 the mapping failed on. Those two look identical in a count
 *                 and are opposite findings.
 *
 *   ORDERING      sorting by the seniority stack instead of maturity alone
 *                 re-orders the rendered ladder. For a filer whose rows are
 *                 all one class it must not move at all — Quest, Centene and
 *                 Molina are the no-regression test. Where it does move, the
 *                 before and after are printed in full so the change is read
 *                 rather than trusted.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { classifyInstrument, priorityRank, priorityClassLabel, instrumentTypeLabel } from "../events/instrumentClass";
import { formatMoneyForDisplay } from "../events/money";
import { currentCompanySpend } from "../agent/costMeter";
import { checkWarm } from "./s22warmcheck";

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
/** Filers whose rows are all one class: the ladder must not move for these. */
const MUST_NOT_MOVE = ["Quest Diagnostics", "Centene Corporation", "Molina Healthcare"];

(async () => {
  const warmth = await checkWarm(BOOK);
  const cold = warmth.filter((w) => !w.warm);
  if (cold.length) console.log(`  SKIPPED, would bill: ${cold.map((w) => w.company).join(", ")}`);

  let rows = 0, classed = 0, typed = 0, spend = 0, regressions = 0;
  const unclassed: string[] = [];
  const reordered: string[] = [];

  for (const company of warmth.filter((w) => w.warm).map((w) => w.company)) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);

    const classified = pos.rows.map((r) => ({
      row: r,
      c: classifyInstrument({ headings: [r.seniority], instrumentName: r.instrument }),
    }));

    const before = classified.map((x) => x.row.instrument);
    const after = [...classified]
      .sort((a, b) => {
        const d = priorityRank(a.c.priorityClass) - priorityRank(b.c.priorityClass);
        if (d !== 0) return d;
        // WITHIN a class, the existing maturity order is preserved exactly —
        // the stack groups, it does not re-sort inside a group.
        return classified.indexOf(a) - classified.indexOf(b);
      })
      .map((x) => x.row.instrument);
    const moved = before.join("|") !== after.join("|");

    console.log(`\n${"=".repeat(102)}\n${result.company}${moved ? "   [LADDER RE-ORDERS]" : "   [order unchanged]"}\n${"=".repeat(102)}`);
    for (const { row: r, c } of classified.sort((a, b) => priorityRank(a.c.priorityClass) - priorityRank(b.c.priorityClass))) {
      rows++;
      if (c.priorityClass) classed++; else unclassed.push(`${company}: ${r.instrument}`);
      if (c.instrumentType) typed++;
      console.log(`  ${priorityClassLabel(c).padEnd(32)} ${(c.instrumentType ?? "—").padEnd(17)} ${formatMoneyForDisplay(r.amount).padStart(9)}  ${r.instrument.slice(0, 46)}`);
    }

    if (moved && MUST_NOT_MOVE.includes(company)) {
      regressions++;
      console.log(`\n  !! REGRESSION — this filer's rows are one class and its ladder must not re-order.`);
      console.log(`     was:  ${before.join(" | ").slice(0, 300)}`);
      console.log(`     now:  ${after.join(" | ").slice(0, 300)}`);
    } else if (moved) {
      reordered.push(company);
      console.log(`\n  order was: ${before.map((s) => s.slice(0, 26)).join(" | ").slice(0, 420)}`);
      console.log(`  order now: ${after.map((s) => s.slice(0, 26)).join(" | ").slice(0, 420)}`);
    }
  }

  console.log(`\n${"=".repeat(102)}`);
  console.log(`  ROWS ${rows}   WITH A CLASS ${classed} (was 33)   WITH A TYPE ${typed}`);
  console.log(`  LADDERS THAT RE-ORDER: ${reordered.length}${reordered.length ? ` — ${reordered.join(", ")}` : ""}`);
  console.log(`  SINGLE-CLASS FILERS THAT MOVED (must be 0): ${regressions}`);
  console.log(`\n  STILL NO CLASS — each must be a row whose corpus states none, not a mapping miss:`);
  for (const u of unclassed) console.log(`    ${u}`);
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(102));
})();
