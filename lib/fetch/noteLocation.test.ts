/**
 * Session 18 — lib/fetch/noteLocation.ts, offline/synthetic where noted,
 * plus real-shape fixtures modeled on the actual coupon-row text captured
 * during zero-LLM-cost diagnosis against real SEC filings for all 10
 * companies (see diag_locator.ts, diag_misses.ts — throwaway, not
 * committed). 26/30 real filings hit; the other 4 (HCA/CHS Q1-2026 10-Qs,
 * both Cigna 10-Qs) were confirmed genuine absences, not locator bugs —
 * modeled here as [8]/[9].
 *
 * Run: npx tsx lib/fetch/noteLocation.test.ts
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
} from "./noteLocation";
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
// [13] PINNED SPAN CHOICE — all 10 companies, against their REAL base
// filings.
//
// This is the safety net that makes shipping a selection rule defensible.
// locateDebtNoteSection now selects HEADING-FIRST (B2): the block under a
// numbered debt-note heading that actually has a table attached beneath it,
// with coupon density plus magnitude used only where no such heading exists.
// `via` is pinned alongside the offsets, so a company silently dropping from
// the heading path to the density fallback fails here rather than quietly
// changing what the model is handed.
//
// Nine of the ten now resolve via their own heading. Universal Health
// Services is pinned as "density" because its 10-Q genuinely carries no
// numbered debt-note heading at all — its schedule lives only in the 10-K,
// which the search-order rule reaches. That is a real property of the filing,
// not a gap in the rule.
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
  // SESSION 20, STAGE 4 — EVERY `end` RE-PINNED, AND ONE `start`.
  //
  // Not a relaxation. locateDebtNoteSection now expands whatever span it
  // selects to the bounds of the NOTE that span sits in (expandToNoteBounds),
  // because a note states half its instruments in sentences either side of
  // its table and no contiguity rule over coupon matches can ever reach
  // those. The pins moved in exactly one direction — every start is
  // unchanged except UHS's, and every end moved forward or stayed — which is
  // the evidence the rule is additive rather than a re-selection.
  //
  // Measured, before and after:
  //   Encompass    981 -> 4,298    Molina      941 -> 3,417
  //   Centene    1,328 -> 2,828    Tenet     1,294 -> 2,441
  //   DaVita     3,409 -> 7,510    CHS       2,863 -> 8,139
  //   Quest      3,119 -> 3,173    Cigna     4,090 -> 6,991
  //   HCA        2,090 -> 2,090  (its sibling heading sits INSIDE the span,
  //                               so there is nothing to reach and nothing
  //                               moves — the never-contract half of the
  //                               rule, exercised on real data)
  //   UHS        3,210 -> 13,398 (and its start moves back 3,544 characters
  //                               to its own heading, "(4) Treasury Credit
  //                               Facilities and Outstanding Debt
  //                               Securities" — the term loan A balance and
  //                               the drawn revolver live in that stretch,
  //                               and the $68 million of Trust liabilities
  //                               "included in debt" lives past the old end)
  const PINS: { company: string; form: string; via: "heading" | "density" | "content" | "not_found"; start: number; end: number; matchCount: number }[] = [
    { company: "DaVita", form: "10-Q", via: "heading", start: 26757, end: 34267, matchCount: 10 },
    { company: "HCA Healthcare", form: "10-Q", via: "heading", start: 32472, end: 34562, matchCount: 5 },
    { company: "Tenet Healthcare", form: "10-Q", via: "heading", start: 33013, end: 35454, matchCount: 10 },
    // SESSION 20, STAGE 2 — RE-PINNED DELIBERATELY, NOT RELAXED.
    //
    // Was via=density start=279162 end=282193 matches=9: the INTEREST-EXPENSE
    // table, which clusters denser than the real disclosure (9 matches to 6)
    // and also wins on magnitude, so neither prior signal could reject it.
    // It is the span that produced five interest rows as a debt ladder in
    // v18 and cost UHS a whole session.
    //
    // Now via=content start=44363 end=47573: the "Treasury / Credit
    // Facilities and Outstanding Debt Securities" note, holding the bulleted
    // list of all five senior secured notes ($700M 1.65% 2026, $500M 4.625%
    // 2029, $800M 2.65% 2030, $500M 2.65% 2032, $500M 5.050% 2034 — summing
    // to the $3.0 billion aggregate the same passage states) plus the term
    // loan A and revolver prose.
    //
    // The change is one company's. Every other pin in this table is
    // unchanged, which is the evidence that content DISQUALIFIES rather than
    // re-ranks: nine spans are undecided or unaffected and magnitude still
    // chooses among them exactly as before.
    { company: "Universal Health Services", form: "10-Q", via: "content", start: 40819, end: 54217, matchCount: 6 },
    { company: "Encompass Health", form: "10-Q", via: "heading", start: 40129, end: 44427, matchCount: 4 },
    { company: "Community Health Systems", form: "10-Q", via: "heading", start: 48294, end: 56433, matchCount: 13 },
    { company: "Quest Diagnostics", form: "10-Q", via: "heading", start: 39415, end: 42588, matchCount: 13 },
    { company: "Centene Corporation", form: "10-Q", via: "heading", start: 52644, end: 55472, matchCount: 7 },
    // SESSION 20, STAGE 4 — Cigna is pinned as NOT LOCATABLE, on purpose.
    //
    // Its anchor is now its most recent 10-Q (the anchor is the most recent
    // 10-Q/10-K, full stop), and that filing's "Note 6 - Debt" is four
    // narrative paragraphs ending "see Note 7 to the Consolidated Financial
    // Statements in the Company's 2025 Form 10-K." There is no ladder in it,
    // and this pin records that there is none rather than reaching for the
    // 10-K's. Until Stage 4 the base rule walked back to that 10-K and
    // rendered its December 31 2025 ladder beside a June 30 2026 balance
    // sheet, 38 rows deep and eight months stale.
    { company: "Cigna Group", form: "10-Q", via: "not_found", start: -1, end: -1, matchCount: -1 },
    { company: "Molina Healthcare", form: "10-Q", via: "heading", start: 37461, end: 40878, matchCount: 5 },
  ];

  for (const pin of PINS) {
    // Same call loop.ts makes — company name, all three forms.
    const filings = await getRecentFilings(pin.company, ["8-K", "10-Q", "10-K"]);
    // Reproduces loop.ts's own anchor rule exactly, INCLUDING the part that
    // changed in Stage 4: the anchor is the most recent 10-Q/10-K, and the
    // locator's opinion of it is not allowed to choose a different quarter.
    // The old version of this loop filtered to filings whose note was
    // reachable and then took the newest of those, which is the fallback
    // this session removed — a test reproducing a rule the code no longer
    // has protects nothing.
    const periodic = selectBaselineFilings(filings.filings)
      .filter((f) => f.form === "10-Q" || f.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const base = periodic[0];
    if (!base) {
      assert(false, `[13] ${pin.company}: no 10-Q or 10-K in the corpus — the pin cannot be checked`);
      continue;
    }
    assert(base.form === pin.form, `[13] ${pin.company}: anchor is still a ${pin.form} (got ${base.form} — a new filing changed the anchor; re-measure, do not retune)`);

    const { text } = await getFilingText(base.primaryDocUrl);
    const loc = locateDebtNoteSection(text);
    if (pin.via === "not_found") {
      assert(loc.status === "not_found",
        `[13] ${pin.company}: its anchor ${pin.form} is pinned as carrying NO locatable debt note — a narrative note that cross-references the 10-K is not a ladder (got ${loc.status})`);
      continue;
    }
    if (loc.status !== "found") {
      assert(false, `[13] ${pin.company}: locator returned ${loc.status} on its own anchor filing`);
      continue;
    }
    assert(
      loc.via === pin.via && loc.start === pin.start && loc.end === pin.end && loc.matchCount === pin.matchCount,
      `[13] ${pin.company}: span pinned at via=${pin.via} start=${pin.start} end=${pin.end} matches=${pin.matchCount} ` +
        `(got via=${loc.via} start=${loc.start} end=${loc.end} matches=${loc.matchCount})`
    );
  }
}


// ============================================================================
// [14] DEBT-NOTE HEADING — pinned per company, DERIVED FROM A RUN.
//
// Under heading-first selection this is no longer only an audit of a span
// density chose; it is a record of which heading each company's span is
// anchored to, so a change of anchor is visible.
//
// Molina flipped from null to "7. Debt" with B2, and that flip retired a
// logged limitation rather than papering over one: magnitude tie-breaking
// used to prefer Molina's FAIR-VALUE disclosure (largest figure 3,951) over
// its carrying-amount schedule (3,769), and the company reconciled only
// because its real note happened to fall inside the 40k lead window every
// filing gets regardless of the locator. The heading now selects the real
// note directly, in the 10-Q and the 10-K alike.
//
// UHS flipped from null to "4) Treasury Credit Facilities and Outstanding
// Debt" in Stage 4. It was never true that its 10-Q carried no numbered
// debt-note heading — the heading pattern required the title to END in
// "debt" within four leading words, and UHS's title has "Debt" fifth of six.
// That one-word bound was the reason UHS alone had an unanchored span, and
// the reason its note was handed to the model in thirds. See [13].
//
// Values are emitted by the assertion itself, never hand-written, so a pin
// can never encode what someone wished were true.
// ============================================================================
async function checkHeadingPins() {
  const PINS: { company: string; form: string; hasHeading: boolean; heading: string | null }[] = [
    { company: "DaVita", form: "10-Q", hasHeading: true, heading: "6. Long-term debt" },
    { company: "HCA Healthcare", form: "10-Q", hasHeading: true, heading: "3) Debt" },
    { company: "Tenet Healthcare", form: "10-Q", hasHeading: true, heading: "NOTE 5. LONG-TERM DEBT" },
    { company: "Universal Health Services", form: "10-Q", hasHeading: true, heading: "4) Treasury Credit Facilities and Outstanding Debt" },
    { company: "Encompass Health", form: "10-Q", hasHeading: true, heading: "4. Long-term Debt" },
    { company: "Community Health Systems", form: "10-Q", hasHeading: true, heading: "6. LONG-TERM DEBT" },
    { company: "Quest Diagnostics", form: "10-Q", hasHeading: true, heading: "7. DEBT" },
    { company: "Centene Corporation", form: "10-Q", hasHeading: true, heading: "8. Debt" },
    // [14] audits heading DETECTION per filing, so Cigna is still checked
    // against the 10-K that has a heading to detect. Note that this is no
    // longer the filing Cigna anchors on — see [13], where its anchor 10-Q
    // is pinned as carrying no locatable note at all.
    { company: "Cigna Group", form: "10-K", hasHeading: true, heading: "Note 7 – Debt" },
    { company: "Molina Healthcare", form: "10-Q", hasHeading: true, heading: "7. Debt" },
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
