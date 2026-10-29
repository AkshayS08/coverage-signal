/**
 * SESSION 27 — MOLINA'S QUARTERLY REFRESH AGAINST ITS CURRENT CARD. $0, offline, signs nothing.
 *
 * Current card: the committed snapshot (lib/cards/inputs, v31, anchor the Q2
 * 10-Q). Refresh: the canonical v33 answer on the Oct 22 Q3 10-Q
 * (baselines/s27-molina-refresh.json). Prints the position date, every row
 * (instrument, amount, maturity, class) and the coverage tie on both sides,
 * then 9b across the three refresh samples (s27compare).
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27molinaDiff.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState } from "../events/golden";
import { assemblePosition } from "../events/position";
import { compareSample } from "./s27compare";

const AS_OF = new Date("2026-10-29T00:00:00Z");
const cur = JSON.parse(readFileSync("lib/cards/inputs/0001179929.json", "utf-8")).result;
const ref = JSON.parse(readFileSync("baselines/s27-molina-refresh.json", "utf-8")).results as { bust: string | null; usd: number; result: any }[];
const out: string[] = [];
const say = (s: string) => { console.log(s); out.push(s); };
const side = (label: string, r: any) => {
  const dm = r.results.find((t: any) => t.triggerId === "debt-maturity");
  const st: any = deriveGoldenState(r, AS_OF);
  say(`\n${label}: anchor ${dm.debtScheduleSourceFiling.form} ${dm.debtScheduleSourceFiling.date}, position as of ${dm.debtScheduleSourceFiling.reportDate}`);
  for (const row of assemblePosition(r, AS_OF).rows) say(`  ${row.isCapacity ? "[capacity] " : ""}${row.instrument} | ${row.amount} | ${row.maturityDate ?? "—"} (${row.dateGranularity ?? "—"}) | ${row.status} | class ${row.classification?.priorityClass ?? row.classification?.instrumentType ?? "—"}`);
  say(`  tie: captured face ${st.coverage.capturedFace}; stated total ${st.coverage.statedTotalDebt} (${st.coverage.denominatorSource}); residual ${st.coverage.residualPercent}% — ${st.coverage.residualPasses ? "passes" : "FAILS"}`);
  const subs = dm.scheduleSequence.filter((e: any) => e.kind === "subtotal").map((e: any) => `${e.label ?? "(unlabelled)"} ${e.amount}`);
  say(`  printed subtotals: ${subs.join("; ")}; headings: ${[...new Set(dm.scheduleSequence.filter((e: any) => e.kind === "row").map((e: any) => e.printedHeading ?? "none"))].join("; ")}`);
};
side("CURRENT CARD (committed snapshot, v31)", cur);
const canon = ref.find((x) => x.bust === null)!;
side(`REFRESH (canonical v33, $${canon.usd.toFixed(4)})`, canon.result);
say(`\n9b across the refresh samples (canonical + ${ref.length - 1} re-tastes, one read set):`);
let n = 1;
for (const x of ref.filter((x) => x.bust)) {
  const { verdict, tie } = compareSample(canon.result, x.result, AS_OF);
  if (tie.counts) n++;
  say(`  ${x.bust} ($${x.usd.toFixed(4)}): ${tie.counts ? "reproduces" : tie.checkFailure ? `CHECK FAILURE — ${tie.reason}` : "diverges"}`);
  if (verdict.kind === "diverged") for (const d of verdict.divergences) say(`    ✗ ${d.slice(0, 220)}`);
  if (verdict.kind !== "not-applicable") for (const t of verdict.tolerated) say(`    tolerated: ${t.slice(0, 200)}`);
}
say(`  9b: ${n}/${ref.length}`);
writeFileSync("sessions/27/molina_refresh_diff.txt", out.join("\n") + "\n");
