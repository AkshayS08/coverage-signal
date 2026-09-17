/**
 * Session 18 stage 2, Group E — golden tests for the render-layer rules.
 *
 * Entirely offline and synthetic, same convention as position.test.ts: each
 * case is pinned to a real shape observed live this session, named at the
 * assertion, so the rule is validated against something that actually
 * happened rather than an invented one.
 *
 * Run: npx tsx lib/events/groupE.test.ts
 */
import type { CompanyResult, TriggerResult, VerifiedSequenceEntry } from "../agent";
import { formatMoneyForDisplay, formatMoneyValue, normalizeMoneyInText } from "./money";
import { collapseToMostRecentPeriod } from "./evidenceCondense";
import { assemblePosition } from "./position";
import { buildEvents } from "./buildEvents";
import { buildCompanyTableBlock } from "./portfolioTable";
import { advisoryPhrasesIn, buildContext, checkCardStructure } from "./sonnetEventBriefing";
import { compactLabelWithTiming } from "./labels";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { citationDateGaps } from "./numberGuard";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

console.log("=== Session 18 Group E golden tests ===\n");

const NOW = new Date("2026-08-25T00:00:00Z");

function row(over: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry {
  return {
    kind: "row", rate: null, seniority: null, amount: "$1.0 billion",
    maturityDate: "2027-06-01", dateGranularity: "month",
    sourceLine: `synthetic: ${over.label}`, citedUrl: "https://example.com/base",
    section: null, periodColumn: null, ...over,
  };
}

function trigger(over: Partial<TriggerResult> & { triggerId: string }): TriggerResult {
  return {
    triggerName: "synthetic", fired: true, dataAvailable: true, evidence: null,
    mappedNeed: "synthetic", needType: "credit", confidence: 1,
    citations: [{ form: "10-Q", date: "2026-07-29", reportDate: "", url: "https://example.com/base" }],
    eventInstances: [], noteRetirements: [],
    proseInstruments: [],
    facilities: [], facilityRejections: [], seniorityStatement: null, proceedsUses: [], projectCompletionDate: null, projectCompletionGranularity: null,
    quoteVerified: true, verifiedQuote: null, verifiedQuoteNormalized: null, quoteMatchType: null,
    quoteHasFigure: false, eventDate: null, dateGranularity: null, eventStatus: "upcoming",
    proceedsUse: null, scheduleSequence: [], priorScheduleSequence: [], balanceSheetDebtCaptions: [],
    debtScheduleSourceFiling: null, debtSchedulePriorFiling: null,
    rowsExtracted: 0, rowsVerified: 0, baseRowsExtracted: 0, scheduleCompleteness: null,
    redeems: [], issuedTranches: [], cashAmount: null, projectName: null, columnReadFailure: false,
    ...over,
  };
}

function company(results: TriggerResult[]): CompanyResult {
  return { company: "SYNTHETIC CO.", cik: "0000000000", ticker: "SYN", verdict: "CALL", relationshipFlags: [], results };
}

/** A minimal VerifiedFact for the guard-level cases — only the fields these assertions read. */
function fact(over: Partial<VerifiedFact> & { linkedTriggerId: string }): VerifiedFact {
  return {
    linkedTriggerId: over.linkedTriggerId,
    ladderRowId: over.ladderRowId ?? null,
    fact: over.fact ?? over.linkedTriggerId,
    verifiedText: over.verifiedText ?? over.normalizedText ?? "",
    normalizedText: over.normalizedText ?? "",
    figures: over.figures ?? [],
    dates: over.dates ?? [],
    sourceFiling: over.sourceFiling ?? null,
    citations: over.citations ?? [],
    evidence: over.evidence ?? null,
    eventDate: over.eventDate ?? null,
    dateGranularity: over.dateGranularity ?? null,
    eventStatus: over.eventStatus ?? null,
    seniority: over.seniority ?? null,
    redeemsInfo: over.redeemsInfo ?? null,
    outstandingAmount: over.outstandingAmount ?? null,
    issueSizeInLabel: over.issueSizeInLabel ?? null,
  } as VerifiedFact;
}

// ============================================================================
// E7 — ONE MONEY FORMATTER.
//
// Every spelling below was rendered in one column of one book.
// ============================================================================
{
  assert(formatMoneyForDisplay("$ 1,500 millions") === "$1.5B", `[E7-1] "$ 1,500 millions" -> $1.5B (got ${formatMoneyForDisplay("$ 1,500 millions")})`);
  assert(formatMoneyForDisplay("$ 2,750,000 thousands") === "$2.8B", `[E7-2] "$ 2,750,000 thousands" -> $2.8B (got ${formatMoneyForDisplay("$ 2,750,000 thousands")})`);
  assert(formatMoneyForDisplay("$699,887 thousand") === "$699.9M", `[E7-3] "$699,887 thousand" -> $699.9M (got ${formatMoneyForDisplay("$699,887 thousand")})`);
  assert(formatMoneyForDisplay("$600,000,000") === "$600M", `[E7-4] a raw digit string -> $600M (got ${formatMoneyForDisplay("$600,000,000")})`);
  assert(formatMoneyForDisplay("$ 788.4 million") === "$788.4M", `[E7-5] "$ 788.4 million" -> $788.4M (got ${formatMoneyForDisplay("$ 788.4 million")})`);
  assert(formatMoneyForDisplay("$ —") === "nil", `[E7-6] a stated zero says so, rather than becoming "$0.0M" (got ${formatMoneyForDisplay("$ —")})`);
  assert(formatMoneyValue(-66_503_000) === "($66.5M)", `[E7-7] a negative renders in accounting parentheses, as the filing printed it (got ${formatMoneyValue(-66_503_000)})`);

  // Never invent a value it could not read.
  assert(formatMoneyForDisplay("see note 7") === "see note 7", "[E7-8] an unparseable amount is shown verbatim, never replaced with a guess or a dash");
  assert(formatMoneyForDisplay(null) === "" && formatMoneyForDisplay("") === "", "[E7-9] nothing stated renders as nothing");
}

// ============================================================================
// E11.2 — A MULTI-PERIOD COMPARISON COLLAPSES TO THE MOST RECENT PERIOD.
// ============================================================================
{
  const quest = "Company disclosed capital expenditures of $252 million for the six months ended June 30, 2026 and $225 million for the same period in 2025.";
  assert(
    collapseToMostRecentPeriod(quest) === "Company disclosed capital expenditures of $252 million for the six months ended June 30, 2026.",
    `[E11.2-1] the prior-year half of Quest's real capex line is dropped (got ${JSON.stringify(collapseToMostRecentPeriod(quest))})`
  );

  // REVERSE: a comparison WITHIN one year cannot be ordered without inventing
  // precision, so it is left whole. HCA's real line is this shape.
  const hca = "Capital expenditures for property and equipment totaled $2,350 million for the six months ended June 30, 2026 and $1,119 million for Q1 2026.";
  assert(collapseToMostRecentPeriod(hca) === hca, "[E11.2-2] REVERSE: a same-year comparison is left uncut rather than guessed at");

  // REVERSE: an "and" that joins two things in ONE period is not a period
  // comparison and must survive intact.
  const oneperiod = "As of June 30, 2026 the company had $373 million drawn on the revolver and $1.455 billion on the Tranche A term loan.";
  assert(collapseToMostRecentPeriod(oneperiod) === oneperiod, "[E11.2-3] REVERSE: an ordinary 'and' with no older period behind it is untouched");
}

// ============================================================================
// E5 / E6 — ONE REFI CONVERSATION PER COMPANY, CITING EVERY FILING IT DRAWS ON.
//
// Cigna's real shape: three tranches maturing across 2027, which produced
// three separate refi cards.
// ============================================================================
{
  const dm = trigger({
    triggerId: "debt-maturity",
    citations: [
      { form: "10-K", date: "2026-02-26", reportDate: "", url: "https://example.com/base" },
      { form: "10-Q", date: "2026-07-30", reportDate: "", url: "https://example.com/other" },
    ],
    scheduleSequence: [
      row({ label: "3.400 % Notes due March 2027", rate: "3.400%", maturityDate: "2027-03-01", amount: "$1,481 million" }),
      row({ label: "7.875 % Debentures due May 2027", rate: "7.875%", maturityDate: "2027-05-01", amount: "$260 million", citedUrl: "https://example.com/other" }),
      row({ label: "3.050 % Notes due October 2027", rate: "3.050%", maturityDate: "2027-10-01", amount: "$599 million" }),
    ],
  });
  const { flashCardCandidates } = buildEvents([company([dm])], NOW);
  const refi = flashCardCandidates.filter((c) => c.bucket === "refi");

  assert(refi.length === 1, `[E5-1] three cardable tranches on one ladder produce ONE refi card, not three (got ${refi.length})`);
  assert(refi[0].headlineRowId?.startsWith("3.400 % Notes due March 2027") === true, `[E5-2] ...headlined by the NEAREST tranche (got ${refi[0].headlineRowId})`);
  assert(refi[0].alsoMaturingRowIds.length === 2, `[E5-3] ...with the other two carried on the same card for KEY POINTS (got ${refi[0].alsoMaturingRowIds.length})`);

  const urls = new Set(refi[0].citations.map((c) => c.url));
  assert(urls.size === 2, `[E6-1] the card cites EVERY filing its rows come from, not just the headline row's (got ${[...urls].join(", ")})`);
  assert(refi[0].citations.length === urls.size, "[E6-2] ...de-duplicated by url");
}

// --- E5's boundary: the per-company cap must NOT come back. A maturity and a
// non-refi event are two conversations. ---
{
  const dm = trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "5.000 % Notes due June 2027", rate: "5.000%", maturityDate: "2027-06-01", amount: "$500 million" })],
  });
  const acq = trigger({
    triggerId: "acquisition-announced",
    eventStatus: "just_announced",
    eventDate: "2026-08-17",
    dateGranularity: "day",
    cashAmount: "$300 million",
    evidence: "On August 17, 2026 the Company completed the acquisition of Talkspace, Inc.",
    verifiedQuote: "On August 17, 2026 the Company completed the acquisition of Talkspace, Inc.",
    verifiedQuoteNormalized: "On August 17, 2026 the Company completed the acquisition of Talkspace, Inc.",
  });
  const { flashCardCandidates } = buildEvents([company([dm, acq])], NOW);
  assert(
    flashCardCandidates.length >= 2 && flashCardCandidates.some((c) => c.bucket === "refi") && flashCardCandidates.some((c) => c.bucket !== "refi"),
    `[E5-4] REVERSE: a maturity plus a non-refi event stays TWO cards — the per-company cap was removed deliberately and must not return (got ${flashCardCandidates.map((c) => c.bucket).join(", ")})`
  );
}

// ============================================================================
// E6 (rewritten, stage-2 review item 1) — THE PERIOD CHECK, ON THE TEXT THE
// CARD ACTUALLY STATES.
//
// The previous version of this asserted against a hand-built list of
// structured fact dates, and passed while the live defect was on screen. It
// could not have caught it: the offending fact was on another trigger, and
// its eventDate was null — "June 30, 2026" existed only in its prose. So
// these cases go through the CARD TEXT, which is where the date the reader
// sees actually comes from.
// ============================================================================
{
  const FEB = [{ form: "10-K", date: "2026-02-26", reportDate: "2025-12-31" }];
  const TODAY = "2026-08-26";

  // The live case, verbatim in shape: a February 10-K, a June 30 balance.
  const gaps = citationDateGaps("Cigna held $6.3 billion of cash and cash equivalents as of June 30, 2026.", FEB, TODAY);
  assert(gaps.length === 1 && gaps[0].statedIso === "2026-06-30", `[E6-3] a June 30 period stated over a February filing is a gap (got ${JSON.stringify(gaps)})`);

  // ...and closes the moment the card cites the filing that could report it.
  assert(
    citationDateGaps("Cigna held $6.3 billion of cash and cash equivalents as of June 30, 2026.", [{ form: "10-K", date: "2026-02-26", reportDate: "2025-12-31" }, { form: "10-Q", date: "2026-07-30", reportDate: "2026-06-30" }], TODAY).length === 0,
    "[E6-4] REVERSE: adding the 10-Q that CAN report that period closes the gap — the fix is the citation set, not the sentence"
  );

  assert(citationDateGaps("Refinance the $500 million notes due June 2027.", FEB, TODAY).length === 0, "[E6-5] REVERSE: a FUTURE maturity is not a period the filing failed to report");
  assert(citationDateGaps("The company completed the sale in 2025.", FEB, TODAY).length === 0, "[E6-6] REVERSE: a bare year carries no precision to compare — never flagged");
  assert(citationDateGaps("The Board declared a dividend on February 10, 2026.", FEB, TODAY).length === 0, "[E6-7] REVERSE: a date the cited filing could carry is not flagged");
  assert(citationDateGaps("As of May 2026 the revolver was undrawn.", [{ form: "10-Q", date: "2026-05-15", reportDate: "2026-04-30" }], TODAY).length === 0, "[E6-8] REVERSE: month precision compares against the 1st, so a mid-month filing can state its own month");
  assert(citationDateGaps("nothing dated here at all", FEB, TODAY).length === 0, "[E6-9] REVERSE: a card with no dates reports no gap rather than a false one");
}

// --- E6 through the REAL guard, which is the half that was missing. A guard
// that is never called is not a guard.
//
// What this actually catches, stated precisely, because the first draft of
// this test asserted something the architecture already guarantees: the
// card's citation set is the UNION over every fact its text draws on, so a
// correctly-cited fact always brings its own filing with it and no period
// gap can survive. The gap that CAN survive is a fact whose own citations
// cannot support its own dates — a June 30 balance cited only to a February
// 10-K. That is an extraction defect, it is invisible to every other guard
// here, and it is exactly what reaches the reader as a dead link.
{
  const junePeriodFact = (citations: TriggerResult["citations"]) => [
    fact({ linkedTriggerId: "debt-maturity", ladderRowId: "row-1", normalizedText: "$500 million 5.000 % Notes due June 2027", evidence: "The company has $500 million of 5.000% notes due June 2027.", citations: [{ form: "10-K", date: "2026-02-26", reportDate: "2025-12-31", url: "https://example.com/k" }] }),
    fact({ linkedTriggerId: "large-cash-balance", ladderRowId: null, normalizedText: "Cash and cash equivalents were $6.3 billion as of June 30, 2026", evidence: "Cash and cash equivalents were $6.3 billion as of June 30, 2026.", citations }),
  ];
  const body = {
    callAbout: "Refinance the $500 million 5.000% notes due June 2027.",
    whyNow: "The $500 million maturity due June 2027 sits against $6.3 billion of cash as of June 30, 2026.",
    keyPoints: ["$500 million of 5.000% notes come due in June 2027.", "Cash and cash equivalents were $6.3 billion as of June 30, 2026."],
  };
  const ctx = { headlineCitations: [{ form: "10-K", date: "2026-02-26", reportDate: "2025-12-31" }], today: "2026-08-26" };

  // The cash fact states a June 30 period but is cited ONLY to the February
  // 10-K. Nothing the card can cite reports that period.
  const bad = checkCardStructure(body, junePeriodFact([{ form: "10-K", date: "2026-02-26", reportDate: "2025-12-31", url: "https://example.com/k" }]), "debt-maturity", ctx);
  assert(
    !bad.ok && bad.reasons.some((r) => r.includes("cannot state a fact about a day")),
    `[E6-10] the STRUCTURAL GUARD — the one production actually calls — rejects a card whose June-period fact is cited only to a February filing (reasons: ${bad.reasons.join("; ")})`
  );

  // The same fact, correctly cited to the 10-Q that reports that period: the
  // union picks the 10-Q up and the card passes. This is the shape all ten
  // live companies are in today.
  const good = checkCardStructure(body, junePeriodFact([{ form: "10-Q", date: "2026-07-30", reportDate: "2026-06-30", url: "https://example.com/q" }]), "debt-maturity", ctx);
  assert(
    !good.reasons.some((r) => r.includes("cannot state a fact about a day")),
    `[E6-11] REVERSE: the same card whose fact carries the 10-Q that reports that period raises no period gap (reasons: ${good.reasons.join("; ")})`
  );
}

// ============================================================================
// E9 / E13 / E12 — through the real block builder.
// ============================================================================
{
  const shared = "Term Loan Facility 1,975";
  const dm = trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "Term Loan Facility", rate: "5.100%", maturityDate: "2027-06-01", amount: "$1,975 million", sourceLine: shared })],
    priorScheduleSequence: [row({ label: "Term Loan Facility", rate: "5.100%", maturityDate: "2027-06-01", amount: "$2,000 million", sourceLine: shared })],
    debtSchedulePriorFiling: { form: "10-Q", date: "2026-04-28", reportDate: "2026-03-31", url: "https://example.com/prior" },
  });
  const floating = trigger({
    triggerId: "floating-rate-debt",
    eventStatus: "standing",
    evidence: shared,
    verifiedQuote: shared,
    verifiedQuoteNormalized: shared,
  });
  const block = buildCompanyTableBlock(company([dm, floating]), [], NOW);

  const hedging = block.buckets.hedging;
  assert(hedging.length === 1, `[E9-1] the hedging line is not removed — an exposure must not vanish from the bucket an RM scans (got ${hedging.length})`);
  assert(hedging[0].crossReferenceTo === "refi", `[E9-2] ...it becomes a CROSS-REFERENCE to the bucket that owns the fact (got ${hedging[0].crossReferenceTo})`);

  const line = block.refiLadder.nearestLines[0];
  assert(line.movementPhrase.startsWith("down $25M (1.3%) from $2.0B"), `[E13-1] the ladder row states how the balance MOVED since the prior filing, with its relative size (got ${JSON.stringify(line.movementPhrase)})`);
  assert(!line.movementPhrase.includes("too small to read"), "[E13-1b] ...and a 1.3% move is stated as a real change, not as accretion");
  assert(line.movementPhrase.includes("10-Q 2026-04-28"), "[E13-2] ...and which filing the prior balance came from");
}

// --- E12: the timing phrase may only deny a date the row genuinely lacks. ---
{
  const pos = assemblePosition(
    company([
      trigger({
        triggerId: "debt-maturity",
        scheduleSequence: [
          row({ label: "Aggregate other debt", rate: null, maturityDate: null, dateGranularity: null, amount: "$100 million" }),
        ],
      }),
    ]),
    NOW
  );
  const block = buildCompanyTableBlock(company([trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "Aggregate other debt", rate: null, maturityDate: null, dateGranularity: null, amount: "$100 million" })],
  })]), [], NOW);
  assert(pos.rows[0].maturityDate === null, "[E12-0 setup] the row genuinely states no maturity");
  assert(
    block.refiLadder.nearestLines[0].timingPhrase === "no maturity date stated in this filing",
    `[E12-1] a row with NO date says so plainly (got ${JSON.stringify(block.refiLadder.nearestLines[0].timingPhrase)})`
  );
}

{
  // A row that DOES state a date must never be described as undated, whatever
  // the window arithmetic makes of it. Cigna rendered "maturity 2026-03-01"
  // and "date not verifiable" on the same line.
  const block = buildCompanyTableBlock(company([trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "1.250 % Notes due March 2026", rate: "1.250%", maturityDate: "2026-03-01", dateGranularity: "month", amount: "$549 million" })],
  })]), [], NOW);
  const phrase = block.refiLadder.nearestLines[0].timingPhrase;
  assert(!/not verifiable/.test(phrase), `[E12-2] a row carrying a real date is never called undated (got ${JSON.stringify(phrase)})`);
  assert(/2026-03-01/.test(phrase), `[E12-3] ...the phrase states the row's own date (got ${JSON.stringify(phrase)})`);
}

// ============================================================================
// E4 — CARDS NARRATE THE OUTSTANDING BALANCE, NOT THE INSTRUMENT'S NAME.
//
// An indenture names a tranche by its ORIGINAL ISSUE SIZE, and the two
// diverge the moment any of it is repurchased. Cigna's real rows: the 4.500%
// due 2030 is named "$1,000 million" and has $993M outstanding; the 7.875%
// Debentures are named "$259 million" and carry $260M.
// ============================================================================
{
  const dm = trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [
      // Cigna's real row: named $1,500 million, $1,481 million outstanding,
      // and inside the card window so it actually produces a card.
      row({ label: "$ 1,500 million, 3.400 % Notes due March 2027", rate: "3.400%", maturityDate: "2027-03-01", dateGranularity: "month", amount: "$1,481 million" }),
    ],
  });
  const co = company([dm]);
  const facts = buildVerifiedFactBase(co);
  const f = facts.find((x) => x.ladderRowId !== null)!;

  assert(f.outstandingAmount === "$1.5B", `[E4-1] the fact carries the OUTSTANDING balance as its own field (got ${f.outstandingAmount})`);
  assert(f.issueSizeInLabel === "$1.5B", `[E4-2] ...and the label's figure separately, identified as the original issue size (got ${f.issueSizeInLabel})`);

  const card = buildEvents([co], NOW).flashCardCandidates[0];
  const ctx = buildContext(card, facts);
  assert(ctx.includes("OUTSTANDING NOW (state THIS amount): $1.5B"), "[E4-3] the context tells narration which figure to state, as its own labelled line");
  assert(ctx.includes("original issue size"), "[E4-4] ...and names the label's figure as the original issue size, statable only when labelled as such");
}

// --- REVERSE: where the label and the balance AGREE there is nothing to
// disambiguate, and an extra field would only be noise. ---
{
  const dm = trigger({
    triggerId: "debt-maturity",
    scheduleSequence: [row({ label: "$ 750 million, 6.000 % Notes due January 2056", rate: "6.000%", maturityDate: "2056-01-15", dateGranularity: "day", amount: "$750 million" })],
  });
  const f = buildVerifiedFactBase(company([dm])).find((x) => x.ladderRowId !== null)!;
  assert(f.outstandingAmount === "$750M", "[E4-5] the outstanding amount is always given");
  assert(f.issueSizeInLabel === null, "[E4-6] REVERSE: no issue-size field when the label and the balance agree");
}

// ============================================================================
// E10 — WHY NOW STATES FACTS AND THEIR RELATION, AND DOES NOT ADVISE.
//
// Both offending phrases below are verbatim from live output.
// ============================================================================
{
  assert(advisoryPhrasesIn("Cigna has ample liquidity to prefund or opportunistically refinance the March 2027 maturity.").length > 0, "[E10-1] 'ample liquidity to ... opportunistically refinance' is caught");
  assert(advisoryPhrasesIn("The company is well-positioned to address this maturity.").length > 0, "[E10-2] 'well-positioned to address this maturity' is caught");
  assert(advisoryPhrasesIn("The August draw gives them room to wait.").length > 0, "[E10-3] a capability claim is caught even without an evaluative adjective");

  // REVERSE — the half that matters. The rule must not silence a statement of
  // RELATION, which is exactly what whyNow is for, and must not ban ordinary
  // financial vocabulary.
  assert(
    advisoryPhrasesIn("The $708 million ABL draw in June lands nine months before the March 2027 maturity.").length === 0,
    "[E10-4] REVERSE: two filed facts and how they bear on each other is allowed — that is what whyNow IS"
  );
  assert(
    advisoryPhrasesIn("Cigna refinanced $4.5 billion across four tranches in September 2025, and $2.3 billion more matures in 2027.").length === 0,
    "[E10-5] REVERSE: 'refinance' and 'prefund' are ordinary facts — the rule tests the modal frame, not the subject matter"
  );
  // REVERSE, found by the live run: "May" is a month. A case-insensitive test
  // on the modal "may" rejected Quest's card twice for writing a date.
  assert(
    advisoryPhrasesIn("The 7.875% Debentures due May 2027 sit three months behind the March 2027 notes.").length === 0,
    "[E10-6] REVERSE: a tranche due MAY is a date, not a modal — this rejected a real card twice before the list was corrected"
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);

// ============================================================================
// STAGE-2 REVIEW — items 2, 12, 13, 15, 16. One block per rule, each with the
// live sentence that motivated it and a REVERSE case for the shape it must
// not touch.
// ============================================================================

// --- ITEM 2: the formatter reaches prose, and knows what to leave alone. ---
{
  const a = normalizeMoneyInText("Repurchased $2,350 million for the six months ended June 30, 2026");
  assert(a === "Repurchased $2.4B for the six months ended June 30, 2026", `[I2-1] a unit word inside a sentence is formatted in place (got ${a})`);
  assert(normalizeMoneyInText("cash of $1,435,000 thousand") === "cash of $1.4B", "[I2-2] ...including 'thousand', which no surface should ever print");
  assert(normalizeMoneyInText("notes of $600,000,000") === "notes of $600M", "[I2-3] a $-prefixed figure written out in full carries its own scale and is formatted");
  assert(
    normalizeMoneyInText("raised the quarterly dividend from $0.80 to $0.86 per share") === "raised the quarterly dividend from $0.80 to $0.86 per share",
    "[I2-4] REVERSE: per-share amounts survive verbatim — rounding these would turn a real disclosure into '$1 to $1'"
  );
  assert(
    normalizeMoneyInText("Total debt principal outstanding 10,847,516") === "Total debt principal outstanding 10,847,516",
    "[I2-5] REVERSE: a bare figure whose scale the filing never stated is left alone — inventing the scale here would undo every guard upstream that correctly refused to"
  );
}

// --- ITEM 12: " and " was not the only join. ---
{
  const capex = "Capital expenditures were $152 million during the six months ended June 30, 2026, compared to $176 million in the prior year period.";
  assert(
    collapseToMostRecentPeriod(capex) === "Capital expenditures were $152 million during the six months ended June 30, 2026.",
    `[I12-1] an explicit comparison to an UNYEARED prior period is dropped — the connective itself says the tail is the benchmark (got ${collapseToMostRecentPeriod(capex)})`
  );
  assert(collapseToMostRecentPeriod("revenues of $1.001 billion in 2025 and $880 million in 2024") === "revenues of $1.001 billion in 2025.", "[I12-2] the original ' and ' rule still holds");
  const sameYear = "Repurchased $2,350 million for the six months ended June 30, 2026 and $1,119 million for Q1 2026";
  assert(
    collapseToMostRecentPeriod(sameYear) === sameYear,
    "[I12-3] REVERSE: two periods inside ONE year are left uncut — nothing here can order them without inventing precision, and a wrong cut is worse than an uncut line"
  );
  const twoInstruments = "As of June 30, 2026 the company had $373 million drawn on the revolver and $1.455 billion on the Tranche A term loan.";
  assert(collapseToMostRecentPeriod(twoInstruments) === twoInstruments, "[I12-4] REVERSE: an ordinary 'and' joining two instruments in one period is not a comparison");
}

// --- ITEM 16: availability is a capability claim. ---
{
  assert(advisoryPhrasesIn("showing the same playbook is available to address the December 2027 notes ahead of maturity").length > 0, "[I16-1] 'the same playbook is available' — a capability claim carrying no modal and no evaluative adjective");
  assert(advisoryPhrasesIn("showing the market is open for exactly this kind of deal").length > 0, "[I16-2] 'the market is open' — the same move, made about the market rather than the company");
  assert(
    advisoryPhrasesIn("Quest just tapped the market in May 2026 for $500 million of 10-year senior notes to refinance a June 2026 maturity").length === 0,
    "[I16-3] REVERSE: the market as the SUBJECT of a filed fact is fine — the rule tests the predicate, not the noun"
  );
  assert(
    advisoryPhrasesIn("the August revolver draw lands three months before the March maturity").length === 0,
    "[I16-4] REVERSE: two filed facts and the arithmetic between them is exactly what whyNow is for"
  );
}

// --- ITEM 13: one instrument per bullet. ---
{
  const FOUR_IN_ONE =
    "On November 18, 2025, Tenet issued $1.5 billion of 5.500% senior secured first lien notes due 2032 and $750 million of 6.000% senior notes due 2033, redeeming $1.5 billion of 6.250% second lien notes due 2027 and partially redeeming $750 million of 6.125% senior notes due 2028.";
  const facts: VerifiedFact[] = [
    fact({
      linkedTriggerId: "new-debt-issuance",
      normalizedText: FOUR_IN_ONE,
      evidence: FOUR_IN_ONE,
      citations: [{ form: "8-K", date: "2025-11-18", reportDate: "", url: "https://example.com/8k" }],
    }),
  ];
  const guard = checkCardStructure(
    { callAbout: "Refinance the notes.", whyNow: "The maturity lands soon.", keyPoints: [FOUR_IN_ONE, "A second bullet."] },
    facts,
    "new-debt-issuance"
  );
  assert(
    guard.reasons.some((r) => r.includes("more than one interest rate")),
    `[I13-1] a bullet naming four instruments is caught — it passes the set-cover test (one FACT does cover it) and is still four facts (reasons: ${guard.reasons.join("; ")})`
  );

  // REVERSE — E4 REQUIRES a bullet stating two amounts for ONE instrument, so
  // counting MONEY would reject exactly the bullet the system asks for.
  // Counting rates does not.
  const oneInstrument = checkCardStructure(
    {
      callAbout: "Refinance the notes.",
      whyNow: "The maturity lands soon.",
      keyPoints: ["$1.1 billion outstanding on the 4.25% Senior Notes due December 15, 2027, against an original issue size of $2.5 billion.", "A second bullet."],
    },
    facts,
    "new-debt-issuance"
  );
  assert(
    !oneInstrument.reasons.some((r) => r.includes("more than one interest rate")),
    "[I13-2] REVERSE: two AMOUNTS for one instrument is one fact, and is the bullet shape E4 exists to require"
  );
}

// --- ITEM 15: no month count for a bare-year maturity. ---
{
  const yearOnly = compactLabelWithTiming("debt-maturity", "debt maturity approaching", {
    monthsToNearestFuture: 16,
    alreadyPast: false,
    isPendingLive: false,
    dateGranularity: "year",
    windowDate: "2027-12-31",
  });
  assert(yearOnly === "refi window matures 2027", `[I15-1] a bare-year maturity states its YEAR — never a month count derived from the code-chosen Dec-31 convention (got ${yearOnly})`);

  const monthKnown = compactLabelWithTiming("debt-maturity", "debt maturity approaching", {
    monthsToNearestFuture: 15,
    alreadyPast: false,
    isPendingLive: false,
    dateGranularity: "month",
    windowDate: "2027-12-01",
  });
  assert(monthKnown === "refi window ~15mo", `[I15-2] REVERSE: a filing that PRINTS the month keeps its real month count (got ${monthKnown})`);
}

if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL GROUP E GOLDEN TESTS PASSED");
}
