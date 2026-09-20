/**
 * SESSION 23 — IS THE MISSING FIELD MISSING FROM THE MODEL, OR FROM THE FILING?
 *
 * Molina's `drawn` and Encompass's `lettersOfCredit` came back null at the
 * blob. The refresh roster exists to find out whether that drop reproduces.
 * But a refresh can only recover a field the FILING states — so before
 * pricing one, this asks the cheaper question first: does the anchor's own
 * text contain a sentence that would fill the field at all?
 *
 * Three outcomes, and they need different answers:
 *   - the language is there and the field is null  → the model dropped it; a
 *     refresh measures whether the drop reproduces
 *   - the language is NOT there                    → null means "this filing
 *     does not say", which is Rule 53's own distinction and CORRECT. No
 *     refresh recovers it, and the declaration's expectation was wrong.
 *   - the language is there and says something OTHER than zero → the
 *     expectation was wrong in a second way, and the number matters.
 *
 * $0 — filing text is permanently cached.
 *
 * Run: npx tsx lib/cache/s23dropprobe.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { selectBaselineFilings } from "../agent/selectFilings";

const TARGETS: { company: string; field: string; re: RegExp }[] = [
  {
    company: "Molina Healthcare",
    field: "drawn",
    // Any sentence about amounts outstanding / borrowings under the facility.
    re: /(outstanding|borrow|drawn|advance)/i,
  },
  {
    company: "Encompass Health",
    field: "lettersOfCredit",
    re: /letters?\s+of\s+credit|\bL\/Cs?\b/i,
  },
];

const FACILITY = /credit\s+facility|credit\s+agreement|revolv/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600);
}

(async () => {
  for (const t of TARGETS) {
    const f = await getRecentFilings(t.company, ["8-K", "10-Q", "10-K"]);
    // THE WHOLE CORPUS THE MODEL WAS GIVEN, not the anchor alone. The first
    // version of this probe read the anchor only and reported zero hits for
    // Encompass — whose facility sentence comes from an 8-K. A probe that
    // reads less than the model read answers a different question than the
    // one it was asked.
    const corpus = selectBaselineFilings(f.filings);

    console.log(`\n${"=".repeat(100)}`);
    console.log(`${t.company} — field "${t.field}" was null at the blob`);
    console.log(`corpus: ${corpus.length} filings — ${corpus.map((c) => `${c.form} ${c.filingDate}`).join(", ")}`);
    console.log("=".repeat(100));

    let total = 0;
    for (const doc of corpus) {
      const { text } = await getFilingText(doc.primaryDocUrl);
      const hits = sentences(text).filter((s) => FACILITY.test(s) && t.re.test(s));
      total += hits.length;
      if (hits.length === 0) continue;
      console.log(`\n  -- ${doc.form} ${doc.filingDate} — ${hits.length} sentence(s)`);
      for (const h of hits.slice(0, 10)) console.log(`     • ${h}`);
    }
    if (total === 0) console.log(`\n  (none anywhere in the corpus — the filings do not speak to this field)`);
    console.log(`\n  TOTAL: ${total} sentence(s) across the corpus`);
  }
})();
