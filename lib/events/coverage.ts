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

export type DebtCategory = ProseInstrumentRow["category"];

export interface CapturedEntry {
  category: DebtCategory | "table-row";
  label: string;
  amount: number | null;
  /** "row" (from the schedule table) or "prose" (from the note's narrative). Stated so the coverage line can name what it counted. */
  from: "row" | "prose";
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
  /** The captions summed, named on the rendered surface per the spec. */
  anchorCaptions: string[];
  line: string;
}

/** A current-maturities ADJUSTMENT must not be subtracted when stated total debt already sums the current-maturities CAPTION — that removes it twice. Matched by category, never proximity. */
function isCurrentPortion(label: string | null | undefined): boolean {
  return /current|within one year|due within/i.test(label ?? "");
}

/**
 * 3C — DEDUP BEFORE COVERAGE.
 *
 * A prose instrument that duplicates a table row is ONE entry. Without this,
 * a company whose note both tabulates its senior notes and describes them in
 * narrative counts them twice and reports impossible coverage — and UHS's own
 * "Subtotal — revolving credit, term loan A and Senior Notes" is exactly the
 * shape that would do it.
 *
 * Matched on CATEGORY plus AMOUNT, never on name: a filing calls the same
 * facility different things in different sentences.
 */
export function dedupAgainstRows(
  prose: ProseInstrumentRow[],
  rows: VerifiedSequenceEntry[]
): { kept: ProseInstrumentRow[]; suppressed: ProseInstrumentRow[] } {
  const rowAmounts = new Set(
    rows.map((r) => parseMoneyAmount(r.amount)).filter((v): v is number => v !== null && v > 0)
  );
  const kept: ProseInstrumentRow[] = [];
  const suppressed: ProseInstrumentRow[] = [];
  for (const p of prose) {
    const amt = p.amount ? parseMoneyAmount(p.amount) : null;
    // DEDUP IS AGAINST ROWS ONLY, NEVER PROSE AGAINST PROSE.
    //
    // An earlier cut also collapsed prose entries sharing a category and an
    // amount, and it cost exactly $1B on the worked example: UHS issued THREE
    // separate $500 million senior notes (2029, 2032, 2034), which are three
    // instruments that happen to be the same size. Same category and same
    // amount is the signature of a duplicate only when one of the two is a
    // TABLE ROW — because then the note has printed the instrument twice, once
    // in each form. Two sentences are two instruments.
    if (amt !== null && rowAmounts.has(amt)) suppressed.push(p);
    else kept.push(p);
  }
  return { kept, suppressed };
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

  const { kept: prose } = dedupAgainstRows(debtMaturity?.proseInstruments ?? [], rows);

  const entries: CapturedEntry[] = [
    ...rows.map((r) => ({ category: "table-row" as const, label: r.label ?? "(unlabeled)", amount: parseMoneyAmount(r.amount), from: "row" as const })),
    // Undrawn capacity is NOT debt and never counts toward coverage.
    ...prose
      .filter((p) => p.category !== "delayed-draw-term-loan")
      .map((p) => ({ category: p.category, label: p.name ?? p.category, amount: p.amount ? parseMoneyAmount(p.amount) : null, from: "prose" as const })),
  ];

  const capturedFace = entries.reduce((a, e) => a + (e.amount ?? 0), 0);
  const residual = statedTotalDebt === null ? null : statedTotalDebt - (capturedFace + statedBridge);
  const residualFraction = residual === null || !statedTotalDebt ? null : Math.abs(residual) / Math.abs(statedTotalDebt);
  const residualPasses = residualFraction === null ? null : residualFraction <= COVERAGE_RESIDUAL_LIMIT;

  const statedCategories = new Set<DebtCategory>((debtMaturity?.proseInstruments ?? []).map((p) => p.category));
  if (debtMaturity?.revolver) statedCategories.add("revolver");
  const capturedCategories = new Set<DebtCategory>(
    entries.filter((e) => e.category !== "table-row" && e.amount !== null).map((e) => e.category as DebtCategory)
  );
  const categoriesMissing = [...statedCategories].filter(
    (c) => c !== "delayed-draw-term-loan" && !capturedCategories.has(c)
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
    entries,
    anchorCaptions,
    line: coverageLine({ statedTotalDebt, capturedFace, residualFraction, residualPasses, categoriesMissing, anchorCaptions, entries }),
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
  const resid =
    r.residualPasses === false && r.residualFraction !== null
      ? ` — ${(r.residualFraction * 100).toFixed(1)}% unexplained, above the ${(COVERAGE_RESIDUAL_LIMIT * 100).toFixed(1)}% line`
      : "";
  return head + missing + resid;
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
