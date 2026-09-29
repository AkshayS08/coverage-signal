/**
 * SESSION 25 — THE DERIVED ROLL, ON FIXTURES. Offline, $0.
 *
 * Cigna's real shapes, constructed rather than loaded, so this suite asserts
 * the RULE and does not go green merely because Cigna still has the filings it
 * has today.
 *
 * Run: npx tsx lib/events/rollForward.test.ts
 */
import { deriveRollEvents, rollForward, placeByDate, statesApproximation, sameInstrument } from "./rollForward";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const BASE = "2025-12-31";
const ANCHOR = "2026-06-30";
const parse = (s: string): number | null => {
  const m = s.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(billion|million|thousand)?/i);
  if (!m) return null;
  const mult = /billion/i.test(m[2] ?? "") ? 1e9 : /million/i.test(m[2] ?? "") ? 1e6 : /thousand/i.test(m[2] ?? "") ? 1e3 : 1;
  return Number(m[1]) * mult;
};
/** The base note prints in millions under its caption. */
const resolveBase = (a: string) => (parse(a) === null ? null : (parse(a) as number) * 1e6);

const inputs = (over: Partial<Parameters<typeof deriveRollEvents>[0]> = {}) => ({
  baseDate: BASE,
  anchorDate: ANCHOR,
  noteRetirements: [{
    instrument: "$ 550 million, 1.250 % Notes due March 2026",
    amount: "$ 550 million", eventDate: "2026-03-01",
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
    name: "Commercial paper program", category: "commercial-paper", amount: "$ 1.0 billion",
    amountBasis: "outstanding", asOfDate: ANCHOR,
    sourceLine: "The commercial paper program had approximately $ 1.0 billion outstanding as of June 30, 2026 and an average interest rate of 3.92 %.",
    citedUrl: "https://sec.gov/anchor.htm",
  }],
  baseRows: [
    { instrument: "$ 1,000 million, 4.500% Notes due September 2030", amount: "$993", sourceLine: "…" },
    { instrument: "$ 1,250 million, 4.875% Notes due September 2032", amount: "$1,243", sourceLine: "…" },
    { instrument: "$ 1,500 million, 5.250% Notes due January 2036", amount: "$1,488", sourceLine: "…" },
    { instrument: "$ 750 million, 6.000% Notes due January 2056", amount: "$735", sourceLine: "…" },
    { instrument: "$ 550 million, 1.250% Notes due March 2026", amount: "$549", sourceLine: "…" },
    { instrument: "Commercial paper", amount: "$—", sourceLine: "Commercial paper $ —" },
  ],
  parse,
  resolveBase,
  ...over,
});

console.log("\n=== [1] EVERY EVENT IS PLACED BY ITS OWN DATE ===");
{
  assert(placeByDate("2025-09-04", BASE, ANCHOR) === "in-base",
    "[1a] before the base date is IN-BASE — Cigna's four tranches, priced 2025-09-04 against a 2025-12-31 base");
  assert(placeByDate("2026-03-01", BASE, ANCHOR) === "delta",
    "[1b] between the dates is a DELTA — the 1.250% notes repaid in March 2026");
  assert(placeByDate("2026-08-15", BASE, ANCHOR) === "subsequent",
    "[1c] after the anchor is SUBSEQUENT — real, and not part of a position as of the anchor");
  assert(placeByDate(null, BASE, ANCHOR) === "undated",
    "[1d] and an undated event cannot be placed at all, which is its own answer rather than a default bucket");
}

console.log("\n=== [2] CIGNA'S $4.5B OF NOTES ARE IN THE BASE, AND IT IS PROVEN ===");
{
  const ev = deriveRollEvents(inputs());
  const issuances = ev.filter((e) => e.kind === "issuance");
  assert(issuances.length === 4 && issuances.every((e) => e.placement === "in-base"),
    `[2a] all four tranches place as IN-BASE on their own pricing date (got ${issuances.map((e) => e.placement).join(", ")})`);
  const r = rollForward(31_463_000_000, ev, inputs().baseRows);
  assert(r.counted.every((e) => e.kind !== "issuance"),
    "[2b] so none of the $4.5 billion is counted as a movement — counting it would overstate the roll by its full principal");
  assert(r.missingFromBase.length === 0,
    `[2c] AND THE IN-BASE CLAIM IS CHECKED: every one is found among the transcribed base rows. "The base already carries it" is an assertion about the transcription, and an unchecked one would let the roll tie for the wrong reason (missing: ${r.missingFromBase.map((e) => e.instrument).join(", ") || "none"})`);

  const shortBase = inputs().baseRows.filter((x) => !String(x.instrument).includes("6.000%"));
  const r2 = rollForward(31_463_000_000, ev, shortBase);
  assert(r2.missingFromBase.length === 1 && r2.missingFromBase[0].instrument.includes("6.000%"),
    "[2d] REVERSE: an in-base event absent from the transcription is REPORTED — the base is short by that amount and that is a finding, not a rounding");
}

console.log("\n=== [3] THE ROLL ITSELF ===");
{
  const ev = deriveRollEvents(inputs());
  const r = rollForward(31_463_000_000, ev, inputs().baseRows);
  assert(r.counted.length === 2,
    `[3a] exactly two movements are counted: the repayment and the commercial paper balance change (got ${r.counted.length}: ${r.counted.map((e) => e.instrument).join(", ")})`);
  assert(r.total === 31_913_000_000,
    `[3b] 31,463 − 550 + 1,000 = 31,913, derived from sentences with nothing typed in (got ${(r.total / 1e6).toLocaleString()}M)`);
  assert(Math.abs(r.total - 31_878_000_000) <= 50_000_000,
    "[3c] which lands inside the ±$50M band of the anchor's own stated total");

  const cp = r.counted.find((e) => e.kind === "balance-change");
  assert(!!cp && cp.amountUsd === 1_000_000_000,
    "[3d] the commercial paper movement is the DIFFERENCE of two stated balances — $1.0B at the anchor against $— at the base — because a revolving balance moves with no event to cite");
}

console.log("\n=== [4] AN INTENT IS NOT A MOVEMENT ===");
{
  const ev = deriveRollEvents(inputs());
  const intent = ev.find((e) => e.instrument === "Term Loan Facility");
  assert(!!intent && intent.placement === "excluded-not-completed",
    "[4a] a $2.0 billion repayment the filing states an INTENTION about is excluded by status, not by date");
  assert(!!intent && intent.amountUsd === 0 && intent.why.includes("has not left"),
    "[4b] and it is carried as an excluded event with its reason rather than dropped — a roll that counted it would report money that has not left");
  const r = rollForward(31_463_000_000, ev, inputs().baseRows);
  assert(!r.counted.some((e) => e.instrument === "Term Loan Facility"),
    "[4c] so it moves nothing. $2.0 billion is the largest single figure in this company's filings and the roll must not touch it");
}

console.log("\n=== [5] APPROXIMATION IS CARRIED, AND IS THE ONLY THING THE BAND MAY ABSORB ===");
{
  assert(statesApproximation("had approximately $ 1.0 billion outstanding") === true,
    "[5a] the filing's own hedge is detected — 'approximately' is the filer's word, not our uncertainty");
  assert(statesApproximation("the Company repaid $ 550 million 1.250 % senior notes") === false,
    "[5b] and an exact statement is not treated as hedged");

  const ev = deriveRollEvents(inputs());
  const r = rollForward(31_463_000_000, ev, inputs().baseRows);
  assert(r.approximateUsd === 1_000_000_000,
    `[5c] the approximate share of the counted movement is reported, so a reader knows which part of a $35M residual is the filer's own rounding (got ${(r.approximateUsd / 1e6).toLocaleString()}M)`);

  // THE RULE THAT KEEPS THE BAND HONEST.
  const exactOnly = deriveRollEvents(inputs({ anchorBalances: [] }));
  const r2 = rollForward(31_463_000_000, exactOnly, inputs().baseRows);
  assert(r2.approximateUsd === 0,
    "[5d] a roll built only from exact figures reports ZERO approximation — so a residual it cannot explain is a roll that is wrong, and the band must not launder it");
}

console.log("\n=== [6] INSTRUMENT IDENTITY, for the in-base check ===");
{
  assert(sameInstrument("4.500% Senior Notes due 2030", "$ 1,000 million, 4.500% Notes due September 2030"),
    "[6a] the same tranche under two of the filing's own phrasings matches on rate and year (Rule 49)");
  assert(!sameInstrument("4.500% Senior Notes due 2030", "4.875% Senior Notes due 2032"),
    "[6b] and two notes differing in coupon are two notes — strict on the rate, because that is what distinguishes them");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
