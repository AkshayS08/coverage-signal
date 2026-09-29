/**
 * IS THERE A SENTENCE STATING THE AMOUNT? $0 — cached answers and cached
 * filing text.
 *
 * Rule 58 says a row's evidence is the sentence that states the row's own
 * amount. Eight rows in the book fail it: Cigna's four 8-K tranches cite an
 * interest-rate sentence that gives the rate and the maturity and never the
 * principal, and HCA's four table rows cite a row label plus a rate
 * parenthetical with no figure at all.
 *
 * BEFORE WRITING A RE-SELECTOR, ASK WHETHER THERE IS ANYTHING TO SELECT. If
 * the cited document contains no sentence stating the amount, re-selection
 * cannot fix these rows and the honest outcome is a stated withholding, not a
 * better search. That is the difference between a fix and a hope.
 *
 * For each failing row this prints every candidate in its own cited document
 * that states the row's amount, so the selection rule can be written against
 * what is actually there.
 *
 * Run: npx tsx lib/cache/s24evidence.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, amountSupportOf, parseMoneyAmount } from "../events/position";
import { getFilingText } from "../fetch";
import { currentCompanySpend } from "../agent/costMeter";

const NAMES = ["Cigna Group", "HCA Healthcare", "Quest Diagnostics"];

/**
 * Sentence-ish segmentation. SEC text is a mix of prose and flattened table
 * rows, so a "sentence" here is a run bounded by terminal punctuation OR by a
 * long whitespace gap — which is what separates table cells once the markup is
 * stripped. Deliberately generous: this is a diagnostic asking what EXISTS,
 * and a narrow splitter would answer a question about the splitter.
 */
function segments(text: string): string[] {
  return text
    .split(/(?<=[.;:])\s+|\n+|\s{4,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12 && s.length < 600);
}

/** Does this segment state this amount — same question amountSupportOf asks. */
const states = (amount: string, seg: string) => amountSupportOf(amount, seg).kind !== "unsupported";

(async () => {
  let spend = 0;
  let unsupported = 0, recoverable = 0, hopeless = 0;

  for (const company of NAMES) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);

    console.log(`\n${"=".repeat(104)}`);
    console.log(`${company}`);
    console.log("=".repeat(104));

    const bad = pos.rows.filter((x) => amountSupportOf(x.amount, x.sourceLine).kind === "unsupported");
    console.log(`\n  ${pos.rows.length} ladder rows, ${bad.length} whose evidence does NOT state the amount`);
    if (bad.length === 0) continue;

    const textCache = new Map<string, string>();
    for (const row of bad) {
      unsupported++;
      console.log(`\n  ── ${row.instrument}  ${row.amount}`);
      console.log(`     cites   ${row.citedUrl.split("/").pop()}`);
      console.log(`     now     "${String(row.sourceLine).replace(/\s+/g, " ").slice(0, 130)}"`);
      if (!row.citedUrl) { hopeless++; console.log(`     NO CITED DOCUMENT — nothing to search`); continue; }
      if (!textCache.has(row.citedUrl)) {
        try { textCache.set(row.citedUrl, (await getFilingText(row.citedUrl)).text); }
        catch { textCache.set(row.citedUrl, ""); }
      }
      const text = textCache.get(row.citedUrl) ?? "";
      if (!text) { hopeless++; console.log(`     document text unreadable — INCONCLUSIVE, not a "no"`); continue; }

      const cands = segments(text).filter((s) => states(row.amount, s));
      // Rank: prefer a candidate that also names the instrument, then the shortest.
      const instrumentWords = row.instrument.toLowerCase().match(/[a-z0-9.%]+/g) ?? [];
      const scored = cands
        .map((s) => {
          const low = s.toLowerCase();
          const hits = instrumentWords.filter((w) => w.length > 2 && low.includes(w)).length;
          return { s, hits };
        })
        .sort((a, b) => b.hits - a.hits || a.s.length - b.s.length);

      if (scored.length === 0) {
        hopeless++;
        console.log(`     NO SEGMENT in this document states ${row.amount} — re-selection cannot fix this row.`);
        console.log(`     Parsed value: ${parseMoneyAmount(row.amount)}`);
      } else {
        recoverable++;
        console.log(`     ${scored.length} candidate(s) state this amount. Best ${Math.min(3, scored.length)}:`);
        for (const c of scored.slice(0, 3)) {
          console.log(`         [names ${c.hits} instrument word(s)] "${c.s.slice(0, 150)}"`);
        }
      }
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  rows failing Rule 58: ${unsupported}   recoverable by re-selection: ${recoverable}   no candidate exists: ${hopeless}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
  console.log("=".repeat(104));
})();
