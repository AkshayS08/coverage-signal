/**
 * SESSION 27 (Akshay, Nov 20): OMISSION AGAINST CONTRADICTION; PRINTED SCHEDULES READ BY CODE; ENCOMPASS BACK TO v13.
 * Applied to the reads already paid for, $0.
 *
 *   O1  a move one read omits is kept when the other reads agree on it by identity and the code's own move-sentence
 *       finder (moveSentences.locateMoveSentences) confirms it with a verified sentence; stability fails only on a
 *       contradiction (another amount, date at stated precision, instrument or move-type family), never on omission.
 *       Encompass's May $100MM revolver paydown returns, and its August paydown pairs with its issuance (as May's does)
 *   O2  control: two reads agreeing on a move the finder does not confirm: dropped; one read alone: dropped
 *   O3  control: a contradiction (one read states another amount) fails, confirmed or not
 *   S1  a printed maturity schedule is read by code where the table parses (its years, its columns, and its total, which
 *       the entries must tie to exactly); the model's schedule only where it does not. Tenet's 2026 column ($27MM) returns
 *   S2  control: a table whose entries do not tie to its total is not read by code; the model's schedule stands
 *   C1  a sub-facility's size renders "capacity only", never withheld: Encompass's $260MM letter-of-credit sub-facility
 *       (stated in its 10-K), with the filing it is stated in
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/omissionRules.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { verifyAsk } from "./verifyFacts";
import { reproduceFacts, codeConfirms } from "./factConsensus";
import { scheduleByCode } from "./scheduleByCode";
import { buildCard } from "../build";
import { factsReadSetOf } from "../factsValidity";
import { ladderEquation } from "../ladderEquation";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const BRIEF = "2026-11-09";
const week = read("lib/cards/inputs/week/2026-11-09.json");
const run = (cik: string, opts: { mutate?: (raw: any) => void; confirm?: (m: any) => boolean } = {}) => {
  const snap = read(`sessions/27/facts_full/${cik}/input.json`), raw = read(`sessions/27/facts_full/${cik}/raw-${cik}.json`);
  opts.mutate?.(raw);
  const asks = raw.asks.map((r: any) => verifyAsk(snap, r, []));
  const residual: any[] = [];
  const facts: any = { cik, anchorUrl: snap.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url, readSet: factsReadSetOf(snap.result) ?? undefined, promptVersion: 3, asks: 3, costUsd: 0, ...reproduceFacts(asks, residual, opts.confirm ?? codeConfirms(snap)), residual };
  const sched = scheduleByCode(snap);
  if (sched) facts.schedule = sched;
  const w = week.names[cik];
  const card = buildCard({ result: snap.result, briefDate: BRIEF, previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
  return { snap, facts, card, residual };
};
const retiresOf = (c: any) => (c.v3?.moves ?? []).flatMap((m: any) => (m.retires ? [`${txt(m.meta)} :: ${txt(m.retires.meta)} :: ${m.retires.items.map(txt).join(" / ")}`] : []));

// O1
const enc = run("0000785161");
const r = retiresOf(enc.card);
assert(r.some((x: string) => /^May 29, 2026/.test(x) && /\$100MM of the revolver, repaid/.test(x)), `[O1] Encompass's May $100MM revolver paydown returns: ${r.find((x: string) => /^May 29/.test(x)) ?? "(none)"}`);
assert(r.some((x: string) => /^Aug 13, 2026/.test(x) && /Refinanced · repaid Aug 2026/.test(x) && /Revolver: repaid/.test(x)), `[O1/a] the August paydown pairs with its issuance: ${r.find((x: string) => /^Aug 13/.test(x)) ?? "(no pair)"}`);
// O2
const noConfirm = run("0000785161", { confirm: () => false });
assert(!retiresOf(noConfirm.card).some((x: string) => /\$100MM of the revolver, repaid/.test(x)), `[O2 control] with no code-confirmed sentence, the move two reads agree on is dropped`);
const oneRead = run("0000785161", { mutate: (raw) => { for (const a of raw.asks.slice(1)) a.moves = a.moves.filter((m: any) => !(m.type === "paydown" && /May 2026/.test(m.date))); } });
assert(!retiresOf(oneRead.card).some((x: string) => /\$100MM of the revolver, repaid/.test(x)), `[O2 control] a move only one read states is dropped`);
// O3
const contra = run("0000785161", { mutate: (raw) => { for (const m of raw.asks[1].moves) if (m.type === "paydown" && /May 2026/.test(m.date)) m.face = "$ 150 million"; if (!raw.asks[1].moves.some((m: any) => m.type === "paydown" && /May 2026/.test(m.date))) raw.asks[1].moves.push({ ...raw.asks[0].moves.find((m: any) => m.type === "paydown" && /May 2026/.test(m.date)), face: "$ 150 million" }); } });
assert(!retiresOf(contra.card).some((x: string) => /\$100MM of the revolver, repaid/.test(x)) && contra.residual.some((x: any) => /contradict/.test(x.why)), `[O3 control] a contradiction (another amount) fails: ${contra.residual.filter((x: any) => /contradict/.test(x.why)).map((x: any) => x.fact).join("; ") || "no contradiction recorded"}`);

// S1
const ten = run("0000070318");
const s26 = ten.facts.schedule.find((s: any) => s.period === "2026");
assert(!!s26 && /27/.test(s26.amount.value) && ten.facts.schedule.length === 6, `[S1] Tenet's schedule read by code: ${ten.facts.schedule.map((s: any) => `${s.period}=${s.amount.value}`).join(", ")}`);
const blocks = (ten.card.v3?.table?.schedule ?? []).map((b: any) => `${txt(b.heading)}: ${b.lines.map(txt).join(" / ")}`);
const calls = (ten.card.v3?.call?.notes ?? []).map(txt).join(" ");
assert(blocks.some((x: string) => /^2026: \$27MM other scheduled principal/.test(x)) && /Also in window: \$265MM/.test(calls), `[S1] the card shows "${blocks.find((x: string) => /^2026/.test(x)) ?? "(no 2026 block)"}" and "${calls.match(/Also in window: [^.]*/)?.[0] ?? ""}"`);
// L1: the ladder equation holds exactly (bars + not shown = total debt); control: the candidate without its 2026 column.
const eqNow = ladderEquation(ten.card)!, eqBefore = ladderEquation(JSON.parse(execSync("git show 1aeb8d9:sessions/27/candidates/0000070318.json", { encoding: "utf-8", maxBuffer: 64e6 })))!;
const mm = (x: number) => `$${(x / 1e6).toLocaleString("en-US")}MM`;
assert(eqNow.holds, `[L1] Tenet's ladder: bars ${mm(eqNow.barsUsd)} + not shown ${mm(eqNow.notShownUsd)} = total ${mm(eqNow.totalUsd)}`);
assert(!eqBefore.holds, `[L1 control] without the 2026 column: bars ${mm(eqBefore.barsUsd)} + not shown ${mm(eqBefore.notShownUsd)} against total ${mm(eqBefore.totalUsd)} (gap ${mm(eqBefore.gapUsd)})`);
for (const cik of ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"]) {
  const e = ladderEquation(JSON.parse(execSync(`git show origin/main:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 })));
  assert(!e || e.holds, `[L1:${cik}] production's ladder holds: ${e ? `${mm(e.barsUsd)} + ${mm(e.notShownUsd)} = ${mm(e.totalUsd)}` : "no chart"}`);
}

// S2
const broken = JSON.parse(JSON.stringify(ten.snap));
const a = broken.result.results.find((x: any) => x.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
broken.docs[a].text = broken.docs[a].text.replace(/(Fixed-rate long-term debt\s*\$\s*)27\b/, (_m: string, lead: string) => `${lead}28`);
assert(scheduleByCode(broken) === null, `[S2 control] a table whose entries do not tie to its total is not read by code`);

// C1
const fac = (enc.card.v3?.facilities ?? []).map((f: any) => `${txt(f.bold)} ${txt(f.sub)}`).join(" | ");
const ns = (enc.card.v3?.notShown ?? []).map(txt).join(" | ");
assert(/Letter-of-credit sub-facility \$260MM, capacity only/.test(fac) && !/sub-facility of \$260MM: stated only in an earlier annual report/.test(ns), `[C1] ${fac.match(/Letter-of-credit sub-facility[^.]*\./)?.[0] ?? "(not on the card)"}; not shown: ${ns.slice(0, 120) || "nothing"}`);
const prior = JSON.parse(execSync("git show 1aeb8d9:sessions/27/candidates/0000785161.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(/sub-facility of \$260MM: stated only in an earlier annual report/.test((prior.v3?.notShown ?? []).map(txt).join(" ")), `[C1 control] the candidate before the rule withheld it`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
