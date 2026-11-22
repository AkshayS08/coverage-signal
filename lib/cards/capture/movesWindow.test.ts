/**
 * SESSION 27 (Akshay, Nov 21): THE MOVES WINDOW IS ENFORCED IN CODE. The facts prompt asks for moves from January 1 of
 * the anchor period's year onward; the verifier now rejects any move dated before it (lastBuild.movesWindowStart, the
 * card's own window), so a read that strays never reaches the facts. The card never showed them; readWindow T2 and
 * verifierParity flagged them (DaVita's May 2025 issuance, Molina's and Cigna's 2025 moves).
 *
 *   W1  over the six adopted answers: no kept move is dated before its anchor year's January 1
 *   W2  an in-window move is kept (DaVita's June 8, 2026 add-on; Encompass's May 2026 redemption)
 *   control: the facts adopted Nov 20 (c0c285c) kept moves dated before the window
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/movesWindow.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { verifyAsk } from "./verifyFacts";
import { dateId } from "./factConsensus";
import { movesWindowStart } from "../../cache/lastBuild";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const CIKS = ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"];
const before = (date: string, start: string) => dateId(date) < start.slice(0, dateId(date).length);

const kept: Record<string, any[]> = {};
for (const cik of CIKS) {
  const snap = read(`lib/cards/inputs/${cik}.json`), raw = read(`lib/cards/inputs/facts/raw-${cik}.json`);
  const start = movesWindowStart(snap.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.reportDate);
  const rejected: any[] = [];
  kept[cik] = raw.asks.flatMap((a: any) => verifyAsk(snap, a, rejected).moves);
  const early = kept[cik].filter((m: any) => before(m.date.value, start));
  assert(early.length === 0, `[W1:${cik}] no kept move before ${start}${early.length ? `: ${early.map((m: any) => `${m.type} ${m.date.value}`).join("; ")}` : ""}`);
}
assert(kept["0000927066"].some((m: any) => /June 8, 2026/.test(m.date.value)) && kept["0000785161"].some((m: any) => m.type === "redemption" && /May 2026/.test(m.date.value)), `[W2] in-window moves are kept (DaVita June 8, 2026; Encompass May 2026)`);
const adopted = (cik: string) => JSON.parse(execSync(`git show c0c285c:lib/cards/inputs/facts/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 }));
const strays = CIKS.flatMap((cik) => adopted(cik).moves.filter((m: any) => dateId(m.date.value) < "2026").map((m: any) => `${cik} ${m.type} ${m.date.value}`));
assert(strays.length > 0, `[control] the facts adopted Nov 20 kept moves before the window: ${strays.join("; ")}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
