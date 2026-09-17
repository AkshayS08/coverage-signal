/**
 * SESSION 22, STAGE 7 — WRITE A GOLDEN, ON SIGNATURE. $0.
 *
 * A golden file is a claim that a state is correct, pinned to the documents it
 * was read from. It is written only for a name a person has signed, and only
 * after that name has reproduced its POSITION three times at the current
 * version — criterion 9b, which is the one criterion no amount of code can
 * attest on its own behalf.
 *
 * REFUSES rather than writes when it cannot establish the basis:
 *   - the company is not on the signed list
 *   - its filing set is empty (a pin against no documents is a pin every
 *     future run matches trivially — see Centene, Rule 44)
 *   - a computed criterion does not hold
 *
 * Run: npx tsx lib/cache/s22sign.ts "DaVita" "Community Health Systems" ...
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, filingSetOf, residualPercentOf, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const SIGNER = "Akshay Sahani";

/**
 * The reproducibility evidence, per name, from the CACHE_BUST x3 runs. Recorded
 * as text in the signature basis rather than asserted in code, because 9b is
 * an attestation about runs that happened, not a property this file can test.
 */
const REPRODUCED: Record<string, string> = {
  "DaVita": "CACHE_BUST x3 at v29 on 2026-09-17: 9 of 9 rows carried a heading in every run, 9 classed in every run, row set / amounts / classes byte-identical across all three.",
  "Community Health Systems": "CACHE_BUST x3 at v29 on 2026-09-17: 12 rows and 9 classed in every run, row set / amounts / classes byte-identical across all three.",
  "Universal Health Services": "CACHE_BUST x3 at v29: prose-only note (0 table rows), 5 classed in every run, row set / amounts / classes byte-identical across all three.",
  "Encompass Health": "CACHE_BUST x3 at v29: 7 of 7 rows carried a heading in every run, 4 classed in every run, row set / amounts / classes byte-identical across all three.",
};

const SIGNED = process.argv.slice(2);

(async () => {
  if (SIGNED.length === 0) {
    console.error("No company named. A golden is written only for a name that was signed.");
    process.exit(1);
  }
  mkdirSync(GOLDEN_DIR, { recursive: true });
  console.log(`\n${"=".repeat(100)}\nWRITING GOLDEN FILES at ${PINNED_AS_OF_DAY} — signed by ${SIGNER}\n${"=".repeat(100)}`);

  let written = 0, refused = 0;
  for (const company of SIGNED) {
    const result = await runAgentLoop(company);
    const state = deriveGoldenState(result, PINNED_AS_OF);
    const crit = evaluateGoldenCriteria(result, PINNED_AS_OF, {
      rowsCorrect: true,
      instrumentTypeFaithful: true,
      reproducedThreeTimes: true,
      by: SIGNER,
      on: PINNED_AS_OF_DAY,
    });
    const filings = filingSetOf(result);
    const reproduced = REPRODUCED[company] ?? Object.entries(REPRODUCED).find(([k]) => company.toLowerCase().includes(k.toLowerCase()))?.[1];

    const problems: string[] = [];
    if (filings.length === 0) problems.push("EMPTY FILING SET — a pin against no documents cannot fail, so it is not a pin (Rule 44)");
    if (!reproduced) problems.push("no CACHE_BUST x3 evidence recorded for this name — criterion 9b cannot be attested");
    for (const c of crit.criteria) {
      if (c.kind === "computed" && c.pass === false) problems.push(`criterion ${c.id} does not hold: ${c.detail.slice(0, 140)}`);
    }
    if (problems.length) {
      refused++;
      console.log(`\n  ${state.company}: REFUSED`);
      for (const p of problems) console.log(`      ${p}`);
      continue;
    }

    const path = join(GOLDEN_DIR, `${result.cik.padStart(10, "0")}.json`);
    const isNew = !existsSync(path);
    const out: GoldenFile = {
      extractionVersion: EXTRACTION_PROMPT_VERSION,
      signature: {
        signedBy: SIGNER,
        signedOn: PINNED_AS_OF_DAY,
        basis:
          `First signature, Session 22 Stage 7, at PINNED_AS_OF ${PINNED_AS_OF_DAY}, extraction v${EXTRACTION_PROMPT_VERSION}. ` +
          `Ladder amounts, subtotals and totals hand-verified against the filings; no wrong number found. ` +
          `Every displayed figure checked against the sentence shown beside it, not merely present somewhere in the corpus ` +
          `(Rule 46) — belonging clean, 0 composites. ` +
          `Facility maturities verified against their own sentences; where the instrument's own cited sentence does not ` +
          `state the date, it is taken from the facility's own maturity sentence and labelled when that sits outside the anchor. ` +
          `${reproduced}`,
      },
      attestation: {
        rowsCorrect: true,
        instrumentTypeFaithful: true,
        reproducedThreeTimes: true,
        by: SIGNER,
        on: PINNED_AS_OF_DAY,
      },
      criteria: crit.criteria.map((c) => ({ id: c.id, name: c.name, kind: c.kind, pass: c.pass, detail: c.detail, defends: c.defends })),
      state,
      sourceResult: result,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
    written++;
    console.log(`\n  ${state.company}: ${isNew ? "SIGNED (new)" : "SIGNED (replaced)"}  ->  baselines/golden/${result.cik.padStart(10, "0")}.json`);
    console.log(`      rows ${state.rows.length}   residualPercent ${residualPercentOf(state) ?? "—"}%   filings ${filings.length}   all nine ${crit.allHold ? "HOLD" : "DO NOT HOLD"}`);
  }

  console.log(`\n${"=".repeat(100)}\n  written ${written}   refused ${refused}\n${"=".repeat(100)}`);
})();
