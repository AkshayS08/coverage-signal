/**
 * SESSION 27 (Akshay, Nov 9, 2026) — THE ANTECEDENT IS READ IN ITS OWN PARAGRAPH (decision 13's approximation retired
 * where the text has paragraphs).
 *
 * The card input's text now keeps paragraph breaks (getFilingParagraphs). A referring funding sentence ("the net
 * proceeds from this offering") resolves to the nearest preceding sentence naming an issuance IN ITS OWN PARAGRAPH,
 * however far back, stopping at a note heading. Text without paragraph breaks (an input captured before Nov 9) keeps
 * the three-sentence window.
 *   Q1  with breaks: an antecedent four sentences back in the same paragraph is found
 *   Q2  with breaks: a sentence naming an issuance in the PREVIOUS paragraph is not the antecedent
 *   Q3  without breaks: the three-sentence window (two back is read, four back is not)
 *   Q4  build.ts reads its sentence pools and the antecedent window from antecedent.ts
 *   control: the three-sentence window over the Q1 text misses the antecedent
 *
 * Offline, $0. Run: npx tsx lib/cards/antecedentParagraph.test.ts
 */
import { readFileSync } from "node:fs";
import { paragraphSentences, antecedentWindow } from "./antecedent";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const NAMES = /\$\d+ million of [\d.]+% Senior Notes due 20\d\d/;
const HEADING = /^\d{1,2}\.\s+[A-Z][a-z]+/;
type P = ReturnType<typeof paragraphSentences>;
/** The index of the antecedent of the sentence matching `ref`, or -1. */
const resolve = (p: P, ref: RegExp, hasBreaks = p.hasBreaks) => {
  const at = p.sentences.findIndex((x) => ref.test(x.sentence));
  if (at < 0) return -2;
  return antecedentWindow(p.sentences, at, hasBreaks, (s) => HEADING.test(s)).find((k) => NAMES.test(p.sentences[k].sentence)) ?? -1;
};
const OFFERING = /this offering/;

const q1 = paragraphSentences("Note 7. Debt\n\nIn May 2026, we issued $500 million of 5.875% Senior Notes due 2034 at par. The notes are guaranteed by our subsidiaries. Interest is payable semi-annually. The notes rank equally with our other senior debt. We used the net proceeds from this offering to redeem the 2028 Notes.");
assert(q1.hasBreaks && resolve(q1, OFFERING) >= 0, `[Q1] with breaks: the antecedent four sentences back in the same paragraph is found (index ${resolve(q1, OFFERING)})`);

const q2 = paragraphSentences("In March 2026, we issued $400 million of 6.25% Senior Notes due 2031.\n\nThe notes are guaranteed by our subsidiaries. We used the net proceeds from this offering to repay the term loan.");
assert(q2.hasBreaks && resolve(q2, OFFERING) === -1, `[Q2] with breaks: an issuance named in the previous paragraph is not the antecedent (index ${resolve(q2, OFFERING)})`);

const q3 = paragraphSentences("In May 2026, we issued $500 million of 5.875% Senior Notes due 2034 at par. Interest is payable semi-annually. We used the net proceeds from this offering to redeem the 2028 Notes.");
const q3far = paragraphSentences("We issued $500 million of 5.875% Senior Notes due 2034. The notes are guaranteed. Interest is payable semi-annually. The notes rank equally. We used the net proceeds from this offering to redeem notes.");
assert(!q3.hasBreaks && resolve(q3, OFFERING) >= 0 && resolve(q3far, OFFERING) === -1, `[Q3] without breaks: the three-sentence window (two back found: ${resolve(q3, OFFERING)}; four back not read: ${resolve(q3far, OFFERING)})`);

const build = readFileSync("lib/cards/build.ts", "utf-8");
assert(/from "\.\/antecedent"/.test(build) && /antecedentWindow\(/.test(build) && /paragraphSentences\(/.test(build), `[Q4] build.ts reads its sentence pools and the antecedent window from antecedent.ts`);

assert(resolve(q1, OFFERING, false) === -1, `[control] the three-sentence window over the Q1 text misses the antecedent`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
