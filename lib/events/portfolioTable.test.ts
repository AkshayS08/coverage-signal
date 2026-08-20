/**
 * Session 16 golden tests — the portfolio table renderer (portfolioTable.ts).
 * Same offline-fixture convention as evidenceCondense.test.ts: real
 * citations/evidence from __fixtures__/session11-facts.json, a synthetic
 * case only where the current 8-company fixture doesn't happen to
 * reproduce the shape under test (pinned onto a real fact, per that file's
 * established convention).
 *
 * Covers three real bugs found live this session:
 *  - A1: a debt-maturity fact whose citations are a subset of the same
 *    company's new-debt-issuance fact's citations describes ONE event
 *    (the notes-pricing 8-K also states the new tranches' own maturity
 *    dates) — must render once, under New debt, not duplicated under Refi.
 *  - A3: a fired distress/relationship-flag trigger must render its own
 *    evidence, never the trigger's generic taxonomy definition.
 *  - C: no table line's status/timing phrase may ever be blank — every
 *    eventStatus (standing/completed/just_announced/upcoming) must resolve
 *    to SOME non-empty phrase.
 *
 * Run: npx tsx lib/events/portfolioTable.test.ts (or npm run test:table)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult, TriggerResult } from "../agent";
import { buildCompanyTableBlock, TABLE_BUCKET_ORDER } from "./portfolioTable";
import { buildVerifiedFactBase } from "./factBase";

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

function companyFor(ticker: string): CompanyResult {
  const c = fixture.companies.find((c) => c.ticker === ticker);
  if (!c) throw new Error(`fixture missing ${ticker}`);
  return c;
}

console.log(`=== Session 16 golden tests (portfolio table renderer) ===\n`);

// --- A1: HCA's real fixture data has debt-maturity and new-debt-issuance
// citing the IDENTICAL single 8-K (the notes-pricing filing also states
// each new tranche's own maturity date) — must render once, under New
// debt, and Refi must show no line for it. ---
{
  const hca = companyFor("HCA");
  const table = buildCompanyTableBlock(hca, []);
  assert(
    table.buckets.refi.every((l) => l.triggerId !== "debt-maturity"),
    `[A1a] HCA: debt-maturity does NOT render under Refi (its citations are a subset of new-debt-issuance's — same event)`
  );
  assert(
    table.buckets.new_debt.some((l) => l.triggerId === "new-debt-issuance"),
    `[A1b] HCA: new-debt-issuance still renders under New debt`
  );
}

// --- A1 guard: Tenet's debt-maturity and new-debt-issuance cite DIFFERENT
// filings (a genuinely separate upcoming maturity vs. a past issuance) —
// the subset check must NOT suppress a legitimate Refi line. ---
{
  const tenet = companyFor("THC");
  const table = buildCompanyTableBlock(tenet, []);
  assert(
    table.buckets.refi.some((l) => l.triggerId === "debt-maturity"),
    `[A1c] Tenet: debt-maturity STILL renders under Refi (citations genuinely differ from new-debt-issuance — not the same event)`
  );
}

// --- A3: a fired distress trigger must render its OWN evidence, never the
// trigger's generic taxonomy definition/name. SYNTHETIC: no fixture
// company in this 8-company book has a fired covenant-breach, so this pins
// a controlled CompanyResult with one added, on top of a real company's
// otherwise-untouched result set. ---
{
  const real = companyFor("SGRY");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const syntheticCovenant: TriggerResult = {
    ...realDebtMaturity,
    triggerId: "covenant-breach",
    triggerName: "Covenant breach / waiver, or going-concern / liquidity warning",
    needType: "distress",
    evidence:
      "On February 4, 2026, the company amended its Credit Agreement to temporarily reduce the quarterly required minimum interest coverage ratio from 3.00 to 1.75.",
    quoteHasFigure: false,
  };
  const controlled: CompanyResult = {
    ...real,
    results: [...real.results, syntheticCovenant],
    relationshipFlags: [syntheticCovenant],
  };
  const table = buildCompanyTableBlock(controlled, []);
  assert(
    table.relationshipFlags.length === 1 && !/^Covenant breach \/ waiver/.test(table.relationshipFlags[0]),
    `[A3a] SYNTHETIC: relationship flag does NOT render the bare trigger definition (rendered: ${JSON.stringify(table.relationshipFlags)})`
  );
  assert(
    table.relationshipFlags.some((f) => /February 4, 2026/.test(f)),
    `[A3b] SYNTHETIC: relationship flag renders the fact's own evidence instead (rendered: ${JSON.stringify(table.relationshipFlags)})`
  );
}

// --- A3 guard: every OTHER fixture company has no fired distress trigger
// at all — relationshipFlags must stay empty, never showing a definition
// for a trigger that never fired. ---
{
  const hca = companyFor("HCA");
  const table = buildCompanyTableBlock(hca, []);
  assert(table.relationshipFlags.length === 0, `[A3c] HCA: no relationship flags when nothing distress-related fired`);
}

// --- C: no table line's timing phrase may ever be blank. Checks every
// bucket, every company, in the whole fixture — real "completed" and
// "just_announced" facts included (DaVita's May 2025 completed issuance,
// DaVita's Feb 2026 just_announced acquisition — both real cases that
// rendered "" before this fix). ---
{
  let blankCount = 0;
  const blankExamples: string[] = [];
  for (const company of fixture.companies) {
    const table = buildCompanyTableBlock(company, []);
    for (const bucket of TABLE_BUCKET_ORDER) {
      for (const line of table.buckets[bucket]) {
        if (line.timingPhrase.trim().length === 0) {
          blankCount++;
          blankExamples.push(`${company.ticker}/${bucket}/${line.triggerId}`);
        }
      }
    }
  }
  assert(blankCount === 0, `[C1] zero blank timing phrases across the whole fixture (found: ${blankExamples.join(", ")})`);
}

// --- C: DaVita's real completed new-debt-issuance renders "completed", not "". ---
{
  const davita = companyFor("DVA");
  const table = buildCompanyTableBlock(davita, []);
  const line = table.buckets.new_debt.find((l) => l.triggerId === "new-debt-issuance");
  assert(!!line && line.timingPhrase === "completed", `[C2] DaVita new-debt-issuance (status=completed) renders "completed" (got: ${JSON.stringify(line?.timingPhrase)})`);
}

// --- C3 (updated Session 17 Item 12): DaVita's real just_announced
// acquisition (dated, but past the pending-live window) renders bare
// "announced", not "". Session 17 Item 12 changed the expected value here:
// DaVita's own description already states "On February 2, 2026" (Haiku's
// evidence phrasing routinely opens with the event's own date), so
// restating it in the status suffix ("announced Feb 2, 2026") was pure
// redundancy — real bug this fixes. The date is never lost entirely: it's
// in the description, just not doubled into the suffix too. ---
{
  const davita = companyFor("DVA");
  const table = buildCompanyTableBlock(davita, []);
  const line = table.buckets.new_debt.find((l) => l.triggerId === "acquisition-announced");
  assert(!!line && /February 2, 2026/.test(line.description), `[C3 setup] DaVita's acquisition-announced description already states its own date`);
  assert(
    !!line && line.timingPhrase === "announced",
    `[C3] DaVita acquisition-announced renders bare "announced" — the date is already in the description, not blank and not doubled (got: ${JSON.stringify(line?.timingPhrase)})`
  );
}

// --- C4 (Session 17 Item 12, other branch): when the description does
// NOT already state the fact's own date, the date suffix must still show
// — suppression is conditional, never unconditional. SYNTHETIC: no
// fixture fact happens to omit its own date from its evidence (Haiku's
// phrasing routinely opens with "On <date>, ..."); pinned onto DaVita's own
// real acquisition-announced fact (eventDate/granularity kept real —
// "2026-02-02"/day — only the evidence text is swapped to a date-less
// sentence, isolating exactly the condition under test). ---
{
  const davita = companyFor("DVA");
  const realAcquisition = davita.results.find((r) => r.triggerId === "acquisition-announced")!;
  assert(!!realAcquisition.eventDate, `[C4 setup] DaVita's real acquisition-announced fact has an eventDate to test against`);
  const controlled: CompanyResult = {
    ...davita,
    results: davita.results.map((r) =>
      r.triggerId === "acquisition-announced" ? { ...r, evidence: "The Company signed a definitive agreement to acquire a noncontrolling minority interest in an entity." } : r
    ),
  };
  const table = buildCompanyTableBlock(controlled, []);
  const line = table.buckets.new_debt.find((l) => l.triggerId === "acquisition-announced");
  assert(
    !!line && !/February/.test(line.description) && line.timingPhrase !== "announced" && /^announced /.test(line.timingPhrase),
    `[C4] when the description does NOT already state the date, the suffix still shows it (got description: ${JSON.stringify(line?.description)}, timing: ${JSON.stringify(line?.timingPhrase)})`
  );
}

// --- Regression guard, unchanged from Session 15b: every fact still
// produces a factBase entry consistent with what the table reads from. ---
{
  const uhs = companyFor("UHS");
  const factBase = buildVerifiedFactBase(uhs);
  assert(factBase.length > 0, `[R1] UHS fact base is still non-empty (sanity check the fixture itself is intact)`);
}

// --- Item 11: "standing" is internal taxonomy vocabulary and must never
// render as the literal word — every standing-status line across the
// whole fixture renders "ongoing" instead, never blank (the never-blank
// invariant from Session 16 still holds; "standing" replaced with plain
// English is a distinct requirement from "never blank," and this checks
// both at once). ---
{
  let standingCount = 0;
  let ongoingCount = 0;
  for (const company of fixture.companies) {
    const table = buildCompanyTableBlock(company, []);
    for (const bucket of TABLE_BUCKET_ORDER) {
      for (const line of table.buckets[bucket]) {
        if (line.timingPhrase === "standing") standingCount++;
        if (line.timingPhrase === "ongoing") ongoingCount++;
      }
    }
  }
  assert(standingCount === 0, `[11a] zero table lines render the literal word "standing" across the whole fixture (found: ${standingCount})`);
  assert(ongoingCount > 0, `[11b] at least one standing-status line renders "ongoing" instead (found: ${ongoingCount}) — sanity check the replacement actually fires on real data`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 16 PORTFOLIO-TABLE GOLDEN TESTS PASSED");
}
