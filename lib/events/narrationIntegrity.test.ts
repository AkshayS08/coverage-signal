/**
 * Session 12 Parts B/C golden tests — narration integrity (loud failure,
 * scrape-shaped-text rejection) and the portfolio-summary constraint
 * checker. Runs entirely OFFLINE: no Anthropic/EDGAR calls, using the same
 * cached fixture (__fixtures__/session11-facts.json) as eligibility.test.ts
 * for the two tests that need a real FlashCard to override (spread
 * pattern, matching that file's own convention — real citations/evidence,
 * only the field under test pinned). Everything else here is a pure
 * function test with no live data dependency at all.
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

// --- 1. Scrape-shaped-text rejection (Part C.2) — the exact Concentra
// Session 10 string must be rejected. Every figure in it is real, so
// numberGuard alone would pass it; this is a different, shape-based check.
{
  const concentra = ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million";
  assert(isScrapeShapedText(concentra), "[1a] exact Concentra scrape-shaped string is rejected");
}

// --- 2. Positive controls — genuine prose with 2+ numbers and a verb must
// NOT be rejected, or the guard would be too aggressive to ship. ---
{
  const genuine1 = "Cash rose from $80 million to $158 million during the quarter.";
  const genuine2 = "DaVita's Term Loan A-2, $1.9875 billion, matures November 24, 2030, the next tranche to clear.";
  const genuine3 = "Per its 10-Q filed 2026-05-05: the company repaid $500 million of its 2026 notes.";
  assert(!isScrapeShapedText(genuine1), "[2a] genuine 2-figure sentence with a verb is NOT rejected");
  assert(!isScrapeShapedText(genuine2), "[2b] genuine narration sentence is NOT rejected");
  assert(!isScrapeShapedText(genuine3), "[2c] template-style sentence with 'filed'/'repaid' verbs is NOT rejected");
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
    text: `- [FX / rate hedging] FX hedging — STANDING (not actionable this week) — timing (use verbatim, never recompute): "standing" — figures: none — dates: none`,
    bucket: "hedging",
    actionable: false,
    timingPhrase: "standing",
  };
  const refiThisWeek: FactLine = {
    text: `- [Refi (debt maturity)] refi window — THIS WEEK (actionable now) — timing (use verbatim, never recompute): "matures 2026" — figures: $1.65 billion — dates: none`,
    bucket: "refi",
    actionable: true,
    timingPhrase: "matures 2026",
  };
  const refiStandingMonths: FactLine = {
    text: `- [Refi (debt maturity)] refi window — STANDING (not actionable this week) — timing (use verbatim, never recompute): "~9mo out" — figures: $500 million — dates: none`,
    bucket: "refi",
    actionable: false,
    timingPhrase: "~9mo out",
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
  // 6c. Gate contradiction: nothing actionable, but prose says "call now" -> violation.
  {
    const r = checkSummaryConstraints("You should call now — there is a standing hedging opportunity worth flagging.", [hedgingStanding]);
    assert(!r.ok && r.reasons.some((x) => x.includes("gate")), "[6c] urgency language with nothing THIS WEEK is caught");
  }
  // 6d. Gate contradiction: nothing actionable, prose correctly says so -> passes that check.
  {
    const r = checkSummaryConstraints("Nothing is actionable this week. A standing hedging opportunity is worth raising when the relationship allows.", [hedgingStanding]);
    assert(!r.reasons.some((x) => x.includes("gate")), "[6d] correctly saying nothing is actionable clears constraint 2");
  }
  // 6e. Fabricated figure: a dollar amount not present in any fact line -> violation.
  {
    const r = checkSummaryConstraints("The refi window matures 2026, backed by $1.65 billion, on top of a separate $9.99 billion facility.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("unverified")), "[6e] a figure absent from the fact set is caught by the number guard");
  }
  // 6f. Date-granularity violation: a year-granularity fact described with a computed relative month count not among the given phrases -> violation.
  {
    const r = checkSummaryConstraints("The refi window is only ~5mo out, backed by $1.65 billion.", [refiThisWeek]);
    assert(!r.ok && r.reasons.some((x) => x.includes("duration")), "[6f] a computed relative-month phrase not in the given timing phrases is caught");
  }
  // 6g. Date-granularity pass: a genuine month-based phrase we actually gave it is fine.
  {
    const r = checkSummaryConstraints("A separate facility is ~9mo out, backed by $500 million, with no other action needed this week.", [refiStandingMonths]);
    assert(!r.reasons.some((x) => x.includes("duration")), "[6g] a timing phrase copied verbatim from the fact set clears constraint 4");
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

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 12 PARTS B/C GOLDEN TESTS PASSED");
}
