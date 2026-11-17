/**
 * SESSION 27 (Akshay, Nov 16) — RULING A2, COMPLETED-MOVE DATING IN CODE. When the read set holds a sentence stating
 * the completion of the same move, the completed move is dated by it; its launch is shown only where a sentence states
 * it ("launched Apr 22"). No prompt change, no re-read: CHS's facts dated its tender by its launch.
 *
 *   A1  CHS's tender (its paid facts: "April 22, 2026") reads "May 6, 2026 (launched Apr 22) · Repurchased"; the May 6
 *       possible move resolves
 *   A2  a completed move whose sentences state no completion keeps its date (CHS's Feb 2 special call)
 *   A3  control: the card before the rule shows "Apr 22, 2026 · Repurchased" and the May 6 possible move
 *   A4  control: a completion stated for another instrument (another coupon) does not re-date the move
 *   A5  control: with no launch stated, no launch is shown
 *   A6  a pending move is never dated by a completion sentence
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/completedDating.test.ts
 */
import { readFileSync } from "node:fs";
import { buildCard } from "./build";
import { verifyAsk } from "./capture/verifyFacts";
import { reproduceFacts } from "./capture/factConsensus";
import { factsReadSetOf } from "./factsValidity";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");

const chs = read("sessions/27/chs_refresh_v3/input.json");
const raw = read("sessions/27/chs_refresh_v3/raw-0001108109.json");
const anchorUrl = chs.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
const factsFrom = (snap: any, r: any) => { const asks = r.asks.map((a: any) => verifyAsk(snap, a, [])); const residual: any[] = []; return { cik: snap.cik, anchorUrl, readSet: factsReadSetOf(snap.result), promptVersion: 3, asks: 3, costUsd: 0, ...reproduceFacts(asks, residual), residual }; };
const BRIEF = "2026-11-16";
const cardOf = (snap: any, facts: any) => buildCard({ result: snap.result, briefDate: BRIEF, previousBrief: null, weekFilings: [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
const metas = (c: any) => c.v3.moves.map((m: any) => txt(m.meta));
const poss = (c: any) => (c.v3.possibleMoves ?? []).map(txt);

const facts = factsFrom(chs, raw);
const card = cardOf(chs, facts);
assert(metas(card).includes("May 6, 2026 (launched Apr 22) · Repurchased") && !poss(card).some((p: string) => /May 6, 2026/.test(p)), `[A1] ${metas(card).join(" | ")}; possible moves: ${poss(card).length}`);
assert(metas(card).some((m: string) => /^Feb 2, 2026 · Redeemed/.test(m)), `[A2] the Feb 2 special call keeps its date`);

const before = JSON.parse(require("node:child_process").execSync("git show 3ab16f2:sessions/27/chs_refresh_v3/card.json", { encoding: "utf-8", maxBuffer: 64e6 })); // the card before the rule
assert(metas(before).includes("Apr 22, 2026 · Repurchased") && poss(before).some((p: string) => /May 6, 2026/.test(p)), `[A3 control] before the rule: ${metas(before).join(" | ")}`);

// A4: the completion sentence names another coupon.
const other = JSON.parse(JSON.stringify(chs));
for (const d of Object.values(other.docs) as any[]) d.text = d.text.replace(/that launched on April 22, 2026, and was completed on May 6, 2026/g, "that launched on April 22, 2026").replace(/\bwas completed on May 6, 2026\b/g, "was launched");
other.docs[anchorUrl].text += "\n\nThe tender offer for the 9.125 % Senior Secured Notes due 2040 was completed on May 6, 2026.";
const f4 = JSON.parse(JSON.stringify(facts));
for (const m of f4.moves) for (const k of ["date", "instrument", "face", "funding"]) if (m[k]?.src?.sentence) m[k].src.sentence = m[k].src.sentence.replace(/that launched on April 22, 2026, and was completed on May 6, 2026/g, "that launched on April 22, 2026");
const c4 = cardOf(other, f4);
assert(!metas(c4).some((m: string) => /^May 6, 2026/.test(m)), `[A4 control] a completion stated for another coupon does not re-date: ${metas(c4).join(" | ")}`);

// A5: completion stated, launch not.
const nolaunch = JSON.parse(JSON.stringify(chs));
for (const d of Object.values(nolaunch.docs) as any[]) d.text = d.text.replace(/a tender offer that launched on April 22, 2026, and was completed on May 6, 2026/g, "a tender offer that was completed on May 6, 2026");
const f5 = JSON.parse(JSON.stringify(facts));
for (const m of f5.moves) for (const k of ["date", "instrument", "face", "funding"]) if (m[k]?.src?.sentence) m[k].src.sentence = m[k].src.sentence.replace(/a tender offer that launched on April 22, 2026, and was completed on May 6, 2026/g, "a tender offer that was completed on May 6, 2026");
const c5 = cardOf(nolaunch, f5);
assert(metas(c5).includes("May 6, 2026 · Repurchased"), `[A5 control] no launch stated, none shown: ${metas(c5).join(" | ")}`);

// A6: a pending move stays on its own date.
const f6 = JSON.parse(JSON.stringify(facts));
for (const m of f6.moves) if (m.type === "tender offer") m.status = "pending";
const c6 = cardOf(chs, f6);
assert(!metas(c6).some((m: string) => /^May 6, 2026/.test(m)), `[A6] a pending move is not dated by a completion: ${metas(c6).join(" | ")}`);

// A7: a period end is not a move's day. Cigna's Q1 10-Q, now in its input: "During the three months ended March 31,
// 2026, the Company repaid $550 million 1.250% senior notes that matured in March 2026." The repayment stays "Mar 2026".
const cig = read("sessions/27/cigna_facts/input.json");
const cigFacts = { ...factsFrom(cig, read("sessions/27/cigna_facts/raw-0001739940.json")), anchorUrl: cig.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url };
const c7 = cardOf(cig, cigFacts);
const rep7 = metas(c7).find((m: string) => /Repaid at maturity/.test(m));
assert(!!rep7 && /^Mar 2026 · Repaid at maturity/.test(rep7), `[A7] a period end ("three months ended March 31, 2026") does not date Cigna's repayment: ${rep7 ?? "(no repayment card)"}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
