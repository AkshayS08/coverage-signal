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
import { deriveGoldenState, filingSetOf, residualPercentOf, unsupportedAmountRows, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { evidenceFor, RUNS_REQUIRED } from "./reproductionEvidence";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const SIGNER = "Akshay Sahani";

/**
 * WHY A GOLDEN IS BEING REPLACED, in the file that replaces it. A re-baseline
 * that does not say what moved leaves the next reader comparing two signed
 * states with no account of the distance between them.
 */
const REBASELINE_REASON: Record<string, string> = {
  "Molina Healthcare":
    "Re-baselined in Session 23 for two reasons, neither a correction of the previous reading. " +
    "(1) THE CORPUS MOVED — the 10-K (moh-20251231.htm) is no longer in the cited set, so the v29 pin " +
    "describes a corpus that is not the current one and cannot be compared against it (Rule 30). " +
    "(2) THE EXTRACTION MOVED — `drawn` is now $0, stated by the anchor (\"As of June 30, 2026, no amount " +
    "was outstanding under the Credit Agreement\") and recovered by Rule 53 once its noun matcher admitted " +
    "the copula; and `lettersOfCredit` is now null, correctly: the v29 value of $100 million was the letter " +
    "of credit SUB-FACILITY's limit, not letters of credit outstanding, which is Rule 48's category error. " +
    "The filing states no LC balance for Molina, so null is the honest answer. Ruled by the signer on " +
    "2026-09-21 against the sentences themselves. Five ladder sourceLines also collapsed from two period " +
    "columns to one — cosmetic provenance, amounts and dates unchanged.",
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
    // 9b's EVIDENCE, LOOKED UP AT THE VERSION BEING SIGNED. The lookup was
    // keyed by company alone, so Molina's "CACHE_BUST x3 at v29" satisfied a
    // v30 signature silently. Version is now part of the key and a mismatch
    // is a refusal that says which versions DO have evidence.
    const lookup = evidenceFor(company, EXTRACTION_PROMPT_VERSION);
    const reproduced = lookup.kind === "usable" ? lookup.evidence.evidence : null;
    const toleratedDifferences = lookup.kind === "usable" ? lookup.evidence.toleratedDifferences : [];

    const problems: string[] = [];
    if (filings.length === 0) problems.push("EMPTY FILING SET — a pin against no documents cannot fail, so it is not a pin (Rule 44)");
    if (!reproduced) problems.push(`criterion 9b: ${(lookup as { reason: string }).reason}`);
    // RULE 58 — A SIGNATURE DOES NOT PIN A NUMBER NOBODY CAN CHECK.
    //
    // A row whose amount no shown sentence states is unverifiable against the
    // page it renders on. This is a property of THIS state, not a comparison,
    // which is why it refuses here rather than diverging in compareToGolden.
    // It is what holds HCA: all four of its rows cite a table row label plus
    // an interest-rate parenthetical and no figure at all.
    const unsupported = unsupportedAmountRows(state);
    for (const u of unsupported) problems.push(`Rule 58 — ${u}`);
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
          // A RE-BASELINE IS NOT A FIRST SIGNATURE, AND THE FILE MUST NOT SAY
          // IT IS. This read "First signature, Session 22 Stage 7" no matter
          // what it was writing — so replacing a golden stamped the new file
          // with the previous signature's own story. `isNew` already knew.
          `${isNew ? `First signature, at` : `RE-BASELINE (replaces an earlier signature), at`} PINNED_AS_OF ${PINNED_AS_OF_DAY}, extraction v${EXTRACTION_PROMPT_VERSION}. ` +
          `${isNew ? "" : `${REBASELINE_REASON[company] ?? "Reason not recorded — a re-baseline states what moved or it is not a re-baseline."} `}` +
          `Ladder amounts, subtotals and totals hand-verified against the filings; no wrong number found. ` +
          `Every displayed figure checked against the sentence shown beside it, not merely present somewhere in the corpus ` +
          `(Rule 46) — belonging clean, 0 composites. ` +
          `Facility maturities verified against their own sentences; where the instrument's own cited sentence does not ` +
          `state the date, it is taken from the facility's own maturity sentence and labelled when that sits outside the anchor. ` +
          `${reproduced}` +
          // THE TOLERATED SET, IN THE SIGNATURE. Non-negotiable per the
          // signer's ruling: a golden over a name the filing prints two ways
          // must say which the reader will see. An empty list is stated too,
          // because "nothing was tolerated" is a claim worth making.
          (toleratedDifferences.length > 0
            ? ` TOLERATED BY THE 9b GATE, RECORDED RATHER THAN DROPPED (${toleratedDifferences.length}): ` +
              toleratedDifferences.map((t, i) => `(${i + 1}) ${t}`).join(" ")
            : ` NOTHING WAS TOLERATED BY THE 9b GATE — the three runs agreed on every compared field, labels included.`),
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
