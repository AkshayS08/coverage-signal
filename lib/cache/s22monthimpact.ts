/**
 * SESSION 22, STAGE 1 — WHAT THE MONTH CONVENTION MOVES. $0.
 *
 * The month count is not decoration: `monthsToNearestFuture` feeds
 * eligibility.ts's `> REFI_WINDOW_MONTHS` test, so changing how months are
 * counted can change WHICH ROWS CARD. Stage 1 is billed as render hygiene,
 * and a change that silently moves a card is not hygiene — so this measures
 * the difference on every dated row in the book before the gate is rewired,
 * and names every row whose verdict moves.
 *
 * Three columns, per row:
 *   OLD    elapsed days / 30.44, rounded          (what shipped)
 *   NEW    whole calendar months completed        (the named convention)
 *   GATE   maturity <= now + 18 calendar months   (a date comparison)
 *
 * $0, AND STRUCTURALLY $0. The first version of this asserted the meter
 * AFTER each company, which reports a charge it has already made — Tenet's
 * cache had gone cold overnight and it billed $0.1759 before the guard
 * fired. The cache state is now READ FIRST from free inputs, and a cold
 * company is named and skipped rather than run. The post-hoc meter assertion
 * stays as a second line of defence.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { monthsBetween, isWithinMonths } from "../events/eventTiming";
import { currentCompanySpend } from "../agent/costMeter";
import { checkWarm } from "./s22warmcheck";

const ASOF = PINNED_AS_OF;
const REFI_WINDOW_MONTHS = 18;
const AVG_DAYS_PER_MONTH = 30.44;

/** Exactly what shipped, kept here so the two are compared rather than remembered. */
const oldMonths = (iso: string, now: Date) =>
  Math.round((new Date(iso).getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * AVG_DAYS_PER_MONTH));

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`MONTH-CONVENTION IMPACT, as of ${ASOF.toISOString().slice(0, 10)}.  $0: warm runs only.`);
  console.log("=".repeat(104));

  let rowsSeen = 0, countMoved = 0, verdictMoved = 0, spend = 0;
  const moves: string[] = [];

  const warmth = await checkWarm(BOOK);
  const cold = warmth.filter((w) => !w.warm);
  if (cold.length) {
    console.log(`
  SKIPPED, would bill: ${cold.map((w) => `${w.company} (${w.reason})`).join("; ")}`);
  }

  for (const company of warmth.filter((w) => w.warm).map((w) => w.company)) {
    const result = await runAgentLoop(company);
    const cost = currentCompanySpend().totalUsd;
    spend += cost;
    if (cost > 0) {
      console.error(`\n  ABORT — ${company} cost $${cost.toFixed(4)}. This stage is declared $0 and a warm run missed.`);
      process.exit(1);
    }
    const pos = assemblePosition(result, ASOF);
    const dated = pos.rows.filter((r) => r.maturityDate && r.dateGranularity !== "year" && !Number.isNaN(new Date(r.maturityDate).getTime()));

    const lines: string[] = [];
    for (const r of dated) {
      rowsSeen++;
      const o = oldMonths(r.maturityDate!, ASOF);
      const n = monthsBetween(r.maturityDate!, ASOF);
      // The verdict each convention produces. Old: a rounded count against
      // the window. New: the two dates compared.
      const oldIn = o >= 0 && o <= REFI_WINDOW_MONTHS;
      const newIn = isWithinMonths(r.maturityDate!, ASOF, REFI_WINDOW_MONTHS) && n >= 0;
      const countChanged = o !== n;
      const verdictChanged = oldIn !== newIn;
      if (countChanged) countMoved++;
      if (verdictChanged) {
        verdictMoved++;
        moves.push(`  ${company} — ${r.instrument} (${r.maturityDate}): ${oldIn ? "CARDED" : "held"} -> ${newIn ? "CARDS" : "HELD"}`);
      }
      if (countChanged || verdictChanged) {
        lines.push(`    ${r.maturityDate}  old ${String(o).padStart(4)}  new ${String(n).padStart(4)}  ${oldIn ? "in " : "out"} -> ${newIn ? "in " : "out"}${verdictChanged ? "   *** VERDICT MOVED ***" : ""}   ${r.instrument.slice(0, 52)}`);
      }
    }
    console.log(`\n  ${company}  —  ${dated.length} dated row(s), ${lines.length} differing`);
    for (const l of lines) console.log(l);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  DATED ROWS EXAMINED:        ${rowsSeen}`);
  console.log(`  MONTH COUNT CHANGED:        ${countMoved}`);
  console.log(`  CARD VERDICT CHANGED:       ${verdictMoved}`);
  for (const m of moves) console.log(m);
  console.log(`  SPEND:                      $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
