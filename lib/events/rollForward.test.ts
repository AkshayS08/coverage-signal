/**
 * SESSION 23, STAGE 2 — the roll-forward, against the hand-verified numbers
 * and against the conjunction's four real cases. Offline, $0.
 *
 * The arithmetic here is Akshay's hand verification, pinned: if a later change
 * makes these numbers move, that is the thing to explain before shipping.
 */
import {
  rollForwardFires,
  computeBaseTie,
  computeRollTie,
  toleranceFor,
  rollForward,
  positionFromRoll,
  APPROXIMATION_BAND_MILLIONS,
  type RollDelta,
} from "./rollForward";
import { coupleReferencedFields } from "../agent/claude";
import type { NoteCrossReference, ScheduleSequenceEntry, BalanceSheetDebtCaption } from "../agent/claude";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

const row = (section: string, instrument: string, amount: string): ScheduleSequenceEntry =>
  ({ kind: "row", section, instrument, amount, sourceLine: `${instrument} ${amount}`, label: null } as unknown as ScheduleSequenceEntry);
const sub = (section: string, label: string, amount: string): ScheduleSequenceEntry =>
  ({ kind: "subtotal", section, label, amount, sourceLine: `${label} ${amount}` } as unknown as ScheduleSequenceEntry);
const cap = (label: string, amount: string): BalanceSheetDebtCaption =>
  ({ label, amount, sourceLine: `${label} ${amount}` } as unknown as BalanceSheetDebtCaption);

// ---------------------------------------------------------------------------
console.log("=== [1] The conjunction — all four real cases ===");
// ---------------------------------------------------------------------------
{
  const cigna: NoteCrossReference = {
    statement: "For more information regarding our short-term and long-term debt, see Note 7 to the Consolidated Financial Statements in the Company's 2025 Form 10-K.",
    referencedNote: "Note 7",
    referencedFiling: "the Company's 2025 Form 10-K",
    referencedSubject: "our short-term and long-term debt",
  };
  // HCA's real pointer: names a document, no note, no subject.
  const hca: NoteCrossReference = {
    statement: "For further information, refer to the consolidated financial statements and footnotes thereto included in our annual report on Form 10-K.",
    referencedNote: null,
    referencedFiling: "our annual report on Form 10-K",
    referencedSubject: null,
  };

  assert(rollForwardFires({ crossReference: cigna, anchorHasLadder: false }).fires,
    "[1a] Cigna — no ladder AND a pointer naming a subject and a specific note: FIRES");
  assert(!rollForwardFires({ crossReference: cigna, anchorHasLadder: true }).fires,
    "[1b] Quest — a debt-specific pointer but the anchor HAS a ladder: does not fire. A pointer never replaces a position the anchor prints");
  assert(!rollForwardFires({ crossReference: null, anchorHasLadder: false }).fires,
    "[1c] UHS — no ladder and no cross-reference: does not fire. Absence is not a direction, and this is the safety case (a company already golden at 98%)");
  assert(!rollForwardFires({ crossReference: hca, anchorHasLadder: true }).fires,
    "[1d] HCA — an aggregate ladder AND boilerplate that names no note: does not fire, on both halves");
  assert(!rollForwardFires({ crossReference: hca, anchorHasLadder: false }).fires,
    "[1e] and HCA's pointer would not fire even WITHOUT a ladder — naming a document but no note points at every note and so at none");

  const why = rollForwardFires({ crossReference: hca, anchorHasLadder: false }).reason;
  assert(/no specific note/.test(why),
    `[1f] and the refusal SAYS which half failed rather than just refusing — "${why.slice(0, 74)}…"`);
}

// ---------------------------------------------------------------------------
console.log("\n=== [2] The base tie — the referenced filing against its own balance sheet ===");
// ---------------------------------------------------------------------------
{
  // Cigna's 10-K note, as the model actually transcribed it: two sections,
  // two subtotals. 30,871 + 592 = 31,463.
  const seq = [
    row("Short-term debt", "Commercial paper", "$ —"),
    row("Short-term debt", "$ 550 million, 1.250 % Notes due March 2026", "$ 549"),
    row("Short-term debt", "Other, including finance leases", "$ 43"),
    sub("Short-term debt", "Total short-term debt", "$ 592"),
    row("Long-term debt", "$ 1,500 million, 3.400 % Notes due March 2027", "$ 1,481"),
    row("Long-term debt", "Other, including finance leases", "$ 68"),
    sub("Long-term debt", "Total long-term debt", "$ 30,871"),
  ];
  const caps = [cap("Short-term debt", "$ 592"), cap("Long-term debt", "$ 30,871")];

  const tie = computeBaseTie(seq, caps);
  assert(tie.computedMillions === 31463, `[2a] the note's own two subtotals sum to 31,463 (got ${tie.computedMillions})`);
  assert(tie.statedMillions === 31463, `[2b] and the referenced filing's balance sheet states 31,463 (got ${tie.statedMillions})`);
  assert(tie.ties && tie.residualMillions === 0,
    "[2c] the base tie is an IDENTITY — same filer, same date, same frame — so it ties exactly or not at all");

  const missing = computeBaseTie(seq, []);
  assert(!missing.ties && /only be checked against itself/.test(missing.detail),
    "[2d] with no referenced balance-sheet captions the base does NOT tie — a stale note ties to itself perfectly, which is why Check 2 exists");
}

// ---------------------------------------------------------------------------
console.log("\n=== [3] The roll tie — Akshay's hand verification, pinned ===");
// ---------------------------------------------------------------------------
{
  const deltas: RollDelta[] = [
    { label: "$550 million 1.250% senior notes matured March 2026 and were repaid", amountMillions: -550,
      sourceLine: "During the six months ended June 30, 2026, the Company repaid $ 550 million 1.250 % senior notes that matured in March 2026.",
      citedUrl: "10-Q", statedApproximate: false },
    { label: "commercial paper outstanding at June 30, 2026", amountMillions: 1000,
      sourceLine: "we had approximately $1.0 billion of commercial paper outstanding with a weighted average interest rate of 3.92 %",
      citedUrl: "10-Q", statedApproximate: true },
  ];
  const tie = computeRollTie(31463, deltas, 31878);
  assert(tie.computedMillions === 31913, `[3a] 31,463 − 550 + 1,000 = 31,913 (got ${tie.computedMillions})`);
  assert(tie.residualMillions === 35, `[3b] against the anchor's 31,878 the residual is 35 (got ${tie.residualMillions})`);
  assert(tie.ties, "[3c] and 35 is inside the band the filer's own \"approximately\" supports, so it ties");
  assert(/within the filer's stated approximation/.test(tie.detail),
    "[3d] the surface says WHOSE approximation the band comes from — it is the filer's word, not our tolerance");

  assert(toleranceFor(deltas) === APPROXIMATION_BAND_MILLIONS,
    "[3e] the band exists only because a delta is stated as an approximation");
  assert(toleranceFor([deltas[0]]) === 0,
    "[3f] a roll made only of exact figures gets NO band and must tie exactly");

  // THE FRAME ERROR, AS A TEST. This is the one an earlier draft of the
  // declaration actually made: fair-value base against balance-sheet target.
  const wrongFrame = computeRollTie(31352, deltas, 31878);
  assert(wrongFrame.residualMillions === -76 && !wrongFrame.ties,
    `[3g] the FAIR-VALUE base (31,352) against the balance-sheet target misses by 76 and does not tie (got ${wrongFrame.residualMillions}) — two frames differing by a constant ~110 are individually consistent and mutually incomparable`);
}

// ---------------------------------------------------------------------------
console.log("\n=== [4] A base that does not tie produces no roll ===");
// ---------------------------------------------------------------------------
{
  const seq = [sub("Short-term debt", "Total short-term debt", "$ 592"), sub("Long-term debt", "Total long-term debt", "$ 30,000")];
  const caps = [cap("Short-term debt", "$ 592"), cap("Long-term debt", "$ 30,871")];
  const out = rollForward({
    crossReference: { statement: "see Note 7", referencedNote: "Note 7", referencedFiling: "2025 Form 10-K", referencedSubject: "our debt" },
    anchorHasLadder: false,
    referencedSequence: seq,
    referencedCaptions: caps,
    deltas: [],
    anchorTotalMillions: 31878,
    basePeriod: "2025-12-31",
    baseFilingLabel: "10-K Note 7",
    anchorPeriod: "2026-06-30",
  });
  assert(out.fires && out.baseTie.ties === false && out.rollTie === null,
    "[4a] base tie fails -> NO roll is attempted. An untied base rolled forward is a wrong number with a date on it");
  assert(out.fires && /rolled forward/.test(out.label) && /per 10-K Note 7/.test(out.label),
    `[4b] and every row still carries its provenance label — "${out.fires ? out.label : ""}"`);
}

// ---------------------------------------------------------------------------
console.log("\n=== [5] referencedScheduleSequence — the state machine, pinned ===");
// ---------------------------------------------------------------------------
//
// This field can hold another filing's table, which is the shape Rule 51
// closed. The argument that it is safe was in comments, and Rule 51's own
// case was a reasoned argument that held until it didn't. These are the three
// conditions that make it safe, asserted rather than reasoned.
{
  const seq = [sub("Long-term debt", "Total long-term debt", "$ 30,871")];
  const caps = [cap("Long-term debt", "$ 30,871")];
  const good: NoteCrossReference = {
    statement: "see Note 7 in the Company's 2025 Form 10-K",
    referencedNote: "Note 7", referencedFiling: "2025 Form 10-K", referencedSubject: "our short-term and long-term debt",
  };

  // --- 5.1 populated ONLY with a cross-reference and no anchor ladder ---
  const kept = coupleReferencedFields({
    noteCrossReference: good, referencedScheduleSequence: seq, referencedBalanceSheetDebtCaptions: caps, scheduleSequence: [],
  });
  assert(kept.referencedScheduleSequence.length === 1,
    "[5a] not-located anchor + a cross-reference: the referenced table is KEPT — the one state in which it means anything");

  const noSentence = coupleReferencedFields({
    noteCrossReference: null, referencedScheduleSequence: seq, referencedBalanceSheetDebtCaptions: caps, scheduleSequence: [],
  });
  assert(noSentence.referencedScheduleSequence.length === 0 && noSentence.referencedBalanceSheetDebtCaptions.length === 0,
    "[5b] populated with NO cross-reference behind it is DROPPED — the sentence is what makes another filing's table relevant; without it this is just another filing's table");

  const anchorHasOwn = coupleReferencedFields({
    noteCrossReference: good, referencedScheduleSequence: seq, referencedBalanceSheetDebtCaptions: caps,
    scheduleSequence: [row("Long-term debt", "some tranche", "$ 100")],
  });
  assert(anchorHasOwn.referencedScheduleSequence.length === 0 && anchorHasOwn.noteCrossReference === null,
    "[5c] populated ALONGSIDE a non-empty scheduleSequence is DROPPED, cross-reference and all — the anchor states its own position and there is nothing to roll");
  assert(anchorHasOwn.referencedBalanceSheetDebtCaptions.length === 0,
    "[5d] and the referenced captions go with it — half a base is not a base");

  // --- 5.2 never renders except through a tied, labelled roll ---
  const untied = rollForward({
    crossReference: good, anchorHasLadder: false,
    referencedSequence: seq,
    referencedCaptions: [cap("Long-term debt", "$ 29,000")],   // base does NOT tie
    deltas: [], anchorTotalMillions: 31878,
    basePeriod: "2025-12-31", baseFilingLabel: "10-K Note 7", anchorPeriod: "2026-06-30",
  });
  const untiedRender = positionFromRoll(untied, seq);
  assert(untiedRender.rows.length === 0 && untiedRender.label === null,
    "[5e] base-tie failure with the field POPULATED renders NO rows — a populated field is not a position");
  assert(/prior-period-only|commercial-paper composition/.test(untiedRender.reason),
    `[5f] and what renders instead is the reason, with the diagnostic order in it — "${untiedRender.reason.slice(0, 68)}…"`);

  const rolled = rollForward({
    crossReference: good, anchorHasLadder: false,
    referencedSequence: [sub("Short-term debt", "Total short-term debt", "$ 592"), sub("Long-term debt", "Total long-term debt", "$ 30,871")],
    referencedCaptions: [cap("Short-term debt", "$ 592"), cap("Long-term debt", "$ 30,871")],
    deltas: [
      { label: "notes repaid", amountMillions: -550, sourceLine: "s", citedUrl: "u", statedApproximate: false },
      { label: "commercial paper", amountMillions: 1000, sourceLine: "s", citedUrl: "u", statedApproximate: true },
    ],
    anchorTotalMillions: 31878,
    basePeriod: "2025-12-31", baseFilingLabel: "10-K Note 7", anchorPeriod: "2026-06-30",
  });
  const rolledRender = positionFromRoll(rolled, seq);
  assert(rolledRender.rows.length === 1 && rolledRender.label !== null,
    "[5g] a roll that FIRED and TIED renders rows — and only then");
  assert(/as of 2025-12-31, per 10-K Note 7/.test(rolledRender.label ?? ""),
    "[5h] and the rows cannot arrive without their provenance: label and rows travel together out of one function, so no caller can render one and forget the other");

  // --- 5.3 the HCA shape: populated, but the roll never fires ---
  const hcaShape = rollForward({
    crossReference: { statement: "refer to the consolidated financial statements and footnotes thereto included in our annual report on Form 10-K", referencedNote: null, referencedFiling: "our annual report on Form 10-K", referencedSubject: null },
    anchorHasLadder: false,
    referencedSequence: seq, referencedCaptions: caps,
    deltas: [], anchorTotalMillions: 31878,
    basePeriod: "2025-12-31", baseFilingLabel: "10-K", anchorPeriod: "2026-06-30",
  });
  const hcaRender = positionFromRoll(hcaShape, seq);
  assert(hcaRender.rows.length === 0 && hcaRender.label === null,
    "[5i] the HCA shape — a pointer naming a document but no note — renders NOTHING even with the field fully populated and the base perfectly tieable");
  assert(/no specific note/.test(hcaRender.reason),
    "[5j] and it says why, so an unfired roll is a stated refusal rather than a silent blank (Rule 3)");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
