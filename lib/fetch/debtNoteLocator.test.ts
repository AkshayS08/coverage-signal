/**
 * Session 18 — lib/fetch/debtNoteLocator.ts, offline/synthetic where noted,
 * plus real-shape fixtures modeled on the actual coupon-row text captured
 * during zero-LLM-cost diagnosis against real SEC filings for all 10
 * companies (see diag_locator.ts, diag_misses.ts — throwaway, not
 * committed). 26/30 real filings hit; the other 4 (HCA/CHS Q1-2026 10-Qs,
 * both Cigna 10-Qs) were confirmed genuine absences, not locator bugs —
 * modeled here as [8]/[9].
 *
 * Run: npx tsx lib/fetch/debtNoteLocator.test.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  locateDebtNoteSection,
  buildExtractionText,
  assertCompanyHasLocatableDebtNote,
  DebtNoteNotFoundError,
  findDebtNoteHeading,
  type DebtNoteFilingStatus,
} from "./debtNoteLocator";
import { getRecentFilings } from "./filings";
import { getFilingText } from "./filingText";
import { selectBaselineFilings } from "../agent/selectFilings";

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

// Modeled on Centene's real 10-Q sourceLine shapes (rate% + instrument + due YYYY + bare number, no spaces around %).
const REAL_SHAPE_SCHEDULE = Array.from({ length: 8 }, (_, i) => {
  const rate = (4.25 + i * 0.25).toFixed(3);
  const year = 2027 + i;
  return `${rate}% Senior Secured First Lien Notes due ${year} ${1000 + i * 100}`;
}).join(" ");

const LEAD_FILLER = "Item 1. Financial Statements. ".repeat(3000); // >40k chars of unrelated lead text
const FULL_DOC_WITH_SCHEDULE = `${LEAD_FILLER}\n\nLong-Term Debt\n${REAL_SHAPE_SCHEDULE}\n\nTotal long-term debt.`;

// [1] Dense real-shaped cluster is found.
{
  const loc = locateDebtNoteSection(FULL_DOC_WITH_SCHEDULE);
  assert(loc.status === "found", "[1] dense coupon-near-year cluster is located");
  if (loc.status === "found") {
    assert(loc.matchCount >= 8, `[1] match count reflects all 8 rows (got ${loc.matchCount})`);
    assert(
      FULL_DOC_WITH_SCHEDULE.slice(loc.start, loc.end).includes("Senior Secured First Lien Notes"),
      "[1] located span actually contains the schedule text"
    );
  }
}

// [2] A document with no coupon-shaped content anywhere returns not_found — never a guessed fallback.
{
  const noSchedule = LEAD_FILLER + "\n\nNo debt disclosures in this excerpt at all.";
  const loc = locateDebtNoteSection(noSchedule);
  assert(loc.status === "not_found", "[2] no coupon content anywhere -> not_found");
}

// [3] A single isolated coupon mention (below MIN_CLUSTER_SIZE) does not count as a schedule — matches the real HCA-Q1/Cigna-Q1 miss shape: a couple of scattered mentions, never forming a table.
{
  const isolated = `${LEAD_FILLER}\n\nOn June 1, 2030, the Company repaid $550 million 1.250% senior notes that matured. Long-term debt 29,086.`;
  const loc = locateDebtNoteSection(isolated);
  assert(loc.status === "not_found", "[3] isolated narrative coupon mention (no cluster) -> not_found, matches real Cigna-10-Q miss shape");
}

// [4] Two clusters in one document -> the larger one wins (primary debt note over a smaller secondary schedule, e.g. an interest-rate-swap notional table).
{
  const smallCluster = Array.from({ length: 3 }, (_, i) => `${(2 + i).toFixed(3)}% swap notional due ${2030 + i} ${500 + i}`).join(" ");
  const bigDoc = `${LEAD_FILLER}\n\nInterest Rate Swaps\n${smallCluster}\n\n${"x ".repeat(5000)}\n\nLong-Term Debt\n${REAL_SHAPE_SCHEDULE}`;
  const loc = locateDebtNoteSection(bigDoc);
  assert(loc.status === "found", "[4] two clusters present -> still found");
  if (loc.status === "found") {
    assert(loc.matchCount >= 8, `[4] the LARGER cluster (8 rows) wins over the smaller one (3 rows), got ${loc.matchCount}`);
  }
}

// [5] buildExtractionText: an 8-K (short, under cap) is returned unchanged with status under_cap.
{
  const shortEightK = "On May 23, 2025, the Company priced $1.0 billion of 4.750% notes due 2030.";
  const result = buildExtractionText({ form: "8-K", url: "https://example.com/8k", fullText: shortEightK });
  assert(result.text === shortEightK, "[5] short 8-K passed through unchanged");
  assert(result.debtNoteStatus === "under_cap", "[5] short doc status is under_cap");
}

// [6] buildExtractionText: an over-cap 8-K (rare, but possible) is lead-truncated with status not_applicable — the locator never runs on non-10-Q/10-K forms.
{
  const longEightK = LEAD_FILLER + REAL_SHAPE_SCHEDULE;
  const result = buildExtractionText({ form: "8-K", url: "https://example.com/8k-long", fullText: longEightK });
  assert(result.debtNoteStatus === "not_applicable", "[6] over-cap 8-K -> not_applicable, locator skipped entirely");
  assert(result.text.length <= 40000, "[6] over-cap 8-K still bounded to the lead cap");
}

// [7] buildExtractionText: an over-cap 10-Q with a locatable note splices in the excerpt, delimited, without duplicating text already inside the lead window.
{
  const result = buildExtractionText({ form: "10-Q", url: "https://example.com/10q", fullText: FULL_DOC_WITH_SCHEDULE });
  assert(result.debtNoteStatus === "found", "[7] over-cap 10-Q with real schedule -> found");
  assert(result.text.includes("Senior Secured First Lien Notes"), "[7] spliced excerpt actually contains the schedule");
  assert(result.text.length < FULL_DOC_WITH_SCHEDULE.length, "[7] output is bounded, not the whole document");
}

// [8] buildExtractionText: an over-cap 10-Q with NO locatable note falls back to lead-only, status not_found — never throws per-filing (the HCA-Q1/CHS-Q1/Cigna-Q1&Q2 real shape: genuinely no schedule in THIS filing, schedule lives in the 10-K instead). Mentions are WIDELY SCATTERED (thousands of chars apart, matching the real diagnostic gaps of 1344-69889 chars) — never densely repeated, which is what actually distinguishes a real isolated mention from a table.
{
  const filler2000 = "Item 1. Financial Statements. ".repeat(65); // ~2000 chars of unrelated text between mentions
  const isolatedLong =
    LEAD_FILLER +
    "On June 1, 2030, the Company repaid $550 million 1.250% senior notes that matured in March 2026. " +
    filler2000 +
    "The effective interest rate was 3.24% as of June 30, 2026. " +
    filler2000.repeat(10) +
    "Long-term debt 29,086 as of the period end.";
  const result = buildExtractionText({ form: "10-Q", url: "https://example.com/10q-thin", fullText: isolatedLong });
  assert(result.debtNoteStatus === "not_found", "[8] over-cap 10-Q genuinely lacking a schedule -> not_found, not a throw");
  assert(result.text.length <= 40000, "[8] falls back to lead-only text, not empty/crashed");
}

// [9] assertCompanyHasLocatableDebtNote: company-level pass — debt-maturity fired, but only ONE of two filings had a locatable cluster (the real HCA/CHS/Cigna shape: Q1 10-Q missed, 10-K found) -> no throw.
{
  let threw = false;
  try {
    assertCompanyHasLocatableDebtNote("HCA Healthcare (synthetic)", true, [
      { form: "10-Q", url: "https://example.com/q1", status: "not_found" },
      { form: "10-K", url: "https://example.com/10k", status: "found" },
    ]);
  } catch {
    threw = true;
  }
  assert(!threw, "[9] one filing missed, one found, debt-maturity fired -> no throw (per-company scope, not per-filing)");
}

// [10] assertCompanyHasLocatableDebtNote: company-level failure — debt-maturity fired but NONE of the fetched filings had a locatable cluster anywhere -> throws DebtNoteNotFoundError.
{
  let threw = false;
  let err: unknown;
  try {
    assertCompanyHasLocatableDebtNote("Synthetic Corp", true, [
      { form: "10-Q", url: "https://example.com/q1", status: "not_found" },
      { form: "10-Q", url: "https://example.com/q2", status: "not_found" },
      { form: "10-K", url: "https://example.com/10k", status: "not_found" },
    ]);
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, "[10] debt-maturity fired, zero filings located anywhere -> throws");
  assert(err instanceof DebtNoteNotFoundError, "[10] throws the distinct DebtNoteNotFoundError type");
}

// [11] assertCompanyHasLocatableDebtNote: debt-maturity did NOT fire -> no check performed regardless of filing statuses (nothing was asserted, nothing to verify).
{
  let threw = false;
  try {
    assertCompanyHasLocatableDebtNote("Synthetic Corp", false, [{ form: "10-Q", url: "https://example.com/q1", status: "not_found" }]);
  } catch {
    threw = true;
  }
  assert(!threw, "[11] debt-maturity not fired -> no check, no throw");
}

// [12] under-cap 10-Q/10-K (real doc, but short enough to fit) never invokes the locator at all -- status under_cap, not found/not_found.
{
  const shortTenQ = "Long-Term Debt\n" + REAL_SHAPE_SCHEDULE;
  const result = buildExtractionText({ form: "10-Q", url: "https://example.com/short-10q", fullText: shortTenQ });
  assert(result.debtNoteStatus === "under_cap", "[12] short 10-Q under the lead cap never needs windowing");
  assert(result.text === shortTenQ, "[12] returned unchanged");
}

// ============================================================================
// [13] PINNED CLUSTER CHOICE — all 10 companies, against their REAL base
// filings.
//
// This is the safety net that makes shipping a one-proxy selection rule
// defensible. locateDebtNoteSection now picks by MAGNITUDE rather than
// cluster density (see its doc comment), and that rule's correctness was
// established against ONE snapshot of base filings — every company's base is
// currently a 10-Q. The rule was previously rejected on a snapshot where
// HCA's base was a 10-K containing a stray "250,000,000", so a future filing
// can genuinely flip the answer.
//
// These pins make that flip LOUD. Each company asserts the exact offset the
// rule selects today, so a new filing that changes which table gets extracted
// fails here instead of silently changing what the model is handed.
//
// IF ONE OF THESE FAILS, DO NOT RETUNE THE PIN TO MATCH. A failure means
// either a new filing became the base (re-measure and re-pin deliberately,
// checking the newly-selected span really is the debt-balance table) or the
// selection rule regressed. Both need a human decision, which is the entire
// point of pinning.
//
// Costs nothing: reads only the SEC filing-text/filing-list caches. Makes
// zero model calls. It does need filing access, so it is a hard dependency
// rather than a skip — a pin that quietly skips protects nothing.
async function checkPins() {
  const PINS: { company: string; form: string; start: number; end: number; matchCount: number; note: string }[] = [
    { company: "DaVita", form: "10-Q", start: 26811, end: 30152, matchCount: 10, note: "CORRECTED by magnitude: density picked the interest-rate-cap table at 31261" },
    { company: "HCA Healthcare", form: "10-Q", start: 33278, end: 34496, matchCount: 5, note: "unchanged by magnitude" },
    { company: "Tenet Healthcare", form: "10-Q", start: 32959, end: 34115, matchCount: 10, note: "unchanged by magnitude" },
    { company: "Universal Health Services", form: "10-Q", start: 279162, end: 282193, matchCount: 9, note: "KNOWN MISS: interest-expense table wins on magnitude too" },
    { company: "Encompass Health", form: "10-Q", start: 40145, end: 41081, matchCount: 4, note: "unchanged by magnitude" },
    { company: "Community Health Systems", form: "10-Q", start: 49227, end: 51119, matchCount: 5, note: "CORRECTED by magnitude: density picked ABL prose at 129587 (no grouped figure at all)" },
    { company: "Quest Diagnostics", form: "10-Q", start: 39325, end: 41175, matchCount: 13, note: "unchanged by magnitude" },
    { company: "Centene Corporation", form: "10-Q", start: 52513, end: 53756, matchCount: 7, note: "unchanged by magnitude" },
    { company: "Cigna Group", form: "10-K", start: 318130, end: 322218, matchCount: 37, note: "KNOWN MISS: anti-dilutive EPS table wins on magnitude too" },
    { company: "Molina Healthcare", form: "10-Q", start: 28306, end: 29350, matchCount: 5, note: "unchanged by magnitude" },
  ];

  const USABLE = new Set<DebtNoteFilingStatus>(["found", "under_cap"]);

  for (const pin of PINS) {
    // Same call loop.ts makes — company name, all three forms.
    const filings = await getRecentFilings(pin.company, ["8-K", "10-Q", "10-K"]);
    // Reproduces loop.ts's own base-filing rule exactly: newest-first among
    // the 10-Q/10-K filings whose debt note is actually reachable.
    const reachable: { form: string; filingDate: string; url: string }[] = [];
    for (const filing of selectBaselineFilings(filings.filings)) {
      if (filing.form !== "10-Q" && filing.form !== "10-K") continue;
      const { text } = await getFilingText(filing.primaryDocUrl);
      const status = buildExtractionText({ form: filing.form, url: filing.primaryDocUrl, fullText: text }).debtNoteStatus;
      if (USABLE.has(status)) reachable.push({ form: filing.form, filingDate: filing.filingDate, url: filing.primaryDocUrl });
    }
    reachable.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const base = reachable[0];
    if (!base) {
      assert(false, `[13] ${pin.company}: no base filing with a reachable debt note — the pin cannot be checked`);
      continue;
    }
    assert(base.form === pin.form, `[13] ${pin.company}: base filing is still a ${pin.form} (got ${base.form} — a new filing changed the base; re-measure, do not retune)`);

    const { text } = await getFilingText(base.url);
    const loc = locateDebtNoteSection(text);
    if (loc.status !== "found") {
      assert(false, `[13] ${pin.company}: locator returned ${loc.status} on its own base filing`);
      continue;
    }
    assert(
      loc.start === pin.start && loc.end === pin.end && loc.matchCount === pin.matchCount,
      `[13] ${pin.company}: cluster choice pinned at start=${pin.start} end=${pin.end} matches=${pin.matchCount} ` +
        `(got start=${loc.start} end=${loc.end} matches=${loc.matchCount}) — ${pin.note}`
    );
  }
}


// ============================================================================
// [14] DEBT-NOTE HEADING ASSERTION — pinned per company, DERIVED FROM A RUN.
//
// A debt schedule lives under a titled, numbered note. This asserts the
// located span contains one, which is an INDEPENDENT check on the locator:
// coupon density can land on an interest-expense or fair-value table that
// shares the rate-near-year signature, and neither sits under a "N. Debt"
// heading.
//
// The two FAILs below are not gaps in the rule — they are the rule working.
// UHS's 10-Q span is its interest-expense-by-instrument table and Molina's is
// its fair-value disclosure; both were confirmed wrong independently, by
// reading the filings. UHS is already handled (the search-order fallback
// moves it to the 10-K, which does carry a real note). Molina is NOT handled
// and reconciles only because its real note at char 37,661 falls inside the
// 40k lead window the model always receives — so this assertion is currently
// the only thing that would notice if that ever stopped being true.
//
// Values are emitted by the assertion itself, never hand-written, so a pin
// can never encode what someone wished were true.
// ============================================================================
async function checkHeadingPins() {
  const PINS: { company: string; form: string; hasHeading: boolean; heading: string | null }[] = [
    { company: "DaVita", form: "10-Q", hasHeading: true, heading: "6. Long-term debt" },
    { company: "HCA Healthcare", form: "10-Q", hasHeading: true, heading: "3) Debt" },
    { company: "Tenet Healthcare", form: "10-Q", hasHeading: true, heading: "NOTE 5. LONG-TERM DEBT" },
    { company: "Universal Health Services", form: "10-Q", hasHeading: false, heading: null },
    { company: "Encompass Health", form: "10-Q", hasHeading: true, heading: "4. Long-term Debt" },
    { company: "Community Health Systems", form: "10-Q", hasHeading: true, heading: "6. LONG-TERM DEBT" },
    { company: "Quest Diagnostics", form: "10-Q", hasHeading: true, heading: "7. DEBT" },
    { company: "Centene Corporation", form: "10-Q", hasHeading: true, heading: "8. Debt" },
    { company: "Cigna Group", form: "10-K", hasHeading: true, heading: "Note 7 – Debt" },
    { company: "Molina Healthcare", form: "10-Q", hasHeading: false, heading: null },
  ];
  const USABLE2 = new Set<DebtNoteFilingStatus>(["found", "under_cap"]);
  for (const pin of PINS) {
    const filings = await getRecentFilings(pin.company, ["8-K", "10-Q", "10-K"]);
    const reachable: { form: string; filingDate: string; url: string }[] = [];
    for (const f of selectBaselineFilings(filings.filings)) {
      if (f.form !== "10-Q" && f.form !== "10-K") continue;
      const { text } = await getFilingText(f.primaryDocUrl);
      if (USABLE2.has(buildExtractionText({ form: f.form, url: f.primaryDocUrl, fullText: text }).debtNoteStatus))
        reachable.push({ form: f.form, filingDate: f.filingDate, url: f.primaryDocUrl });
    }
    reachable.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const base = reachable[0];
    if (!base) { assert(false, `[14] ${pin.company}: no base filing, pin uncheckable`); continue; }
    const { text } = await getFilingText(base.url);
    const loc = locateDebtNoteSection(text);
    const h = loc.status === "found" ? findDebtNoteHeading(text, loc.start, loc.end) : null;
    assert(
      !!h === pin.hasHeading && (h?.text ?? null) === pin.heading,
      `[14] ${pin.company} (${base.form}): heading pinned as ${JSON.stringify(pin.heading)} (got ${JSON.stringify(h?.text ?? null)})`
    );
  }
}

checkPins()
  .then(checkHeadingPins)
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error(`\nFailed: ${failures.join(", ")}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    // A pin that cannot be checked is a FAILURE, never a skip — the whole
    // point is that a filing change cannot pass silently.
    console.error(`\n[13] PINNED CLUSTER CHOICE could not be verified: ${err instanceof Error ? err.message : String(err)}`);
    console.error("These pins need SEC filing access (cached, no model calls). Not skippable.");
    process.exit(1);
  });
