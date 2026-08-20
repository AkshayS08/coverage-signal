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
import { checkCardStructure, buildCorrectionInstruction, parseKeyPoints, type RawCardBody } from "./sonnetEventBriefing";
import { checkNumbersAgainstQuotes, countDistinctFactsReferenced, factsReferencedIn, isFullyExplainedByOneFact } from "./numberGuard";
import { dedupeCitations } from "./buildEvents";

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
        result.keyPoints.length === 0 &&
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
      const body: RawCardBody = { callAbout: "", whyNow: `Something about ${fig1 ?? "it"}.`, keyPoints: ["A generic point.", "Another point."] };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("callAbout is empty")), "[9a] an empty callAbout fails structurally");
    }

    // 9b. whyNow over 2 sentences fails.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: "First sentence here. Second sentence here. Third sentence pushes it over.",
        keyPoints: ["A generic point.", "Another point."],
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("2-sentence limit")), "[9b] a 3-sentence whyNow fails the sentence-count check");
    }

    // 9c. An unverified figure fails the number-guard leg.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: `This references $9,999,999,999 which appears nowhere in the facts.`,
        keyPoints: ["A generic point.", "Another point."],
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(!r.ok && r.reasons.some((x) => x.includes("not found in any given fact")), "[9c] a figure absent from every given fact fails the number-guard check");
    }

    // 9d. Scrape-shaped field fails.
    {
      const body: RawCardBody = {
        callAbout: "Refinance the notes.",
        whyNow: ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million",
        keyPoints: ["A generic point.", "Another point."],
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
        keyPoints: ["A generic point.", "Another point."],
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
    // unverified figures, no scrape shape, no empty field, callAbout names
    // a verified figure — Session 15b Part B's new check) passes.
    if (fig1 && fig2 && fig1 !== fig2) {
      const body: RawCardBody = {
        callAbout: `Refinance the upcoming notes (${fig1}).`,
        whyNow: `The company disclosed ${fig1} in one filing, and separately ${fig2} in another.`,
        keyPoints: [`The filing states ${fig1}.`, `A separate filing states ${fig2}.`],
      };
      const r = checkCardStructure(body, uhsFacts);
      assert(
        r.ok && r.factsReferenced >= 2,
        `[9f] a body connecting 2 distinct real facts, correctly structured, PASSES (reasons: ${r.reasons.join("; ")}, factsReferenced=${r.factsReferenced})`
      );
    } else {
      console.warn("  (skipped [9f] — UHS's first two facts don't have two distinct figures this build)");
    }

    // 9h. Session 15b Part B: callAbout naming NEITHER a figure nor a date
    // fails the new check — this is the exact "description, not a call"
    // pattern the requirement exists to catch.
    {
      const body: RawCardBody = { callAbout: "Refinance the notes soon.", whyNow: "Something is happening.", keyPoints: ["A generic point.", "Another point."] };
      const r = checkCardStructure(body, uhsFacts);
      assert(
        r.reasons.some((x) => x.includes("no verified amount or date")),
        "[9h] callAbout naming neither a figure nor a date fails the new Part B check"
      );
    }

    // 9i. Part C's explicit allowance: callAbout naming a verified DATE
    // ALONE (no dollar figure) satisfies the check — exactly UHS's own
    // debt-maturity shape, whose only verifiable figure is redacted.
    {
      const uhsDebtMaturity = uhsFacts.find((f) => f.linkedTriggerId === "debt-maturity");
      if (uhsDebtMaturity?.eventDate) {
        const body: RawCardBody = {
          callAbout: `Address the notes maturing in ${uhsDebtMaturity.eventDate}.`,
          whyNow: "Placeholder synthesis line.",
          keyPoints: ["A generic point.", "Another point."],
        };
        const r = checkCardStructure(body, uhsFacts);
        assert(
          !r.reasons.some((x) => x.includes("no verified amount or date")),
          `[9i] callAbout naming a verified DATE alone (no figure) satisfies the check — Part C's explicit allowance (reasons: ${r.reasons.join("; ")})`
        );
      } else {
        console.warn("  (skipped [9i] — UHS's debt-maturity fact has no eventDate this build)");
      }
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

// --- 11 (Session 17 Item 17): checkCardStructure's three new keyPoints
// checks — 2-4 bullet count, no bullet connecting 2+ distinct facts, and
// the first bullet must reference the HEADLINE fact specifically. [11a]/
// [11b] reuse the real UHS fact base from block 9; [11c]/[11d]/[11e] use
// two SYNTHETIC facts pinned to real UHS filings (clean, guaranteed-
// distinct figures) rather than depending on which two live UHS facts
// happen to have bound figures in a given fixture rebuild. ---
{
  const uhs = fixture.companies.find((c) => c.ticker === "UHS")!;
  const uhsFacts: VerifiedFact[] = buildVerifiedFactBase(uhs);

  // 11a. Only 1 bullet fails the count check.
  {
    const body: RawCardBody = { callAbout: "Refinance the notes.", whyNow: "Placeholder synthesis line.", keyPoints: ["Only one bullet here."] };
    const r = checkCardStructure(body, uhsFacts);
    assert(!r.ok && r.reasons.some((x) => x.includes("needs 2 to 4")), `[11a] a single keyPoints bullet fails the 2-4 count check (reasons: ${r.reasons.join("; ")})`);
  }

  // 11b. 5 bullets fails the count check.
  {
    const body: RawCardBody = {
      callAbout: "Refinance the notes.",
      whyNow: "Placeholder synthesis line.",
      keyPoints: ["One.", "Two.", "Three.", "Four.", "Five."],
    };
    const r = checkCardStructure(body, uhsFacts);
    assert(!r.ok && r.reasons.some((x) => x.includes("needs 2 to 4")), `[11b] 5 keyPoints bullets fails the 2-4 count check (reasons: ${r.reasons.join("; ")})`);
  }

  const headlineFact: VerifiedFact = {
    linkedTriggerId: "debt-maturity",
    fact: "Debt maturity approaching",
    verifiedText: "SYNTHETIC",
    normalizedText: "SYNTHETIC: notes due 2027",
    figures: ["$500 million"],
    dates: ["2027"],
    sourceFiling: null,
    citations: [{ form: "10-Q", date: "2026-07-01", url: "https://example.com/synthetic-headline" }],
    evidence: "SYNTHETIC: $500 million of notes due 2027.",
    eventDate: "2027",
    dateGranularity: "year",
    eventStatus: "upcoming",
  };
  const otherFact: VerifiedFact = {
    linkedTriggerId: "large-cash-balance",
    fact: "Large cash balance building",
    verifiedText: "SYNTHETIC",
    normalizedText: "SYNTHETIC: cash of $900 million",
    figures: ["$900 million"],
    dates: [],
    sourceFiling: null,
    citations: [{ form: "10-Q", date: "2026-07-01", url: "https://example.com/synthetic-other" }],
    evidence: "SYNTHETIC: cash and equivalents of $900 million.",
    eventDate: null,
    dateGranularity: null,
    eventStatus: "standing",
  };
  const syntheticFacts = [headlineFact, otherFact];

  // 11c. A bullet referencing 2 distinct facts fails — the structural
  // proxy for "no bullet may assert a relationship between two facts."
  {
    const body: RawCardBody = {
      callAbout: "Refinance the $500 million notes due 2027.",
      whyNow: "The notes come due as cash builds toward $900 million, giving room to act.",
      keyPoints: ["The company holds $500 million of notes due 2027 and separately $900 million of cash.", "A second, unrelated point."],
    };
    const r = checkCardStructure(body, syntheticFacts, "debt-maturity");
    assert(
      !r.ok && r.reasons.some((x) => x.includes("never connects two")),
      `[11c] SYNTHETIC: a keyPoints bullet referencing 2 distinct facts fails — a bullet states one fact, never a relationship (reasons: ${r.reasons.join("; ")})`
    );
  }

  // 11d. The first bullet not referencing the headline fact fails.
  {
    const body: RawCardBody = {
      callAbout: "Refinance the $500 million notes due 2027.",
      whyNow: "Placeholder synthesis line naming nothing extra.",
      keyPoints: ["The company holds $900 million of cash.", "A second point."],
    };
    const r = checkCardStructure(body, syntheticFacts, "debt-maturity");
    assert(
      !r.ok && r.reasons.some((x) => x.includes("does not reference the headline fact")),
      `[11d] SYNTHETIC: the first keyPoints bullet not referencing the headline fact fails (reasons: ${r.reasons.join("; ")})`
    );
  }

  // 11e. A well-formed keyPoints array (2 bullets, each single-fact, first
  // bullet references the headline) passes all three new checks.
  {
    const body: RawCardBody = {
      callAbout: "Refinance the $500 million notes due 2027.",
      whyNow: "The notes come due while cash of $900 million sits on the balance sheet.",
      keyPoints: ["The company has $500 million of notes due 2027.", "Separately, the company holds $900 million of cash."],
    };
    const r = checkCardStructure(body, syntheticFacts, "debt-maturity");
    assert(
      !r.reasons.some((x) => x.includes("2 to 4") || x.includes("never connects two") || x.includes("does not reference the headline fact")),
      `[11e] SYNTHETIC: a well-formed keyPoints array (first bullet = headline, no multi-fact bullets) passes all three new checks (reasons: ${r.reasons.join("; ")})`
    );
  }
}

// --- 12 (Session 17 Item 17, hardening): parseKeyPoints must accept a
// genuine array (the normal case) AND recover the real malformed shape
// observed live on Tenet's and Quest's actual first attempts this session
// — a single string with pseudo-XML <item> tags instead of a JSON array,
// despite the schema declaring an array. Anything else (a plain string
// with no tags, a number, null) still returns [], which still fails
// loudly downstream. ---
{
  assert(
    JSON.stringify(parseKeyPoints(["First point.", "Second point."])) === JSON.stringify(["First point.", "Second point."]),
    "[12a] a genuine array of strings passes through unchanged"
  );

  const realMalformed =
    "\n<item>Senior secured first lien notes of $1.5 billion are due November 2027, part of maturities staggered out to November 2033</item>\n<item>In November 2025, Tenet issued $1.5 billion of 5.500% first lien notes due 2032 and $750 million of 6.000% senior notes due 2033</item>\n<item>Cash and cash equivalents stood at $2.17 billion as of June 30, 2026</item>\n<item>Tenet repurchased $1.36 billion of common stock in the six months ended June 30, 2026</item>\n</keyPoints>\n";
  const recovered = parseKeyPoints(realMalformed);
  assert(
    recovered.length === 4 && recovered[0].startsWith("Senior secured first lien notes") && recovered[3].includes("$1.36 billion"),
    `[12b] REAL malformed shape (Tenet's actual live response this session) recovers all 4 bullets, content intact (got ${recovered.length} bullets: ${JSON.stringify(recovered)})`
  );

  assert(JSON.stringify(parseKeyPoints("just a plain string, no tags")) === "[]", "[12c] a plain string with no <item> tags returns empty — still fails loudly downstream, no guess");
  assert(JSON.stringify(parseKeyPoints(null)) === "[]", "[12d] null returns empty");
  assert(JSON.stringify(parseKeyPoints(undefined)) === "[]", "[12e] undefined returns empty");
}

// --- 13 (Session 17 Item 17, regression): the real false-positive found
// live on Tenet's actual first draft this session. Tenet's debt-maturity
// evidence lists its own tranche ladder, which happens to include the
// exact "$1.5 billion due November 2032" / "$750 million due June 2033"
// figures that new-debt-issuance's evidence ALSO states (the same notes,
// described from two angles) — a bullet describing ONLY new-debt-
// issuance's own two-tranche pricing was being rejected twice over: once
// as "scrape-shaped" (numeric density 0.33, above the old 0.3 sentence
// threshold) and once as "connects 2 facts" (token-overlap with debt-
// maturity's evidence, even though new-debt-issuance alone fully explains
// every token in it). Real fixture data, unmodified. ---
{
  const thc = fixture.companies.find((c) => c.ticker === "THC")!;
  const thcFacts = buildVerifiedFactBase(thc);
  const debtMaturity = thcFacts.find((f) => f.linkedTriggerId === "debt-maturity");
  const newDebtIssuance = thcFacts.find((f) => f.linkedTriggerId === "new-debt-issuance");
  if (debtMaturity && newDebtIssuance) {
    const realTenetBullet =
      "On November 18, 2025, Tenet issued $1.5 billion of 5.500% first lien notes due 2032 and $750 million of 6.000% senior notes due 2033.";
    assert(
      !isScrapeShapedText(realTenetBullet, "bullet"),
      `[13a] REAL Tenet bullet (numeric ratio ~0.33) is NOT scrape-shaped under the bullet context's looser threshold`
    );
    assert(
      isFullyExplainedByOneFact(realTenetBullet, thcFacts),
      `[13b] REAL Tenet bullet IS fully explained by new-debt-issuance alone, even though debt-maturity's evidence coincidentally shares the same tranche figures`
    );
    const body: RawCardBody = {
      callAbout: "Refinance the $1.5 billion senior secured first lien notes due November 2027.",
      whyNow: "Tenet just tapped the market in November 2025 for similar notes, showing it can access refinancing ahead of the 2027 wall.",
      keyPoints: [
        "$1.5 billion senior secured first lien notes mature November 2027, part of maturities staggered out to November 2033.",
        realTenetBullet,
      ],
    };
    const r = checkCardStructure(body, thcFacts, "debt-maturity");
    assert(
      !r.reasons.some((x) => x.includes("raw data") || x.includes("not fully explained")),
      `[13c] REAL Tenet card body (both real bullets) passes both fixed checks (reasons: ${r.reasons.join("; ")})`
    );
  } else {
    console.warn("  (skipped [13] — Tenet's debt-maturity or new-debt-issuance fact missing this fixture build)");
  }
}

// --- 10 (Session 17 Item 4): factsReferencedIn / the citation-union fix.
// Real fixture data: HCA's debt-maturity fact (cites ONLY 8-K 2026-04-30,
// evidence states "The 2031 Notes mature May 15, 2031") and HCA's
// asset-sale fact (cites ONLY 10-Q 2026-07-28, evidence states "$21
// million") share no citation with each other — the exact shape that
// broke a dedup-cluster-based union (debt-maturity never clusters with
// anything else, since it has no 8-K to share). Text referencing BOTH
// facts' own figures/dates must resolve to BOTH facts, and their citation
// union must cover both filings — proving the fix actually closes the gap
// a cluster-based implementation would not have. ---
{
  const hca = fixture.companies.find((c) => c.ticker === "HCA")!;
  const hcaFacts = buildVerifiedFactBase(hca);
  const debtMaturity = hcaFacts.find((f) => f.linkedTriggerId === "debt-maturity")!;
  const assetSale = hcaFacts.find((f) => f.linkedTriggerId === "asset-sale")!;

  assert(
    debtMaturity.citations.every((c) => !assetSale.citations.some((c2) => c2.url === c.url)),
    "[10 setup] HCA's debt-maturity and asset-sale facts share no citation — the real shape a cluster-based union would miss"
  );

  const cardText = "Refinance the notes maturing May 15, 2031. The company also received $21 million from recent asset sales.";
  const referenced = factsReferencedIn(cardText, hcaFacts);
  assert(
    referenced.some((f) => f.linkedTriggerId === "debt-maturity") && referenced.some((f) => f.linkedTriggerId === "asset-sale"),
    `[10a] text referencing both facts' own figures/dates resolves to BOTH facts (got: ${referenced.map((f) => f.linkedTriggerId).join(", ")})`
  );

  const union = dedupeCitations([...debtMaturity.citations, ...referenced.flatMap((f) => f.citations)]);
  const urls = union.map((c) => c.url);
  assert(
    debtMaturity.citations.every((c) => urls.includes(c.url)) && assetSale.citations.every((c) => urls.includes(c.url)),
    "[10b] the citation union covers both the headline's own filing (8-K) and the referenced fact's filing (10-Q) — not just the headline's"
  );

  // A text that only restates the headline's own figure must NOT pull in
  // an unrelated fact's citation — the fix must be precise, not "cite
  // everything the company has."
  const headlineOnlyText = "Refinance the notes maturing May 15, 2031.";
  const referencedNarrow = factsReferencedIn(headlineOnlyText, hcaFacts);
  assert(
    !referencedNarrow.some((f) => f.linkedTriggerId === "asset-sale"),
    "[10c] text mentioning only the headline's own date does not pull in an unrelated fact's citation — precise, not over-inclusive"
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 12/15 NARRATION-INTEGRITY GOLDEN TESTS PASSED");
}
