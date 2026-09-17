/**
 * Session 16 golden tests — the portfolio table renderer (portfolioTable.ts).
 * Same offline-fixture convention as evidenceCondense.test.ts: real
 * citations/evidence from __fixtures__/session11-facts.json, a synthetic
 * case only where the current 8-company fixture doesn't happen to
 * reproduce the shape under test (pinned onto a real fact, per that file's
 * established convention).
 *
 * Covers real bugs found live this session:
 *  - A3: a fired distress/relationship-flag trigger must render its own
 *    evidence, never the trigger's generic taxonomy definition.
 *  - C: no table line's status/timing phrase may ever be blank — every
 *    eventStatus (standing/completed/just_announced/upcoming) must resolve
 *    to SOME non-empty phrase.
 *
 * Session 18: A1 (the same-citation refi/new-debt dedup) removed — that
 * logic is DELETED, not superseded (position.ts makes it structurally
 * impossible for a newly issued tranche to double-render as both a refi
 * fact and a new-debt fact, since it's just one row on the ladder). See F1
 * below for its replacement tests, against the new dedicated
 * `refiLadder` block — real fixture data predates this schema (no
 * debtSchedule), so every F1 case is SYNTHETIC, same convention as
 * position.test.ts.
 *
 * Run: npx tsx lib/events/portfolioTable.test.ts (or npm run test:table)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult, TriggerResult } from "../agent";
import { buildCompanyTableBlock, TABLE_BUCKET_ORDER } from "./portfolioTable";
import { buildVerifiedFactBase } from "./factBase";
import type { FlashCard } from "./buildEvents";
import { rowIdentityKey } from "./position";

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

// --- F1 (Session 18): the refi bucket never uses `buckets.refi` at all —
// debt-maturity is always excluded from the main per-trigger loop, and its
// own dedicated `refiLadder` block carries everything instead. ---
{
  const tenet = companyFor("THC");
  const table = buildCompanyTableBlock(tenet, []);
  assert(table.buckets.refi.length === 0, "[F1-setup] buckets.refi is always empty now — debt-maturity never renders through the generic per-trigger path");
}

function debtMaturityWithSchedule(real: TriggerResult, over: Partial<TriggerResult>): TriggerResult {
  return { ...real, fired: true, ...over };
}

function syntheticRow(over: { label: string; rate: string; maturityDate: string; dateGranularity: "day" | "month" | "year"; amount?: string }) {
  return {
    kind: "row" as const,
    label: over.label,
    rate: over.rate,
    seniority: null,
    amount: over.amount ?? "$1.0 billion",
    maturityDate: over.maturityDate,
    dateGranularity: over.dateGranularity,
    sourceLine: "s",
    citedUrl: "https://example.com/synthetic-10q",
    section: null,
    periodColumn: null,
  };
}

function syntheticSubtotal(label: string | null, amount: string) {
  return {
    kind: "subtotal" as const,
    label,
    rate: null,
    seniority: null,
    amount,
    maturityDate: null,
    dateGranularity: null,
    section: null,
    periodColumn: null,
    sourceLine: "s",
    citedUrl: "https://example.com/synthetic-10q",
  };
}

// --- F1a: a clean tie (Check 1) renders the completeness statement,
// nearest tranches named individually, and the tail collapsed. SYNTHETIC:
// pinned onto a real company's debt-maturity trigger (only the Session 18
// fields set) since the fixture predates scheduleSequence. ---
{
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const rows = [
    syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }),
    syntheticRow({ label: "B", rate: "4.500%", maturityDate: "2029-06-01", dateGranularity: "day" }),
    syntheticRow({ label: "C", rate: "4.000%", maturityDate: "2031-06-01", dateGranularity: "day" }),
    syntheticRow({ label: "D", rate: "3.500%", maturityDate: "2033-06-01", dateGranularity: "day" }),
    syntheticRow({ label: "E", rate: "3.000%", maturityDate: "2035-06-01", dateGranularity: "day" }),
  ];
  const controlled = debtMaturityWithSchedule(realDebtMaturity, {
    citations: [{ form: "10-Q", date: "2026-06-30", reportDate: "", url: "https://example.com/synthetic-10q" }],
    scheduleSequence: [...rows, syntheticSubtotal("Total debt", "$5.0 billion")],
  });
  const companyControlled: CompanyResult = { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? controlled : t)) };
  const table = buildCompanyTableBlock(companyControlled, []);
  assert(table.refiLadder.hasData, "[F1a-setup] refiLadder has data for a fired, scheduled debt-maturity trigger");
  assert(table.refiLadder.walkCheck.pass, `[F1a] SYNTHETIC: 5x $1.0B rows tie exactly to $5.0B subtotal -> Check 1 passes (gaps: ${table.refiLadder.walkCheck.subtotalChecks.map((s) => s.gap).join(",")})`);
  assert(/internal walk ties/.test(table.refiLadder.completenessStatement) && /✓/.test(table.refiLadder.completenessStatement), `[F1a] completeness statement states the tie (got: "${table.refiLadder.completenessStatement}")`);
  assert(table.refiLadder.nearestLines.length === 3, `[F1a] exactly 3 nearest tranches named individually (got ${table.refiLadder.nearestLines.length})`);
  assert(table.refiLadder.tailSummary !== null && /2 more tranche/.test(table.refiLadder.tailSummary), `[F1a] the remaining 2 tranches collapse into a tail summary (got: "${table.refiLadder.tailSummary}")`);
}

// --- F1b: does not tie (Check 1 fails) — rendered anyway, never
// suppressed, with the dollar gap stated. ---
{
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const controlled = debtMaturityWithSchedule(realDebtMaturity, {
    citations: [{ form: "10-Q", date: "2026-06-30", reportDate: "", url: "https://example.com/synthetic-10q" }],
    scheduleSequence: [
      syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }),
      syntheticSubtotal("Total debt", "$2.5 billion"), // $1.5B unaccounted — a real gap
    ],
  });
  const companyControlled: CompanyResult = { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? controlled : t)) };
  const table = buildCompanyTableBlock(companyControlled, []);
  assert(!table.refiLadder.walkCheck.pass, "[F1b] a genuine $1.5B gap does not tie -- Check 1 fails");
  assert(/does not tie/.test(table.refiLadder.completenessStatement) && /\$1\.5B/.test(table.refiLadder.completenessStatement), `[F1b] rendered anyway, states the dollar gap through the SAME money formatter as every other surface (item 2), never suppressed (got: "${table.refiLadder.completenessStatement}")`);
  assert(table.refiLadder.nearestLines.length === 1, "[F1b] the ladder itself still renders despite not tying — completeness and display are separate");
}

// --- F1c: an unconfirmed row renders with its status stated, never
// silently dropped — and a retired row never gets its own line (it only
// explains a live one via a card's KEY POINT, not the table). ---
{
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const controlled = debtMaturityWithSchedule(realDebtMaturity, {
    citations: [{ form: "10-Q", date: "2026-06-30", reportDate: "", url: "https://example.com/synthetic-10q" }],
    scheduleSequence: [syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }), syntheticSubtotal("Total debt", "$1.0 billion")],
    priorScheduleSequence: [
      syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }),
      syntheticRow({ label: "GONE", rate: "6.000%", maturityDate: "2026-03-01", dateGranularity: "month", amount: "$500 million" }),
    ],
  });
  const companyControlled: CompanyResult = { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? controlled : t)) };
  const table = buildCompanyTableBlock(companyControlled, []);
  const unconfirmedLine = table.refiLadder.nearestLines.find((l) => l.row.status === "unconfirmed");
  assert(!!unconfirmedLine, "[F1c] the row that dropped off with no redemption explaining it still renders (never silently dropped)");
  assert(/unconfirmed/.test(unconfirmedLine?.timingPhrase ?? ""), `[F1c] its status is stated in the timing phrase (got: "${unconfirmedLine?.timingPhrase}")`);
  assert(table.refiLadder.nearestLines.every((l) => l.row.status !== "retired"), "[F1c] no retired row ever gets its own table line");
}

// --- F1d: no debt-maturity signal at all -> hasData false, same "checked,
// nothing found" honesty the rest of the table already follows. ---
{
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const noSignal = debtMaturityWithSchedule(realDebtMaturity, { fired: false, scheduleSequence: [] });
  const companyControlled: CompanyResult = { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? noSignal : t)) };
  const table = buildCompanyTableBlock(companyControlled, []);
  assert(!table.refiLadder.hasData, "[F1d] a company with no debt-maturity signal at all reports hasData: false, not an empty-but-present ladder");
}

// --- F1e: card-eligible marking is per-ROW, not per-trigger — two rows
// from the SAME debt-maturity trigger must be independently markable, so
// only the specific tranche with an actual card shows CARD ABOVE. ---
{
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const rowA = syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" });
  const rowB = syntheticRow({ label: "B", rate: "4.500%", maturityDate: "2029-06-01", dateGranularity: "day" });
  const controlled = debtMaturityWithSchedule(realDebtMaturity, {
    citations: [{ form: "10-Q", date: "2026-06-30", reportDate: "", url: "https://example.com/synthetic-10q" }],
    scheduleSequence: [rowA, rowB, syntheticSubtotal("Total debt", "$2.0 billion")],
  });
  const companyControlled: CompanyResult = { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? controlled : t)) };
  // Row ids are content-derived (instrument::rate::maturityDate) — build the
  // expected id for row A the same way position.ts does, so the synthetic
  // card points at exactly one row without needing to run assemblePosition
  // here just to discover it.
  // SESSION 22 — built with the SAME function position.ts uses, rather than a
  // hand-assembled copy of its format. The previous literal drifted the moment
  // row identity stopped keying on the label, and a test that reconstructs an
  // identity by hand is testing its own copy of the rule.
  const rowAId = rowIdentityKey({ rate: rowA.rate, maturityDate: rowA.maturityDate, amount: rowA.amount });
  const syntheticCard = { headlineTrigger: controlled, headlineRowId: rowAId } as FlashCard;
  const table = buildCompanyTableBlock(companyControlled, [syntheticCard]);
  const lineA = table.refiLadder.nearestLines.find((l) => l.row.instrument === "A");
  const lineB = table.refiLadder.nearestLines.find((l) => l.row.instrument === "B");
  assert(lineA?.cardEligible === true, "[F1e] row A (the one the synthetic card points at via headlineRowId) shows CARD ABOVE");
  assert(lineB?.cardEligible === false, "[F1e] row B (same trigger, no card) does NOT show CARD ABOVE — per-row, not per-trigger");
}

// ============================================================================
// Session 18 (post-v11) — prior-period CONTEXT (item 2). Pinned to CHS's
// real shape: the newest 10-Q carries only two near-term maturity mentions
// (no table, no subtotal) while the 10-K has the full schedule. Base
// selection is deliberately NOT changed to prefer whichever filing
// reconciles — that would make the tool choose a stale ladder for being
// tidier, exactly what Check 2 exists to catch.
// ============================================================================

const PRIOR_FILING = { form: "10-K", date: "2026-02-19", reportDate: "2025-12-31", url: "https://example.com/synthetic-10k" };

function chsShapedCompany(over: Partial<TriggerResult>): CompanyResult {
  const real = companyFor("THC");
  const realDebtMaturity = real.results.find((r) => r.triggerId === "debt-maturity")!;
  const controlled = debtMaturityWithSchedule(realDebtMaturity, {
    citations: [{ form: "10-Q", date: "2026-07-23", reportDate: "", url: "https://example.com/synthetic-10q" }],
    debtScheduleSourceFiling: { form: "10-Q", date: "2026-07-23", reportDate: "2026-06-30", url: "https://example.com/synthetic-10q" },
    ...over,
  });
  return { ...real, results: real.results.map((t) => (t.triggerId === "debt-maturity" ? controlled : t)) };
}

// --- P1: RETIRED. This block asserted RefiLadderBlock.priorPeriodContext —
// the render path that surfaced an older filing's schedule as labelled
// context beneath a base ladder that failed both checks.
//
// Session 18 (post-v16) DELETED that path. The locator search-order rule
// supersedes it: rather than showing a stale schedule beside a failed one,
// the pipeline now walks newest-10-Q -> prior-10-Q -> 10-K and takes the
// first filing that actually YIELDS a schedule, recording that filing's own
// form and date as the base. UHS is the live case — its two 10-Qs yield
// nothing and it now resolves to its 10-K, sourced and labelled as such.
// Context beside a failure was the timid version of advancing the base.
//
// What must NOT be lost with it is the invariant that made the old path
// safe, and that invariant is P2 below: prior-period rows are never merged
// into the current ladder, and the base is never swapped for whichever
// filing reconciles more tidily. `priorScheduleSequence` itself is
// deliberately RETAINED — position.ts's `unconfirmed` pass still needs it to
// spot a tranche that vanished with no redemption explaining it — so P2 is
// testing live behaviour, not a vestige. ---

// --- P2: THE CRITICAL INVARIANT — prior-period rows are never merged into
// the current ladder, and the base filing is never swapped for the tidier
// one. The rendered ladder must still be the CURRENT filing's two rows. ---
{
  const company = chsShapedCompany({
    scheduleSequence: [
      syntheticRow({ label: "CURRENT ONLY", rate: "8.000%", maturityDate: "2027-01-01", dateGranularity: "year" }),
    ],
    priorScheduleSequence: [
      syntheticRow({ label: "PRIOR A", rate: "3.111%", maturityDate: "2028-01-01", dateGranularity: "year" }),
      syntheticRow({ label: "PRIOR B", rate: "3.222%", maturityDate: "2029-01-01", dateGranularity: "year" }),
      syntheticSubtotal("Total debt", "$2.0 billion"),
    ],
    debtSchedulePriorFiling: PRIOR_FILING,
  });
  const table = buildCompanyTableBlock(company, []);
  const renderedLabels = table.refiLadder.nearestLines.map((l) => l.row.instrument);
  assert(
    renderedLabels.includes("CURRENT ONLY"),
    `[P2a] the current filing's own row still renders as the ladder (got: ${JSON.stringify(renderedLabels)})`
  );
  assert(
    !renderedLabels.some((l) => l.startsWith("PRIOR")),
    `[P2b] NO prior-period row is merged into the current ladder (got: ${JSON.stringify(renderedLabels)})`
  );
  assert(
    table.refiLadder.sourceCitation?.date === "2026-07-23",
    `[P2c] the ladder's source citation is still the NEWEST filing — base selection was not swapped for the one that reconciles (got: ${table.refiLadder.sourceCitation?.date})`
  );
  assert(
    table.refiLadder.nearestLines.every((l) => !l.cardEligible),
    "[P2d] no prior-period line is card-eligible"
  );
}

// --- P3: REVERSE ASSERTION — when the base ladder passes its checks, no
// prior-period context appears at all, even though a prior schedule exists.
// Context is for a failed base ladder only, never routine clutter. ---
{
  const company = chsShapedCompany({
    scheduleSequence: [
      syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }),
      syntheticSubtotal("Total debt", "$1.0 billion"),
    ],
    balanceSheetDebtCaptions: [
      { label: "Long-term debt", amount: "$1.0 billion", sourceLine: "s", citedUrl: "https://example.com/synthetic-10q", periodColumn: null },
    ],
    priorScheduleSequence: [
      syntheticRow({ label: "PRIOR A", rate: "3.111%", maturityDate: "2028-01-01", dateGranularity: "year" }),
      syntheticSubtotal("Total debt", "$2.0 billion"),
    ],
    debtSchedulePriorFiling: PRIOR_FILING,
  });
  const table = buildCompanyTableBlock(company, []);
  assert(table.refiLadder.walkCheck.pass && table.refiLadder.balanceSheetCheck.pass, "[P3-setup] this base ladder passes both checks");
  // P3's own context assertion retired with the render path (see P1). What
  // still matters — and is subtly different — is that a prior-period row may
  // only ever appear via the `unconfirmed` pass, explicitly labelled as such.
  // It must never be presented as a live, current tranche. (A prior row DOES
  // legitimately surface here: the base ladder reconciles, so the unconfirmed
  // pass runs and flags the tranche that dropped off with nothing explaining
  // it. That is the feature, not a leak.)
  assert(
    table.refiLadder.nearestLines.every((l) => !l.row.instrument.startsWith("PRIOR") || l.row.status === "unconfirmed"),
    `[P3] a prior-period row can only appear as \`unconfirmed\`, never as a live tranche (got: ${JSON.stringify(table.refiLadder.nearestLines.map((l) => `${l.row.instrument}:${l.row.status}`))})`
  );
}

// --- P4: only ONE check failing is not enough — a partial failure still
// means the current filing produced a usable ladder. ---
{
  const company = chsShapedCompany({
    scheduleSequence: [
      syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" }),
      syntheticSubtotal("Total debt", "$1.0 billion"),
    ],
    // Check 1 passes; Check 2 fails (no captions extracted at all).
    balanceSheetDebtCaptions: [],
    priorScheduleSequence: [syntheticRow({ label: "PRIOR A", rate: "3.111%", maturityDate: "2028-01-01", dateGranularity: "year" })],
    debtSchedulePriorFiling: PRIOR_FILING,
  });
  const table = buildCompanyTableBlock(company, []);
  assert(table.refiLadder.walkCheck.pass && !table.refiLadder.balanceSheetCheck.pass, "[P4-setup] Check 1 passes, Check 2 fails");
  assert(
    table.refiLadder.nearestLines.every((l) => !l.row.instrument.startsWith("PRIOR") || l.row.status === "unconfirmed"),
    `[P4] with one check failing, a prior-period row is still only ever \`unconfirmed\` (got: ${JSON.stringify(table.refiLadder.nearestLines.map((l) => `${l.row.instrument}:${l.row.status}`))})`
  );
}

// --- P5: both checks fail but there IS no prior filing -> no context, no
// crash, and the base ladder's own failure still renders. ---
{
  const company = chsShapedCompany({
    scheduleSequence: [syntheticRow({ label: "A", rate: "5.000%", maturityDate: "2027-06-01", dateGranularity: "day" })],
    priorScheduleSequence: [],
    debtSchedulePriorFiling: null,
  });
  const table = buildCompanyTableBlock(company, []);
  assert(table.refiLadder.hasData && table.refiLadder.nearestLines.length === 1, "[P5] no prior filing at all -> the base ladder still renders its own row and its own failure, no crash");
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

// --- C: DaVita's real completed new-debt-issuance renders its AGE, not "".
//
// INVERTED for Session 18 D3. This originally asserted the bare word
// "completed". D3 requires a completed event over 12 months old to render
// how old it is, and this fixture's issuance is from 2025 — so against a
// fixed "now" it is genuinely stale and must say so. The property the
// assertion actually protects (never blank, always a real phrase) is
// unchanged and is what [C1] enforces book-wide; only the exact wording for
// an OLD completion moved. A recent completion still renders plain
// "completed" — asserted below. ---
{
  const davita = companyFor("DVA");
  const table = buildCompanyTableBlock(davita, []);
  const line = table.buckets.new_debt.find((l) => l.triggerId === "new-debt-issuance");
  assert(
    !!line && /^completed( \d+yr( \d+mo)?| \d+mo)? ago$|^completed$/.test(line.timingPhrase),
    `[C2] DaVita new-debt-issuance (status=completed) renders a real completed phrase (got: ${JSON.stringify(line?.timingPhrase)})`
  );
  assert(
    !!line && line.timingPhrase !== "",
    `[C2b] ...and it is never blank — the never-blank floor D3 must not break`
  );
  // D3's own reason for existing: a stale completion must be distinguishable
  // from a recent one. Cigna's HCSC sale read a bare "completed" while being
  // over a year old.
  assert(
    !!line && / ago$/.test(line.timingPhrase),
    `[C2c] ...and because this issuance IS over 12 months old, it states its age (got: ${JSON.stringify(line?.timingPhrase)})`
  );
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
