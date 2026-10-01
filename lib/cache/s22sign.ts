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
  // REWRITTEN AT v31. The v30 text said the 10-K "is no longer in the cited
  // set". It is back. A re-baseline reason is a statement about the corpus
  // the new signature pins, not a paragraph inherited from the last one, and
  // carrying that sentence forward would have put a false claim inside a
  // signature — the one artifact in this build whose whole value is that it
  // does not do that.
  "Molina Healthcare":
    "Re-baselined at v31 in Session 23. (1) THE CORPUS MOVED, AND MOVED BACK — the cited set is 3 documents, " +
    "up from the 2 the v30 signature pinned: the 10-K (moh-20251231.htm) is cited again. The v30 re-baseline was " +
    "written when it had dropped out and said so; that sentence is NOT carried forward, because it is no longer " +
    "true. (2) THE EXTRACTION MOVED, in one direction only — the revolver now carries its stated size, " +
    "$1.25 billion, where v30 recorded no amount for it, so it renders as $1,250M of committed capacity rather " +
    "than an unsized line; and it is named \"revolving credit facility\" where v30 printed \"Credit Facility\", " +
    "which is the second of the filing's own two names for one instrument and is why row identity does not rest " +
    "on the label. (3) WHAT THE v30 RE-BASELINE ESTABLISHED IS UNCHANGED AND STILL CORRECT: `drawn` is $0, " +
    "stated by the anchor (\"As of June 30, 2026, no amount was outstanding under the Credit Agreement\") and " +
    "recovered by Rule 53's copula class; `lettersOfCredit` is null, because the v29 value of $100 million was " +
    "the letter-of-credit SUB-FACILITY's limit and not letters of credit outstanding (Rule 48's category error), " +
    "and the filing states no LC balance. Six rows, coverage unchanged, every facility figure identical across " +
    "all three v31 runs.",

  // Tenet's corpus move is the largest in the book and is stated as the first
  // fact, because a reader comparing this file to the v29 one is comparing
  // two different document sets before they are comparing two readings.
  "Tenet Healthcare":
    "Re-baselined at v31 in Session 23. (1) THE CORPUS MOVED HARD — the cited set is 2 documents against the 6 " +
    "the v29 signature pinned. Five of those six are no longer cited (thc-20240805.htm, thc-20251231.htm, " +
    "thc-20260331.htm, thc-20260908.htm, d845102d8k.htm) and one 8-K is new (d104323d8k.htm). Rule 30: a pin " +
    "against a corpus that is not the current one is re-signed, never compared across. (2) THE EXTRACTION MOVED " +
    "IN ONE PLACE, AND IT IS THE FIX THAT WAS ASKED FOR — the senior secured revolving credit facility reads " +
    "$1.900 billion, as the filing prints it, where v29 printed $1,900 million. That is v31's unit rule (copy the " +
    "printed unit, never convert) doing exactly its named job; the money is unchanged and the transcription is " +
    "now the filing's own. (2b) AND THE SCALE WORD IS OURS, CANONICALLY — the twelve table rows whose cells carry " +
    "no unit of their own take one from the filing's governing declaration, and that word is now the tool's " +
    "singular (\"$ 1,500 million\") rather than the caption's inflection, which had been copied verbatim and " +
    "rendered \"$ 1,500    millions\" across this whole ladder. The filing states a SCALE; it does not state how " +
    "that scale is spelled beside one number, so there was nothing there to be faithful to. Values and units " +
    "unchanged. (3) PROVENANCE WIDENED, NOT CHANGED — seven schedule sourceLines now carry both " +
    "period columns (\"6.750 % due 2031 $ 1,350 $ 1,350\") where v29 carried one. Every line still states its own " +
    "row's amount; Rule 58 is clean across all twelve rows. (4) NOTHING ELSE MOVED: twelve rows, identical on " +
    "value, unit, maturity, granularity, provenance and capacity flag; coverage unchanged; one card, as before. " +
    "Facility figures identical across all three v31 runs.",

  "DaVita":
    "Re-baselined at v31 in Session 24, and the position it pins is the one v29 pinned: nine rows, same instruments, " +
    "same amounts, same maturities and classes. WHAT MOVED WAS OUR ABILITY TO SEE THAT. This name failed criterion 9b " +
    "three times, and every failure was in this codebase rather than in the extraction. (1) The ladder returned 9, 17 " +
    "and 9 rows across three runs whose every row-bearing field was IDENTICAL — same instruments, values, counts and " +
    "period columns. The only difference was a date written \"11/24/2030\" instead of \"2030-11-24\", which made " +
    "`debtRowDateToken` return null, which `rowsRepresentSameTranche` reported as \"not the same tranche\", which " +
    "re-added seven prior entries beside their own live twins (Rule 61). An earlier diagnosis of mine blamed an " +
    "off-anchor 10-K citation; that was wrong and is recorded as wrong — the citation was on `international-expansion` " +
    "and never touched the ladder. (2) The same spelling then broke ROW IDENTITY, a second and independent path to the " +
    "same question, reporting seven instruments as seven MISSING plus seven UNEXPECTED. (3) The answer's IDENTITY " +
    "moved when that unrelated citation entered the fifteen-trigger filing set (Rule 65). " +
    "Two extraction-side changes also land here and both are corrections rather than re-readings: five facility " +
    "figures that alternated between \"$ 188,482 thousand\" and \"$ 188,482\" across runs — the bare form being " +
    "dropped as indeterminate — now take their scale from the filing's own \"dollars and shares in thousands\" " +
    "declaration in code; and maturity dates render canonically, while the extracted entry keeps what the filing " +
    "printed. Nine rows, coverage unchanged, every facility figure identical across all three v31 runs.",

  "Community Health Systems":
    "Re-baselined at v31 in Session 24. Twelve rows, as v29 pinned, and the two changes are both ones a reader sees. " +
    "(1) THE ABL IS UNDRAWN CAPACITY, NOT A REPAID TRANCHE. C1 turned any zero-balance row into `repaid`, which is " +
    "right for a term tranche reported at nil and is the opposite of the truth for a revolver: nothing is owed AND the " +
    "whole $1.0 billion commitment stands. CHS was the only name in ten this fired on, and the other eight revolvers " +
    "in the book — Tenet $1,900M, Cigna $6,500M, Quest $750M and $600M, Molina $1,250M — already rendered as capacity, " +
    "which is what made it a rule rather than a patch (Rule 60). The row now shows the committed size and states that " +
    "nothing is drawn against it. (2) THE ABL APPEARED TWICE. The model reports it in the debt note's schedule and, on " +
    "some runs, again as a prose instrument stating the same facility, the same $1.0 billion and the same 2029-06-05. " +
    "The canonical run carried no prose entry and gave 12 rows; four other extractions carried one and gave 13. That " +
    "was diagnosed as citation drift for most of a day and was a duplicate (Rule 49 on the ladder). It took three " +
    "wrong diagnoses to find, all three recorded. " +
    "The remaining \"drift\" was the third defect: an `asset-sale` citation entering the fifteen-trigger filing set " +
    "made the whole answer read as incomparable, about a corpus that never moved (Rule 65). " +
    "The borrowing-base catch is unchanged and still on the facility line, with the filer's own qualifying language " +
    "and the implied-base arithmetic beside it. " +
    "ONE CHANGE IS A LOSS AND IS SIGNED KNOWINGLY: the 9 3/4% Senior Secured Notes due 2034 carry a maturity of " +
    "\"2034\" where v29 carried \"2034-09-15\". The year is right and the day is gone — a bare-year maturity is " +
    "handled correctly everywhere downstream (it sorts to year-end for ordering, never renders as a real date, and " +
    "cannot card on a day it does not have), so this is a loss of PRECISION rather than a wrong number. It is " +
    "recorded here rather than noticed later, because a signature that lists only improvements is not a record.",

  // Encompass is the unusual case and the reason is written to say so: the
  // READING did not move at all. Re-baselined because the version and the
  // corpus moved, and for no other reason.
  "Encompass Health":
    "Re-baselined at v31 in Session 23, and the notable fact is what did NOT change. (1) THE READING DID NOT MOVE " +
    "— not one row field differs from the v29 signature. Seven rows, identical instruments, amounts, maturities, " +
    "granularities, provenance and capacity flags; coverage unchanged; one card. The v30 extraction had carried " +
    "six rows; v31 carries seven, which is what v29 read, and the seventh (5.875 % Senior Notes due 2034, " +
    "$491.0 million, 2034-06-01) is cited byte-identically to the anchor 10-Q (ehc-20260630.htm) with the prior " +
    "period column printing an em-dash — a note that did not exist at the prior date, not an off-anchor pull. " +
    "(2) THE CORPUS MOVED — the 10-K (ehc-20251231.htm) is no longer in the cited set, 4 documents down to 3, " +
    "which is on its own sufficient reason to re-sign rather than compare (Rule 30). (3) THE LETTER-OF-CREDIT " +
    "WATCH CLOSES ON EVIDENCE — a $53.6 million LC figure was claimed and REJECTED by the per-figure guard, " +
    "because the sentence offered for it states \"$ 200.0 million was drawn under the revolving credit facility\" " +
    "and not $53.6 million. The anchor states no LC balance for Encompass, so null is the honest answer and the " +
    "Session 23 refresh-roster watch on this field is struck on the filings rather than on a preference. " +
    "Facility figures identical across all three v31 runs.",
};

/**
 * WHAT THIS PARTICULAR SIGNATURE HAS TO SAY FOR ITSELF, beyond the standard
 * basis. A first signature has no re-baseline reason, and some of them still
 * carry a fact the next reader needs — which corpus is pinned, and how the
 * evidence was obtained.
 */
const SIGNING_NOTE: Record<string, string> = {
  "Cigna Group":
    "CORPUS PINNED: f1237506 — the September 2025 pricing 8-K and the June 2026 10-Q. " +
    "THE THREE 9b SAMPLES ARE FRESH v31 EXTRACTIONS ON THAT CORPUS, NOT RE-RENDERS OF THE CACHED SAMPLES, " +
    "and they were bought by an UNAUTHORISED $0.5714 (Rule 75): the filing-list cache passed its 24-hour TTL " +
    "mid-session, EDGAR returned a changed catalog, the fingerprint moved 813c7d6b → f1237506, and three " +
    "re-renders that had been free an hour earlier re-extracted live under an instruction that said no spend. " +
    "What it bought is what 9b asks for — three independent asks at one version against one corpus — and it is " +
    "recorded here as what it is rather than presented as the measurement that was authorised. " +
    "THIS IS THE FIRST SIGNATURE OVER A ROLLED POSITION. Coverage is not computed on rows the anchor states: " +
    "the anchor's debt note yields no ladder and directs the reader, in its own verified words, to Note 7 of the " +
    "2025 10-K. That note's 36 transcribed rows are the labelled prior-period base, rolled forward to the anchor " +
    "date through movements derived from the filings. The signature pins the WORK and not only the result — " +
    "`state.rolled` carries all 36 base rows with their sentences, both printed subtotals against the rows that " +
    "precede them, every counted delta with the sentence and document stating it, and the roll tie — so a later " +
    "change that dropped a row and gained an equal delta would still fail, though every coverage figure matched. " +
    "THE LOAD-BEARING ASSUMPTION, STATED: commercial paper outstanding at the base date is ZERO, sourced to the " +
    "10-K twice (the MD&A sentence and the note table's em-dash). The CP delta is therefore the whole closing " +
    "balance rather than an increment, so if that base is not zero the roll is wrong by exactly the amount it is " +
    "not. AND THE HEDGE SURVIVES: the anchor states the $1.0 billion twice, once qualified and once not; the " +
    "qualified sentence is the evidence, because asserting a precision the filer did not consistently claim would " +
    "be worse — and because it is also the reading under which the roll ties. The contrary reading gives no band " +
    "and a 35 miss, and is available to anyone who wants it.",
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
          `${SIGNING_NOTE[company] ? `${SIGNING_NOTE[company]} ` : ""}` +
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
