/**
 * SESSION 27 (Akshay, Nov 13, 2026) — THE FACTS VERIFIER CALLS THE CARD'S OWN DECIDING FUNCTIONS, WITH NO COPY.
 *
 * No new rules: spacing-normalised quote matching, same-move identity across held documents, and completed-versus-
 * scheduled dating (ruling A2) are decided in lib/cards/moveEvidence.ts, and both the card build and the verifier
 * call it.
 *   V1  build.ts and facts.ts both import the three from moveEvidence.ts; neither keeps its own NOTICE or SCHEDULED
 *       pattern, its own quote normaliser, or its own move verb
 *   V2  on every saved answer (published facts, the re-run, the refresh renders, Molina's review), every move the
 *       verifier keeps has its date in a sentence the card's functions accept for that move (its own sentence, or one
 *       that states the same move); every move it rejects has no such sentence in the documents it was verified against
 *   control: a verifier verdict that accepts a completed move dated by a notice ("issued a notice of conditional full
 *            redemption") fails V2
 *
 * Offline, $0. Run: npx tsx lib/cards/verifierParity.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyAskForTest } from "./capture/verifyFacts";
import { quoteFound, statesSameMove, datesCompletedMove } from "./moveEvidence";
import { paragraphSentences, antecedentWindow, REFERS, HEADING } from "./antecedent";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

const build = readFileSync("lib/cards/build.ts", "utf-8"), facts = readFileSync("lib/cards/capture/verifyFacts.ts", "utf-8");
const imports = (src: string) => /from "(?:\.\.?\/)+(?:cards\/)?moveEvidence"/.test(src) && /statesSameMove/.test(src) && /quoteFound|quoteKey/.test(src) && /datesCompletedMove|SCHEDULED/.test(src);
const copies = (src: string) => [/const SCHEDULED = \//, /\\bpress release\\b\|\\bannounc/, /const normQ = /, /redeem\\w\*\|redemption\|repurchas\\w\*\|repaid\|retired/].filter((re) => re.test(src)).map(String);
assert(imports(build) && imports(facts) && !copies(build).length && !copies(facts).length, `[V1] both import the deciding functions from moveEvidence.ts; copies left: build ${copies(build).join(" ") || "none"}, facts ${copies(facts).join(" ") || "none"}`);

/** Every saved answer, with the card input it was verified against. */
const sets: { label: string; raw: string; input: string }[] = [];
for (const cik of ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"]) {
  sets.push({ label: `${cik} published`, raw: join("lib", "cards", "inputs", "facts", `raw-${cik}.json`), input: join("lib", "cards", "inputs", `${cik}.json`) });
  sets.push({ label: `${cik} re-run`, raw: join("sessions", "27", "facts_rerun", `raw-${cik}.json`), input: join("lib", "cards", "inputs", `${cik}.json`) });
  sets.push({ label: `${cik} refresh`, raw: join("sessions", "27", "refresh", "facts", `raw-${cik}.json`), input: join("sessions", "27", "refresh", `${cik}_input.json`) });
}
sets.push({ label: "0001179929 Molina review", raw: join("sessions", "27", "molina_review_facts", "raw-0001179929.json"), input: join("sessions", "27", "molina_review_input.json") });
const present = nonEmpty("the saved facts answers", sets.filter((s) => existsSync(s.raw) && existsSync(s.input)));

/** The card's verdict on a move's date: a held sentence it accepts for this move that states the date. */
function cardAccepts(snap: any, m: { type: string; instrument: string; date: string; status: string; sourceLine: string }, sentence: string): boolean {
  const docs = Object.values(snap.docs as Record<string, { text: string }>);
  const doc = docs.find((d) => quoteFound(d.text, sentence));
  if (!doc) return false;
  const own = quoteFound(sentence, m.sourceLine) || quoteFound(m.sourceLine, sentence);
  // The card's antecedent rule: where the move's own sentence refers ("this offering"), the issuance before it in the
  // same paragraph.
  const ownDoc = docs.find((d) => quoteFound(d.text, m.sourceLine));
  let antecedent = false;
  if (ownDoc) {
    const { sentences, hasBreaks } = paragraphSentences(ownDoc.text);
    const at = sentences.findIndex((x) => quoteFound(x.sentence, m.sourceLine) || quoteFound(m.sourceLine, x.sentence));
    antecedent = at >= 0 && REFERS.test(sentences[at].sentence) && antecedentWindow(sentences, at, hasBreaks, (x) => HEADING.test(x)).some((k) => quoteFound(sentences[k].sentence, sentence));
  }
  const same = own || antecedent || statesSameMove(sentence, m, doc.text);
  return same && (m.status !== "completed" || datesCompletedMove(sentence));
}
function cardFinds(snap: any, m: { type: string; instrument: string; date: string; status: string; sourceLine: string }): boolean {
  for (const d of Object.values(snap.docs as Record<string, { text: string }>)) for (const s of paragraphSentences(d.text).sentences) {
    if (quoteFound(s.sentence, m.date) && cardAccepts(snap, m, s.sentence)) return true;
  }
  return false;
}

let moves = 0;
const disagree: string[] = [];
for (const set of present) {
  const raw = read(set.raw), snap = read(set.input);
  for (const ask of raw.asks as any[]) {
    const v = verifyAskForTest(snap, ask);
    for (const m of ask.moves ?? []) {
      moves++;
      const kept = v.moves.find((k: any) => k.type === m.type && k.date.value === m.date && k.instrument.value === m.instrument);
      const ok = kept ? cardAccepts(snap, m, kept.date.src.sentence) : !cardFinds(snap, m);
      if (!ok) disagree.push(`${set.label}: ${m.type} ${m.date} ${String(m.instrument).slice(0, 40)} — verifier ${kept ? "kept" : "rejected"}, the card's functions ${kept ? "do not accept its date sentence" : "find a sentence dating it"}`);
    }
  }
}
assert(moves > 0 && disagree.length === 0, `[V2] ${moves} saved moves over ${present.length} answer sets: verifier and card agree on every one${disagree.length ? `; ${disagree.length} disagree: ${disagree.slice(0, 4).join(" | ")}` : ""}`);

// Control: Tenet's re-run redemption dated by its Sept 8 notice, accepted, must disagree with the card.
const ten = read(join("lib", "cards", "inputs", "0000070318.json"));
const notice = "On September 8, 2026 , the Company issued a notice of conditional full redemption to the holders of its 2027 Notes and a notice of conditional partial redemption to the holders of its 2028 Notes.";
assert(!cardAccepts(ten, { type: "redemption", instrument: "5.125% senior secured first lien notes due November 2027", date: "September 8, 2026", status: "completed", sourceLine: notice }, notice), `[control] a completed redemption dated by its notice is not accepted by the card's functions`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
