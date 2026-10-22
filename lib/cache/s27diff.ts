/**
 * SESSION 27, STAGE 1, STEP 6 — EACH RE-EXTRACTED NAME AGAINST ITS SIGNED GOLDEN. $0, offline.
 *
 * Reads the results s27reextract.ts wrote (baselines/s27-<phase>.json) and
 * compares each, through the same derivation goldenThroughLoop uses
 * (deriveGoldenState, compareToGolden), with the v31 golden it was signed
 * as, plus the position identity (Rule 65: the documents the position rests
 * on). "Zero position change" means both match. Nothing here re-signs.
 *
 * Run: npx tsx lib/cache/s27diff.ts canonical
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, positionFilingSetOf, type GoldenFile } from "../events/golden";

const phase = process.argv[2] ?? "canonical";
const run = JSON.parse(readFileSync(`baselines/s27-${phase}.json`, "utf-8")) as { results: { company: string; bust: string | null; usd: number; result: any }[] };
const goldens = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8")) as GoldenFile);
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
let changed = 0;
for (const r of run.results) {
  const g = goldens.find((x) => x.state.cik === r.result.cik && x.extractionVersion === 31);
  if (!g) { say(`${r.company}: NO v31 GOLDEN to compare against`); changed++; continue; }
  const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
  const verdict = compareToGolden(g.state, deriveGoldenState(r.result, asOf));
  const idNow = positionFilingSetOf(r.result, asOf), idThen = g.state.filingSet;
  const sameId = idNow.join("|") === idThen.join("|");
  const same = verdict.kind === "matches" && sameId;
  if (!same) changed++;
  say(`\n${r.company}${r.bust ? ` [${r.bust}]` : ""} ($${r.usd.toFixed(4)}): ${same ? "ZERO POSITION CHANGE against the signed v31 golden" : "POSITION CHANGED — a finding to explain before any signing"}`);
  if (verdict.kind === "diverged") for (const d of verdict.divergences) say(`    ${d}`);
  if (verdict.kind === "not-applicable") say(`    not applicable: ${verdict.reason}`);
  if (!sameId) say(`    position identity: signed on ${idThen.map((u) => u.split("/").pop()).join(", ")}; now ${idNow.map((u) => u.split("/").pop()).join(", ")}`);
}
say(`\n${run.results.length - changed} of ${run.results.length} with zero position change.`);
writeFileSync(`sessions/27/stage1_diffs_${phase}.txt`, lines.join("\n") + "\n");
process.exit(changed > 0 ? 1 : 0);
