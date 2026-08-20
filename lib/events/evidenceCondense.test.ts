/**
 * Session 15b Part A golden tests — the evidence condenser. Runs entirely
 * OFFLINE against the cached fixture (__fixtures__/session11-facts.json),
 * same convention as eligibility.test.ts/narrationIntegrity.test.ts: real
 * citations/evidence, only the field under test pinned when a synthetic
 * case is needed.
 *
 * These assertions exist because Step 0 of this session (a raw evidence
 * dump for both acceptance books, before any renderer code was written)
 * found three real bugs a plausible-looking first implementation had:
 * sentence-splitting on "Alan B. Miller"/"U.K." abbreviations, picking a
 * figure-less lead sentence over a later figure-bearing one (Cigna's
 * dividend line dropped its own $1.56 amount), and counting unrelated
 * "as of"/redemption dates as if they were additional debt tranches. Each
 * has a live regression test below.
 *
 * Run: npx tsx lib/events/evidenceCondense.test.ts (or npm test)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult } from "../agent";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { condenseDebtMaturity, condenseFirstSentence, condenseEvidenceDescription } from "./evidenceCondense";

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

function factFor(ticker: string, triggerId: string): VerifiedFact {
  const c = fixture.companies.find((c) => c.ticker === ticker);
  if (!c) throw new Error(`fixture missing ${ticker}`);
  const facts = buildVerifiedFactBase(c);
  const f = facts.find((f) => f.linkedTriggerId === triggerId);
  if (!f) throw new Error(`fixture missing ${ticker}/${triggerId} as a verified fact`);
  return f;
}

console.log(`=== Session 15b golden tests (evidence condenser) ===\n`);

// --- 1. Rule 1: debt-maturity selects the clause matching the trigger's
// OWN eventDate — never positional. Tenet's real evidence lists 10
// tranches in one string; the eligible one (Nov 2027, matching eventDate)
// is neither first-by-accident-only nor guessable without date-matching. ---
{
  const tenet = factFor("THC", "debt-maturity");
  const condensed = condenseDebtMaturity(tenet);
  assert(
    /November 2027/.test(condensed) && /\$1\.5 billion/.test(condensed),
    `[1a] Tenet debt-maturity picks the November 2027 / $1.5 billion clause matching eventDate=${tenet.eventDate} (condensed: ${JSON.stringify(condensed)})`
  );
  assert(!/June 2028|April 2029|June 2033/.test(condensed), `[1b] Tenet's condensed line does NOT lead with a different (non-matching) tranche`);
  assert(/\+9 more tranches? to 2033/.test(condensed), `[1c] Tenet's line correctly counts the other 9 due-dated tranches, max year 2033 (condensed: ${JSON.stringify(condensed)})`);
}

// --- 2. Rule 1's mandated no-guess fallback: when no evidence clause
// contains a date matching eventDate, render a date-only line — never the
// first clause, never a fabricated figure. SYNTHETIC: no real fact in the
// current book fails to find its own eventDate in evidence (that's what
// factGuard.ts already guarantees upstream), so this pins a controlled
// case with evidence text that deliberately omits the matching date. ---
{
  const real = factFor("UHS", "debt-maturity");
  const controlled: VerifiedFact = { ...real, evidence: "Some other unrelated tranche due March 2019 was mentioned.", eventDate: "2026", dateGranularity: "year" };
  const condensed = condenseDebtMaturity(controlled);
  assert(
    condensed === "notes due 2026",
    `[2] SYNTHETIC: no evidence clause matches eventDate -> date-only fallback, never the unrelated first clause (condensed: ${JSON.stringify(condensed)})`
  );
}

// --- 3. Rule 3 / generic condenser: prefers the first sentence containing
// a MONEY figure over an earlier figure-less scene-setter. Real bug found
// live during this session's own verification pass, on a company outside
// this fixture's 8-company book (Cigna's dividend-buyback evidence opens
// with "Quarterly cash dividends are being paid." — no figure — before
// the sentence stating "$1.56 per share."). SYNTHETIC here because this
// fixture's own book doesn't happen to reproduce that exact shape; pinned
// onto a real HCA fact (same figure-binding rules, only evidence text
// swapped) rather than hand-built from nothing. ---
{
  const real = factFor("HCA", "dividend-buyback");
  const controlled: VerifiedFact = {
    ...real,
    evidence: "Quarterly cash dividends are being paid. On July 22, 2026, the Board declared a dividend of $1.56 per share.",
  };
  const condensed = condenseFirstSentence(controlled);
  assert(/\$1\.56/.test(condensed), `[3] SYNTHETIC: a figure-less opening sentence is skipped in favor of the later sentence stating the actual figure (condensed: ${JSON.stringify(condensed)})`);
}

// --- 4. Rule 3: 2+ "as of <date>" periods -> keep only the MOST RECENT
// period's sentence. Real fixture case: DaVita's revolver states June 30
// utilization, then March 31, then a trend comment with neither. ---
{
  const davita = factFor("DVA", "revolver-near-capacity");
  const condensed = condenseFirstSentence(davita);
  assert(/June 30, 2026/.test(condensed) && /\$65 million/.test(condensed), `[4a] DaVita revolver keeps the June 30 (most recent) period (condensed: ${JSON.stringify(condensed)})`);
  assert(!/March 31, 2026/.test(condensed), `[4b] DaVita revolver drops the earlier March 31 period entirely — Rule 3, never render the comparison`);
}

// --- 5. Never a bare line: condenseEvidenceDescription always returns
// non-empty text, even for a fact with no evidence at all. ---
{
  const real = factFor("UHS", "capex-program");
  const noEvidence: VerifiedFact = { ...real, evidence: null };
  const condensed = condenseEvidenceDescription(noEvidence);
  assert(condensed.length > 0 && /no figure disclosed/.test(condensed), `[5] a fact with no evidence at all falls back to an honest, non-empty "no figure disclosed" line (condensed: ${JSON.stringify(condensed)})`);
}

// --- 6. Sentence-splitter abbreviation guard: "Alan B. Miller Medical
// Center" and "its U.K. operations" must not truncate mid-name. Real bugs
// found live in the FIRST implementation, both from UHS's real evidence. ---
{
  const capex = factFor("UHS", "capex-program");
  const condensed = condenseFirstSentence(capex);
  assert(!/^Alan B\.$/.test(condensed.trim()), `[6a] UHS capex-program does not truncate to "Alan B." (condensed: ${JSON.stringify(condensed)})`);

  const intl = factFor("UHS", "international-expansion");
  const condensedIntl = condenseFirstSentence(intl);
  assert(!/U\.K\.$/.test(condensedIntl.trim()), `[6b] UHS international-expansion does not truncate mid-"U.K." (condensed: ${JSON.stringify(condensedIntl)})`);
}

// --- 7 (Session 16 Fix B1): the matched clause must isolate the tranche
// itself, never a preceding line-item ("current portion of long-term debt
// was $10 million") that happens to share the same run-on sentence with no
// semicolon between them. SYNTHETIC: no fixture company has this exact
// comma-joined lead-in shape (real case found live on Quest Diagnostics,
// which isn't in this 8-company fixture); pinned onto a real UHS
// debt-maturity fact with evidence swapped for the real live Quest text. ---
{
  const real = factFor("UHS", "debt-maturity");
  const controlled: VerifiedFact = {
    ...real,
    evidence:
      "3.45% Senior Notes due June 2026 matured on June 1, 2026. As of June 30, 2026, the current portion of long-term debt was $10 million, with 4.60% Senior Notes due December 2027 ($400 million) and 4.20% Senior Notes due June 2029 ($500 million) approaching maturity within the next 12-18 months.",
    eventDate: "2027-12-01",
    dateGranularity: "month",
  };
  const condensed = condenseDebtMaturity(controlled);
  assert(
    /^4\.60% Senior Notes due December 2027 \(\$400 million\)/.test(condensed),
    `[7a] SYNTHETIC: Quest-shaped evidence isolates the December 2027 tranche, not the preceding "$10 million" current-portion figure (condensed: ${JSON.stringify(condensed)})`
  );
  assert(!/current portion|\$10 million/.test(condensed), `[7b] SYNTHETIC: the unrelated $10 million current-portion figure does not leak into the line`);
}

// --- 8 (Session 16 Fix B3, updated Session 17 Item 13): truncation must
// never leave a dangling conjunction/preposition right before the
// ellipsis, and the cap itself must not cut a real, single-sentence fact
// that's only barely over the OLD 260-char limit. DaVita's new-debt-
// issuance evidence is 261 chars — 1 over the old cap, comfortably under
// the new 400-char one (measured against every real condensed line across
// both fixture books; the longest found was 318 chars — see
// evidenceCondense.ts's MAX_LINE_CHARS comment). [8a]/[8b] now confirm the
// fix: DaVita's real line renders in FULL, including the $986 million
// net-proceeds figure the old 260-cap discarded. [8c]/[8d] preserve
// coverage of the truncation logic itself (still real, load-bearing code
// for a genuinely pathological case) via a SYNTHETIC evidence string well
// over 400 chars, pinned onto the same real DaVita fact. ---
{
  const davita = factFor("DVA", "new-debt-issuance");
  assert(davita.evidence !== null && davita.evidence.length === 261, `[8 setup] DaVita new-debt-issuance evidence is 261 chars — over the old 260 cap, under the new 400 one (length=${davita.evidence?.length})`);
  const condensed = condenseFirstSentence(davita);
  assert(!condensed.endsWith("…"), `[8a] DaVita new-debt-issuance line is NOT truncated under the new 400-char cap (condensed: ${JSON.stringify(condensed)})`);
  assert(
    /\$986 million/.test(condensed),
    `[8b] DaVita's line keeps its own $986 million net-proceeds figure, discarded by the old 260-char cap (condensed: ${JSON.stringify(condensed)})`
  );

  const synthetic: VerifiedFact = {
    ...davita,
    evidence:
      "Company completed private offering of $1.0 billion aggregate principal amount of 6.750% Senior Notes due 2033 on May 23, 2025, with net proceeds of approximately $986 million used to repay revolving credit facility borrowings, fund working capital, support general corporate purposes, and provide additional liquidity for the company's ongoing operations and future growth initiatives across its network of outpatient dialysis centers nationwide.",
  };
  assert(synthetic.evidence!.length > 400, `[8c setup] SYNTHETIC evidence is over the 400-char cap (length=${synthetic.evidence!.length})`);
  const condensedSynthetic = condenseFirstSentence(synthetic);
  assert(condensedSynthetic.endsWith("…"), `[8c] SYNTHETIC: a genuinely long single sentence still truncates (condensed: ${JSON.stringify(condensedSynthetic)})`);
  assert(
    !/\b(and|or|with|for|to|of|in|on|at|by|the|a|an)…$/i.test(condensedSynthetic),
    `[8d] SYNTHETIC: the truncated line still does not end on a dangling conjunction/preposition (condensed: ${JSON.stringify(condensedSynthetic)})`
  );
}

// --- 9 (Session 16 Fix B4): a standing fact with 2+ periods phrased as
// "<word> quarter of <year>" (not "as of <date>") must still prefer the
// MOST RECENT period — Rule 3 previously only recognized "as of" phrasing.
// SYNTHETIC: no fixture company has this exact shape (real case found live
// on Molina Healthcare, which isn't in this 8-company fixture); pinned onto
// a real EHC dividend-buyback fact with evidence swapped for the real live
// Molina text. ---
{
  const real = factFor("EHC", "dividend-buyback");
  const controlled: VerifiedFact = {
    ...real,
    evidence:
      "In the first quarter of 2025, the company purchased approximately 1,679,000 shares for $500 million under a stock purchase program authorized in October 2024. In the third quarter of 2025, the company purchased approximately 2,849,000 shares for $500 million under a program authorized in April 2025.",
  };
  const condensed = condenseFirstSentence(controlled);
  assert(/third quarter of 2025/.test(condensed), `[9a] SYNTHETIC: Molina-shaped evidence keeps the third-quarter (most recent) period (condensed: ${JSON.stringify(condensed)})`);
  assert(!/first quarter of 2025/.test(condensed), `[9b] SYNTHETIC: the earlier first-quarter period is dropped entirely — Rule 3, never render the comparison`);
}

// --- 11 (Session 17 Item 14, regression): cross-family false positive.
// HCA's real dividend-buyback evidence has an "as of June 30, 2026"
// sentence (buyback capacity) and a SEPARATE "six months ended June 30,
// 2026" sentence (shares repurchased) — the SAME period-end, two
// different metrics, not a temporal progression of one thing. Comparing
// them as if they were a genuine before/after pair (the bug Item 14's
// first implementation introduced) silently drops the dividend sentence
// entirely. Family-aware matching must leave this fact on the ORIGINAL
// "first sentence with money" fallback — the dividend sentence — since
// neither family has 2+ occurrences on its own. Real fixture data,
// unmodified. ---
{
  const hca = factFor("HCA", "dividend-buyback");
  const condensed = condenseFirstSentence(hca);
  assert(
    /\$0\.78 per share/.test(condensed),
    `[11] REAL HCA dividend-buyback keeps the dividend sentence — "as of June 30" (buyback capacity) and "six months ended June 30" (shares repurchased) are different families describing different metrics, not a comparison (condensed: ${JSON.stringify(condensed)})`
  );
}

// --- 10 (Session 17 Item 14): a multi-period comparison stated WITHIN a
// single sentence — not across two sentences, which Rule 3's
// mostRecentPeriodSentence already handled — must still collapse to the
// most recent period only. Real fixture case, unmodified: DaVita's real
// capex-program evidence is exactly one sentence mentioning BOTH "the
// first six months of 2026" and "the first six months of 2025." ---
{
  const davita = factFor("DVA", "capex-program");
  assert(
    /first six months of 2026/.test(davita.evidence ?? "") && /first six months of 2025/.test(davita.evidence ?? ""),
    `[10 setup] DaVita capex-program evidence states both periods within ONE sentence (evidence: ${JSON.stringify(davita.evidence)})`
  );
  const condensed = condenseFirstSentence(davita);
  assert(/first six months of 2026/.test(condensed), `[10a] DaVita capex line keeps the 2026 (most recent) period (condensed: ${JSON.stringify(condensed)})`);
  assert(!/first six months of 2025/.test(condensed), `[10b] DaVita capex line drops the earlier 2025 period entirely, even stated within the SAME sentence (condensed: ${JSON.stringify(condensed)})`);
  assert(/\$271\.8 million/.test(condensed) && !/\$264\.3 million/.test(condensed), `[10c] the 2026 figure ($271.8M) is kept, the 2025 figure ($264.3M) is dropped (condensed: ${JSON.stringify(condensed)})`);
}

// --- 12 (Session 17 follow-up, regression): a single sentence with 2+
// same-family matches must NOT outrank the money-bearing sentence in
// mostRecentPeriodSentence's cross-sentence selection — that is
// collapseSamePeriodClause's (Item 14's) job, applied AFTER a sentence is
// chosen, not a reason to choose a different sentence in the first place.
// Real bug found live during this session's own baseline-diff review:
// UHS's real (Aug 2026) international-expansion evidence gained a third
// sentence since the fixture was captured — "Total assets... were $1.531
// billion as of December 31, 2025 and $1.358 billion as of December 31,
// 2024." — whose own two internal "as of" matches satisfied the (buggy)
// 2+-occurrence bar on their own, letting it leapfrog the actually-
// relevant revenue-growth sentence. Pinned onto the real UHS fact with the
// real live evidence text (captured verbatim) since the fixture predates
// this third sentence. ---
{
  const real = factFor("UHS", "international-expansion");
  const controlled: VerifiedFact = {
    ...real,
    evidence:
      "UHS operates behavioral health care facilities in the United Kingdom. UK behavioral health care facilities generated net revenues of approximately $1.001 billion in 2025 and $880 million in 2024, representing growth. Total assets at UK behavioral health care facilities were approximately $1.531 billion as of December 31, 2025 and $1.358 billion as of December 31, 2024.",
  };
  const condensed = condenseFirstSentence(controlled);
  assert(
    /net revenues of approximately \$1\.001 billion/.test(condensed),
    `[12a] REAL (live-captured) UHS international-expansion keeps the revenue-growth sentence, not the total-assets sentence, even though the total-assets sentence has 2 same-family "as of" matches within itself (condensed: ${JSON.stringify(condensed)})`
  );
  assert(!/Total assets/.test(condensed), `[12b] the total-assets sentence's own internal 2-period comparison does not let it outrank the money-bearing revenue sentence (condensed: ${JSON.stringify(condensed)})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 15b EVIDENCE-CONDENSER GOLDEN TESTS PASSED");
}
