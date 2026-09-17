/**
 * SESSION 21, STAGE 5 — THE DERIVED LINES, PINNED.
 *
 * Four lines, all arithmetic over verified fields. The assertions that matter
 * most are the NEGATIVE ones, because every failure mode this suite pins was
 * a real defect in the first draft of the module it tests:
 *
 *   - a year-granularity maturity must produce NO month count
 *   - a figure with no source sentence behind it must be WITHHELD, not printed
 *   - a redemption must NOT be dated by the issuance that funded it
 *   - the clock is a required parameter, so a second one cannot appear
 *
 * Fixtures are synthetic. The real book is asserted separately, at the book
 * gate, on what is actually there.
 *
 * Run: npx tsx lib/events/derived.test.ts
 */
import { monthsBetween, isWithinMonths, monthsLabel } from "./eventTiming";
import { buildDerivedLines, derivedLinePasses, type DerivedLine } from "./derived";
import type { CompanyPosition, LadderRow } from "./position";
import type { FlashCard } from "./buildEvents";
import type { TriggerResult } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const ASOF = new Date("2026-09-04T00:00:00Z");

const row = (o: Partial<LadderRow> & { id: string }): LadderRow =>
  ({ instrument: "notes", rate: null, seniority: null, amount: "$500 million", maturityDate: null,
     dateGranularity: null, sourceLine: "src", citedUrl: "u", status: "live", provenance: "note", ...o } as LadderRow);

const position = (rows: LadderRow[]): CompanyPosition =>
  ({ rows, tier2: { events: [], rolledTotal: null, rolledLabel: null, anchorDate: null }, statedIntentions: [],
     rowsOutsideSubtotal: [], issuancesInsideAggregate: [], adjustments: [], finalSubtotal: null, baseFiling: null,
     baseLadderUntrustworthy: false, rowsNotVerifiedAsTranscribed: false, walkGapFraction: null } as unknown as CompanyPosition);

const card = (rowId: string | null): FlashCard =>
  ({ id: "c1", company: "Meridian Health Partners", cik: "1", ticker: "MHP", headlineRowId: rowId,
     alsoMaturingRowIds: [], alsoActive: [], citations: [] } as unknown as FlashCard);

const issuance = (o: Partial<TriggerResult>): TriggerResult =>
  ({ triggerId: "new-debt-issuance", fired: true, redeems: [], citations: [], ...o } as unknown as TriggerResult);

const find = (ls: DerivedLine[], k: string) => ls.find((l) => l.kind === k);

console.log("\n=== [1] MONTHS TO MATURITY — the pinned clock, and the year rule ===");
{
  const r = row({ id: "a", instrument: "4.60% Senior Notes due December 2027", maturityDate: "2027-12-01",
    dateGranularity: "month", sourceLine: "4.60 % Senior Notes due December 2027 500 500" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([r]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  const m = find(lines, "months-to-maturity")!;
  // 14, NOT 15, AND THE CHANGE IS THE POINT (Session 22, Stage 1). From
  // 2026-09-04 to 2027-12-01 is fourteen whole calendar months and 27 days.
  // The old arithmetic divided 453 elapsed days by an average month of 30.44
  // and rounded to 15 — a number that was never wrong so much as never
  // defined, since nothing stated whether it counted completed months or
  // month boundaries. The convention is now named in the BRD and this is
  // what it says: whole calendar months COMPLETED.
  assert(m.computed === "14 months" && m.text.includes("14 months out"),
    `[1a] a month-granularity maturity computes WHOLE CALENDAR MONTHS COMPLETED against the PINNED as-of, not a fresh clock and not days/30.44 (got ${m.computed})`);
  assert(!m.text.includes("2026"),
    `[1b] and does NOT print the run date — it is identical on every line and the surface states it once; printing it would put a token in every line that no filing states (${m.text})`);
}
{
  const r = row({ id: "a", instrument: "5.125 % due 2027", maturityDate: "2027", dateGranularity: "year", sourceLine: "5.125 % due 2027 1,500 1,500" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([r]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  const m = find(lines, "months-to-maturity")!;
  assert(m.computed === null && !/\d+ months/.test(m.text),
    `[1c] A YEAR-GRANULARITY MATURITY PRODUCES NO MONTH COUNT. Only December of that year is N months out and the filing does not say which month — a count here is precision nobody disclosed (${m.text})`);
  assert(m.text.includes("2027") && m.text.includes("states only the year"),
    "[1d] and the line still RENDERS, stating the year and stating why there is no count — never a blank");
}
{
  const r = row({ id: "a", instrument: "1.65% Notes due 2026", maturityDate: "2026-09-01", dateGranularity: "day",
    status: "matured", sourceLine: "1.65 % Senior Secured Notes due 2026-09-01 700" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([r]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  const m = find(lines, "months-to-maturity")!;
  assert(m.text.startsWith("MATURED") && m.text.includes("still carried"),
    `[1e] a maturity already past states that it is past AND still carried — the pending state, in one line (${m.text})`);
  assert(m.text.includes("less than a month ago") && !m.text.includes("0 months"),
    `[1f] AND THE SIGN COMES FROM THE DATES, NOT THE ROUNDED COUNT. monthsBetween rounds, so this tranche — matured three days before the as-of — returned 0 and the first draft read it as "0 months out", i.e. upcoming. The one thing this line exists to get right (${m.text})`);
}

console.log("\n=== [2] REFI PATTERN — dated by the ISSUANCE, never by the redemption ===");
{
  const retired = row({ id: "a", instrument: "4.50 % Senior Notes due 2028", rate: "4.50%", maturityDate: "2028-02-01",
    dateGranularity: "day", sourceLine: "4.50 % Senior Notes due 2028-02-01 396.9" });
  const nd = issuance({
    eventDate: "2026-05-29",
    verifiedQuote: "In May 2026, we issued $ 500 million of 5.875 % Senior Notes due 2034 at par.",
    redeems: [{ instrument: "4.50 % Senior Notes due 2028", amount: "$400 million", status: "completed", verified: true,
      sourceLine: "we issued $ 500 million of 5.875 % Senior Notes due 2034 at par" }],
  } as Partial<TriggerResult>);
  const { lines } = buildDerivedLines({ card: card("a"), position: position([retired]), debtMaturity: undefined, newDebtIssuance: nd, asOf: ASOF });
  const p = find(lines, "refi-pattern")!;
  assert(p.text.includes("Last refinanced") && p.text.includes("an issuance dated 2026-05-29"),
    `[2a] THE DATE BELONGS TO THE ISSUANCE AND THE LINE SAYS SO. A RedeemsClaim carries no date; writing "retired on <the issuance's date>" asserts a retirement date no filing states — the amount-join defect one field over, and this line read exactly that way first (${p.text})`);
  assert(!/retired .* on 2026-05-29/.test(p.text),
    "[2b] REVERSE: it must not read as though the tranche was called on the day the new notes priced");
  assert(p.computed === "3 months",
    `[2c] the age is months from the issuance to the pinned as-of (got ${p.computed})`);
  assert(p.text.includes("20 months ahead of the retired tranche's stated 2028-02-01 maturity"),
    `[2d] and where the retired tranche's maturity is STRUCTURALLY available, the months-ahead figure is computed from it (${p.text})`);
}
{
  // The claim names a rate no row shares. Measured on the real book, a loose
  // substring match paired CHS's 5.625% claim with its unrelated 6% row.
  const other = row({ id: "a", instrument: "6 % Senior Secured Notes due 2029", rate: "6%", maturityDate: "2029-01-15",
    dateGranularity: "day", sourceLine: "6 % Senior Secured Notes due 2029-01-15 644" });
  const nd = issuance({ eventDate: "2025-08-12",
    verifiedQuote: "the redemption of all of our 5.625 % Senior Secured Notes due 2027",
    redeems: [{ instrument: "5.625 % Senior Secured Notes due 2027", amount: "$1.743 billion", status: "completed", verified: true,
      sourceLine: "we used the net proceeds to finance the redemption of our 5.625 % Senior Secured Notes due 2027" }] } as Partial<TriggerResult>);
  const { lines } = buildDerivedLines({ card: card("a"), position: position([other]), debtMaturity: undefined, newDebtIssuance: nd, asOf: ASOF });
  const p = find(lines, "refi-pattern");
  assert(!!p && !p.text.includes("2029") && p.text.includes("no structured maturity"),
    `[2e] A 5.625% CLAIM DOES NOT MATCH A 6% ROW. "6" is a substring of "6.250" and of "5.625" — identity is rate AND the row's own maturity year, together, never a substring (${p?.text ?? "WITHHELD"})`);
}
{
  const nd = issuance({ eventDate: "2026-01-01", redeems: [
    { instrument: "x", amount: "$1", status: "intended", verified: true, sourceLine: "s" },
    { instrument: "y", amount: "$2", status: "completed", verified: false, sourceLine: "s" },
  ] } as Partial<TriggerResult>);
  const { lines } = buildDerivedLines({ card: card(null), position: position([]), debtMaturity: undefined, newDebtIssuance: nd, asOf: ASOF });
  const p = find(lines, "refi-pattern")!;
  assert(p.computed === null && p.text.includes("No verified, corroborated-completed redemption"),
    `[2f] AN INTENDED RETIREMENT AND AN UNVERIFIED ONE ARE BOTH NOT A PATTERN — the same two gates a row needs to retire at all (${p.text})`);
}

console.log("\n=== [3] NEXT TRANCHE UP — a sort of the company's own ladder ===");
{
  const a = row({ id: "a", instrument: "4.25% due 2027", maturityDate: "2027-12-15", dateGranularity: "day", sourceLine: "4.25 % due 2027-12-15 1,067" });
  const b = row({ id: "b", instrument: "2.45% due 2028", maturityDate: "2028-07-15", dateGranularity: "day", sourceLine: "2.45 % due 2028-07-15 2,160" });
  const cap = row({ id: "c", instrument: "revolver", maturityDate: "2027-01-01", dateGranularity: "day", isCapacity: true, sourceLine: "revolver 2027-01-01" });
  // THE FIXTURE IS IN MATURITY ORDER, because nextTranche reads the ladder
  // assemblePosition already sorted and does not re-sort it. The old fixture
  // listed the revolver (2027-01-01) AFTER the 2027-12-15 tranche and got
  // away with it only because capacity was filtered out before the ordering
  // mattered — the moment a facility joined the ladder, the unsorted fixture
  // started answering with whatever came next in the array.
  const ladderOrder = [cap, a, b];
  const { lines } = buildDerivedLines({ card: card("a"), position: position(ladderOrder), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  const n = find(lines, "next-tranche")!;
  // SESSION 22, STAGE 5 — THE RULE CHANGED, AND THIS ASSERTS THE NEW ONE.
  //
  // It read "capacity is skipped — undrawn commitment has no maturity
  // conversation, whatever date sits beside it". That is true of a drawn
  // BALANCE and false of the facility: a revolver coming due is a renewal
  // negotiation with a date on it, which is among the strongest calls an RM
  // can make. Quest is the measured case — its secured receivables facility
  // matures November 2027, inside the window, and the old rule left its own
  // card saying "this tranche is not on the assembled ladder" about a row
  // sitting on that ladder.
  //
  // So a facility with a STATED MATURITY takes its place in the maturity
  // order like any other instrument. The fixture's revolver matures
  // 2027-01-01, BEFORE the 2027-12-15 tranche this card is about, so what
  // follows that tranche is still the 2028 note — the ordering is what
  // changed, not the answer here.
  assert(n.text.includes("2.45% due 2028") && n.computed === "7 months",
    `[3a] the next dated tranche, with the gap between the two maturities (${n.text})`);
  const capFirst = buildDerivedLines({ card: card("c"), position: position(ladderOrder), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  assert(find(capFirst.lines, "next-tranche")!.text.includes("4.25% due 2027"),
    "[3b] AND A FACILITY WITH A STATED MATURITY IS ON THE LADDER, not skipped — a card about the revolver can say what follows it");
  const undated = row({ id: "u", instrument: "undrawn revolver", maturityDate: null, dateGranularity: null, isCapacity: true, sourceLine: "undrawn revolver" });
  const noDate = buildDerivedLines({ card: card("a"), position: position([a, b, undated]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  assert(!find(noDate.lines, "next-tranche")!.text.includes("undrawn revolver"),
    "[3b2] capacity with NO stated maturity is still skipped — there is no date to order it by, and the exclusion was always really about that");
}
{
  const a = row({ id: "a", instrument: "5.125 % due 2027", maturityDate: "2027", dateGranularity: "year", sourceLine: "5.125 % due 2027 1,500" });
  const b = row({ id: "b", instrument: "6.125 % due 2028", maturityDate: "2028", dateGranularity: "year", sourceLine: "6.125 % due 2028 1,750" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([a, b]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  const n = find(lines, "next-tranche")!;
  assert(n.computed === null && n.text.includes("not computed"),
    `[3c] the year rule applies to the GAP too — two bare years cannot produce a month count between them (${n.text})`);
}
{
  const a = row({ id: "a", instrument: "last", maturityDate: "2033-01-01", dateGranularity: "day", sourceLine: "last 2033-01-01" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: undefined, newDebtIssuance: undefined, asOf: ASOF });
  assert(find(lines, "next-tranche")!.text.includes("Nothing behind it"),
    "[3d] the last tranche says so — it does not silently omit the line");
}

console.log("\n=== [4] LIQUIDITY — the verified revolver fields, and only them ===");
{
  const a = row({ id: "a", instrument: "5.125 % due 2027", amount: "$ 1,500 million", maturityDate: "2027", dateGranularity: "year", sourceLine: "5.125 % due 2027 1,500" });
  const dm = { facilities: [{ name: "revolving credit facility", category: "revolver", facilitySize: { value: "$ 1.900 billion", sourceLine: "Our borrowing availability was $ 1.900 billion at June 30, 2026." }, drawn: null,
    lettersOfCredit: { value: "less than $ 1 million", sourceLine: "Letters of credit outstanding were less than $ 1 million." },
    available: { value: "$ 1.900 billion", sourceLine: "Our borrowing availability was $ 1.900 billion at June 30, 2026." },
    asOfDate: "2026-06-30", maturity: null }] } as unknown as TriggerResult;
  const { lines } = buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: dm, newDebtIssuance: undefined, asOf: ASOF });
  const l = find(lines, "liquidity")!;
  // THE HOUSE FORMAT, INSIDE A GUARDED LINE (Session 22, Stage 1). The
  // figures render as $1.5B / $1.9B rather than as the filing's own
  // "$ 1,500 million" / "$ 1.900 billion", so the ladder and the block
  // beside it read in one unit. This is safe only because the derived
  // guard matches ACROSS SCALE where both sides carry a unit — measured
  // before the change, not assumed: "$1.5B" matches "$ 1,500 millions"
  // and would NOT have matched a bare "1,500" off a table row. The
  // as-printed string is still what verification sheets and golden files
  // carry; only the rendered line is normalised.
  // SESSION 22, STAGE 5 — LIQUIDITY IS SUMMED, NOT JUXTAPOSED.
  //
  // The line was never a liquidity figure: it was ONE facility's headroom,
  // chosen because the schema had one slot. With no cash figure in this
  // fixture it states the undrawn total and says exactly why no total is
  // computed — which is the never-suppress rule, not a silence.
  assert(l.text.includes("$1.9B of undrawn capacity across 1 committed facility") && l.text.includes("no cash balance"),
    `[4a] UNDRAWN CAPACITY IS SUMMED ACROSS EVERY FACILITY, and a missing cash figure is stated rather than assumed away (${l.text})`);
  assert(l.computed === null && !/\d+\s?%/.test(l.text) && !/cover/i.test(l.text),
    `[4b] AND STILL NO RATIO. This first read "127% of this maturity", which implies coverage the tool does not judge and divides two things that are not substitutes (${l.text})`);
  const withCash = { fired: true, cashAmount: "$ 2.170 billion", eventDate: "2026-06-30", verifiedQuote: "Cash and cash equivalents were $ 2.170 billion as of June 30, 2026." } as unknown as TriggerResult;
  const summed = find(buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: dm, newDebtIssuance: undefined, cashBalance: withCash, asOf: ASOF }).lines, "liquidity")!;
  assert(summed.computed === "$4.1B" && summed.text.includes("$4.1B of liquidity as of 2026-06-30"),
    `[4c] WITH BOTH HALVES IT IS ONE COMPUTED SUM, as-of dated: cash plus undrawn capacity (${summed.text})`);
  const mixedClock = { fired: true, cashAmount: "$ 2.170 billion", eventDate: "2026-03-31", verifiedQuote: "Cash and cash equivalents were $ 2.170 billion as of March 31, 2026." } as unknown as TriggerResult;
  const mixed = find(buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: dm, newDebtIssuance: undefined, cashBalance: mixedClock, asOf: ASOF }).lines, "liquidity")!;
  assert(mixed.computed === null && mixed.text.includes("different dates"),
    `[4c2] AND TWO DATES ARE NEVER ADDED. A liquidity figure summed across two as-of dates is true at neither, which is the mixed-clock error the anchor rules exist to prevent (${mixed.text})`);
}
{
  // The measured Encompass case: an availability figure that appears nowhere
  // in the sentence cited for it, and whose own revolver arithmetic does not
  // reconcile either.
  const DRAWN = "As of June 30, 2026, $ 200.0 million was drawn under the revolving credit facility with an interest rate of 4.9 %.";
  const a = row({ id: "a", instrument: "4.50%", amount: "$396.9 million", maturityDate: "2028-02-01", dateGranularity: "day", sourceLine: "4.50 % 2028-02-01 396.9" });
  const dm = { facilities: [{ name: "revolving credit facility", category: "revolver", // ENCOMPASS AS SHIPPED: one sentence, and it states only the drawn figure.
    // Post-Stage-3 the facility guard would have dropped the other three before
    // they ever reached here; this fixture keeps them to prove the DERIVED
    // guard refuses them too, so neither layer relies on the other to be safe.
    facilitySize: { value: "$1 billion", sourceLine: DRAWN }, drawn: { value: "$200.0 million", sourceLine: DRAWN }, lettersOfCredit: { value: "$46.3 million", sourceLine: DRAWN },
    available: { value: "$824 million", sourceLine: DRAWN }, asOfDate: "2026-06-30",
    maturity: null }] } as unknown as TriggerResult;
  const { lines, withheld } = buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: dm, newDebtIssuance: undefined, asOf: ASOF });
  assert(!find(lines, "liquidity") && withheld.some((w) => w.kind === "liquidity" && w.unverified.includes("$824M")),
    `[4d] AN AVAILABILITY FIGURE ITS OWN CITED SENTENCE DOES NOT CONTAIN IS WITHHELD, and named. This is the real measured case, and the note's own revolver arithmetic independently reports it as not reconciling (${JSON.stringify(withheld)})`);
}
{
  const a = row({ id: "a", instrument: "x", maturityDate: "2027-12-15", dateGranularity: "day", sourceLine: "x 2027-12-15" });
  const { lines } = buildDerivedLines({ card: card("a"), position: position([a]), debtMaturity: { facilities: [] } as unknown as TriggerResult, newDebtIssuance: undefined, asOf: ASOF });
  assert(find(lines, "liquidity")!.text.includes("neither a cash balance nor undrawn capacity"),
    "[4e] a filer with neither half says so, rather than the line vanishing");
}

console.log("\n=== [5] THE GUARD — what may appear in a derived line ===");
{
  const ok = derivedLinePasses({ kind: "months-to-maturity", label: "l", fieldInputs: [], computed: "15 months",
    inputs: ["4.60 % Senior Notes due December 2027 500 500"], text: "15 months out — matures 2027-12-01." });
  assert(ok.ok, `[5a] a date traceable to the input sentence passes, in either representation (${JSON.stringify(ok.unverified)})`);

  const bad = derivedLinePasses({ kind: "liquidity", label: "l", fieldInputs: [], computed: "127%",
    inputs: ["$ 200.0 million was drawn"], text: "$824 million of undrawn capacity — 127% of this maturity." });
  assert(!bad.ok && bad.unverified.includes("$824 million"),
    `[5b] a money figure in no input sentence FAILS and is named (${JSON.stringify(bad.unverified)})`);

  const selfless = derivedLinePasses({ kind: "refi-pattern", label: "l", fieldInputs: [], computed: "3 months", inputs: [], text: "Last refinanced 3 months ago." });
  assert(!selfless.ok,
    "[5c] A LINE THAT COMPUTED A VALUE WITH NO VERIFIED INPUT BEHIND IT FAILS. Arithmetic over nothing is an assertion, and assertions do not render here");

  const noCompute = derivedLinePasses({ kind: "liquidity", label: "l", fieldInputs: [], computed: null, inputs: [], text: "The anchor filing states no revolving facility." });
  assert(noCompute.ok,
    "[5d] but a line that computed NOTHING and states only why is fine with no inputs — that is the never-suppress case, and it asserts no figure");
}
{
  const retired = row({ id: "a", instrument: "4.50 % Notes due 2028", rate: "4.50%", maturityDate: "2028-02-01",
    dateGranularity: "day", sourceLine: "4.50 % Notes due 2028 396.9" });
  const nd = issuance({ eventDate: "2026-05-29", verifiedQuote: "we redeemed our 4.50 % Notes due 2028",
    redeems: [{ instrument: "4.50 % Notes due 2028", amount: "$400 million", status: "completed", verified: true,
      sourceLine: "we redeemed our 4.50 % Notes due 2028" }] } as Partial<TriggerResult>);
  const { lines } = buildDerivedLines({ card: card("a"), position: position([retired]), debtMaturity: undefined, newDebtIssuance: nd, asOf: ASOF });
  const p = find(lines, "refi-pattern")!;
  assert(!p.inputs.includes("2026-05-29") && p.fieldInputs.some((f) => f.value === "2026-05-29" && f.verifiedBy.includes("event-date guard")),
    `[5e] A NORMALIZED FIELD IS DECLARED AS A FIELD, NOT AS A SOURCE SENTENCE. The filing prints "May 29, 2026"; the ISO form is verified by the event-date guard and is text no document contains. A verification sheet that searched for it and reported NOT FOUND would teach its reader to skip warnings, which on a sheet meant for signature is worse than showing none (${JSON.stringify(p.fieldInputs)})`);
  assert(derivedLinePasses(p).ok,
    "[5f] and the token guard trusts a field input exactly as it trusts a source sentence — the distinction is what the sheet can LOCATE, never what it can rely on");
}

console.log("\n=== [6] Scope — which lines a card gets, by what the line needs ===");
{
  const nd = issuance({ eventDate: "2026-05-06",
    verifiedQuote: "we redeemed our 3.45% Notes due June 2026",
    redeems: [{ instrument: "3.45% Notes due June 2026", amount: "$500 million", status: "completed", verified: true,
      sourceLine: "we redeemed our 3.45% Notes due June 2026" }] } as Partial<TriggerResult>);
  const { lines } = buildDerivedLines({ card: card(null), position: position([]), debtMaturity: undefined, newDebtIssuance: nd, asOf: ASOF });
  assert(lines.length === 1 && lines[0].kind === "refi-pattern",
    `[6a] a card with no headline ladder row gets the COMPANY-level line only. Scoped by what each line needs, never by which trigger the card happens to be (got ${lines.map((l) => l.kind).join(",")})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }

console.log("\n=== [9] THE MONTH CONVENTION, PINNED AT ITS BOUNDARIES ===");
{
  const at = new Date("2026-09-04T00:00:00Z");
  assert(monthsBetween("2027-09-04", at) === 12,
    "[9a] the anniversary itself is a whole month count — twelve months to the day is 12, not 11");
  assert(monthsBetween("2027-09-03", at) === 11,
    "[9b] ONE DAY SHORT IS ONE MONTH SHORT. The count is months COMPLETED, so a day before the anniversary has not completed it — this is the half the old rounding got wrong in both directions");
  assert(monthsBetween("2026-01-31", new Date("2025-12-31T00:00:00Z")) === 1,
    "[9c] end-of-month clamps rather than overflowing — Dec 31 to Jan 31 is one month, not zero");
  assert(monthsBetween("2026-08-04", at) === -1,
    "[9d] a past date counts negative, so a caller can tell direction from the number instead of re-deriving it (Rule 28)");
  assert(isWithinMonths("2028-03-04", at, 18) && !isWithinMonths("2028-03-05", at, 18),
    "[9e] THE WINDOW IS A DATE COMPARISON. Eighteen calendar months after 2026-09-04 is 2028-03-04; the day after is outside. No count is consulted, so no rounding can carry a row across the boundary");
  assert(monthsLabel(1) === "1 month" && monthsLabel(0) === "0 months" && monthsLabel(17) === "17 months",
    "[9f] one month is singular — \"1 months ahead\" shipped on Quest's card");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
