/**
 * SESSION 27 (Akshay, Nov 16): FACTS CONSENSUS ACROSS THE THREE READS MATCHES BY IDENTITY, NOT WORDING — the principle
 * deltaIdentity applies to positions. A move: its type, status, instrument (coupon, maturity year), amount, and date at
 * its stated precision. Funding: its source kind and amount. Every other fact by its amount, instrument, date or kind.
 *
 *   I1  Cigna, on the three reads already paid for (Nov 16): the March 2026 repayment of the 1.250% notes and the
 *       commercial paper outstanding (~$1.0 billion) reproduce
 *   I2  CHS, on its three paid reads: the ~$600MM funding of the Apr/May tender is kept on both notes it bought (the
 *       10.875% notes' funding quote spliced the sentence; a move's detail stated in the move's own verified sentence
 *       is verified by it)
 *   I3  control: the wording consensus (the Nov 16 facts files) dropped each of these
 *   I4  control: a different coupon, maturity year, amount, date at the same precision, type or funding source is not
 *       the same fact, and drops to the residual
 *
 * Offline, $0: verification and consensus over saved raw answers. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/factConsensus.test.ts
 */
import { readFileSync } from "node:fs";
import { verifyAsk } from "./verifyFacts";
import { reproduceFacts, sameInstrument, sameAmount, sameDate, sameFunding } from "./factConsensus";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const rerun = (snap: any, raw: any) => { const rejected: any[] = []; const asks = raw.asks.map((r: any, i: number) => verifyAsk(snap, r, i === 0 ? rejected : [])); const residual: any[] = []; return { ...reproduceFacts(asks, residual), residual, rejected }; };

// I1 Cigna
const cig = rerun(read("sessions/27/cigna_facts/input.json"), read("sessions/27/cigna_facts/raw-0001739940.json"));
const rep = cig.moves.find((m: any) => m.type === "repayment at maturity" && /1\.250/.test(m.instrument.value));
assert(!!rep && /March 2026/.test(rep.date.value), `[I1] Cigna's March 2026 repayment reproduces: ${rep ? `${rep.date.value} ${rep.instrument.value} ${rep.face?.value}` : "dropped"}`);
assert(!!cig.commercialPaper?.outstanding && sameAmount(cig.commercialPaper.outstanding.value, "$1.0 billion"), `[I1] Cigna's commercial paper outstanding reproduces: ${cig.commercialPaper?.outstanding?.value ?? "dropped"}`);

// I2 CHS
const chs = rerun(read("sessions/27/chs_refresh_v3/input.json"), read("sessions/27/chs_refresh_v3/raw-0001108109.json"));
const tenders = chs.moves.filter((m: any) => m.type === "tender offer");
assert(tenders.length === 2 && tenders.every((m: any) => m.funding && sameAmount(m.funding.value, "$600 million")), `[I2] CHS's tender keeps its ~$600MM funding on both notes: ${tenders.map((m: any) => `${m.instrument.value}: ${m.funding?.value ?? "none"}`).join("; ")}`);

// I2 control: a detail whose quote is not found, and whose value the move's own sentence does not state, is still rejected.
const bad = JSON.parse(JSON.stringify(read("sessions/27/chs_refresh_v3/raw-0001108109.json")));
for (const a of bad.asks) for (const m of a.moves) if (m.funding) m.funding = { value: "net proceeds of the 2035 Notes", sourceLine: "We used the net proceeds of the 2035 Notes to repurchase the notes.", documentUrl: m.funding.documentUrl };
const badRun = rerun(read("sessions/27/chs_refresh_v3/input.json"), bad);
assert(badRun.moves.filter((m: any) => m.type === "tender offer").every((m: any) => !m.funding) && badRun.rejected.some((r: any) => /^funding of/.test(r.fact)), `[I2 control] a funding the move's own sentence does not state is rejected, not borrowed`);

// I3 controls: the wording consensus
// The facts files as the wording consensus wrote them (3ab16f2), before they were re-derived by identity.
const atWording = (p: string) => JSON.parse(require("node:child_process").execSync(`git show 3ab16f2:${p}`, { encoding: "utf-8", maxBuffer: 64e6 }));
const oldCig = atWording("sessions/27/cigna_facts/0001739940.json"), oldChs = atWording("sessions/27/chs_refresh_v3/facts.json");
assert(!oldCig.moves.some((m: any) => m.type === "repayment at maturity") && !oldCig.commercialPaper?.outstanding && oldChs.moves.filter((m: any) => m.type === "tender offer" && m.funding).length < 2, `[I3 control] the wording consensus dropped Cigna's repayment and CP outstanding, and CHS's funding on one note`);

// I4 controls: identity, not similarity
assert(sameInstrument("1.250% senior notes", "$550 million 1.250% notes due March 2026") && sameInstrument("10 ⅞% Senior Secured Notes due 2032", "10.875% Senior Secured Notes due 2032"), `[I4] same coupon (printed as a fraction or a decimal), maturity year where both state one: same instrument`);
assert(!sameInstrument("4.500% Senior Notes due 2030", "4.875% Senior Notes due 2030") && !sameInstrument("6.875% Senior Notes due 2028", "6.875% Junior-Priority Secured Notes due 2029"), `[I4 control] a different coupon or maturity year is another instrument`);
assert(sameAmount("approximately $ 1.0 billion", "$1,000 million") && !sameAmount("$ 368 million", "$ 231 million"), `[I4 control] amounts by value: $1.0 billion is $1,000 million; $368 million is not $231 million`);
assert(sameDate("March 2026", "March 2026") && sameDate("March 2026", "March 15, 2026") && !sameDate("March 2026", "April 15, 2026") && !sameDate("April 22, 2026", "May 6, 2026"), `[I4 control] dates by identity (Nov 18): a day within the stated month is the same date; another month or another day is not`);
assert(sameFunding("approximately $ 600 million of cash on hand from recent divestiture proceeds", "$600 million of cash on hand from divestiture proceeds") && !sameFunding("net proceeds from the 2034 Notes", "cash on hand"), `[I4 control] funding by source kind and amount: new notes are not cash on hand`);
const one = JSON.parse(JSON.stringify(read("sessions/27/cigna_facts/raw-0001739940.json")));
for (const m of one.asks[2].moves) m.instrument = String(m.instrument).replace(/1\.250\s*%/, "1.500%");
const changed = rerun(read("sessions/27/cigna_facts/input.json"), one);
assert(!changed.moves.some((m: any) => m.type === "repayment at maturity"), `[I4 control] one read naming another coupon: the repayment is not reproduced`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
