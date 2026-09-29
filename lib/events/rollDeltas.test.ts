/**
 * SESSION 25 — DERIVING THE ROLL'S DELTAS, ON FIXTURES. Offline, $0.
 *
 * `rollForward.test.ts` pins the ARITHMETIC against hand-verified numbers,
 * with its deltas written by hand in the test. This suite pins the half that
 * was missing: reading those deltas OUT of the filings, and placing each one
 * by its own date.
 *
 * Cigna's real shapes, constructed rather than loaded, so this asserts the
 * rule and does not go green merely because Cigna still has the filings it has
 * today.
 *
 * Run: npx tsx lib/events/rollDeltas.test.ts
 */
import { derivePlacedMovements, toRollDeltas, inBaseButMissing, placeByDate, statesApproximation, sameInstrument } from "./rollDeltas";
import { computeRollTie, toleranceFor } from "./rollForward";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const BASE = "2025-12-31";
const ANCHOR = "2026-06-30";
/** Millions, the unit rollForward works in. */
const millions = (a: string): number | null => {
  const m = a.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(billion|million)?/i);
  if (!m) return null;
  return Number(m[1]) * (/billion/i.test(m[2] ?? "") ? 1000 : 1);
};

const inputs = (over: Partial<Parameters<typeof derivePlacedMovements>[0]> = {}) => ({
  baseDate: BASE,
  anchorDate: ANCHOR,
  noteRetirements: [{
    instrument: "$ 550 million, 1.250 % Notes due March 2026", amount: "$ 550 million", eventDate: "2026-03-01",
    sourceLine: "During the six months ended June 30, 2026, the Company repaid $ 550 million 1.250 % senior notes that matured in March 2026.",
    citedUrl: "https://sec.gov/anchor.htm",
  }],
  issuedTranches: [
    { instrument: "4.500% Senior Notes due 2030", amount: "$ 1,000 million", sourceLine: "…$1,000,000,000 aggregate principal…", citedUrl: "https://sec.gov/8k.htm" },
    { instrument: "4.875% Senior Notes due 2032", amount: "$ 1,250 million", sourceLine: "…", citedUrl: "https://sec.gov/8k.htm" },
    { instrument: "5.250% Senior Notes due 2036", amount: "$ 1,500 million", sourceLine: "…", citedUrl: "https://sec.gov/8k.htm" },
    { instrument: "6.000% Senior Notes due 2056", amount: "$ 750 million", sourceLine: "…", citedUrl: "https://sec.gov/8k.htm" },
  ],
  issuanceDate: "2025-09-04",
  intendedRedemptions: [{ instrument: "Term Loan Facility", amount: "$ 2.0 billion", status: "intended", sourceLine: "The Company intends to use the proceeds (i) to repay $2.0 billion of loans outstanding…" }],
  anchorBalances: [{
    name: "Commercial paper program", amount: "$ 1.0 billion", amountBasis: "outstanding", asOfDate: ANCHOR,
    sourceLine: "The commercial paper program had approximately $ 1.0 billion outstanding as of June 30, 2026 and an average interest rate of 3.92 %.",
    citedUrl: "https://sec.gov/anchor.htm",
  }],
  baseRows: [
    { instrument: "$ 1,000 million, 4.500% Notes due September 2030", amount: "$993", sourceLine: "…" },
    { instrument: "$ 1,250 million, 4.875% Notes due September 2032", amount: "$1,243", sourceLine: "…" },
    { instrument: "$ 1,500 million, 5.250% Notes due January 2036", amount: "$1,488", sourceLine: "…" },
    { instrument: "$ 750 million, 6.000% Notes due January 2056", amount: "$735", sourceLine: "…" },
    { instrument: "Commercial paper", amount: "$0", sourceLine: "Commercial paper $ —" },
  ],
  parseMillions: (a: string) => millions(a),
  ...over,
});

console.log("=== [1] EVERY MOVEMENT IS PLACED BY ITS OWN DATE ===");
{
  assert(placeByDate("2025-09-04", BASE, ANCHOR) === "in-base",
    "[1a] before the base date is IN-BASE — Cigna's four tranches, priced 2025-09-04 against a 2025-12-31 base");
  assert(placeByDate("2026-03-01", BASE, ANCHOR) === "delta",
    "[1b] between the dates is a DELTA — the 1.250% notes repaid in March 2026");
  assert(placeByDate("2026-08-15", BASE, ANCHOR) === "subsequent",
    "[1c] after the anchor is SUBSEQUENT — real, and not part of a position as of the anchor");
  assert(placeByDate(null, BASE, ANCHOR) === "undated",
    "[1d] and an undated movement cannot be placed at all, which is its own answer rather than a default bucket");
}

console.log("\n=== [2] $4.5 BILLION IN THE BASE, PROVEN BOTH WAYS ===");
{
  const m = derivePlacedMovements(inputs());
  const issuances = m.filter((x) => x.kind === "issuance");
  assert(issuances.length === 4 && issuances.every((x) => x.placement === "in-base"),
    `[2a] all four tranches place as IN-BASE on their own pricing date (got ${issuances.map((x) => x.placement).join(", ")})`);
  assert(toRollDeltas(m).every((d) => !/Senior Notes due 20(30|32|36|56)/.test(d.label)),
    "[2b] so none of the $4.5 billion reaches rollForward as a delta — counting it would overstate the roll by its full principal");
  assert(inBaseButMissing(m, inputs().baseRows).length === 0,
    "[2c] AND THE CLAIM IS CHECKED against the transcription. 'The base already carries it' is an assertion about the transcribed rows, and an unchecked one lets the roll tie for the wrong reason");

  const short = inputs().baseRows.filter((x) => !String(x.instrument).includes("6.000%"));
  const missing = inBaseButMissing(m, short);
  assert(missing.length === 1 && missing[0].instrument.includes("6.000%"),
    "[2d] REVERSE: an in-base movement absent from the transcription is REPORTED — the base is short by that amount, which is a finding rather than a rounding");
}

console.log("\n=== [3] THE DERIVED DELTAS FEED THE EXISTING ARITHMETIC ===");
{
  const deltas = toRollDeltas(derivePlacedMovements(inputs()));
  assert(deltas.length === 2,
    `[3a] exactly two movements are handed to rollForward: the repayment and the commercial-paper balance change (got ${deltas.length}: ${deltas.map((d) => d.label).join(", ")})`);
  const tie = computeRollTie(31463, deltas, 31878);
  assert(tie.computedMillions === 31913 && tie.residualMillions === 35 && tie.ties,
    `[3b] and they reproduce the hand-verified roll exactly — 31,463 − 550 + 1,000 = 31,913, residual 35, ties (got ${tie.computedMillions}/${tie.residualMillions}/${tie.ties})`);
  assert(toleranceFor(deltas) === 50,
    "[3c] the band is earned by the commercial paper's stated approximation, decided by rollForward's own toleranceFor rather than re-implemented here");

  const exactOnly = toRollDeltas(derivePlacedMovements(inputs({ anchorBalances: [] })));
  assert(toleranceFor(exactOnly) === 0,
    "[3d] and a roll derived with no approximate figure earns NO band — so a residual it cannot explain is a roll that is wrong");
}

console.log("\n=== [4] AN INTENT IS NOT A MOVEMENT ===");
{
  const m = derivePlacedMovements(inputs());
  const intent = m.find((x) => x.instrument === "Term Loan Facility");
  assert(!!intent && intent.placement === "excluded-not-completed",
    "[4a] a $2.0 billion repayment the filing states an INTENTION about is excluded by status, not by date");
  assert(!!intent && intent.why.includes("has not left"),
    "[4b] carried as an excluded movement with its reason rather than dropped — a roll counting it would report money that has not left");
  assert(!toRollDeltas(m).some((d) => d.label === "Term Loan Facility"),
    "[4c] so it never reaches the arithmetic. $2.0 billion is the largest single figure in this company's filings");
}

console.log("\n=== [5] A REVOLVING BALANCE, AND ITS APPROXIMATION ===");
{
  const m = derivePlacedMovements(inputs());
  const cp = m.find((x) => x.kind === "balance-change");
  assert(!!cp && cp.amountMillions === 1000,
    `[5a] commercial paper moves by the DIFFERENCE of two stated balances — $1.0B at the anchor against $— at the base — because a revolving balance has no event to cite (got ${cp?.amountMillions})`);
  assert(statesApproximation("had approximately $ 1.0 billion outstanding"),
    "[5b] the filer's own hedge is detected — 'approximately' is the filing's word, not our uncertainty");
  assert(!statesApproximation("the Company repaid $ 550 million 1.250 % senior notes"),
    "[5c] and an exact statement is not treated as hedged");
  assert(toRollDeltas(m).find((d) => /Commercial paper/.test(d.label))?.statedApproximate === true,
    "[5d] the flag travels with the delta, which is what rollForward reads to decide whether a band exists at all");

  const noBase = derivePlacedMovements(inputs({ baseRows: [] }));
  assert(!noBase.some((x) => x.kind === "balance-change"),
    "[5e] REVERSE: with no balance stated at the BASE there is nothing to difference, and no delta is invented — a guess is not a movement");
}

console.log("\n=== [6] INSTRUMENT IDENTITY, for the in-base check ===");
{
  assert(sameInstrument("4.500% Senior Notes due 2030", "$ 1,000 million, 4.500% Notes due September 2030"),
    "[6a] one tranche under two of the filing's own phrasings matches on rate and year (Rule 49)");
  assert(!sameInstrument("4.500% Senior Notes due 2030", "4.875% Senior Notes due 2032"),
    "[6b] and two notes differing in coupon are two notes — strict on the rate, because that is what distinguishes them");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
