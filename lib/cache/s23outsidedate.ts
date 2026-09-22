/**
 * WHAT DOES THE FILING ACTUALLY SAY ABOUT THE $700M FACILITY'S MATURITY? $0.
 *
 * Run 1 transcribed "364 days after initial funding, on or prior to
 * September 30, 2026" and carded on 2026-09-30. Run 3 transcribed "364 days
 * after funding" and carried no date at all.
 *
 * Before minting a rule about clauses that state BOTH, two things have to be
 * measured rather than assumed:
 *
 *   1. Does the filing state both in one clause, or did run 1 assemble them?
 *      A rule about a clause that does not exist is a rule about nothing.
 *   2. Is the outside date inside the sentence run 3 ALREADY CITED? If it is,
 *      the date is recoverable from the model's own citation and no corpus
 *      search is needed (B5 stands). If it is not, the rule cannot stabilise
 *      the transcription and saying so is the honest answer.
 *
 * Run: npx tsx lib/cache/s23outsidedate.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { selectBaselineFilings } from "../agent/selectFilings";

const COMPANY = "Universal Health Services";
const TOPIC = /364\s+days|delayed\s+draw|july\s+2026/i;
const OUTSIDE = /on\s+or\s+prior\s+to|no\s+later\s+than|outside\s+date|in\s+any\s+event.*(?:by|prior)/i;

function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.;])\s+/).map((s) => s.trim()).filter((s) => s.length > 30 && s.length < 900);
}

(async () => {
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const corpus = selectBaselineFilings(f.filings);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — every sentence about the 364-day facility, across the ${corpus.length}-document corpus`);
  console.log("=".repeat(104));

  let both = 0, relativeOnly = 0;
  for (const doc of corpus) {
    const { text } = await getFilingText(doc.primaryDocUrl);
    const hits = sentences(text).filter((s) => TOPIC.test(s) && /matur|364\s+days/i.test(s));
    if (hits.length === 0) continue;
    console.log(`\n  -- ${doc.form} ${doc.filingDate}`);
    for (const h of hits) {
      const carriesOutside = OUTSIDE.test(h);
      const carriesDate = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/.test(h);
      if (carriesOutside && carriesDate) both++; else relativeOnly++;
      console.log(`\n     ${carriesOutside && carriesDate ? "★ RELATIVE **AND** OUTSIDE DATE" : "  relative term only        "}`);
      console.log(`       "${h.slice(0, 400)}"`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${both} sentence(s) state a relative term AND a hard outside date in one clause`);
  console.log(`  ${relativeOnly} state a relative term with no outside date`);
  console.log("=".repeat(104));
})();
