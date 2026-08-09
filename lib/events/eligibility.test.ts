/**
 * Session 11 golden tests — card-eligibility gate correctness.
 *
 * Runs entirely OFFLINE against a cached fixture
 * (__fixtures__/session11-facts.json, built once by a throwaway script from
 * a real 8-company pipeline run — see the Step 5 report for how). Zero
 * Anthropic/EDGAR calls, seconds to run, safe to run on every change.
 *
 * The fixture's own `generatedAt` timestamp is used as "now" for every
 * assertion below, NOT the real wall-clock date — a golden test must be
 * deterministic forever, and a fact like "Tenet's notes mature Nov 2027"
 * would silently drift from "upcoming" to "completed" as real time passes
 * if evaluated against today's actual date on every future run.
 *
 * History on pinning (read before "fixing" a failing live assertion by
 * re-pinning it): proceedsUse was originally classified by Haiku, and its
 * label for Encompass's real disclosure was observed to flip across
 * fixture builds of the IDENTICAL underlying evidence (refinancing_only /
 * partly_unapplied). Moved to a single, dedicated Sonnet call
 * (lib/agent/proceedsUse.ts) to fix this — took two follow-up fixes to
 * actually work: (1) Sonnet was originally given only Haiku's evidence/
 * quote pointer, which frequently doesn't contain the use-of-proceeds
 * sentence at all (confirmed live: Encompass's and HCA's real filings
 * both state it clearly, just not in the short excerpt Haiku happened to
 * select) — fixed by having Sonnet read the FULL cited filing text
 * instead; (2) even the cited filing sometimes doesn't have it — HCA's
 * new-debt-issuance was cited from a terse 8-K in one run and the fuller
 * 10-Q (which has the actual "repay commercial paper... general corporate
 * purposes" language) in another — fixed by always including the most
 * recent 10-Q regardless of which filing Haiku cited for this specific
 * trigger. After both fixes, Encompass ("refinancing_only") and HCA
 * ("partly_unapplied") are stable across 3 fresh rebuilds and match their
 * real disclosures — [8]/[8b] below are live, unpinned, no guard needed.
 *
 * Two OTHER companies (Concentra, Surgery Partners) still flip across the
 * same 3 rebuilds — NOT pinned, reported instead. Root cause looks
 * structurally different from the Encompass/HCA case: both of their
 * "new-debt-issuance" facts are credit-AGREEMENT AMENDMENTS (a revolver
 * increase, an incremental term loan) rather than a notes offering with a
 * clean "raised $X, proceeds went to Y" narrative — the three-way
 * refinancing_only/partly_unapplied/unstated schema may just not map
 * cleanly onto that fact shape. Neither is exercised by any of the 20
 * assertions below, so this doesn't block anything here, but see the
 * Step 5 report for the full readout — it's a real, unresolved edge case,
 * not swept under a synthetic override.
 *
 * A couple of SYNTHETIC REGRESSION GUARDS remain, clearly labeled, for
 * code branches ("completed status gates before date scan," the exact
 * HCA-class bug) that no real fact in this book currently exercises —
 * dropping them would leave a real, previously-shipped bug unprotected
 * just because live data doesn't happen to reproduce the input shape
 * that triggered it.
 *
 * HCA's debt-maturity fact was ALSO checked for framing variance across
 * the same 3 rebuilds: eventStatus, eventDate, and evidence came back
 * byte-identical every time ("upcoming", 2031-05-15, notes due
 * May 2031/2033/2036 disclosed alongside the redeemed 2026 notes) — no
 * variance observed this round. See the Step 5 report for the code-level
 * confirmation of what happens to the CARD/TABLE decision if a future run
 * DOES headline the "completed redemption" framing instead.
 *
 * Run: npx tsx lib/events/eligibility.test.ts (or npm test)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult, TriggerResult } from "../agent";
import { buildEvents, compareUrgency } from "./buildEvents";
import { evaluateEligibility, PROCEEDS_RECENCY_DAYS } from "./eligibility";
import { daysBetween, PENDING_LIVE_MAX_AGE_DAYS } from "./eventTiming";

interface Fixture {
  generatedAt: string;
  companies: CompanyResult[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__/session11-facts.json"), "utf8")
);
const NOW = new Date(fixture.generatedAt);

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

function findCompany(ticker: string): CompanyResult {
  const c = fixture.companies.find((c) => c.ticker === ticker);
  if (!c) throw new Error(`fixture missing company with ticker "${ticker}" (have: ${fixture.companies.map((x) => x.ticker).join(", ")})`);
  return c;
}

function findTrigger(company: CompanyResult, triggerId: string): TriggerResult {
  const t = company.results.find((t) => t.triggerId === triggerId);
  if (!t) throw new Error(`fixture missing trigger "${triggerId}" for ${company.company}`);
  return t;
}

function isoDaysBeforeNow(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

console.log(`=== Session 11 golden tests (fixture generatedAt=${fixture.generatedAt}) ===\n`);

// --- 1. UHS — 1.650% notes due 2026 (debt maturity) — must be CARD ---
// Live-extracted: eventDate "2026" (bare year — no filing in the corpus
// states a month for these notes), eventDateGranularity "year". The gate
// must still card it via the windowDate (Dec 31, 2026) convention.
{
  const uhs = findCompany("UHS");
  const t = findTrigger(uhs, "debt-maturity");
  const r = evaluateEligibility(t, NOW);
  assert(r.cardEligible, `[1] UHS debt-maturity (1.650% notes due ${t.eventDate}, granularity=${t.dateGranularity}) cards`);
}

// --- 2. UHS — Talkspace acquisition — LIVE. No filing in the corpus has
// ever stated a clean announcement date for this deal (confirmed stable
// across 4 rebuilds: null every time — the evidence only dates the
// FINANCING amendments, never the acquisition agreement itself). Before
// the pending-live fix this cardEligible unconditionally regardless; now,
// correctly, a just_announced fact with no verifiable date can't be
// assumed recent — TABLE. This is a real, honest behavior change worth
// flagging, not a test bug: this exact case is exactly why the fix
// exists (an indefinitely-"just_announced" fact should NOT card forever),
// it just means UHS's specific real fact no longer demonstrates the
// POSITIVE (still-cards) side — see [2-guard] for that. ---
{
  const uhs = findCompany("UHS");
  const t = findTrigger(uhs, "acquisition-announced");
  const r = evaluateEligibility(t, NOW);
  assert(
    !r.cardEligible,
    `[2] UHS acquisition-announced (Talkspace, eventDate=${t.eventDate ?? "null — never disclosed in any filing checked"}) stays TABLE — no verifiable date means pending-live can't be assumed (reason: "${r.reason}")`
  );
}

// --- 2-guard. SYNTHETIC REGRESSION GUARD: a just_announced acquisition
// with a real, verified, RECENT date must still CARD. No real company
// fact in this book currently demonstrates the positive branch — UHS's
// own fact has no date at all ([2] above), DaVita's is stale ([2b]) — so
// this pins a verified, 30-day-old date onto UHS's real acquisition fact
// (same company, same citations, only the date/verification pinned) to
// prove isPendingLive's true branch still cards, not just its false
// branch. Without this, nothing in the suite would catch an accidental
// "always TABLE" regression in the new decay logic. ---
{
  const uhs = findCompany("UHS");
  const real = findTrigger(uhs, "acquisition-announced");
  const controlled: TriggerResult = {
    ...real,
    eventDate: isoDaysBeforeNow(30),
    dateGranularity: "day",
    quoteVerified: true,
    verifiedQuote: real.evidence ?? "synthetic",
    verifiedQuoteNormalized: real.evidence ?? "synthetic",
  };
  const r = evaluateEligibility(controlled, NOW);
  assert(
    r.cardEligible,
    "[2-guard] Synthetic: just_announced acquisition, verified and 30d old, cards — pending-live's true branch still works"
  );
}

// --- 2b/2c. Pending-live decay discriminating pair (Session 11 follow-up):
// isPendingLive now requires eventStatus "just_announced" AND eventDate
// within PENDING_LIVE_MAX_AGE_DAYS (90) — computed once, centrally, in
// eventTiming.ts's computeTiming. These two prove both directions on real
// companies: a stale just_announced fact drops out, a fresh one doesn't. ---
{
  const dva = findCompany("DVA");
  const t = findTrigger(dva, "acquisition-announced");
  const daysAgo = -daysBetween(t.eventDate!, NOW);
  if (!(daysAgo > PENDING_LIVE_MAX_AGE_DAYS)) {
    throw new Error(`[2b] test setup invalid: DaVita's acquisition eventDate is only ${daysAgo}d ago — expected beyond the ${PENDING_LIVE_MAX_AGE_DAYS}d pending-live window`);
  }
  const r = evaluateEligibility(t, NOW);
  assert(
    !r.cardEligible,
    `[2b] DaVita acquisition-announced (${t.eventDate}, ${daysAgo}d ago) stays TABLE — beyond the pending-live window (reason: "${r.reason}")`
  );
}
{
  const sgry = findCompany("SGRY");
  const t = findTrigger(sgry, "asset-sale");
  const daysAgo = -daysBetween(t.eventDate!, NOW);
  if (!(daysAgo >= 0 && daysAgo <= PENDING_LIVE_MAX_AGE_DAYS)) {
    throw new Error(`[2c] test setup invalid: Surgery Partners' asset-sale eventDate is ${daysAgo}d ago — expected inside the ${PENDING_LIVE_MAX_AGE_DAYS}d pending-live window`);
  }
  const r = evaluateEligibility(t, NOW);
  assert(
    r.cardEligible,
    `[2c] Surgery Partners asset-sale (${t.eventDate}, ${daysAgo}d ago) cards — within the pending-live window (note: asset-sale's own case is still unconditional-true, untouched this pass, so this specifically proves the fix didn't break a still-fresh fact, not that asset-sale newly reads isPendingLive)`
  );
}

// --- 3. Tenet — 5.125% notes due Nov 2027 (debt maturity) — must be CARD ---
{
  const thc = findCompany("THC");
  const t = findTrigger(thc, "debt-maturity");
  const r = evaluateEligibility(t, NOW);
  assert(r.cardEligible, `[3] Tenet debt-maturity (notes due ${t.eventDate}) cards`);
}

// --- 4. Synthetic — completed issuance, 30 days old, partly_unapplied — must be CARD ---
// Guards the proceeds test's POSITIVE branch: no real fact in this book
// naturally lands inside the 90-day window with unapplied proceeds, so
// this is spec-mandated as an explicit synthetic case.
{
  const synthetic: TriggerResult = {
    triggerId: "new-debt-issuance",
    triggerName: "New debt issuance / notes pricing",
    fired: true,
    dataAvailable: true,
    evidence: "Synthetic: completed issuance 30 days before test run, proceeds partly unapplied.",
    mappedNeed: "Refi or add-on financing",
    needType: "credit",
    confidence: 1,
    citations: [],
    quoteVerified: true,
    verifiedQuote: "synthetic",
    verifiedQuoteNormalized: "synthetic",
    quoteMatchType: "literal",
    quoteHasFigure: true,
    eventDate: isoDaysBeforeNow(30),
    dateGranularity: "day",
    eventStatus: "completed",
    proceedsUse: "partly_unapplied",
  };
  const r = evaluateEligibility(synthetic, NOW);
  assert(r.cardEligible, "[4] Synthetic completed issuance (30d old, partly_unapplied) cards — proceeds-test positive branch");
}

// --- 5. HCA debt-maturity — LIVE, unpinned. Stable across 3 fresh rebuilds
// (identical evidence/eventDate/eventStatus every time): Haiku currently
// headlines this trigger on HCA's NEW 2031/2033/2036 notes, not the
// completed redemption — both are true facts about HCA, this is just
// which one Haiku picks as the trigger's primary evidence. Must be TABLE
// either way (2031 notes are ~57mo out, past the 18mo window). ---
{
  const hca = findCompany("HCA");
  const t = findTrigger(hca, "debt-maturity");
  const r = evaluateEligibility(t, NOW);
  assert(
    !r.cardEligible,
    `[5] HCA debt-maturity (LIVE: status=${t.eventStatus}, eventDate=${t.eventDate}) stays TABLE (reason: "${r.reason}")`
  );
}

// --- 5-guard. SYNTHETIC REGRESSION GUARD for the specific HCA-class bug:
// a redeemed tranche's former due date (a still-future-looking date) must
// never card just because eventStatus wasn't checked first. No real fact
// in this book currently has eventStatus=completed on debt-maturity (see
// [5] above — live extraction happens to headline the future notes
// instead), so this guards the code path with a controlled input built
// from HCA's real "...were redeemed on May 27, 2026" disclosure, per the
// same rationale as [4]'s synthetic proceeds-test case: dropping this
// would leave a real, previously-shipped bug unprotected. ---
{
  const hca = findCompany("HCA");
  const real = findTrigger(hca, "debt-maturity");
  const controlled: TriggerResult = {
    ...real,
    evidence:
      '$1.5 billion of 5.250% senior notes due June 2026 and $1.0 billion of 5.375% senior notes due September 2026 were redeemed on May 27, 2026.',
    eventDate: "2026-09-01",
    dateGranularity: "month",
    eventStatus: "completed",
  };
  const r = evaluateEligibility(controlled, NOW);
  assert(
    !r.cardEligible,
    "[5-guard] Synthetic: redeemed notes (completed status, still-future-looking former due date) stays TABLE — status must gate before any date scan"
  );
}

// --- 6. Tenet — Nov 2025 notes pricing (stale, completed) — must be TABLE ---
{
  const thc = findCompany("THC");
  const t = findTrigger(thc, "new-debt-issuance");
  const r = evaluateEligibility(t, NOW);
  assert(!r.cardEligible, `[6] Tenet new-debt-issuance (${t.eventDate}, stale) stays TABLE`);
}

// --- 7. Acadia — Mar 2025 issuance (stale, refinancing_only) — must be TABLE ---
{
  const achc = findCompany("ACHC");
  const t = findTrigger(achc, "new-debt-issuance");
  const r = evaluateEligibility(t, NOW);
  assert(!r.cardEligible, `[7] Acadia new-debt-issuance (${t.eventDate}, ${t.proceedsUse}) stays TABLE`);
}

// --- 8. Encompass — $500M May 2026 issuance, refinancing_only, INSIDE the
// 90-day window — must be TABLE. LIVE, unpinned, no guard needed anymore:
// after fixing proceedsUse.ts to read the full cited filing text (not just
// Haiku's evidence/quote pointer, which frequently didn't contain the
// use-of-proceeds sentence at all) and always include the most recent
// 10-Q, Encompass is stably "refinancing_only" across 3 fresh rebuilds —
// live data now fully exercises the discriminator this test exists to
// prove (not just recency). Setup asserts the specific label so a future
// drift back to "unstated"/"partly_unapplied" fails loudly instead of
// silently passing for the wrong reason. ---
{
  const ehc = findCompany("EHC");
  const t = findTrigger(ehc, "new-debt-issuance");
  const days = -daysBetween(t.eventDate!, NOW); // daysBetween is positive for FUTURE dates; negate for "days ago"
  if (!(days >= 0 && days <= PROCEEDS_RECENCY_DAYS)) {
    throw new Error(
      `[8] test setup invalid: Encompass's real issuance date ${t.eventDate} is ${days}d ago from fixture now — expected inside the ${PROCEEDS_RECENCY_DAYS}d window for this test to mean anything`
    );
  }
  if (t.proceedsUse !== "refinancing_only") {
    throw new Error(
      `[8] test setup invalid: Encompass's real proceedsUse is "${t.proceedsUse}", not "refinancing_only" — this test needs that specific label to prove the discriminator; see the file header for the classifier's known instability on non-notes-offering facts`
    );
  }
  const r = evaluateEligibility(t, NOW);
  assert(
    !r.cardEligible,
    `[8] Encompass new-debt-issuance ($500M, ${days}d ago, LIVE proceedsUse=refinancing_only) stays TABLE despite being inside the ${PROCEEDS_RECENCY_DAYS}d window — proceeds test, not just recency (reason: "${r.reason}")`
  );
}

// --- 8b. HCA — $3.0B April 2026 issuance, partly_unapplied, OUTSIDE the
// 90-day window — must be TABLE. LIVE, unpinned, no guard needed anymore:
// HCA is stably "partly_unapplied" across 3 fresh rebuilds after the same
// fix — live data now fully exercises "recency enforced independent of
// proceeds label" too. Setup asserts the specific label for the same
// loud-failure-on-drift reason as [8] above. ---
{
  const hca = findCompany("HCA");
  const t = findTrigger(hca, "new-debt-issuance");
  const days = -daysBetween(t.eventDate!, NOW); // daysBetween is positive for FUTURE dates; negate for "days ago"
  if (!(days > PROCEEDS_RECENCY_DAYS)) {
    throw new Error(`[8b] test setup invalid: HCA's issuance is only ${days}d ago — expected beyond the ${PROCEEDS_RECENCY_DAYS}d window`);
  }
  if (t.proceedsUse !== "partly_unapplied") {
    throw new Error(
      `[8b] test setup invalid: HCA's real proceedsUse is "${t.proceedsUse}", not "partly_unapplied" — this test needs that specific label to prove recency is enforced independently of the proceeds-use branch`
    );
  }
  const r = evaluateEligibility(t, NOW);
  assert(
    !r.cardEligible,
    `[8b] HCA new-debt-issuance ($3.0B, ${days}d ago, LIVE proceedsUse=partly_unapplied) stays TABLE — recency test, independent of the proceeds test (reason: "${r.reason}")`
  );
}

// --- 9. Encompass — standing capex program — must be TABLE ---
{
  const ehc = findCompany("EHC");
  const t = findTrigger(ehc, "capex-program");
  const r = evaluateEligibility(t, NOW);
  assert(!r.cardEligible && t.eventStatus === "standing", "[9] Encompass capex-program (standing) stays TABLE");
}

// --- 10. DaVita — standing capex program — must be TABLE ---
{
  const dva = findCompany("DVA");
  const t = findTrigger(dva, "capex-program");
  const r = evaluateEligibility(t, NOW);
  assert(!r.cardEligible && t.eventStatus === "standing", "[10] DaVita capex-program (standing) stays TABLE");
}

// --- 11. Concentra — cash with no computed >30% QoQ — must be TABLE ---
{
  const con = findCompany("CON");
  const t = con.results.find((t) => t.triggerId === "large-cash-balance");
  if (t && t.fired) {
    const r = evaluateEligibility(t, NOW);
    assert(!r.cardEligible, "[11] Concentra large-cash-balance (no computed QoQ) stays TABLE");
  } else {
    assert(true, "[11] Concentra large-cash-balance didn't fire this fixture build — trivially not a card (noted, not a gate failure)");
  }
}

// --- 12. AT LEAST 2 cards for one company — proves no per-company cap.
// CONTROLLED: no company in this fixture build currently has two live,
// independently card-eligible, DIFFERENT-CLUSTER triggers (UHS's own
// acquisition-announced has no date — see [2] — and its new-debt-issuance
// failed quote verification this build, an unrelated pre-existing
// non-determinism). Pins a verified/recent acquisition-announced fact
// alongside UHS's own live debt-maturity fact to prove the STRUCTURAL fix
// (the cap itself is gone) without depending on two unrelated
// data-availability gaps closing at once.
//
// An earlier version of this test overrode eventDate/quoteVerified but NOT
// citations, so the synthetic acquisition kept UHS's own real
// acquisition-announced citation — which happens to cite the SAME 8-K
// (uhs-20260422.htm) as UHS's real debt-maturity fact. clusterIntoEvents
// clusters on shared citations, so the two facts correctly merged into ONE
// cluster and the test failed for a reason that had nothing to do with the
// per-company cap it exists to prove — the test's own premise ("a
// genuinely different cluster — different citations") was false against
// this fixture's real data. Fixed by also overriding `citations` to a
// citation guaranteed disjoint from debt-maturity's, so the synthetic fact
// actually lands in its own cluster. (Chose this over asserting on a
// company with two genuinely live distinct events because no company in
// the current fixture has one — every card-eligible company here produces
// exactly one cluster; see the testFromFixture.ts run.) ---
{
  const uhs = findCompany("UHS");
  const debtMaturity = findTrigger(uhs, "debt-maturity");
  const realAcquisition = findTrigger(uhs, "acquisition-announced");
  const controlledAcquisition: TriggerResult = {
    ...realAcquisition,
    eventDate: isoDaysBeforeNow(30),
    dateGranularity: "day",
    quoteVerified: true,
    verifiedQuote: realAcquisition.evidence ?? "synthetic",
    verifiedQuoteNormalized: realAcquisition.evidence ?? "synthetic",
    // Deliberately disjoint from debt-maturity's real citations (which
    // include uhs-20260422.htm) — this is what makes it land in a
    // genuinely different dedup cluster, not just a different trigger.
    citations: [{ form: "8-K", date: isoDaysBeforeNow(30), url: "https://example.com/synthetic-controlled-acquisition-8k" }],
  };
  const uhsControlled: CompanyResult = {
    ...uhs,
    results: uhs.results.map((t) => (t.triggerId === "acquisition-announced" ? controlledAcquisition : t)),
  };
  const result = buildEvents([uhsControlled], NOW);
  assert(
    result.flashCardCandidates.length >= 2,
    `[12] UHS produces at least 2 cards when debt-maturity (${debtMaturity.eventDate}) and a verified/recent acquisition-announced with a DISJOINT citation are both eligible (got ${result.flashCardCandidates.length}: ${result.flashCardCandidates.map((c) => c.headlineTrigger.triggerId).join(", ")}) — proves no per-company cap, independent of dedup clustering`
  );
}

// --- 13. No card has eventStatus standing/completed, except the proceeds-test exception ---
{
  const allEvents = buildEvents(fixture.companies, NOW);
  const bad = allEvents.flashCardCandidates.filter((card) => {
    const t = card.headlineTrigger;
    if (t.eventStatus === "standing") return true;
    if (t.eventStatus === "completed") {
      if (t.triggerId !== "new-debt-issuance") return true;
      if (t.proceedsUse !== "partly_unapplied" || !t.eventDate) return true;
      const daysAgo = -daysBetween(t.eventDate, NOW); // daysBetween is positive for FUTURE dates; negate for "days ago"
      return !(daysAgo >= 0 && daysAgo <= PROCEEDS_RECENCY_DAYS);
    }
    return false;
  });
  assert(
    bad.length === 0,
    `[13] No card has eventStatus standing/completed outside the proceeds-test exception (found ${bad.length}${bad.length ? ": " + bad.map((c) => `${c.company}/${c.headlineTrigger.triggerId}`).join(", ") : ""})`
  );
}

// --- 14. Cards sorted by time-to-event, live/pending first ---
{
  const allEvents = buildEvents(fixture.companies, NOW);
  const cards = allEvents.flashCardCandidates;
  let sortedOk = true;
  for (let i = 1; i < cards.length; i++) {
    if (compareUrgency(cards[i - 1], cards[i]) > 0) {
      sortedOk = false;
      break;
    }
  }
  assert(sortedOk, `[14] flashCardCandidates (${cards.length} total) sorted by time-to-event, live/pending first`);
}

// --- 15. DaVita: a June 2030 maturity must not be described as within
// ~18mo of a June 2026-ish filing — proves eventDate arithmetic, not
// evidence-text "~18 months" parsing, drives the result ---
{
  const dva = findCompany("DVA");
  const t = findTrigger(dva, "debt-maturity");
  const r = evaluateEligibility(t, NOW);
  const months = r.timing.monthsToNearestFuture;
  assert(
    months === null || months < 15 || months > 21,
    `[15a] DaVita debt-maturity (${t.eventDate}) timing is NOT computed near the old bogus "~18mo" value (computed: ${months}mo)`
  );
  assert(!r.cardEligible, `[15b] DaVita debt-maturity (${t.eventDate}, ~${months}mo out) correctly stays TABLE`);
}

// --- 16. UHS: eventDate must derive from the notes, not from an unrelated
// hospital lease expiration (or any other unrelated sentence) ---
{
  const uhs = findCompany("UHS");
  const t = findTrigger(uhs, "debt-maturity");
  assert(
    t.eventDate === null || !t.eventDate.startsWith("2026-12"),
    `[16] UHS debt-maturity eventDate (${t.eventDate}) is not December 2026 (the unrelated hospital lease date from the original bug)`
  );
}

// --- 17. Constraint check (user-specified): a bare-year maturity whose
// Dec-31 windowDate convention falls OUTSIDE the 18-month window must
// still go to TABLE — proves the convention can't quietly widen the gate. ---
{
  const farYear = String(NOW.getUTCFullYear() + 2); // Dec 31 two years out is unambiguously beyond 18mo regardless of exact month within `now`.
  const synthetic: TriggerResult = {
    triggerId: "debt-maturity",
    triggerName: "Debt maturity approaching",
    fired: true,
    dataAvailable: true,
    evidence: `Synthetic: notes due ${farYear} (bare year, no month disclosed).`,
    mappedNeed: "Refinancing",
    needType: "credit",
    confidence: 1,
    citations: [],
    quoteVerified: true,
    verifiedQuote: "synthetic",
    verifiedQuoteNormalized: "synthetic",
    quoteMatchType: "literal",
    quoteHasFigure: true,
    eventDate: farYear,
    dateGranularity: "year",
    eventStatus: "upcoming",
    proceedsUse: null,
  };
  const r = evaluateEligibility(synthetic, NOW);
  assert(
    !r.cardEligible,
    `[17] Bare-year maturity (${farYear}, windowDate Dec 31 ${farYear}) outside 18mo stays TABLE — the year-convention can't quietly widen the gate`
  );
}

// --- 18. Display safety (user-specified constraint 3): a year-granularity
// card's reason string states the year only — never a fabricated month
// ("Dec 2026") and never a computed month count ("~5mo out"). ---
{
  const uhs = findCompany("UHS");
  const t = findTrigger(uhs, "debt-maturity");
  const r = evaluateEligibility(t, NOW);
  if (t.dateGranularity === "year") {
    const showsMonthCount = /~\d+\s*mo\b/.test(r.reason);
    const showsFabricatedMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(r.reason);
    assert(
      !showsMonthCount && !showsFabricatedMonth,
      `[18] Year-granularity reason string shows year only, no month count or fabricated month name (reason: "${r.reason}")`
    );
  } else {
    assert(true, `[18] UHS debt-maturity granularity is "${t.dateGranularity}" this build (not "year") — display-safety check not applicable, skipping rather than asserting on data this run doesn't have`);
  }
}

// --- 19a/19b/19c. Session 12 Part A — SGRY asset-sale quote-verification
// determinism. Diagnosed root cause: Haiku's quote-selection sometimes
// spliced two individually-true but non-adjacent sentences into one
// fabricated contiguous span (the escrow-mechanics opening + a deal-value
// sentence 1,169 characters later), which correctly failed verification —
// that's the guard working, not a bug. Fixed at the prompt level (claude.ts:
// select ONE contiguous sentence; when the material figures live in a
// different sentence than the surrounding context, quote the figure-bearing
// sentence; never join two locations). The third assertion below is the one
// that actually matters: a run was observed where verification succeeded
// via a genuinely contiguous quote that nonetheless contained NEITHER deal
// figure — "verified" alone would have shipped an empty card. ---
{
  const sgry = findCompany("SGRY");
  const t = findTrigger(sgry, "asset-sale");
  const r = evaluateEligibility(t, NOW);
  assert(r.cardEligible, `[19a] SGRY asset-sale cards (eventStatus=${t.eventStatus}, eventDate=${t.eventDate})`);
  assert(
    t.quoteVerified && t.quoteMatchType === "literal",
    `[19b] SGRY asset-sale verifiedQuote passes LITERAL match, not the table co-occurrence path (quoteVerified=${t.quoteVerified}, matchType=${t.quoteMatchType})`
  );
  const hasFigures = !!t.verifiedQuote && (t.verifiedQuote.includes("$1.15 billion") || t.verifiedQuote.includes("$795 million"));
  assert(
    hasFigures,
    `[19c] SGRY asset-sale verifiedQuote CONTAINS a deal figure ($1.15 billion or $795 million) — verifiedQuote: ${JSON.stringify(t.verifiedQuote)}`
  );
}

console.log(`\n${failed === 0 ? "ALL GOLDEN TESTS PASSED" : `${failed} GOLDEN TEST(S) FAILED`} (${passed} passed, ${failed} failed)`);
if (failed > 0) {
  console.log("Failed:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
