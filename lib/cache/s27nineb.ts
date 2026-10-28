/**
 * SESSION 27, STAGE 1, STEP 6 — 9b: DO THE RE-TASTES REPRODUCE THE CANONICAL POSITION? $0, offline.
 *
 * Each re-taste (baselines/s27-retaste.json) against its name's canonical v33
 * answer (baselines/s27-replay.json: the cached canonical answer through the
 * current code), through compareToGolden with the tolerated classes:
 * a re-transcribed source line (verbatim in its row's document, stating the
 * amount), a withheld figure differing in amount or reason, and a label the
 * name rule renders from its sentence. Facility figures are reported beside
 * it, as 9b does not pin them.
 *
 * Run: npx tsx lib/cache/s27nineb.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, sourceLineCheckFor } from "../events/golden";

const canon = JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")).results as { company: string; result: any }[];
const re = JSON.parse(readFileSync("baselines/s27-retaste.json", "utf-8")).results as { company: string; bust: string; usd: number; result: any }[];
const AS_OF = new Date("2026-10-15T00:00:00Z");
const docsOf = (cik: string) => new Map<string, string>(Object.entries(JSON.parse(readFileSync(`lib/cards/inputs/${cik}.json`, "utf-8")).docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available"] as const;
const figs = (r: any) => (r.results.find((t: any) => t.triggerId === "debt-maturity")?.facilities ?? []).map((f: any) => `${f.name}: ${FIELDS.map((k) => `${k}=${f[k]?.value ?? "—"}`).join(" ")}`);
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
let reproduced = 0;
for (const r of re) {
  const c = canon.find((x) => x.result.cik === r.result.cik);
  if (!c) { say(`${r.company} [${r.bust}]: no canonical answer to compare`); continue; }
  const v = compareToGolden(deriveGoldenState(c.result, AS_OF), deriveGoldenState(r.result, AS_OF), { sourceLineCheck: sourceLineCheckFor(r.result, docsOf(r.result.cik), AS_OF) });
  const ok = v.kind === "matches";
  if (ok) reproduced++;
  say(`\n${r.company} [${r.bust}] ($${r.usd.toFixed(4)}): ${ok ? "REPRODUCES the canonical position" : v.kind === "not-applicable" ? `NOT APPLICABLE — ${v.reason}` : "DIVERGES from the canonical position"}`);
  if (v.kind === "diverged") for (const d of v.divergences) say(`    ${d.slice(0, 240)}`);
  if (v.kind !== "not-applicable") for (const t of v.tolerated) say(`    tolerated: ${t.slice(0, 200)}`);
  const fc = figs(c.result), fr = figs(r.result);
  for (const [k, l] of fr.entries()) if (l !== fc[k]) say(`    facility figures (not pinned by 9b): canonical ${fc[k] ?? "—"} | this sample ${l}`);
}
say(`\n9b: ${reproduced} of ${re.length} re-taste samples reproduce their canonical position.`);
writeFileSync("sessions/27/stage1_9b.txt", lines.join("\n") + "\n");
