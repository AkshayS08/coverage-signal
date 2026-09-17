/**
 * SESSION 22, STAGE 3 (finish) — DID THE COMMA NORMALIZATION MOVE ANY ROW? $0.
 *
 * CLASS_PATTERNS gained `senior[,\s]+secured` / `senior[,\s]+unsecured` so
 * Encompass's "senior, unsecured obligations" reads as the class it states.
 * That pattern is consulted for section headings and instrument names too, so
 * it could in principle re-class a row — and "it probably doesn't" is not a
 * measurement. This asks the only question that settles it: does any string
 * the classifier reads, anywhere in the book, contain that phrase WITH the
 * comma? If none does, the change is inert everywhere except the sentence it
 * was made for.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/** The comma form only — the space form is what the pattern always matched. */
const COMMA_FORM = /\bsenior\s*,\s*(?:un)?secured\b/i;

(async () => {
  let checked = 0;
  const hits: string[] = [];
  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const pos = assemblePosition(result, PINNED_AS_OF);
    for (const r of pos.rows) {
      for (const s of [r.instrument, r.seniority ?? ""]) {
        checked++;
        if (COMMA_FORM.test(s)) hits.push(`${company}: "${s}"`);
      }
    }
  }
  console.log(`\nSTRINGS CHECKED: ${checked} (every row's name and section heading, all ten companies)`);
  console.log(`COMMA-FORM MATCHES OUTSIDE A SENIORITY SENTENCE: ${hits.length}`);
  for (const h of hits) console.log(`  ${h}`);
  console.log(
    hits.length === 0
      ? "\n=> INERT. No row's name or heading uses the comma form, so the pattern change cannot re-class any row; it reaches only the prose sentence it was made for."
      : "\n=> NOT INERT — the rows above are affected and each must be checked by hand."
  );
})();
