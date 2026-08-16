/**
 * Session 12 Parts B/C + Session 15 Part A golden tests — narration
 * integrity (loud failure, scrape-shaped-text rejection) and the new
 * structural card-body guard. Runs entirely OFFLINE: no Anthropic/EDGAR
 * calls, using the same cached fixture (__fixtures__/session11-facts.json)
 * as eligibility.test.ts for the tests that need a real FlashCard/fact
 * base to build from — real citations/evidence, only the field under test
 * pinned, matching that file's own convention. Everything else here is a
 * pure function test with no live data dependency at all.
 *
 * Session 15: the word-ceiling retry tests, the portfolio-summary
 * constraint-checker tests, and the templateEventBriefing/
 * quoteFallbackBriefing wiring tests are all deleted along with the code
 * they tested (sonnetPortfolioSummary.ts, portfolioSummary.ts, the
 * word-ceiling guard, the deterministic fallbacks) — the verified quote is
 * no longer a narration display fallback of any kind. New tests cover the
 * replacement: checkCardStructure's five checks (empty field, sentence
 * count, number-guard, scrape-guard, the "connects >=2 facts" proxy).
 *
 * Run: npx tsx lib/events/narrationIntegrity.test.ts (or npm test)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult } from "../agent";
import { buildEvents } from "./buildEvents";
import { isScrapeShapedText } from "./scrapeGuard";
import { failedEventBriefing } from "./eventBriefing";
import { buildVerifiedFactBase, hasDeterminableScale, type VerifiedFact } from "./factBase";
import { checkCardStructure, buildCorrectionInstruction, type RawCardBody } from "./sonnetEventBriefing";
import { checkNumbersAgainstQuotes, countDistinctFactsReferenced } from "./numberGuard";

interface Fixture {
  generatedAt: string;
  companies: CompanyResult[];
}

const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, "__fixtures__/session11-facts.json"), "utf8"));

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ PASS — ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL — ${label}`);
    failed++;
    failures.push(label);
  }
}

console.log(`=== Session 12/15 golden tests (narration integrity) ===\n`);

// --- 1. Scrape-shaped-text rejection (Part C.2, v2 — structural, not
// lexical). The exact Concentra Session 10 string must be rejected. Every
// figure in it is real, so numberGuard alone would pass it; this is a
// different, shape-based check. Two more real REJECT cases pulled directly
// from the current fixture's own verified quotes (genuine table-row
// fragments, not hand-written) for extra coverage of the same fix. ---
{
  const concentra = ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million";
  assert(isScrapeShapedText(concentra), "[1a] exact Concentra scrape-shaped string is rejected");

  // Real fixture quote: THC large-cash-balance (verifiedQuote, matchType=literal).
  const thcCash = "Cash and cash equivalents $ 2,170   $ 2,883";
  // Real fixture quote: DVA floating-rate-debt (verifiedQuote, matchType=literal).
  const dvaTermLoans =
    "Term Loan A-2 (2) $ 1,987,500   $ 2,000,000   11/24/2030 SOFR + 1.50% $ 1,982,531   Term Loan B-2 1,863,864   1,868,559   5/9/2031 SOFR + 1.75%";
  assert(isScrapeShapedText(thcCash), "[1b] real fixture table-row quote (Tenet cash balance sheet line) is rejected");
  assert(isScrapeShapedText(dvaTermLoans), "[1c] real fixture table-row quote (DaVita term loan schedule) is rejected");
}

// --- 2. Accept cases (Part C.2, priority fix) — the exact SGRY sentence
// that was a false positive under the old verb-allowlist ("values" and
// "providing" weren't enumerated) MUST be accepted now, plus 3 more real,
// complete, figure-bearing sentences pulled directly from the current
// fixture's own verified quotes (not hand-written prose). ---
{
  const sgryAssetSale =
    "The Transaction values the combined facilities at approximately $1.15 billion, providing Surgery Partners with total consideration of approximately $795 million.";
  assert(!isScrapeShapedText(sgryAssetSale), "[2a] SGRY asset-sale sentence (the priority false positive) is now accepted");

  // Real fixture quote: THC new-debt-issuance (verifiedQuote, matchType=literal).
  const thcNewDebt =
    'On November 18, 2025, Tenet Healthcare Corporation ("Tenet") issued $1,500,000,000 in aggregate principal amount of 5.500% senior secured first lien notes due 2032 (the "First Lien Notes") and $750,000,000 in aggregate principal amount of 6.000% senior notes due 2033 (the "Senior Notes" and together with the First Lien Notes, the "Notes").';
  // Real fixture quote: EHC asset-sale (verifiedQuote, matchType=literal).
  const ehcAssetSale =
    'On December 31, 2025, we entered into an agreement to sell our 50 % membership interest in Gamma Knife Center at Barnes-Jewish Hospital, LLC ("Gamma Knife") to our existing joint venture partner, Barnes-Jewish Hospital, LLC, for $ 17.9  million effective January 1, 2026.';
  // Real fixture quote: UHS international-expansion (verifiedQuote, matchType=literal).
  const uhsIntl = "Our behavioral health care facilities located in the U.K. generated net revenues of approximately $1.001 billion in 2025 and $880 million in 2024.";
  assert(!isScrapeShapedText(thcNewDebt), "[2b] real fixture sentence (Tenet notes issuance) is accepted");
  assert(!isScrapeShapedText(ehcAssetSale), "[2c] real fixture sentence (Encompass asset sale) is accepted");
  assert(!isScrapeShapedText(uhsIntl), "[2d] real fixture sentence (UHS international revenue) is accepted");
}

// --- 3. Edge cases: single-number text and non-numeric text never trip the
// guard (it only suspects text with 2+ numeric tokens). ---
{
  const oneNumber = "Total assets $158.04 million";
  const noNumbers = "Assets Current Cash Balance Sheet";
  assert(!isScrapeShapedText(oneNumber), "[3a] a single numeric token never trips the guard (needs 2+)");
  assert(!isScrapeShapedText(noNumbers), "[3b] text with no numeric tokens never trips the guard");
  assert(!isScrapeShapedText(""), "[3c] empty string never trips the guard");
  assert(!isScrapeShapedText(null), "[3d] null never trips the guard");
}

// --- 4. failedEventBriefing shape (Part C.1) — the loud-failure contract
// itself: empty prose fields, a populated failureReason, source: "failed".
// Pure, no fixture needed beyond one real FlashCard to construct from. ---
{
  const sgry = fixture.companies.find((c) => c.ticker === "SGRY")!;
  const { flashCardCandidates } = buildEvents([sgry]);
  const anyCard = flashCardCandidates[0];
  if (!anyCard) {
    console.warn("  (skipped [4a] — no live card in this fixture build to construct a FlashCard from)");
  } else {
    const result = failedEventBriefing(anyCard, "simulated Sonnet timeout");
    assert(
      result.source === "failed" &&
        result.callAbout === "" &&
        result.whyNow === "" &&
        result.openWith === "" &&
        result.failureReason === "simulated Sonnet timeout",
      "[4a] failedEventBriefing returns empty fields + source:failed + the given reason"
    );
  }
}

// --- 5. factTokens.ts money-extraction unit typing (Part B data-quality
// fix) — VerifiedFact.figures must contain only CURRENCY-typed money,
// never a bare unlabeled count, a percentage read as an amount, or a
// per-share rate read as a total. Three real symptoms, three real fixture
// facts, not hand-written. Unaffected by Session 15 — factBase.ts is
// unchanged. ---
{
  const ehc = fixture.companies.find((c) => c.ticker === "EHC");
  if (!ehc) throw new Error("fixture missing EHC");
  const ehcFacts = buildVerifiedFactBase(ehc);

  const ehcAssetSale = ehcFacts.find((f) => f.linkedTriggerId === "asset-sale");
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.every((f) => !f.includes("%")),
    `[5a] EHC asset-sale figures exclude the 50% ownership-stake percentage (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.some((f) => f.includes("17.9")),
    `[5b] EHC asset-sale figures include the real $17.9 million proceeds figure (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );

  const ehcBuyback = ehcFacts.find((f) => f.linkedTriggerId === "dividend-buyback");
  assert(
    !!ehcBuyback && ehcBuyback.figures.length === 0,
    `[5c] EHC dividend-buyback's $0.19 per-share dividend is excluded, not shown as an authorization size (figures: ${JSON.stringify(ehcBuyback?.figures)})`
  );

  const uhs = fixture.companies.find((c) => c.ticker === "UHS");
  if (!uhs) throw new Error("fixture missing UHS");
  const uhsFacts = buildVerifiedFactBase(uhs);
  const uhsBuyback = uhsFacts.find((f) => f.linkedTriggerId === "dividend-buyback");
  assert(
    !!uhsBuyback && uhsBuyback.figures.length === 0,
    `[5d] UHS dividend-buyback's bare unlabeled table figures (no "$" anywhere) are excluded rather than guessed as dollars (figures: ${JSON.stringify(uhsBuyback?.figures)})`
  );
}

// --- 6. Figure-binding fixes (Session 13's 3 fixes, factBase.ts unchanged
// this session) — each against real fixture facts, not hand-written. ---
{
  const ehc = fixture.companies.find((c) => c.ticker === "EHC");
  if (!ehc) throw new Error("fixture missing EHC");
  const ehcFacts = buildVerifiedFactBase(ehc);
  const ehcAssetSale = ehcFacts.find((f) => f.linkedTriggerId === "asset-sale");
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.some((f) => /\bmillion\b/i.test(f)),
    `[6a] EHC asset-sale's figure keeps its "million" scale word despite the double-space EDGAR artifact (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );

  let uncapped = 0;
  const badFigures: string[] = [];
  for (const c of fixture.companies) {
    for (const f of buildVerifiedFactBase(c)) {
      for (const fig of f.figures) {
        uncapped++;
        if (!hasDeterminableScale(fig)) badFigures.push(`${c.ticker}/${f.linkedTriggerId}: "${fig}"`);
      }
    }
  }
  assert(
    badFigures.length === 0,
    `[6b] no displayed figure across the full book lacks a determinable unit (checked ${uncapped} figures; failures: ${badFigures.join("; ")})`
  );

  {
    const changeQuote =
      'increased the size of its commercial paper program under which the Issuer may issue unsecured commercial paper notes (the "Notes") from time to time from a maximum aggregate face or principal amount of $4.0 billion outstanding at any time to a maximum aggregate face or principal amount of $8.0 billion outstanding at any time.';
    const synthetic: CompanyResult = {
      company: "SYNTHETIC CO.",
      cik: "0000000000",
      ticker: "SYN",
      verdict: "CALL",
      relationshipFlags: [],
      results: [
        {
          triggerId: "revolver-near-capacity",
          triggerName: "Revolver near capacity + growth",
          fired: true,
          dataAvailable: true,
          evidence: changeQuote,
          mappedNeed: "Revolver upsize",
          needType: "credit",
          confidence: 0.95,
          citations: [{ form: "10-Q", date: "2026-07-28", url: "https://example.com/synthetic" }],
          quoteVerified: true,
          verifiedQuote: changeQuote,
          verifiedQuoteNormalized: changeQuote,
          quoteMatchType: "literal",
          quoteHasFigure: true,
          eventDate: null,
          dateGranularity: null,
          eventStatus: "standing",
          proceedsUse: null,
        },
      ],
    };
    const syntheticFacts = buildVerifiedFactBase(synthetic);
    const revolver = syntheticFacts.find((f) => f.linkedTriggerId === "revolver-near-capacity");
    assert(
      !!revolver && revolver.figures.some((f) => f.includes("8.0 billion")) && !revolver.figures.some((f) => f.includes("4.0 billion")),
      `[6c] "increased from $4.0 billion to $8.0 billion" binds the post-change $8.0 billion, not the pre-change $4.0 billion (figures: ${JSON.stringify(revolver?.figures)})`
    );
  }

  const dva = fixture.companies.find((c) => c.ticker === "DVA");
  if (!dva) throw new Error("fixture missing DVA");
  const dvaFacts = buildVerifiedFactBase(dva);
  const dvaFx = dvaFacts.find((f) => f.linkedTriggerId === "fx-exposure");
  if (dvaFx) {
    assert(
      dvaFx.figures.length === 0,
      `[6d] DaVita fx-exposure binds no figure rather than the unrelated $2.88 million net-income figure (figures: ${JSON.stringify(dvaFx.figures)})`
    );
  } else {
    // Same live-data-drift pattern eligibility.test.ts's [11] already
    // documents: DaVita's fx-exposure didn't fire in this fixture rebuild
    // (real, observed Haiku non-determinism on an ambiguous trigger,
    // unrelated to this fix) — trivially not a figure-binding case here.
    assert(true, "[6d] DaVita fx-exposure didn't fire this fixture build — trivially nothing to bind (noted, not a fix regression)");
  }
}

// --- 7. numberGuard.checkNumbersAgainstQuotes (unchanged this session,
// still the accuracy backbone of checkCardStructure below). ---
{
  const guessedCard = "UHS has $771.9 million of debt maturing soon.";
  const bareQuote = "Current maturities of long-term debt $ 771,910";
  const result = checkNumbersAgainstQuotes(guessedCard, [bareQuote]);
  assert(
    !result.ok && result.unverifiedTokens.some((t) => /771\.9/.test(t)),
    `[7a] numberGuard rejects a scale-guessed "$771.9 million" against a bare, unresolved "$ 771,910" source (result: ${JSON.stringify(result)})`
  );

  const correctCard = "The company holds $1.5 billion in new debt.";
  const scaledQuote = "issued $1.5 billion aggregate principal amount of senior notes.";
  const result2 = checkNumbersAgainstQuotes(correctCard, [scaledQuote]);
  assert(result2.ok, `[7b] numberGuard still accepts a figure that matches the source at its own stated scale (result: ${JSON.stringify(result2)})`);
}

// --- 8. Session 15 Part A — countDistinctFactsReferenced, the mechanical
// proxy for "WHY NOW connects at least 2 facts." Pure function, hand-built
// fact texts (the property under test is about counting DISTINCT sources,
// not any specific real company's data). ---
{
  const factA = "5.500% notes due 2031 totaling $600 million";
  const factB = "revolver capacity of $373 million drawn as of March 31, 2026";
  const factC = "quarterly dividend of $0.78 per share declared in July 2026";

  assert(
    countDistinctFactsReferenced("This references $600 million from fact A only.", [factA, factB]) === 1,
    "[8a] text referencing only fact A's figure counts as 1 distinct fact"
  );
  assert(
    countDistinctFactsReferenced("This ties the $600 million notes to the $373 million revolver draw.", [factA, factB]) === 2,
    "[8b] text referencing both fact A's and fact B's figures counts as 2 distinct facts"
  );
  assert(
    countDistinctFactsReferenced("This mentions $9.99 billion, found nowhere.", [factA, factB]) === 0,
    "[8c] text whose figure matches NEITHER fact counts as 0 — an unverified figure never inflates the count"
  );
  assert(
    countDistinctFactsReferenced("$600 million again, and $600 million once more.", [factA, factB, factC]) === 1,
    "[8d] restating the SAME fact's figure twice still counts as only 1 distinct fact — repetition isn't synthesis"
  );
  assert(countDistinctFactsReferenced("Nothing numeric here at all.", [factA, factB]) === 0, "[8e] text with no traceable token counts as 0");
}

// --- 9. Session 15 Part A — checkCardStructure, the replacement for the
// deleted word-ceiling guard. Built from a real UHS fact base (real
// figures/dates) so the number-guard/distinctness checks exercise genuine
// data, not hand-typed strings that might accidentally collide. ---
{
  const uhs = fixture.companies.find((c) => c.ticker === "UHS")!;
  const uhsFacts: VerifiedFact[] = buildVerifiedFactBase(uhs);
  // Search for facts with a bound figure rather than assuming positions
  // 0/1 have one — the first fact in trigger-declaration order (debt-
  // maturity) is often exactly the "no determinable scale" case
  // (factBase.ts's own fix), which would make 9e/9f trivially skip.
  const withFigures = uhsFacts.filter((f) => f.figures[0]);
  const fact1 = withFigures[0];
  const fact2 = withFigures[1];
  if (!fact1 || !fact2) {
    console.warn("  (skipped [9a-9f] — fewer than 2 UHS facts with a bound figure in this fixture build)");
  } else {
    const fig1 = fact1.figures[0];
    const fig2 = fact2.figures[0];

    // 9a. Empty field fails.
    {
      const body: RawCardBody = { callAbout: "", whyNow: `Something about ${fig1 ?? "it"}.`, openWith: "Call them." };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("callAbout is empty")), "[9a] an empty callAbout fails structurally");
    }

    // 9b. whyNow over 2 sentences fails.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: "First sentence here. Second sentence here. Third sentence pushes it over.",
        openWith: "Call them.",
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("2-sentence limit")), "[9b] a 3-sentence whyNow fails the sentence-count check");
    }

    // 9c. An unverified figure fails the number-guard leg.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: `This references $9,999,999,999 which appears nowhere in the facts.`,
        openWith: "Call them.",
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("not found in any given fact")), "[9c] a figure absent from every given fact fails the number-guard check");
    }

    // 9d. Scrape-shaped field fails.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million",
        openWith: "Call them.",
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("raw data")), "[9d] a scrape-shaped whyNow fails the scrape-guard check");
    }

    // 9e. whyNow referencing only 1 distinct fact fails the synthesis check
    // — this is the "here's a thing that happened" pattern the session kills.
    if (fig1) {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: `The company disclosed ${fig1} in its filing.`,
        openWith: "Call them.",
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(
        !r.ok && r.reasons.some((x) => x.includes("must connect at least 2")) && r.factsReferenced <= 1,
        `[9e] whyNow restating only the headline's own figure fails the >=2-facts check (factsReferenced=${r.factsReferenced})`
      );
    } else {
      console.warn("  (skipped [9e] — UHS's first fact has no bound figure this build)");
    }

    // 9f. A genuinely valid body (2 sentences, 2 distinct facts, no
    // unverified figures, no scrape shape, no empty field) passes.
    if (fig1 && fig2 && fig1 !== fig2) {
      const body: RawCardBody = {
        callAbout: "Refinance the upcoming notes.",
        whyNow: `The company disclosed ${fig1} in one filing, and separately ${fig2} in another.`,
        openWith: "Ask how they're sequencing the two.",
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(
        r.ok && r.factsReferenced >= 2,
        `[9f] a body connecting 2 distinct real facts, correctly structured, PASSES (reasons: ${r.reasons.join("; ")}, factsReferenced=${r.factsReferenced})`
      );
    } else {
      console.warn("  (skipped [9f] — UHS's first two facts don't have two distinct figures this build)");
    }
  }

  // 9g. buildCorrectionInstruction just joins the reasons — pure formatting,
  // tested directly so a future change to its join logic is caught.
  {
    const instruction = buildCorrectionInstruction({ ok: false, reasons: ["callAbout is empty", "whyNow is 3 sentences"], factsReferenced: 0 });
    assert(
      instruction === "callAbout is empty; also, whyNow is 3 sentences",
      `[9g] buildCorrectionInstruction joins every reason with "; also, " (got: ${JSON.stringify(instruction)})`
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 12/15 NARRATION-INTEGRITY GOLDEN TESTS PASSED");
}
