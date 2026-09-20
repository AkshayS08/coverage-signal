/** Session 23 — what are a company's ladder rows, and where did each come from? $0 (cache hit). */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";

(async () => {
  for (const company of process.argv.slice(2)) {
    const result = await runAgentLoop(company);
    const pos = assemblePosition(result, PINNED_AS_OF);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    console.log(`\n### ${result.company} — ${pos.rows.length} ladder rows`);
    console.log(`    sources: schedule ${(dm?.scheduleSequence ?? []).length}, prose ${(dm?.proseInstruments ?? []).length}, facilities ${(dm?.facilities ?? []).length}, referenced ${(dm?.referencedScheduleSequence ?? []).length}`);
    for (const r of pos.rows) {
      console.log(`    ${String(r.instrument).slice(0, 52).padEnd(54)} ${String(r.amount ?? "—").slice(0, 18).padEnd(20)} ${r.maturityDate ?? "—"}   [${r.status}]`);
    }
  }
})();
