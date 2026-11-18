/**
 * SESSION 27 (Akshay, Nov 18): DATES AND MOVE TYPES ACROSS THE THREE READS, applied to the reads already paid for ($0).
 *
 *   D1  a date failure never drops a move: a move whose date fails verification is re-dated from a verified sentence
 *       stating completion of the same move (ruling A2), and a move recorded pending whose completion such a sentence
 *       states is completed; only a move with no confirming sentence is dropped. Tenet's redemptions read "redeemed
 *       Sept 2026 (scheduled for Sept 23)"
 *   D2  date identity: a day within a month stated for the same move is the same date; the more precise day is kept only
 *       where a sentence states completion on it. Tenet's issuance stays Sept 22 (its 8-K states it done)
 *   D3  date formats are normalised before verification and comparison (ISO, written, abbreviated): DaVita's
 *       "2026-06-08" verifies against "June 8, 2026", and is kept as the filer prints it
 *   D4  move-type families: "incremental add-on" and "facility amendment" are one family (an amendment adding debt);
 *       a disagreement across families (issuance against repayment) is flagged, never merged
 *   D5  Encompass: the May redemption ("We used the net proceeds from this offering … to (i) redeem …") is dated by its
 *       antecedent, May 2026: the verifier finds the sentence that contains the quote, not one the quote contains
 *   D6  the three cards keep every production move: Tenet's Sept 22 issuance and both redemptions, DaVita's June 8
 *       add-on, Encompass's May refinancing
 *   controls: each rule's absence, re-introduced, loses its move
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/dateRules.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { verifyAsk } from "./verifyFacts";
import { reproduceFacts, sameDate, moveFamily, normaliseDate } from "./factConsensus";
import { buildCard } from "../build";
import { factsReadSetOf } from "../factsValidity";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const BRIEF = "2026-11-09";
const week = read("lib/cards/inputs/week/2026-11-09.json");
const run = (cik: string, mutate?: (raw: any) => void) => {
  const snap = read(`sessions/27/facts_full/${cik}/input.json`), raw = read(`sessions/27/facts_full/${cik}/raw-${cik}.json`);
  if (mutate) mutate(raw);
  const rejected: any[] = [];
  const asks = raw.asks.map((r: any, i: number) => verifyAsk(snap, r, i === 0 ? rejected : []));
  const residual: any[] = [];
  const facts = { cik, anchorUrl: snap.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url, readSet: factsReadSetOf(snap.result) ?? undefined, promptVersion: 3, asks: 3, costUsd: 0, ...reproduceFacts(asks, residual), residual };
  const w = week.names[cik];
  const card = buildCard({ result: snap.result, briefDate: BRIEF, previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
  return { facts, card, rejected, residual };
};
const lines = (c: any) => (c.v3?.moves ?? []).flatMap((m: any) => [txt(m.meta), ...m.title.map(txt), ...(m.retires ? [txt(m.retires.meta), ...m.retires.items.map(txt)] : [])]);
const prodLines = (cik: string) => lines(JSON.parse(execSync(`git show origin/main:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 })));

// D2 / D3 / D4 units
assert(sameDate("September 2026", "September 22, 2026") && sameDate("2026-06-08", "June 8, 2026") && sameDate("Jun. 8, 2026", "June 8, 2026") && sameDate("Sept 2026", "September 2026"), `[D2/D3] a day within the month, and one date in ISO, written and abbreviated forms, are the same date`);
assert(!sameDate("September 2026", "October 1, 2026") && !sameDate("September 22, 2026", "September 23, 2026"), `[D2 control] another month, or another day, is another date`);
assert(normaliseDate("2026-06-08") === "June 8, 2026" && normaliseDate("Sept. 22, 2026") === "September 22, 2026" && normaliseDate("2026-06") === "June 2026", `[D3] normalised: "2026-06-08" → "${normaliseDate("2026-06-08")}", "Sept. 22, 2026" → "${normaliseDate("Sept. 22, 2026")}"`);
assert(moveFamily("incremental add-on") === moveFamily("facility amendment") && moveFamily("redemption") === moveFamily("special call") && moveFamily("issuance") !== moveFamily("repayment at maturity"), `[D4] families: add-on and amendment one ("${moveFamily("incremental add-on")}"); redemption and special call one; issuance and repayment two`);

// Tenet (D1, D2)
const ten = run("0000070318");
const tl = lines(ten.card), tp = prodLines("0000070318");
assert(tl.includes("Sept 22, 2026 · Issued, confirmed by 8-K"), `[D2] Tenet's issuance stays Sept 22 (its 8-K states it done): ${tl[0] ?? "(no move)"}`);
assert(tl.some((l: string) => /redeemed Sept 2026 \(scheduled for Sept 23\)/.test(l)), `[D1] Tenet's redemptions read "redeemed Sept 2026 (scheduled for Sept 23)": ${tl.filter((l: string) => /Refinanced|Redeemed|redeemed/.test(l)).join(" | ") || "(none)"}`);
const noConfirm = run("0000070318", (raw) => { for (const a of raw.asks) for (const m of a.moves) if (/6\.125/.test(m.instrument)) { m.instrument = m.instrument.replace(/6\.125\s*%/, "7.375%"); m.sourceLine = m.sourceLine.replace(/6\.125\s*%/g, "7.375%"); } });
assert(!lines(noConfirm.card).some((l: string) => /7[.⅜]375|7⅜/.test(l)), `[D1 control] a move no sentence confirms (a 7.375% note in no filing) is dropped`);

// DaVita (D3, D4)
const dva = run("0000927066");
const dl = lines(dva.card);
assert(dl.some((l: string) => /^June 8, 2026 · /.test(l)) && dl.some((l: string) => /incremental \$500MM Term Loan B-2/.test(l)), `[D3/D4] DaVita's June 8 add-on: ${dl.slice(0, 2).join(" | ") || "(none)"}`);
const dvaJune = dva.facts.moves.find((m: any) => /June 8, 2026/.test(m.date.value));
assert(!!dvaJune && dvaJune.date.value === "June 8, 2026", `[D3] kept as the filer prints it: "${dvaJune?.date.value}"`);
const cross = run("0000927066", (raw) => { for (const m of raw.asks[1].moves) if (/June 8, 2026/.test(m.date)) m.type = "repayment at maturity"; });
assert(cross.residual.some((r: any) => /types disagree/.test(r.why)) && !lines(cross.card).some((l: string) => /^June 8, 2026 · Repaid/.test(l)), `[D4 control] issuance-family against repayment is flagged, not merged: ${cross.residual.filter((r: any) => /types disagree/.test(r.why)).map((r: any) => r.fact).join("; ") || "no flag"}`);

// Encompass (D5)
const enc = run("0000785161");
const el = lines(enc.card);
const encRed = enc.facts.moves.find((m: any) => m.type === "redemption" && /4\.50/.test(m.instrument.value));
assert(!!encRed && /May 2026/.test(encRed.date.value), `[D5] Encompass's May redemption is dated by its antecedent: ${encRed ? `${encRed.date.value} (${encRed.date.src.sentence.slice(0, 60)}…)` : "dropped"}`);

// E1: a facility refinancing is the event production showed as an entry and a termination: "Refinanced", with its draw.
const encMeta = (enc.card.v3?.moves ?? []).map((m: any) => txt(m.meta));
const refiCard = (enc.card.v3?.moves ?? []).find((m: any) => /^Mar 9, 2026/.test(txt(m.meta)));
assert(encMeta.includes("Mar 9, 2026 · Refinanced") && !encMeta.some((m: string) => /Facility refinancing|^Mar 2026 · Drew/.test(m)) && /replaced the 2022 agreement/.test(refiCard ? refiCard.title.map(txt).join(" ") : ""), `[E1] Encompass's refinancing: ${refiCard ? `${txt(refiCard.meta)} | ${refiCard.title.map(txt).join(" / ")} | ${txt(refiCard.detail)}` : encMeta.join("; ")}`);
// E2: a retirement and the issuance that funds it are one event, whichever documents state them: no second card.
assert(!encMeta.some((m: string) => /^May 2026 · /.test(m)), `[E2] Encompass's May redemption is on its issuance's card only: ${encMeta.join("; ")}`);
// E3: a revolver is repaid. The use clause's verb is the one that governs the revolver, never the first verb in it.
const noRed = run("0000785161", (raw) => { for (const a of raw.asks) a.moves = a.moves.filter((m: any) => m.type !== "redemption"); });
const may = (noRed.card.v3?.moves ?? []).find((m: any) => /^May 29, 2026/.test(txt(m.meta)));
assert(!!may && !/redeem the revolver/.test(txt(may.detail)) && /repay part of the revolver|repay the revolver/.test(txt(may.detail)), `[E3] with no paired redemption, the use clause reads: "${may ? txt(may.detail) : "(no card)"}"`);

// D6: every production move kept
for (const [cik, name, lst] of [["0000070318", "Tenet", tl], ["0000927066", "DaVita", dl], ["0000785161", "Encompass", el]] as const) {
  const metas = prodLines(cik).filter((l: string) => /^[A-Z][a-z]+\.? \d/.test(l) && / · /.test(l));
  const missing = metas.filter((l: string) => !lst.includes(l));
  assert(missing.length === 0, `[D6:${name}] keeps every production move: ${missing.length ? `missing ${missing.join("; ")}` : metas.join("; ")}`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
