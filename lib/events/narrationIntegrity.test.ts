/**
 * Session 12 Parts B/C + Session 13 Part A golden tests — narration
 * integrity (loud failure, scrape-shaped-text rejection, word-ceiling
 * retry) and the portfolio-summary constraint checker. Runs entirely
 * OFFLINE: no Anthropic/EDGAR calls, using the same cached fixture
 * (__fixtures__/session11-facts.json) as eligibility.test.ts for the two
 * tests that need a real FlashCard to override (spread pattern, matching
 * that file's own convention — real citations/evidence, only the field
 * under test pinned). Everything else here is a pure function test with
 * no live data dependency at all.
 *
 * Run: npx tsx lib/events/narrationIntegrity.test.ts (or npm test)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult } from "../agent";
import { buildEvents } from "./buildEvents";
import { isScrapeShapedText } from "./scrapeGuard";
import { templateEventBriefing, quoteFallbackBriefing, failedEventBriefing } from "./eventBriefing";
import { failedPortfolioSummary } from "./portfolioSummary";
import { checkSummaryConstraints, type FactLine } from "./sonnetPortfolioSummary";
import { buildVerifiedFactBase, hasDeterminableScale } from "./factBase";
import { overWordCeiling, buildCorrectionInstruction, type WordCounts } from "./sonnetEventBriefing";
import { checkNumbersAgainstQuotes } from "./numberGuard";

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

console.log(`=== Session 12 Parts B/C golden tests (narration integrity) ===\n`);

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

// --- 4. Wiring: templateEventBriefing/quoteFallbackBriefing must route a
// scrape-shaped verified quote to failedEventBriefing, not display it as
// prose. Built from a REAL card (SGRY's asset-sale — confirmed card-
// eligible 3/3 in Session 12 Part A, see eligibility.test.ts's [19a]) with
// only verifiedQuoteNormalized overridden to a known scrape-shaped string —
// same spread-and-pin convention as eligibility.test.ts's synthetic
// guards. ---
{
  const sgry = fixture.companies.find((c) => c.ticker === "SGRY");
  if (!sgry) throw new Error("fixture missing SGRY");
  const { flashCardCandidates } = buildEvents([sgry]);
  const assetSaleCard = flashCardCandidates.find((c) => c.headlineTrigger.triggerId === "asset-sale");
  if (!assetSaleCard) {
    console.warn("  (skipped [4a]/[4b]/[4c] — SGRY's asset-sale is not a live card-eligible candidate in this fixture build)");
  } else {
    const scrapeShapedQuote = ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million";
    const rigged = {
      ...assetSaleCard,
      headlineTrigger: { ...assetSaleCard.headlineTrigger, verifiedQuoteNormalized: scrapeShapedQuote, verifiedQuote: scrapeShapedQuote },
    };
    const templateResult = templateEventBriefing(rigged);
    const quoteResult = quoteFallbackBriefing(rigged);
    assert(
      templateResult.source === "failed" && !!templateResult.failureReason?.includes("scrape-shaped"),
      "[4a] templateEventBriefing routes a scrape-shaped quote to a loud failure, not prose"
    );
    assert(
      quoteResult.source === "failed" && !!quoteResult.failureReason?.includes("scrape-shaped"),
      "[4b] quoteFallbackBriefing routes a scrape-shaped quote to a loud failure, not prose"
    );
    assert(templateResult.what === "" && quoteResult.what === "", "[4c] failed briefings carry no prose in `what` — the UI has nothing to accidentally render but the banner");
  }
}

// --- 5. failedEventBriefing / failedPortfolioSummary shape (Part C.1) —
// the loud-failure contract itself: empty prose fields, a populated
// failureReason, source: "failed". Pure, no fixture needed. ---
{
  const sgry = fixture.companies.find((c) => c.ticker === "SGRY")!;
  const { flashCardCandidates } = buildEvents([sgry]);
  const anyCard = flashCardCandidates[0];
  if (!anyCard) {
    console.warn("  (skipped [5a] — no live card in this fixture build to construct a FlashCard from)");
  } else {
    const result = failedEventBriefing(anyCard, "simulated Sonnet timeout");
    assert(
      result.source === "failed" && result.what === "" && result.whyCall === "" && result.angle === "" && result.failureReason === "simulated Sonnet timeout",
      "[5a] failedEventBriefing returns empty prose + source:failed + the given reason"
    );
  }
  const summaryResult = failedPortfolioSummary("Test Co", "simulated API error");
  assert(
    summaryResult.source === "failed" && summaryResult.summary === "" && summaryResult.failureReason === "simulated API error",
    "[5b] failedPortfolioSummary returns empty summary + source:failed + the given reason"
  );
}

// --- 6. checkSummaryConstraints — Part B's five mechanical constraints,
// each with a trip case and a pass case. Pure FactLine[] input, no live
// data needed: FactLine is deliberately structured/token-based (never raw
// filing prose), matching what Sonnet is actually given. ---
{
  const hedgingStanding: FactLine = {
    text: `- [FX / rate hedging] FX hedging — STANDING (not actionable this week) — timing (use verbatim, never recompute): "standing" — value: no figure disclosed (date unstated)`,
    bucket: "hedging",
    actionable: false,
    timingPhrase: "standing",
    monthsValue: null,
  };
  const refiThisWeek: FactLine = {
    text: `- [Refi (debt maturity)] refi window — THIS WEEK (actionable now) — timing (use verbatim, never recompute): "matures 2026" — value: $1.65 billion (date unstated)`,
    bucket: "refi",
    actionable: true,
    timingPhrase: "matures 2026",
    monthsValue: null, // year-granularity — no real month precision to check a duration against
  };
  const refiStandingMonths: FactLine = {
    text: `- [Refi (debt maturity)] refi window — STANDING (not actionable this week) — timing (use verbatim, never recompute): "~9mo out" — value: $500 million (date unstated)`,
    bucket: "refi",
    actionable: false,
    timingPhrase: "~9mo out",
    monthsValue: 9,
  };
  const refi15mo: FactLine = {
    text: `- [Refi (debt maturity)] refi window — STANDING (not actionable this week) — timing (use verbatim, never recompute): "~15mo out" — value: $500 million (date unstated)`,
    bucket: "refi",
    actionable: false,
    timingPhrase: "~15mo out",
    monthsValue: 15,
  };

  // 6a. Hedging surfacing: standing hedging exists, summary never mentions it -> violation.
  {
    const r = checkSummaryConstraints("The company has a refi window coming up. Nothing else stands out right now.", [hedgingStanding, refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("hedging")), "[6a] missing hedging mention is caught when a standing hedging fact exists");
  }
  // 6b. Hedging surfacing: mentioned -> passes that check (may still fail others independently).
  {
    const r = checkSummaryConstraints(
      "The company's refi window matures 2026, backed by $1.65 billion. Its standing FX exposure remains a hedging opportunity worth raising.",
      [hedgingStanding, refiThisWeek]
    );
    assert(!r.reasons.some((x) => x.includes("hedging")), "[6b] an explicit hedging mention clears constraint 1");
  }
  // 6c. Gate contradiction: nothing actionable, but the summary never says
  // so (no explicit no-action statement) -> violation. (Claim-based check,
  // not vocabulary — this summary happens to also say "call now," but the
  // missing no-action statement alone is enough to fail it.)
  {
    const r = checkSummaryConstraints("You should call now — there is a standing hedging opportunity worth flagging.", [hedgingStanding]);
    assert(!r.ok && r.reasons.some((x) => x.includes("card gate")), "[6c] a no-card summary with no explicit no-action statement is caught");
  }
  // 6d. Gate contradiction: nothing actionable, prose correctly says so -> passes that check.
  {
    const r = checkSummaryConstraints("Nothing is actionable this week. A standing hedging opportunity is worth raising when the relationship allows.", [hedgingStanding]);
    assert(!r.reasons.some((x) => x.includes("card gate")), "[6d] correctly saying nothing is actionable clears constraint 2");
  }
  // 6d2. Required assertion (Session 12 fix): a no-card summary explicitly
  // saying nothing is actionable AND surfacing standing hedging language
  // ("worth raising") must PASS — this is exactly the combination the
  // previous vocabulary-based check put in conflict with constraint 1.
  {
    const r = checkSummaryConstraints(
      "Nothing is actionable this week for this company. Its standing FX hedging remains worth raising with the client.",
      [hedgingStanding]
    );
    assert(!r.reasons.some((x) => x.includes("card gate")), '[6d2] "nothing actionable this week... hedging worth raising" PASSES constraint 2');
  }
  // 6d3. Required assertion: a no-card summary that names a SPECIFIC
  // action tied to "this week" must FAIL, even though it also contains the
  // no-action statement elsewhere in the text.
  {
    const r = checkSummaryConstraints(
      "Nothing is actionable this week overall. You should call them this week about the maturity.",
      [hedgingStanding]
    );
    assert(!r.ok && r.reasons.some((x) => x.includes("card gate")), '[6d3] "call them this week about the maturity" on a no-card summary FAILS');
  }
  // 6d4. Required assertion: a CARDED company's summary naming its own
  // actionable event as actionable must PASS — constraint 2 is exempt
  // entirely once anyActionable is true.
  {
    const r = checkSummaryConstraints(
      "Tenet has a refi window actionable this week — worth calling now to discuss terms.",
      [refiThisWeek]
    );
    assert(!r.reasons.some((x) => x.includes("card gate")), "[6d4] a carded company naming its own actionable event PASSES constraint 2");
  }
  // 6d5. Real case hit during live re-runs: "neither has triggered a call
  // this week" — "neither" negates the directive just as much as "not"
  // does, but wasn't in the original negation word list, causing a real
  // retry against an otherwise-correct draft.
  {
    const r = checkSummaryConstraints(
      "Nothing is actionable this week. Worth flagging is a standing hedging opportunity, which should be raised even though neither item has triggered a call this week.",
      [hedgingStanding]
    );
    assert(!r.reasons.some((x) => x.includes("card gate")), '[6d5] "neither...has triggered a call this week" is recognized as negation, not a directive');
  }
  // 6e. Fabricated figure: a dollar amount not present in any fact line -> violation.
  {
    const r = checkSummaryConstraints("The refi window matures 2026, backed by $1.65 billion, on top of a separate $9.99 billion facility.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("unverified")), "[6e] a figure absent from the fact set is caught by the number guard");
  }
  // 6f. Date-granularity violation: a year-granularity fact (no month value
  // at all — monthsValue null) described with a computed relative month
  // count -> violation, since there is nothing in the allowed set to match.
  {
    const r = checkSummaryConstraints("The refi window is only ~5mo out, backed by $1.65 billion.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("duration")), "[6f] a computed relative-month phrase for a year-granularity fact is caught");
  }
  // 6g. Date-granularity pass: a genuine month-based phrase we actually gave it is fine.
  {
    const r = checkSummaryConstraints("A separate facility is ~9mo out, backed by $500 million, with no other action needed this week.", [refiStandingMonths]);
    assert(!r.reasons.some((x) => x.includes("duration")), "[6g] a timing phrase copied verbatim from the fact set clears constraint 4");
  }
  // 6g2. SEMANTIC not lexical: "~15 months out" restating a fed "~15mo"
  // must PASS — same VALUE, different wording, which is exactly what the
  // rewrite from substring-containment to value-parsing exists to allow.
  {
    const r = checkSummaryConstraints(
      "A separate facility is ~15 months out, backed by $500 million, with no other action needed this week.",
      [refi15mo]
    );
    assert(!r.reasons.some((x) => x.includes("duration")), '[6g2] "~15 months out" against a fed "~15mo" PASSES (same value, different wording)');
  }
  // 6g3. But a genuinely different value must still FAIL even in the same
  // "months" wording — the check is real, not just permissive.
  {
    const r = checkSummaryConstraints(
      "A separate facility is only ~5 months out, backed by $500 million, with no other action needed this week.",
      [refi15mo]
    );
    assert(!r.ok && r.reasons.some((x) => x.includes("duration")), '[6g3] "~5 months out" against a fed "~15mo" FAILS (wrong value)');
  }
  // 6h. Shape violation: too few sentences — with a non-empty fact set, so
  // the empty-fact-base single-sentence exemption does not apply.
  {
    const r = checkSummaryConstraints("The refi window matures 2026.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("2-4")), "[6h] a single-sentence summary (with facts present) fails the 2-4 sentence shape rule");
  }
  // 6i. Shape violation: semicolon list (the exact old-format defect this session replaces).
  {
    const r = checkSummaryConstraints("New debt raised — standing; acquisition financing — standing; capex financing — this week.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("semicolon")), "[6i] a semicolon-joined list is rejected by the shape rule");
  }
  // 6j. Empty fact list -> the fixed no-activity line passes every check.
  {
    const r = checkSummaryConstraints("No verified activity to report this week.", []);
    assert(r.ok, `[6j] the fixed no-activity line passes every constraint (reasons: ${r.reasons.join("; ")})`);
  }
}

// --- 7. factTokens.ts money-extraction unit typing (Part B data-quality
// fix) — VerifiedFact.figures must contain only CURRENCY-typed money,
// never a bare unlabeled count, a percentage read as an amount, or a
// per-share rate read as a total. Three real symptoms, three real fixture
// facts, not hand-written. ---
{
  const ehc = fixture.companies.find((c) => c.ticker === "EHC");
  if (!ehc) throw new Error("fixture missing EHC");
  const ehcFacts = buildVerifiedFactBase(ehc);

  // Real quote: "...sell our 50% membership interest...for $17.9 million..."
  // — the 50% ownership stake must never appear in figures; the real
  // $17.9 million proceeds figure must.
  const ehcAssetSale = ehcFacts.find((f) => f.linkedTriggerId === "asset-sale");
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.every((f) => !f.includes("%")),
    `[7a] EHC asset-sale figures exclude the 50% ownership-stake percentage (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.some((f) => f.includes("17.9")),
    `[7b] EHC asset-sale figures include the real $17.9 million proceeds figure (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );

  // Real quote: "Dividends declared ($0.19 per share)" — a rate, never a
  // buyback authorization SIZE; must be excluded entirely (no other money
  // token exists in this fact).
  const ehcBuyback = ehcFacts.find((f) => f.linkedTriggerId === "dividend-buyback");
  assert(
    !!ehcBuyback && ehcBuyback.figures.length === 0,
    `[7c] EHC dividend-buyback's $0.19 per-share dividend is excluded, not shown as an authorization size (figures: ${JSON.stringify(ehcBuyback?.figures)})`
  );

  // Real quote: bare table figures ("3,938", "164,501", ...) with no "$"
  // anywhere near them — too ambiguous to trust as dollar amounts.
  const uhs = fixture.companies.find((c) => c.ticker === "UHS");
  if (!uhs) throw new Error("fixture missing UHS");
  const uhsFacts = buildVerifiedFactBase(uhs);
  const uhsBuyback = uhsFacts.find((f) => f.linkedTriggerId === "dividend-buyback");
  assert(
    !!uhsBuyback && uhsBuyback.figures.length === 0,
    `[7d] UHS dividend-buyback's bare unlabeled table figures (no "$" anywhere) are excluded rather than guessed as dollars (figures: ${JSON.stringify(uhsBuyback?.figures)})`
  );
}

// --- 8. Figure-binding fixes (this session's 3 fixes) — each against real
// fixture facts, not hand-written. ---
{
  // 8a/8b. Fix 1: Encompass's "$ 17.9  million" (double-space EDGAR
  // artifact) must keep its scale word, not silently become "$17.9".
  const ehc = fixture.companies.find((c) => c.ticker === "EHC");
  if (!ehc) throw new Error("fixture missing EHC");
  const ehcFacts = buildVerifiedFactBase(ehc);
  const ehcAssetSale = ehcFacts.find((f) => f.linkedTriggerId === "asset-sale");
  assert(
    !!ehcAssetSale && ehcAssetSale.figures.some((f) => /\bmillion\b/i.test(f)),
    `[8a] EHC asset-sale's figure keeps its "million" scale word despite the double-space EDGAR artifact (figures: ${JSON.stringify(ehcAssetSale?.figures)})`
  );

  // 8b. General assertion: across the ENTIRE book, no displayed figure
  // lacks a determinable unit (hasDeterminableScale — factBase.ts).
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
    `[8b] no displayed figure across the full book lacks a determinable unit (checked ${uncapped} figures; failures: ${badFigures.join("; ")})`
  );

  // 8c. Fix 2: "increased...from $4.0 billion...to $8.0 billion" must bind
  // the POST-change $8.0 billion, not the first-stated $4.0 billion.
  // SYNTHETIC REGRESSION GUARD: this exact sentence is HCA's real,
  // historically-observed revolver-near-capacity quote (see Session 13
  // Part B's live-run report) — but that trigger doesn't fire on every
  // live run (real, observed non-determinism, unrelated to this fix), so
  // it's pinned here as a constructed CompanyResult, matching
  // eligibility.test.ts's own established convention for a real quote
  // that the current live fixture doesn't happen to reproduce.
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
      `[8c] "increased from $4.0 billion to $8.0 billion" binds the post-change $8.0 billion, not the pre-change $4.0 billion (figures: ${JSON.stringify(revolver?.figures)})`
    );
  }

  // 8d. Fix 3: DaVita's fx-exposure fact must bind NO figure — the only
  // candidates in its padded, non-prose display text are an unrelated
  // net-income figure and the fact's own (unlabeled, in this padded text)
  // translation-gain comparative; with no sentence structure to lean on,
  // neither is trusted.
  const dva = fixture.companies.find((c) => c.ticker === "DVA");
  if (!dva) throw new Error("fixture missing DVA");
  const dvaFacts = buildVerifiedFactBase(dva);
  const dvaFx = dvaFacts.find((f) => f.linkedTriggerId === "fx-exposure");
  assert(
    !!dvaFx && dvaFx.figures.length === 0,
    `[8d] DaVita fx-exposure binds no figure rather than the unrelated $2.88 million net-income figure (figures: ${JSON.stringify(dvaFx?.figures)})`
  );
}

// --- 9. Session 13 Part A — word-ceiling retry path. Diagnosed as high
// run-to-run draft-length variance (real repeated-draft counts observed:
// 26-58 words), not a systematically-too-tight ceiling, so the fix folds
// the 45-word hard ceiling into the SAME retry pipeline as
// numberGuard/scrapeGuard rather than throwing on its own — these pure
// functions ARE that retry decision, directly testable at zero cost. ---
{
  // 9a/9b. overWordCeiling: the exact real failure shape (what=47) trips
  // it; a within-limits draft doesn't.
  const overLimit: WordCounts = { what: 47, whyCall: 38, angle: 29 };
  const withinLimit: WordCounts = { what: 32, whyCall: 28, angle: 24 };
  assert(overWordCeiling(overLimit), "[9a] a real observed over-ceiling draft (what=47) trips overWordCeiling");
  assert(!overWordCeiling(withinLimit), "[9b] a within-limit draft does not trip overWordCeiling");

  // 9c. The correction instruction for a LENGTH-ONLY failure must mention
  // the word limit and must NOT be miscategorized as a numbers problem —
  // the exact bug that made every observed retry come out LONGER than the
  // first attempt (the old hardcoded message only ever talked about
  // sourcing figures, never length).
  const lengthOnly = buildCorrectionInstruction({ unverifiedTokens: [], scrapeShaped: false, overCeiling: true, counts: overLimit });
  assert(
    /45-word hard limit/.test(lengthOnly) && !/stated a number/.test(lengthOnly),
    `[9c] a length-only failure's retry instruction mentions the word limit and is not miscategorized as a numbers problem (instruction: ${JSON.stringify(lengthOnly)})`
  );

  // 9d. The correction instruction for an ACCURACY-only failure must
  // mention the unverified figure and must NOT mention length — the
  // retry must not ask Sonnet to shorten a draft that was never too long.
  const accuracyOnly = buildCorrectionInstruction({
    unverifiedTokens: ["$9.99 billion"],
    scrapeShaped: false,
    overCeiling: false,
    counts: withinLimit,
  });
  assert(
    /\$9\.99 billion/.test(accuracyOnly) && !/word hard limit/.test(accuracyOnly),
    `[9d] an accuracy-only failure's retry instruction names the bad figure and does not mention length (instruction: ${JSON.stringify(accuracyOnly)})`
  );

  // 9e. Both failing at once must produce ONE instruction covering both —
  // this is the real diagnosed case: a retry prompted by an accuracy miss
  // that then grew even longer (34->58, 29->49, 29->48, 32->44 observed
  // live) because length was never mentioned in the same breath.
  const both = buildCorrectionInstruction({ unverifiedTokens: ["2026"], scrapeShaped: false, overCeiling: true, counts: overLimit });
  assert(
    /2026/.test(both) && /45-word hard limit/.test(both),
    `[9e] a combined accuracy+length failure's retry instruction covers both in one message (instruction: ${JSON.stringify(both)})`
  );
}

// --- 10. Session 13 Part B — four figure-binding fixes after a live run
// found real defects the fixture never exercised: a scale contradiction
// (card said "$771.9 million," summary said "$771.91 thousand" for the
// SAME bare UHS table cell), a truncated quote with no unit reaching
// display (Encompass's "$107.7"), and adjacency mis-binding generalized
// beyond the two triggers Session 12 had keyword-gated. ---
{
  const uhs = fixture.companies.find((c) => c.ticker === "UHS");
  if (!uhs) throw new Error("fixture missing UHS");
  const uhsFacts = buildVerifiedFactBase(uhs);
  const uhsDebtMaturity = uhsFacts.find((f) => f.linkedTriggerId === "debt-maturity");

  // 10a/10b. Fix 1: UHS's bare "$ 771,910" table cell (no scale word, no
  // sentence structure) must produce "no figure disclosed" in the SUMMARY
  // path (figures[]) AND must not be visible for the CARD path to guess a
  // scale for either (normalizedText) — the exact defect: card guessed
  // "$771.9 million," summary read the same bare number as "$771.91
  // thousand."
  assert(
    !!uhsDebtMaturity && uhsDebtMaturity.figures.length === 0,
    `[10a] UHS's bare $771,910 table cell produces "no figure disclosed" in the portfolio-summary path (figures: ${JSON.stringify(uhsDebtMaturity?.figures)})`
  );
  assert(
    !!uhsDebtMaturity && !/771,?910/.test(uhsDebtMaturity.normalizedText) && uhsDebtMaturity.normalizedText.includes("undisclosed"),
    `[10b] UHS's bare $771,910 is also redacted from the CARD-narration text — Sonnet cannot see it to guess a scale either (normalizedText: ${JSON.stringify(uhsDebtMaturity?.normalizedText)})`
  );
  // 10c. The two paths never disagree: whenever the summary drops a
  // figure to "no figure disclosed," the card path's own text has no
  // stray raw figure left for Sonnet to state instead.
  assert(
    !!uhsDebtMaturity && uhsDebtMaturity.figures.length === 0 && uhsDebtMaturity.normalizedText.includes("undisclosed"),
    "[10c] card and summary paths agree — both are gated by the identical tokenHasDeterminableScale rule for this fact"
  );

  // 10d. Fix 2: Encompass's truncated quote ("Cash and cash equivalents $
  // 107.7" — Haiku's own quote cut off right before "million," despite its
  // evidence field having it) must be dropped, not shown as a bare,
  // unitless "$107.7". This is a Part A/extraction defect (logged as an
  // open issue, NOT fixed here) — Fix 2 is the display-side backstop.
  const ehc = fixture.companies.find((c) => c.ticker === "EHC");
  if (!ehc) throw new Error("fixture missing EHC");
  const ehcFacts = buildVerifiedFactBase(ehc);
  const ehcCash = ehcFacts.find((f) => f.linkedTriggerId === "large-cash-balance");
  assert(
    !!ehcCash && ehcCash.figures.length === 0 && !/\$\s*107\.7\b/.test(ehcCash.normalizedText),
    `[10d] Encompass's truncated "$107.7" (no unit) is dropped from both paths, not displayed bare (figures: ${JSON.stringify(ehcCash?.figures)}, normalizedText: ${JSON.stringify(ehcCash?.normalizedText)})`
  );

  // 10e. Fix 1, part 2: the number-guard itself must reject a card that
  // states a SCALE-GUESSED figure ("$771.9 million") against a source
  // quote that only has the bare, unresolved "$ 771,910" — the old
  // tolerant x1/x1000/x1,000,000 matching let exactly this kind of guess
  // pass audit.
  {
    const guessedCard = "UHS has $771.9 million of debt maturing soon.";
    const bareQuote = "Current maturities of long-term debt $ 771,910";
    const result = checkNumbersAgainstQuotes(guessedCard, [bareQuote]);
    assert(
      !result.ok && result.unverifiedTokens.some((t) => /771\.9/.test(t)),
      `[10e] numberGuard rejects a scale-guessed "$771.9 million" against a bare, unresolved "$ 771,910" source (result: ${JSON.stringify(result)})`
    );
  }
  // 10e2. Positive control: the SAME figure at the SAME (already-resolved)
  // scale still passes — this isn't a blanket rejection of large numbers,
  // only of a scale that was never actually verified.
  {
    const correctCard = "The company holds $1.5 billion in new debt.";
    const scaledQuote = "issued $1.5 billion aggregate principal amount of senior notes.";
    const result = checkNumbersAgainstQuotes(correctCard, [scaledQuote]);
    assert(result.ok, `[10e2] numberGuard still accepts a figure that matches the source at its own stated scale (result: ${JSON.stringify(result)})`);
  }

  // 10f. Disclosed, accepted tradeoff of generalizing the adjacency guard
  // to every trigger (not a per-trigger keyword allowlist): Concentra's
  // floating-rate-debt fact was previously correctly reading "$938.13
  // million" (its first candidate happened to be right), but its source
  // text has no sentence structure and multiple scale-worded candidates —
  // under the universal rule it now loses that figure too. Documented
  // here, not silently lost.
  const con = fixture.companies.find((c) => c.ticker === "CON");
  if (!con) throw new Error("fixture missing CON");
  const conFacts = buildVerifiedFactBase(con);
  const conFloating = conFacts.find((f) => f.linkedTriggerId === "floating-rate-debt");
  assert(
    !!conFloating && conFloating.figures.length === 0,
    `[10f] KNOWN TRADEOFF: Concentra's floating-rate-debt figure ($938.13 million, previously correct) is now also dropped — non-sentence source with multiple scale-worded candidates, no reliable attribution without a keyword allowlist (figures: ${JSON.stringify(conFloating?.figures)})`
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 12/13 NARRATION-INTEGRITY GOLDEN TESTS PASSED");
}
