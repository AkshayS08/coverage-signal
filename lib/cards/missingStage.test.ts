/**
 * SESSION 27 (Akshay, Oct 30, 2026) — A SECTION WHOSE STAGE HAS NOT RUN ON THE
 * CURRENT ANCHOR RENDERS "NOT YET READ FROM [FILING]". It never asserts
 * absence, and it never renders a section from a prior anchor.
 *
 * Molina's first refresh render said "No debt moves stated this year": false —
 * the Feb 4 amendment is this year — because the verified-facts stage, which
 * reads moves, had not run on the Oct 22 10-Q.
 *
 *   M1  every committed card of the six: its facts were read from its own
 *       anchor, so no section says "not yet read" and the facts sections render
 *   M2  Molina's refresh with no facts: moves, liquidity, the chart and the
 *       facilities each say "not yet read from 10-Q filed Oct 22, 2026", and the
 *       moves section does not say "No debt moves stated"
 *   M3  Molina's refresh with the PRIOR anchor's facts (the Jul 23 10-Q's):
 *       treated as not read — nothing from them renders (no Feb 4 amendment
 *       move, no sub-facility line), and the sections say "not yet read"
 *   M4  control: the checker flags a card whose facts stage did not run yet
 *       whose moves section asserts "No debt moves stated"
 *
 * Offline, $0. Run: npx tsx lib/cards/missingStage.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCard } from "./build";
import { movesSectionText } from "./sections";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const IN = join("lib", "cards", "inputs");
const CIKS = JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[];
const txt = (l: any[]) => l.map((s: any) => s.t ?? s.printed ?? "").join("");
const UNREAD = /not yet read from/i;
const ABSENT_MOVES = /No debt moves stated/i;

/** The checker: where the facts stage did not run on this card's anchor, nothing may assert absence. */
function stageViolations(card: any): string[] {
  const v = card.v3, out: string[] = [];
  if (v.stages?.facts === true) return out;
  if (ABSENT_MOVES.test(movesSectionText(v))) out.push(`moves: "${movesSectionText(v)}"`);
  if (!UNREAD.test(movesSectionText(v))) out.push("moves: no not-yet-read line");
  for (const [name, lines] of [["liquidity", v.liquidity.notes], ["chart", v.chart.captions]] as const) if (!(lines as any[]).some((l) => UNREAD.test(txt(l)))) out.push(`${name}: no not-yet-read line`);
  if (!v.facilities.some((f: any) => UNREAD.test(txt(f.bold) + txt(f.sub ?? [])))) out.push("facilities: no not-yet-read line");
  return out;
}

console.log("\n=== M1: the six committed cards ===");
for (const cik of CIKS) {
  const card = JSON.parse(readFileSync(join("lib", "cards", "generated", `${cik}.json`), "utf-8"));
  assert(card.v3.stages?.facts === true && !UNREAD.test(JSON.stringify(card.v3)) && stageViolations(card).length === 0, `[M1:${card.company}] facts read from its own anchor; no section says "not yet read"`);
}

console.log("\n=== M2-M3: Molina's refresh ===");
const result = JSON.parse(readFileSync(join("baselines", "s27-molina-refresh.json"), "utf-8")).results.find((x: any) => x.bust === null).result;
const snap = JSON.parse(readFileSync(join(IN, "0001179929.json"), "utf-8"));
const build = (facts: any) => buildCard({ result, briefDate: "2026-10-30", previousBrief: "2026-10-15", weekFilings: [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: [], facts }) as any;
for (const [label, facts] of [["no facts", null], ["the prior anchor's facts", JSON.parse(readFileSync(join(IN, "facts", "0001179929.json"), "utf-8"))]] as const) {
  const card = build(facts), v = card.v3, moves = movesSectionText(v);
  assert(v.stages?.facts === false && stageViolations(card).length === 0 && /10-Q filed Oct 22, 2026/.test(moves), `[${label === "no facts" ? "M2" : "M3"}] Molina refresh, ${label}: every facts section says "not yet read from 10-Q filed Oct 22, 2026"; moves reads "${moves}" (violations: ${stageViolations(card).join("; ") || "none"})`);
  if (label !== "no facts") {
    // Rendered text only: a cited sentence behind a link (src) is the current anchor's own text, not a prior fact.
    const all = JSON.stringify(v, (k, x) => (k === "src" ? undefined : x));
    assert(!/Feb 4, 2026/.test(all) && !/Swingline sub-facility/i.test(all), `[M3] nothing from the prior anchor's facts renders (no Feb 4 amendment, no swingline sub-facility)`);
  }
}

console.log("\n=== M4: the control ===");
const bad = build(null);
bad.v3.movesUnread = null;
assert(stageViolations(bad).some((x) => /No debt moves stated/.test(x)), `[M4 control] a card whose facts stage did not run, saying "No debt moves stated", is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
