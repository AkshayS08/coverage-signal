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
import { assertFree } from "./freeRun";

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
    "Re-baselined in Session 26: date display clamped to cited-sentence precision; the prior v29 2034-09-15 for the " +
    "CHS 9¾% notes was an interest date read as a maturity. (1) SIX MATURITIES MOVE FROM DAY TO YEAR — the 6%, 5¼%, " +
    "4¾%, 10⅞% and 10¾% senior secured notes and the 6⅞% senior notes. Each row cites its line in the anchor's debt " +
    "table (\"6 % Senior Secured Notes due 2029 644\"), which prints the year only; the days had come from the 10-K. " +
    "A date may not be finer than the sentence it links to (Rules 76, 77), and pulling a day from a prior 10-K is a " +
    "separate question under Rule 66, logged as a post-demo candidate. (2) THE 9¾% NOTES STAY AT 2034, which is what " +
    "the anchor states. The Session 24 signature called this \"a loss of precision\"; read against the filings it is a " +
    "correction — no filing states 2034-09-15 as a maturity, September 15 is an interest payment date, and the filed " +
    "day (January 15, 2034) is only in the pre-anchor 2025-08-12 8-K. (3) THE ABL's MATURITY now cites its own " +
    "sentence (\"…will be due and payable in full on June 5, 2029\"), not the size sentence (Rule 78); the date is " +
    "unchanged. (4) NOTHING ELSE MOVED: twelve rows, the same amounts, statuses, provenance and capacity flags; " +
    "coverage unchanged; the ABL still undrawn capacity with the borrowing-base sentence on its facility line.",

  // Encompass is the unusual case and the reason is written to say so: the
  // READING did not move at all. Re-baselined because the version and the
  // corpus moved, and for no other reason.
  "Encompass Health":
    "Re-baselined in Session 26: date display clamped to cited-sentence precision; the prior v29 2034-09-15 for the " +
    "CHS 9¾% notes was an interest date read as a maturity. (1) FOUR MATURITIES MOVE FROM DAY TO YEAR — the 4.50% " +
    "notes due 2028, 4.75% due 2030, 4.625% due 2031 and 5.875% due 2034. Each row cites its line in the anchor's " +
    "debt table (\"4.50 % Senior Notes due 2028 396.9 792.0\"), which prints the year only. The first three days " +
    "are stated in the 10-K (\"The 2028 Notes mature on February 1, 2028…\"); the 5.875% notes' June 1, 2034 is " +
    "printed elsewhere in the anchor, not in the row's own line. A date may not be finer than the sentence it links " +
    "to (Rules 76, 77); taking a day from another sentence or filing is the post-demo candidate logged with Rule 66. " +
    "(2) THE REVOLVER'S MATURITY now cites its own sentence (\"the maturity date is March 9, 2031, rather than " +
    "October 7, 2027\"), not the amount line (Rule 78); the date is unchanged. (3) ONE CHANGE IS A LOSS AND IS " +
    "SIGNED KNOWINGLY: THE REFI CARD IS GONE. The Session 23 state carded the 4.50% notes on 2028-02-01, inside the " +
    "18-month window. At year precision the row cannot card — a bare year never does, because there is no day to " +
    "be inside a window (BRD 6.2) — so the state carries no card. The notes, their amount and their year are " +
    "unchanged on the ladder. The day exists in the 10-K, and whether a card may rest on it is the Rule 66 " +
    "candidate, not something this signature decides. (4) NOTHING ELSE MOVED: seven rows, " +
    "the same amounts, statuses, provenance and capacity flags; coverage unchanged; the letter-of-credit figure " +
    "still null, because the anchor states no LC balance and the $53.6 million once claimed was rejected against " +
    "its own sentence.",

  "Cigna Group":
    "Re-baselined in Session 26: date display clamped to cited-sentence precision; the prior v29 2034-09-15 for the " +
    "CHS 9¾% notes was an interest date read as a maturity. (1) THE REVOLVER'S MATURITY MOVES FROM DAY TO MONTH. Its " +
    "sentence says the agreement \"will mature in April 2030\"; the row had shown 2030-04-01 at day precision, the " +
    "day supplied by the model's prose entry and approved by a check that let a coarser sentence support a finer " +
    "date (Rules 76, 77). It now shows April 2030. (2) THE FOUR SEPTEMBER 2025 NOTES KEEP THEIR DAYS, NOW CORRECTLY " +
    "SOURCED. Each maturity cites the 8-K sentence that states it (\"…until the maturity date of September 15, " +
    "2030\"), which Rule 58's amount re-selection had been discarding; the amount still cites the sentence stating " +
    "the amount (Rule 78). (3) NOTHING ELSE MOVED: six rows, the same amounts, statuses and capacity flags; the roll " +
    "pinned in `state.rolled` identical — 36 base rows, both subtotal ties, the counted deltas and the roll tie. " +
    "(4) RECORDED, NOT NEW: re-read at $0 under this loop, the two 9b samples agree with the canonical run on every " +
    "ladder row, every date, coverage and the roll, and differ in the rolled base's label spelling (\"$900 million, " +
    "3.250%\" against \"$ 900 million, 3.250 %\", 33 base rows and one delta label). The pre-change code at 17a54de " +
    "gives the identical difference, so it is a property of the three transcriptions and not of this change; the " +
    "Session 25 gate compared the roll's arithmetic, which agrees, and not label strings.",
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
  // RULE 75 — a signature is written from cached answers. If any name's
  // corpus has moved, this is a new extraction and is not signed here.
  await assertFree(SIGNED.map((company) => ({ company })));
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
