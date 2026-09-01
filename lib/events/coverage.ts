/**
 * SESSION 20, ITEMS 3C–3E — COVERAGE.
 *
 * "Does this ladder describe the company's debt?" was never asked. Check 1
 * asks whether the note's own rows reconcile to the note's own subtotal, and
 * Check 2 asks whether a subtotal matches the balance sheet. Both can pass on
 * a ladder that is missing an entire term loan, because both only compare the
 * note to itself.
 *
 * UHS is the case that forced it: a rendered ladder of $1.1B against a stated
 * total debt of $4,851,847K, with Check 1 and Check 2 reporting nothing wrong
 * because there was nothing to reconcile.
 *
 * TWO TESTS, REPORTED SEPARATELY, because they fail for different reasons and
 * a single percentage hides which:
 *
 *   1. CATEGORY COMPLETENESS — no threshold. Every debt category the note
 *      states to exist is either captured or flagged as stated-but-missing.
 *      A term loan we hold no entry for flags regardless of size, because
 *      "small" is not the same as "accounted for".
 *   2. RESIDUAL MATERIALITY — measured threshold. After summing every
 *      captured entry at face, the unexplained remainder against stated total
 *      debt must be under the line set in COVERAGE_RESIDUAL_LIMIT.
 */
import { parseMoneyAmount, normalizeScheduleSequence } from "./position";
// The instrument-level facts live in one place and every layer reads them.
import { dedupAgainstRows, debtContribution, sameNormalisedAmount, type DebtCategory } from "./instrument";
export { dedupAgainstRows, debtContribution, sameNormalisedAmount } from "./instrument";
export type { DebtCategory } from "./instrument";
import type { TriggerResult, ProseInstrumentRow, RevolverRow, VerifiedSequenceEntry } from "../agent";

/**
 * THE THRESHOLD, MEASURED RATHER THAN ASSUMED (Session 20, Stage 3).
 *
 * Measured across all ten companies at the anchor, comparing stated total
 * debt against the note's own rows at face:
 *
 *   Encompass  0.00%   Cigna      0.00%
 *   DaVita    -0.62%   Tenet     -0.64%   Quest  -0.57%   Molina -0.82%
 *   HCA       -0.91%   CHS       -2.00%
 *
 * The residual is not noise. Every one of those figures IS the note's own
 * discount / deferred-financing-cost line, itemised in the same table:
 * DaVita's -$66.5M is its "Discount, premium and deferred financing costs
 * (66,503)"; Molina's -$31M is "Deferred debt issuance costs (31)"; CHS's
 * -$192M is "Less: Unamortized deferred debt issuance costs". Face exceeds
 * carrying by exactly the unamortised cost, which is what those two measures
 * mean.
 *
 * So the bridge is EXPLAINED, not tolerated, and the threshold does not have
 * to absorb it — the adjustments are subtracted first and the line is set for
 * what remains. 2.5% clears the largest measured bridge item (CHS, 2.00%)
 * with margin while still catching everything this check exists for: UHS's
 * missing $3.7B is 77% of its total, and its $225M drawn revolver alone is
 * 4.6%. The gap between "explained bridge" and "missing instrument" is more
 * than an order of magnitude, which is why a threshold works here at all.
 *
 * If a future company's bridge exceeds this, the answer is to itemise the
 * new bridge item, not to raise the line.
 */
export const COVERAGE_RESIDUAL_LIMIT = 0.025;

/**
 * How far past its own stated total a single entry may reach before it is a
 * transcription error rather than a balance. MEASURED, like the residual
 * limit, and the two populations are not close:
 *
 *   largest legitimate single entry, across three full books
 *     HCA "Senior unsecured notes payable through 2095" $44,200 million   0.889x
 *     Encompass "4.75 % Senior Notes due 2030" $788.4 million             0.299x
 *   a row may also slightly EXCEED the carrying total, because carrying is
 *     net of the note's own discount — measured at 1.008x on Molina's
 *     3,800 against 3,769
 *   the error this exists for
 *     UHS "Tranche A term loan $1,448 billion" (the note prints
 *     "$ 1.448 billion")                                               298.443x
 *
 * Nothing at all sits between 1.008 and 298. The line is set at 2x: double
 * the largest legitimate figure and two orders of magnitude below the error.
 * It can afford to be generous because a scale error is a factor of a
 * thousand and never a factor of two — this is not a tuned boundary between
 * neighbouring populations, it is a bound on the impossible.
 */
const IMPOSSIBLE_ENTRY_MULTIPLE = 2;


export interface CapturedEntry {
  category: DebtCategory | "table-row";
  label: string;
  amount: number | null;
  /** "row" (from the schedule table) or "prose" (from the note's narrative). Stated so the coverage line can name what it counted. */
  from: "row" | "prose";
  /** Why this entry counts as debt, or why it counts as capacity instead. Rendered, never inferred by the reader. */
  basisNote?: string;
}

export interface CoverageResult {
  /** Null when no anchor captions were extracted — coverage is then UNMEASURED, which is a rendered state, not silence. */
  statedTotalDebt: number | null;
  capturedFace: number;
  /** Bridge items the note itself states (discount, issuance costs). Subtracted before the residual is judged. */
  statedBridge: number;
  residual: number | null;
  residualFraction: number | null;
  /** Test 2. Null when unmeasurable. */
  residualPasses: boolean | null;
  /** Test 1 — categories the note states exist but for which nothing was captured. */
  categoriesMissing: DebtCategory[];
  categoriesCaptured: DebtCategory[];
  entries: CapturedEntry[];
  /** Entries larger than the total they are meant to be part of — a transcription error, excluded from the sum and stated as one. */
  impossible: CapturedEntry[];
  /** Committed but undrawn — reported separately, never summed as debt, never dropped. */
  capacity: CapturedEntry[];
  /** The captions summed, named on the rendered surface per the spec. */
  anchorCaptions: string[];
  line: string;
}

/** A current-maturities ADJUSTMENT must not be subtracted when stated total debt already sums the current-maturities CAPTION — that removes it twice. Matched by category, never proximity. */
function isCurrentPortion(label: string | null | undefined): boolean {
  return /current|within one year|due within/i.test(label ?? "");
}

/**
 * Computes coverage AT THE ANCHOR ONLY (3e). Post-anchor 8-K issuances are
 * deltas layered on top of this number and are deliberately not passed in —
 * blending them would compare a position at one date against instruments that
 * did not exist at it, and the coverage surface states the two stages
 * separately for the same reason.
 */
export function computeCoverage(debtMaturity: TriggerResult | undefined): CoverageResult {
  const caps = debtMaturity?.balanceSheetDebtCaptions ?? [];
  const anchorCaptions = caps.map((c) => c.label);
  const statedTotalDebt = caps.length > 0 ? caps.reduce((a, c) => a + (parseMoneyAmount(c.amount) ?? 0), 0) : null;

  const seq = normalizeScheduleSequence(debtMaturity?.scheduleSequence);
  const rows = seq.filter((e) => e.kind === "row");
  const hasCurrentCaption = caps.some((c) => isCurrentPortion(c.label));
  const statedBridge = seq
    .filter((e) => e.kind === "adjustment")
    .filter((e) => !(hasCurrentCaption && isCurrentPortion(e.label)))
    .reduce((a, e) => a + (parseMoneyAmount(e.amount) ?? 0), 0);

  // CAPACITY IS SPLIT OFF BEFORE DEDUP, AND THE ORDER IS LOAD-BEARING.
  //
  // A table row is a balance. Capacity is not a balance, so a commitment can
  // never be the same instrument as a row no matter what the two figures
  // are — and running dedup first made exactly that mistake on the worked
  // example: UHS's $700 million Twelfth Amendment delayed-draw facility was
  // suppressed as a duplicate of its $700 million 1.65% senior notes due
  // 2026, two entirely different things that happen to be the same size and
  // state nothing that contradicts.
  const capacity: CapturedEntry[] = [];
  const debtBearing: ProseInstrumentRow[] = [];
  const contributionOf = new Map<ProseInstrumentRow, { amount: number | null; why: string }>();
  for (const p of debtMaturity?.proseInstruments ?? []) {
    const c = debtContribution(p, debtMaturity?.revolver);
    if (c.capacity) {
      capacity.push({ category: p.category, label: p.name ?? p.category, amount: p.amount ? parseMoneyAmount(p.amount) : null, from: "prose", basisNote: c.why });
    } else {
      debtBearing.push(p);
      contributionOf.set(p, { amount: c.amount, why: c.why });
    }
  }
  const { kept: prose } = dedupAgainstRows(debtBearing, rows);
  const proseEntries: CapturedEntry[] = prose.map((p) => ({
    category: p.category,
    label: p.name ?? p.category,
    amount: contributionOf.get(p)?.amount ?? null,
    from: "prose" as const,
    basisNote: contributionOf.get(p)?.why,
  }));
  const entries: CapturedEntry[] = [
    ...rows.map((r) => ({ category: "table-row" as const, label: r.label ?? "(unlabeled)", amount: parseMoneyAmount(r.amount), from: "row" as const })),
    ...proseEntries,
  ];

  // ONE INSTRUMENT CANNOT BE LARGER THAN THE TOTAL IT IS PART OF.
  //
  // Arithmetic, not vocabulary, and it needs nothing but the denominator this
  // function already holds. UHS at v24 is why: the note prints "$ 1.448
  // billion" and the model returned "$1,448 billion" — one misplaced decimal,
  // $1.448 TRILLION, rendered on a ladder line as this company's term loan.
  // Coverage read 29,880%, so nothing was silently wrong; but the LINE was
  // wrong, and a line is what an RM reads.
  //
  // A component of a stated total cannot exceed that total. The entry is
  // excluded from the sum and rendered as impossible, with both figures, so
  // the reader sees a transcription error rather than a balance.
  const impossible = statedTotalDebt === null ? [] : entries.filter((e) => e.amount !== null && Math.abs(e.amount) > Math.abs(statedTotalDebt) * IMPOSSIBLE_ENTRY_MULTIPLE);
  const countable = entries.filter((e) => !impossible.includes(e));
  const capturedFace = countable.reduce((a, e) => a + (e.amount ?? 0), 0);
  const residual = statedTotalDebt === null ? null : statedTotalDebt - (capturedFace + statedBridge);
  const residualFraction = residual === null || !statedTotalDebt ? null : Math.abs(residual) / Math.abs(statedTotalDebt);
  const residualPasses = residualFraction === null ? null : residualFraction <= COVERAGE_RESIDUAL_LIMIT;

  const statedCategories = new Set<DebtCategory>((debtMaturity?.proseInstruments ?? []).map((p) => p.category));
  if (debtMaturity?.revolver) statedCategories.add("revolver");
  const capturedCategories = new Set<DebtCategory>(
    countable.filter((e) => e.category !== "table-row" && e.amount !== null).map((e) => e.category as DebtCategory)
  );
  // A facility whose only stated figure is a commitment is NOT "missing" —
  // it is accounted for, as capacity. Flagging it would report a gap that
  // does not exist; omitting it entirely would hide a real instrument.
  const reportedAsCapacity = new Set<DebtCategory>(capacity.map((e) => e.category as DebtCategory));
  const categoriesMissing = [...statedCategories].filter(
    (c) => c !== "delayed-draw-term-loan" && !capturedCategories.has(c) && !reportedAsCapacity.has(c)
  );

  return {
    statedTotalDebt,
    capturedFace,
    statedBridge,
    residual,
    residualFraction,
    residualPasses,
    categoriesMissing,
    categoriesCaptured: [...capturedCategories],
    entries: countable,
    impossible,
    capacity,
    anchorCaptions,
    line: coverageLine({ statedTotalDebt, capturedFace, residualFraction, residualPasses, categoriesMissing, anchorCaptions, entries: countable, capacity, impossible }),
  };
}

/**
 * NEVER SUPPRESS. "No anchor located, coverage unmeasured" is a valid
 * rendered state; silence is not. A reader must be able to tell a book we
 * checked and found complete from one we could not check.
 */
function coverageLine(r: {
  statedTotalDebt: number | null;
  capturedFace: number;
  residualFraction: number | null;
  residualPasses: boolean | null;
  categoriesMissing: DebtCategory[];
  anchorCaptions: string[];
  entries: CapturedEntry[];
  capacity: CapturedEntry[];
  impossible: CapturedEntry[];
}): string {
  const b = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(0)}M`);
  if (r.statedTotalDebt === null) {
    return "coverage unmeasured — the anchor filing states no balance-sheet debt caption to measure against";
  }
  const pct = r.statedTotalDebt ? Math.round((r.capturedFace / r.statedTotalDebt) * 100) : 0;
  const rowN = r.entries.filter((e) => e.from === "row").length;
  const proseN = r.entries.filter((e) => e.from === "prose").length;
  const counted = `${rowN} row${rowN === 1 ? "" : "s"}${proseN > 0 ? ` + ${proseN} prose instrument${proseN === 1 ? "" : "s"}` : ""}`;
  const head = `${counted} cover ${b(r.capturedFace)} of ${b(r.statedTotalDebt)} stated total debt (${pct}%), against ${r.anchorCaptions.join(" + ")}`;
  const missing = r.categoriesMissing.length > 0 ? ` — STATED BUT NOT CAPTURED: ${r.categoriesMissing.join(", ")}` : "";
  const cap =
    r.capacity.length > 0
      ? ` — plus ${b(r.capacity.reduce((a, e) => a + (e.amount ?? 0), 0))} of undrawn capacity NOT counted as debt (${r.capacity.map((e) => `${e.label}: ${e.basisNote}`).join("; ")})`
      : "";
  const resid =
    r.residualPasses === false && r.residualFraction !== null
      ? ` — ${(r.residualFraction * 100).toFixed(1)}% unexplained, above the ${(COVERAGE_RESIDUAL_LIMIT * 100).toFixed(1)}% line`
      : "";
  const imp =
    r.impossible.length > 0
      ? ` — IMPOSSIBLE AMOUNT, EXCLUDED: ${r.impossible.map((e) => `${e.label} reads ${b(e.amount ?? 0)}, larger than the ${b(r.statedTotalDebt ?? 0)} total it is part of`).join("; ")}. Read the filing; this is a transcription error, not a balance.`
      : "";
  return head + missing + resid + cap + imp;
}

/**
 * 3B — the free arithmetic check. drawn + LCs + available = facility size.
 * A mismatch is its own flag rather than a silently wrong liquidity figure.
 */
export function checkRevolverArithmetic(rev: RevolverRow | null | undefined): { checked: boolean; ok: boolean; note: string } {
  if (!rev) return { checked: false, ok: false, note: "" };
  const size = rev.facilitySize ? parseMoneyAmount(rev.facilitySize) : null;
  const parts = [rev.drawn, rev.lettersOfCredit, rev.available].map((s) => (s ? parseMoneyAmount(s) : null));
  if (size === null || parts.some((p) => p === null)) {
    return { checked: false, ok: false, note: "revolver arithmetic not checkable — the note states fewer than all four figures" };
  }
  const sum = parts.reduce((a: number, p) => a + (p ?? 0), 0);
  const ok = Math.abs(sum - size) <= Math.abs(size) * 0.01;
  return {
    checked: true,
    ok,
    note: ok
      ? `revolver reconciles — drawn + LCs + available = facility size`
      : `REVOLVER DOES NOT RECONCILE — drawn + LCs + available is ${(sum / 1e6).toFixed(0)}M against a stated facility of ${(size / 1e6).toFixed(0)}M; read the filing before quoting availability`,
  };
}
