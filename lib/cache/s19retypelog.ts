/** THROWAWAY — Session 19: the book-wide subtotal re-typing log, from cache. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { buildCompanyTableBlock, buildEvents } from "../events";
import { computeWalkChecksum, retypeEmbeddedSubtotals, walkGapFractionOf } from "../events/position";
import type { SubtotalRetype } from "../events/position";

const BOTH_BOOKS = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

async function main() {
  const lines: string[] = [];
  let totalRetypes = 0;
  for (const company of BOTH_BOOKS) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((r) => r.triggerId === "debt-maturity");

    const seen: SubtotalRetype[] = [];
    retypeEmbeddedSubtotals(dm?.scheduleSequence, (r) => seen.push(r));
    const prior: SubtotalRetype[] = [];
    retypeEmbeddedSubtotals(dm?.priorScheduleSequence, (r) => prior.push(r));
    totalRetypes += seen.length + prior.length;

    const walk = computeWalkChecksum(dm?.scheduleSequence);
    const gap = walkGapFractionOf(walk);
    const { flashCardCandidates } = buildEvents([result]);
    const table = buildCompanyTableBlock(result, flashCardCandidates);

    lines.push(
      `${company.padEnd(28)} retypes=${String(seen.length + prior.length).padStart(2)}  walk=${walk.pass ? "TIES " : "FAILS"}  rows=${String(walk.rowCount).padStart(2)}  gap=${gap === null ? "  —  " : gap.toFixed(4)}  cards=${table.cardCount}`
    );
    for (const r of seen) lines.push(`      current : ${JSON.stringify(r.label)} = ${r.amount}  (sum of ${r.rowsSummed} rows)`);
    for (const r of prior) lines.push(`      prior   : ${JSON.stringify(r.label)} = ${r.amount}  (sum of ${r.rowsSummed} rows)`);
  }
  console.error("\n\n================ BOOK-WIDE SUBTOTAL RE-TYPING ================");
  for (const l of lines) console.error(l);
  console.error(`\n${totalRetypes} re-typing(s) across ${BOTH_BOOKS.length} companies.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
