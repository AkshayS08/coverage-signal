/**
 * Regression test for the table-aware verification engine (verifyQuote.ts
 * + factTokens.ts). No Anthropic API calls — pure EDGAR fetch + local
 * matching logic, safe to run repeatedly at zero API cost.
 *
 * The case this guards against: DaVita's real debt schedule shows Term
 * Loan A-2 ($1,987,500 thousand) maturing 11/24/2030 and Term Loan B-2
 * ($1,863,864 thousand) maturing 5/9/2031 (see lib/fetch/filingText.ts's
 * ix:header fix) — no maturity anywhere in the real schedule falls near
 * Dec 2026. A hallucinated claim of "$1.75B due Dec 31, 2026" must NEVER
 * verify, no matter how permissive the table-row co-occurrence matching
 * gets — those tokens do not co-occur anywhere in the real filing, because
 * that date does not exist in it.
 *
 * Run: npx tsx lib/agent/verifyQuote.regression.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getRecentFilings, readFiling } from "./tools";
import { selectBaselineFilings } from "./selectFilings";
import { verifyTriggerQuote } from "./verifyQuote";
import { buildVerifiedFactBase } from "../events/factBase";
import type { CompanyResult } from "./loop";

async function main() {
  console.log("=== Fetching DaVita's real filings (no Anthropic calls) ===");
  const filingsResult = await getRecentFilings("DaVita", ["8-K", "10-Q", "10-K"]);
  const baseline = selectBaselineFilings(filingsResult.filings);
  const textByUrl = new Map<string, string>();
  for (const filing of baseline) {
    const { text } = await readFiling(filing.primaryDocUrl);
    textByUrl.set(filing.primaryDocUrl, text);
  }
  const citedUrls = baseline.map((f) => f.primaryDocUrl);

  let failures = 0;

  // --- Negative control: the fabricated claim must fail. ---
  const fabricated = "Term Loan A-2 and Term Loan B-2, $1.75 billion, due December 31, 2026";
  const fabricatedResult = verifyTriggerQuote({ fired: true, quote: fabricated, citedUrls, textByUrl });
  console.log(`\nFabricated claim: "${fabricated}"`);
  console.log(`  verified: ${fabricatedResult.verified} (expected: false)`);
  if (fabricatedResult.verified) {
    console.error("  ✗ REGRESSION: a fabricated fact verified! displayText:", fabricatedResult.displayText);
    failures++;
  } else {
    console.log("  ✓ PASS — fabricated fact correctly rejected");
  }

  // Also probe the exact figure from the original bug report as its own case.
  const fabricated2 = "$1.75B due Dec 31, 2026";
  const fabricatedResult2 = verifyTriggerQuote({ fired: true, quote: fabricated2, citedUrls, textByUrl });
  console.log(`\nFabricated claim: "${fabricated2}"`);
  console.log(`  verified: ${fabricatedResult2.verified} (expected: false)`);
  if (fabricatedResult2.verified) {
    console.error("  ✗ REGRESSION: a fabricated fact verified! displayText:", fabricatedResult2.displayText);
    failures++;
  } else {
    console.log("  ✓ PASS — fabricated fact correctly rejected");
  }

  // --- Positive control: a genuine table-row fact must verify (proves the test isn't trivially passing because nothing ever verifies). Real figures confirmed against DaVita's actual debt schedule: "Term Loan A-2 (2) $ 1,987,500 $ 2,000,000 11/24/2030 SOFR + 1.50%". ---
  const genuine = "Term Loan A-2, $1.9875 billion, 11/24/2030";
  const genuineResult = verifyTriggerQuote({ fired: true, quote: genuine, citedUrls, textByUrl });
  console.log(`\nGenuine claim: "${genuine}"`);
  console.log(`  verified: ${genuineResult.verified} (expected: true)`);
  console.log(`  displayText (raw):        ${genuineResult.displayText}`);
  console.log(`  normalizedText (scaled):  ${genuineResult.normalizedText}`);
  if (!genuineResult.verified) {
    console.error("  ✗ REGRESSION: a genuine, real table fact FAILED to verify — the positive control is broken.");
    failures++;
  } else {
    console.log("  ✓ PASS — genuine table fact correctly verified");
  }
  // The raw table cell is a bare "1,987,500" (or similar) with no unit of
  // its own — normalizedText should have resolved it to a real dollar
  // figure via the filing's own scale declaration, not left it bare.
  if (genuineResult.normalizedText && /\b\d{1,3}(,\d{3})+\b/.test(genuineResult.normalizedText) && !/\$/.test(genuineResult.normalizedText)) {
    console.error("  ✗ REGRESSION: normalizedText still contains a bare unscaled number — scale normalization did not apply.");
    failures++;
  } else if (genuineResult.normalizedText?.includes("$") && /\b(billion|million|thousand)\b/.test(genuineResult.normalizedText)) {
    console.log("  ✓ PASS — bare table figure correctly scale-normalized to a human dollar figure");
  }
  // Guards a real bug found and fixed this session: extractMoneyCommaGrouped
  // trimmed its matched raw string without shifting `index` to match,
  // desyncing every downstream {index, raw.length} text splice — the
  // symptom was glued/malformed output like "$1.5 billion0" or
  // "2027$1.5 billion" (missing space, stray trailing digit).
  if (genuineResult.normalizedText && /\b(billion|million|thousand)\d/.test(genuineResult.normalizedText)) {
    console.error(`  ✗ REGRESSION: normalizedText has a digit glued directly onto a scale word (index/raw desync): "${genuineResult.normalizedText}"`);
    failures++;
  } else {
    console.log("  ✓ PASS — no glued/malformed tokens in normalizedText (index/raw stayed in sync)");
  }

  // --- Literal-match path also needs normalization: a quote can be a
  // verbatim table-row fragment (matches literally) rather than paraphrased
  // prose (which only matches via co-occurrence) — both paths must
  // normalize bare figures the same way. Real case found this session:
  // Tenet's debt-maturity quote was the table row reproduced verbatim,
  // which matched literally and silently skipped normalization entirely
  // until this path was added. ---
  const literalTableRow = "Term Loan A-2 (2) $ 1,987,500 $ 2,000,000 11/24/2030 SOFR + 1.50% $ 1,982,531";
  const literalResult = verifyTriggerQuote({ fired: true, quote: literalTableRow, citedUrls, textByUrl });
  console.log(`\nLiteral table-row quote: "${literalTableRow}"`);
  console.log(`  verified: ${literalResult.verified} (expected: true)`);
  console.log(`  normalizedText: ${literalResult.normalizedText}`);
  if (!literalResult.verified) {
    console.error("  ✗ REGRESSION: a verbatim table-row quote failed to verify via the literal-match path.");
    failures++;
  } else if (literalResult.normalizedText && /\b\d{1,3}(,\d{3})+\b/.test(literalResult.normalizedText) && !/\$1\.99|\$2\s*billion|\$1\.98/.test(literalResult.normalizedText)) {
    console.error("  ✗ REGRESSION: literal-match path did not scale-normalize its bare table figures.");
    failures++;
  } else {
    console.log("  ✓ PASS — literal-match path also scale-normalizes bare table figures");
  }

  // --- Doubled-"$" guard: EDGAR's HTML-to-text conversion sometimes puts a
  // "$" table cell on its own line, separated from its number by a
  // newline + padding (e.g. "$ \n 3,890" — 3 whitespace chars). Real case
  // found this session: HCA's commercial-paper row produced "$ $3.89
  // billion" (the source's own "$" left unconsumed, then a second "$"
  // prefixed by scale-normalization). Pure synthetic text, no network call. ---
  const dollarGapText =
    "Statements of Cash Flows (Unaudited) (In thousands) Commercial paper (average life of 38 days) $ \n 3,890 $ \n 2,207 Long-term debt:";
  const dollarGapQuote = "Commercial paper (average life of 38 days) $ 3,890";
  const dollarGapResult = verifyTriggerQuote({
    fired: true,
    quote: dollarGapQuote,
    citedUrls: ["https://example.com/synthetic"],
    textByUrl: new Map([["https://example.com/synthetic", dollarGapText]]),
  });
  console.log(`\nDollar/number split-by-newline case: "${dollarGapQuote}"`);
  console.log(`  verified: ${dollarGapResult.verified} (expected: true)`);
  console.log(`  normalizedText: ${dollarGapResult.normalizedText}`);
  if (!dollarGapResult.verified) {
    console.error("  ✗ REGRESSION: a quote split from its own \"$\" by a line break failed to verify.");
    failures++;
  } else if (dollarGapResult.normalizedText && /\$\s*\$/.test(dollarGapResult.normalizedText)) {
    console.error(`  ✗ REGRESSION: doubled "$" in normalizedText: "${dollarGapResult.normalizedText}"`);
    failures++;
  } else {
    console.log('  ✓ PASS — no doubled "$" when the source splits it from its number by a line break');
  }

  // --- Fact-base gate (Step 1): the fabricated claim, correctly marked
  // unverified above, must never make it into buildVerifiedFactBase's
  // output — this is the actual gate Sonnet's narrative synthesis reads
  // from, so the assertion needs to be at THAT boundary, not just at
  // verifyTriggerQuote's. ---
  const syntheticCompany: CompanyResult = {
    company: "DAVITA INC.",
    cik: "0000927066",
    ticker: "DVA",
    verdict: "CALL",
    relationshipFlags: [],
    results: [
      {
        triggerId: "debt-maturity",
        triggerName: "Debt maturity approaching",
        fired: true,
        dataAvailable: true,
        evidence: "Fabricated: $1.75B due Dec 31, 2026",
        mappedNeed: "Refinancing",
        needType: "credit",
        confidence: 0.95,
        citations: [],
        quoteVerified: false, // exactly what verifyTriggerQuote correctly produced above
        verifiedQuote: null,
        verifiedQuoteNormalized: null,
        quoteMatchType: null,
        quoteHasFigure: false,
        eventDate: null,
        dateGranularity: null,
        eventStatus: "upcoming",
        proceedsUse: null,
      },
      {
        triggerId: "new-debt-issuance",
        triggerName: "New debt issuance / notes pricing",
        fired: true,
        dataAvailable: true,
        evidence: "Genuine: Term Loan A-2, $1.9875B, 11/24/2030",
        mappedNeed: "Refi or add-on financing",
        needType: "credit",
        confidence: 0.95,
        citations: [{ form: "10-Q", date: "2026-05-05", url: "https://example.com/genuine" }],
        quoteVerified: true,
        verifiedQuote: genuineResult.displayText ?? genuine,
        verifiedQuoteNormalized: genuineResult.normalizedText ?? genuineResult.displayText ?? genuine,
        quoteMatchType: genuineResult.matchType,
        quoteHasFigure: true,
        eventDate: "2030-11-24",
        dateGranularity: "day",
        eventStatus: "completed",
        proceedsUse: "unstated",
      },
    ],
  };
  const factBase = buildVerifiedFactBase(syntheticCompany);
  console.log(`\nFact base built from a company with one fabricated (unverified) + one genuine (verified) trigger:`);
  console.log(`  facts included: ${factBase.map((f) => f.linkedTriggerId).join(", ") || "(none)"}`);
  const fabricatedLeaked = factBase.some((f) => f.linkedTriggerId === "debt-maturity");
  const genuinePresent = factBase.some((f) => f.linkedTriggerId === "new-debt-issuance");
  if (fabricatedLeaked) {
    console.error("  ✗ REGRESSION: the unverified/fabricated trigger leaked into the verified fact base!");
    failures++;
  } else {
    console.log("  ✓ PASS — unverified trigger correctly excluded from the fact base");
  }
  if (!genuinePresent) {
    console.error("  ✗ REGRESSION: the genuine verified trigger is missing from the fact base — the positive control is broken.");
    failures++;
  } else {
    console.log("  ✓ PASS — genuine verified trigger correctly included in the fact base");
  }

  console.log(`\n${failures === 0 ? "ALL REGRESSION CHECKS PASSED" : `${failures} REGRESSION CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
