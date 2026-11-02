/**
 * SESSION 27 (Akshay, Oct 31, 2026) — A DEBT-MOVE SENTENCE THE FACTS STAGE DID
 * NOT KEEP IS A CHECK FAILURE: the card lists it as "Possible move, not
 * confirmed" with its sentence, never as fact and never as "none".
 *
 * Diagnosis (Rule 63): on Molina's Q2 anchor all three facts asks returned the
 * Feb 4, 2026 credit-agreement amendment from "We executed an amendment to the
 * Credit Agreement on February 4, 2026 …"; on the Q3 anchor the same sentence
 * was in the input, the instruction is year-scoped ("from January 1 of the
 * anchor period's year"), and all three returned no moves. Not a quarter
 * scope: the model omitted a sentence it was shown. The cause is fixed by
 * locating move sentences in code and handing them to the facts stage as a
 * list to account for; this check is the safety net.
 *
 *   P1  the locator finds Molina's Feb 4 amendment sentence (Q3 anchor),
 *       Cigna's March 2026 repayment and Tenet's Sept 22 issuance, each dated
 *       in its window; and it does not take "may redeem" or a prior year
 *   P2  every committed card of the six: each located move sentence is a
 *       confirmed move or a "Possible move, not confirmed" line, and the moves
 *       section never says "none" while one is unconfirmed
 *   P3  Molina's refresh card (Q3 facts, which kept no move): the Feb 4
 *       amendment shows as a possible move, not confirmed, and the section does
 *       not say "No debt moves stated"
 *   P4  control: the same card with its possible-move lines removed is flagged
 *   P5  the facts input lists the located move sentences for the stage to
 *       account for (the cause, fixed)
 *
 * Offline, $0. Run: npx tsx lib/cards/possibleMoves.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { locateMoveSentences, uncoveredMoves } from "./moveSentences";
import { movesSectionText } from "./sections";
import { buildCard } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const IN = join("lib", "cards", "inputs");
const txt = (l: any[]) => l.map((s: any) => s.t ?? s.printed ?? "").join("");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const docsOf = (snap: any) => Object.entries(snap.docs as Record<string, { label: string; text: string }>).map(([url, d]) => ({ url, label: d.label, text: d.text }));

console.log("\n=== P1: the locator ===");
const mol = JSON.parse(readFileSync("sessions/27/molina_review_input.json", "utf-8"));
const molAnchor = mol.result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling;
const mFound = locateMoveSentences(docsOf(mol).filter((d) => d.url === molAnchor.url), "2026-01-01", "2026-10-30");
assert(mFound.some((m) => /amendment to the Credit Agreement on February 4, 2026/.test(m.sentence) && m.date === "2026-02-04"), `[P1] Molina Q3: the Feb 4, 2026 amendment sentence (${mFound.length} located: ${mFound.map((m) => m.date).join(", ")})`);
const cig = JSON.parse(readFileSync(join(IN, "0001739940.json"), "utf-8"));
assert(locateMoveSentences(docsOf(cig), "2026-01-01", "2026-10-15").some((m) => /repaid \$ 550 million 1\.250 % senior notes/.test(m.sentence)), `[P1] Cigna: the March 2026 repayment`);
const ten = JSON.parse(readFileSync(join(IN, "0000070318.json"), "utf-8"));
assert(locateMoveSentences(docsOf(ten), "2026-01-01", "2026-10-15").some((m) => /6\.250%/.test(m.sentence) && m.date.startsWith("2026-09")), `[P1] Tenet: the Sept 22 issuance`);
assert(locateMoveSentences([{ url: "u", label: "x", text: "We may redeem the 2030 Notes at any time on or after March 1, 2026. In March 2025, we repaid $500 million of senior notes." }], "2026-01-01", "2026-10-15").length === 0, `[P1 control] "may redeem" and a 2025 repayment are not located`);

/** The check: every located move sentence is a confirmed move's or a possible-move line; no absence claim beside one. */
function violations(card: any, docs: { url: string; label: string; text: string }[], from: string, to: string): string[] {
  const v = card.v3, out: string[] = [];
  // The card's own coverage rule (uncoveredMoves): what no confirmed move covers must be listed as possible.
  const possible = flat((v.possibleMoves ?? []).map(txt).join(" | "));
  for (const m of uncoveredMoves(locateMoveSentences(docs, from, to), v.moves)) {
    const head = flat(m.sentence).slice(0, 50);
    if (!possible.includes(head)) out.push(`unlisted: "${head}…" (${m.date})`);
  }
  if (out.length === 0 && (v.possibleMoves ?? []).length && /No debt moves stated/.test(movesSectionText(v))) out.push("asserts none beside a possible move");
  if ((v.possibleMoves ?? []).length && /No debt moves stated/.test(movesSectionText(v))) out.push(`moves section says "${movesSectionText(v)}" beside a possible move`);
  return out;
}

console.log("\n=== P2: the six committed cards ===");
const CIKS = JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[];
for (const cik of CIKS) {
  const card = JSON.parse(readFileSync(join("lib", "cards", "generated", `${cik}.json`), "utf-8"));
  const snap = JSON.parse(readFileSync(join(IN, `${cik}.json`), "utf-8"));
  const period = snap.result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.reportDate as string;
  const v = violations(card, docsOf(snap), `${period.slice(0, 4)}-01-01`, card.briefDate);
  assert(v.length === 0, `[P2:${card.company}] every located move sentence is confirmed or listed as possible (${(card.v3.possibleMoves ?? []).length} possible)${v.length ? ` — ${v.join("; ")}` : ""}`);
}

console.log("\n=== P3-P4: Molina's refresh card ===");
const result = JSON.parse(readFileSync("baselines/s27-molina-refresh.json", "utf-8")).results.find((x: any) => x.bust === null).result;
// Nov 1: Molina's facts were re-run with the move-sentence list and now keep the Feb 4 amendment (the cause, fixed).
// The safety net is tested on the case it exists for: the same facts with the move missed, as the first run had it.
const rerun = JSON.parse(readFileSync("sessions/27/molina_review_facts/0001179929.json", "utf-8"));
const missed = { ...rerun, moves: [] };
const buildWith = (facts: any): any => buildCard({ result, briefDate: "2026-10-30", previousBrief: "2026-10-15", weekFilings: [], cash: mol.cash, textByUrl: new Map(docsOf(mol).map((d) => [d.url, d.text])), periodSentence: mol.periodSentence, laterUrls: [], facts });
const card: any = buildWith(missed);
const poss = (card.v3.possibleMoves ?? []).map(txt).join(" | ");
assert(/Possible move, not confirmed/.test(poss) && /February 4, 2026/.test(poss) && !/No debt moves stated/.test(movesSectionText(card.v3)) && violations(card, docsOf(mol), "2026-01-01", "2026-10-30").length === 0, `[P3] the Feb 4 amendment shows as "${poss.slice(0, 120)}…"; the section reads "${movesSectionText(card.v3)}"`);
// P6 (Oct 31): one transaction printed in two documents is one possible move, as it is one confirmed move.
assert((card.v3.possibleMoves ?? []).length === 1, `[P6] the Feb 4 amendment, printed in the 10-Q and the 10-K, is listed once (${(card.v3.possibleMoves ?? []).length} lines)`);
const bad = JSON.parse(JSON.stringify(card)); bad.v3.possibleMoves = [];
assert(violations(bad, docsOf(mol), "2026-01-01", "2026-10-30").length > 0, `[P4 control] with the possible-move lines removed, the card is flagged`);

const confirmed = buildWith(rerun);
assert(confirmed.v3.moves.some((m: any) => /Feb 4, 2026/.test(m.meta.map((x: any) => x.t ?? "").join(""))) && (confirmed.v3.possibleMoves ?? []).length === 0, `[P7] with the re-run facts, the Feb 4 amendment is a confirmed move card and nothing is left as possible`);

console.log("\n=== P8: a redemption notice is covered by the redemption it announced ===");
// Nov 1: with the debt-item 8-Ks back in the read set (M1), Tenet's Sept 8 "notice of conditional full redemption to the
// holders of its 2027 Notes …" surfaced as a possible move beside the confirmed Sept 23 redemption of those notes. A
// notice and the redemption it announces are one transaction: covered by a confirmed retirement of the same notes (by
// maturity year) dated on or after the notice, within 60 days.
const tenRefresh = JSON.parse(readFileSync("sessions/27/refresh/0000070318_review_card.json", "utf-8"));
const tenIn = JSON.parse(readFileSync("sessions/27/refresh/0000070318_input.json", "utf-8"));
const notice = locateMoveSentences(docsOf(tenIn), "2026-01-01", "2026-10-31").filter((m) => /notice of conditional full redemption/.test(m.sentence));
assert(notice.length > 0 && uncoveredMoves(notice, tenRefresh.v3.moves).length === 0 && !(tenRefresh.v3.possibleMoves ?? []).map(txt).join(" ").includes("notice of conditional"), `[P8] Tenet's Sept 8 redemption notice is covered by the confirmed Sept 23 redemption (${notice.length} located; card lists ${(tenRefresh.v3.possibleMoves ?? []).length} possible)`);
const noRedemption = tenRefresh.v3.moves.map((m: any) => ({ ...m, retires: null }));
assert(uncoveredMoves(notice, noRedemption).length > 0, `[P8 control] with the confirmed redemption removed, the notice is a possible move`);
for (const cik of CIKS) {
  const c = JSON.parse(readFileSync(join("lib", "cards", "generated", `${cik}.json`), "utf-8"));
  const own = (c.v3.possibleMoves ?? []).map(txt).filter((p: string) => /notices? of (?:conditional )?(?:full |partial )?redemption/i.test(p));
  assert(own.length === 0 || own.every((p: string) => !c.v3.moves.some((m: any) => JSON.stringify(m).includes((/\b(20\d\d) (?:Senior )?Notes/.exec(p) ?? [])[1] ?? "@@"))), `[P8:${c.company}] no redemption notice is listed as possible beside the redemption it announced`);
}

console.log("\n=== P5: the cause, fixed ===");
const dump = join(process.env.TEMP ?? ".", "p5dump");
require("node:fs").mkdirSync(dump, { recursive: true });
require("node:child_process").execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", "2026-10-30", "--input", "sessions/27/molina_review_input.json", "--dump", dump], { env: { ...process.env, ANTHROPIC_API_KEY: "" }, shell: true, stdio: "ignore" });
const input = existsSync(join(dump, "input-0001179929.txt")) ? readFileSync(join(dump, "input-0001179929.txt"), "utf-8") : "";
assert(/CANDIDATE MOVE SENTENCES/.test(input) && /amendment to the Credit Agreement on February 4, 2026/.test(input.split("CANDIDATE MOVE SENTENCES")[1] ?? ""), `[P5] the facts input lists the located move sentences, the Feb 4 amendment among them`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
