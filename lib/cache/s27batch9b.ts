/**
 * SESSION 27 — 9b ACROSS EACH REFRESH IN THE BATCH (canonical + two re-tastes, one read set), at $0, against each
 * name's own refreshed documents (sessions/27/refresh/<cik>_input.json). Run: npx tsx lib/cache/s27batch9b.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, sourceLineCheckFor, countsToward9b } from "../events/golden";
const AS_OF = new Date("2026-10-31T00:00:00Z");
const b = JSON.parse(readFileSync("baselines/s27-refresh-batch.json", "utf-8"));
const out: string[] = [];
for (const n of b.names) {
  const input = JSON.parse(readFileSync(`sessions/27/refresh/${n.cik}_input.json`, "utf-8"));
  const docs = new Map<string, string>(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
  const canon = n.samples.find((s: any) => s.bust === null).result;
  let k = 1; const lines: string[] = [];
  for (const s of n.samples.filter((x: any) => x.bust)) {
    const e = deriveGoldenState(canon, AS_OF), a = deriveGoldenState(s.result, AS_OF);
    const v = compareToGolden(e, a, { sourceLineCheck: sourceLineCheckFor(s.result, docs, AS_OF) });
    const t = countsToward9b(e, a, v);
    if (t.counts) k++;
    lines.push(`  ${s.bust}: ${t.counts ? "reproduces" : t.checkFailure ? `CHECK FAILURE — ${t.reason}` : "diverges"}`);
    if (v.kind === "diverged") for (const d of v.divergences) lines.push(`    ✗ ${d.slice(0, 200)}`);
  }
  const st: any = deriveGoldenState(canon, AS_OF);
  out.push(`${n.company}: 9b ${k}/3; ${st.rows.length} rows; captured face ${st.coverage.capturedFace}; residual ${st.coverage.residualPercent}% (${st.coverage.residualPasses ? "passes" : "FAILS"})`, ...lines);
}
console.log(out.join("\n"));
writeFileSync("sessions/27/refresh/batch_9b.txt", out.join("\n") + "\n");
