/**
 * WHAT ELSE DOES THE COPULA WIDENING TOUCH? $0, cached reads only.
 *
 * Rule 53's `drawn` matcher now admits a copula between the noun and
 * "outstanding". The widening is exactly one alternative, so its blast radius
 * is exactly the set of sentences where THAT alternative matches and none of
 * the pre-existing ones do. Anything else in the book was already matching
 * and cannot have moved.
 *
 * So this does not guess and does not re-render: it walks every figure in
 * every cached answer in the book, scores each sentence under the OLD matcher
 * and the NEW one, and prints every sentence where they disagree — plus, for
 * each, whether the disagreement actually changes a verdict.
 *
 * A widening whose delta set is one sentence has a blast radius of one
 * sentence, and that is a measurement rather than an argument.
 *
 * Run: npx tsx lib/cache/s23copulascan.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { zeroSupportFor, isZeroValue } from "../agent/statedZero";

/** The matcher as it stood before the widening — kept verbatim so the delta is real. */
const DRAWN_BEFORE = /borrow|drawn|draw(?:n|ings)?\b|advance|outstanding\s+(?:balance|principal|amount)|amounts?\s+outstanding|cash\s+borrowings/i;
/** The clause form the widening admits, and only that. */
const DRAWN_ADDED = /amounts?\s+(?:was|were|is|are|remains?|remained|be|been)\s+outstanding/i;

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

interface Fig { value: string; sourceLine: string }

(async () => {
  let scanned = 0, delta = 0, changed = 0;
  console.log(`\n${"=".repeat(100)}`);
  console.log(`COPULA WIDENING — every figure in every cached answer, scored under both matchers`);
  console.log("=".repeat(100));

  for (const company of ALL) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const meta = await head(baseAnswerKey(f.cik, corpusFingerprint(f.filings)), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
    const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];

    const hits: string[] = [];
    for (const fac of facs) {
      for (const field of FIELDS) {
        const fig = fac[field] as Fig | null;
        if (!fig?.sourceLine) continue;
        scanned++;
        // The delta set: the new alternative fires where nothing old did.
        if (!DRAWN_ADDED.test(fig.sourceLine)) continue;
        if (DRAWN_BEFORE.test(fig.sourceLine)) continue; // already matched — cannot have moved
        delta++;
        const zero = isZeroValue(fig.value);
        const verdict = zeroSupportFor(fig.sourceLine, "drawn");
        const moves = zero && verdict.kind === "asserts-absence";
        if (moves) changed++;
        hits.push(
          `    ${String(fac.name).slice(0, 40).padEnd(42)} ${field.padEnd(16)} ${fig.value}\n` +
          `      "${fig.sourceLine.replace(/\s+/g, " ").slice(0, 150)}"\n` +
          `      zero? ${zero ? "yes" : "no"}   drawn verdict now: ${verdict.kind}   ` +
          `${moves ? "→ A RENDERED VALUE MOVES" : "→ nothing moves (a non-zero figure is never routed through this rule)"}`
        );
      }
    }
    console.log(`\n  ${company.padEnd(30)} ${facs.length} facility(ies)   ${hits.length} sentence(s) in the delta set`);
    for (const h of hits) console.log(h);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`  ${scanned} figures scanned across the book`);
  console.log(`  ${delta} sentence(s) the widening reaches at all`);
  console.log(`  ${changed} rendered value(s) move`);
  console.log("=".repeat(100));
})();
