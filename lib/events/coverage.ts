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
/**
 * SESSION 20, STAGE 4 — ONE INSTRUMENT IN TWO UNITS IS STILL ONE.
 *
 * Matching was exact equality on the parsed amount, which is exact equality
 * on how the filing chose to PRINT the figure. The same term loan written
 * "$ 1.448 billion" in a sentence and "1,447,500" in a table stated in
 * thousands is 1.448e9 against 1.4475e9 — a 0.03% difference that is not a
 * difference at all, it is one number rounded for prose.
 *
 * The test is not a tolerance band. It is the rounding relationship itself:
 * the more precise figure MATCHES the less precise one when it rounds to it
 * at the less precise one's OWN PRINTED PRECISION. "$1.448 billion" carries
 * three decimals of a billion, 1.4475e9 rounds to 1.448e9 there, so they
 * match; "$1.155 billion" also carries three, 1.1625e9 rounds to 1.163e9
 * there, so they do not — and they should not, because those two ARE
 * different balances of an amortising loan at two different dates.
 */
function printedPrecision(raw: string): number {
  const m = raw.match(/([\d,]+)(?:\.(\d+))?\s*(thousand|million|billion|bn|mm|k)?/i);
  if (!m) return 0;
  const unit = (m[3] ?? "").toLowerCase();
  const scale = unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit.startsWith("t") || unit === "k" ? 1e3 : 1;
  return scale / Math.pow(10, (m[2] ?? "").length);
}

/** Do two printed amounts state the same figure, once units are normalised and the coarser one's own rounding is allowed for? */
export function sameNormalisedAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const va = parseMoneyAmount(a);
  const vb = parseMoneyAmount(b);
  if (va === null || vb === null || va <= 0 || vb <= 0) return false;
  if (va === vb) return true;
  // Round the finer figure at the coarser one's precision and compare there.
  const step = Math.max(printedPrecision(a), printedPrecision(b));
  if (!Number.isFinite(step) || step <= 0) return false;
  return Math.round(va / step) === Math.round(vb / step);
}

/** A four-digit maturity year, from an ISO date or a bare year. Null when the entry states none. */
function maturityYear(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/** Coupon rate as a number, when stated. */
function rateOf(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/**
 * INSTRUMENT CONTINUITY. Two entries are the same instrument only if nothing
 * they BOTH state contradicts. A maturity or a rate stated on both and
 * differing is the filing telling us these are two instruments, whatever
 * their sizes are — which is what keeps UHS's three separate $500 million
 * senior notes (2029, 2032, 2034) three, and would keep them three even if
 * every other signal collapsed them.
 */
interface Continuity { maturityDate: string | null; rate: string | null; label?: string | null; name?: string | null }

/**
 * An instrument's distinguishing facts, read from wherever the filing put
 * them. A transcribed bullet often carries its maturity in its own LABEL
 * ("4.625 % senior secured notes due in October, 2029") and nowhere else,
 * and a rule that only reads the maturityDate field would find no
 * contradiction between three notes that plainly contradict.
 */
function statedYear(e: Continuity): number | null {
  return maturityYear(e.maturityDate) ?? maturityYear(e.label ?? e.name);
}
function statedRate(e: Continuity): number | null {
  return rateOf(e.rate) ?? rateOf(e.label ?? e.name);
}

function contradicts(a: Continuity, b: Continuity): boolean {
  const ya = statedYear(a), yb = statedYear(b);
  if (ya !== null && yb !== null && ya !== yb) return true;
  const ra = statedRate(a), rb = statedRate(b);
  if (ra !== null && rb !== null && Math.abs(ra - rb) > 0.001) return true;
  return false;
}

export function dedupAgainstRows(
  prose: ProseInstrumentRow[],
  rows: VerifiedSequenceEntry[]
): { kept: ProseInstrumentRow[]; suppressed: ProseInstrumentRow[] } {
  const kept: ProseInstrumentRow[] = [];
  const suppressed: ProseInstrumentRow[] = [];
  for (const p of prose) {
    // DEDUP IS AGAINST ROWS ONLY, NEVER PROSE AGAINST PROSE.
    //
    // An earlier cut also collapsed prose entries sharing a category and an
    // amount, and it cost exactly $1B on the worked example: UHS issued THREE
    // separate $500 million senior notes (2029, 2032, 2034), which are three
    // instruments that happen to be the same size. Same category and same
    // amount is the signature of a duplicate only when one of the two is a
    // TABLE ROW — because then the note has printed the instrument twice, once
    // in each form. Two sentences are two instruments.
    const twin = rows.find((r) => sameNormalisedAmount(r.amount, p.amount) && !contradicts(r, p));
    if (twin) suppressed.push(p);
    else kept.push(p);
  }
  return { kept, suppressed };
}

/**
 * SESSION 20, STAGE 4 — DEBT IS WHAT IS DRAWN.
 *
 * An undrawn commitment is capacity. It is a real fact, it belongs on the
 * liquidity line, and it is not owed. The distinction was already drawn once
 * here — the delayed-draw facility was excluded — and drawn in ONE PLACE
 * only, as a category name rather than as the distinction itself, so every
 * other facility went through uncounted. Measured on v22: Molina contributed
 * its $1.25 billion facility SIZE against nothing drawn, Tenet its $1.900
 * billion against $0 drawn, and both rendered above 100% coverage.
 *
 * Three tests, in order, none of them a list of facility names:
 *   1. A revolving facility contributes its DRAWN balance and nothing else.
 *      The drawn figure has its own field precisely because size and balance
 *      are different numbers; where the note states no drawn balance, the
 *      facility contributes zero.
 *   2. An amount the note itself states as a commitment contributes zero,
 *      whatever kind of instrument it is. This is the general form, and it
 *      is why a facility type nobody has seen yet is handled.
 *   3. Otherwise the stated amount is a balance and counts.
 *
 * Nothing excluded is silently dropped — every one is returned as capacity
 * and rendered on its own line.
 */
export function debtContribution(
  p: ProseInstrumentRow,
  revolver: RevolverRow | null | undefined
): { amount: number | null; capacity: boolean; why: string } {
  if (p.category === "revolver") {
    const drawn = revolver?.drawn ? parseMoneyAmount(revolver.drawn) : null;
    if (drawn === null) return { amount: null, capacity: true, why: "revolving facility, no drawn balance stated — capacity, not debt" };
    return { amount: drawn, capacity: drawn === 0, why: drawn === 0 ? "revolving facility, nothing drawn" : "revolving facility, drawn balance" };
  }
  if (p.category === "delayed-draw-term-loan") {
    return { amount: null, capacity: true, why: "committed but undrawn — capacity, not debt" };
  }
  if (p.amountBasis === "commitment") {
    return { amount: null, capacity: true, why: "the note states this amount as a commitment, not a balance outstanding" };
  }
  return { amount: p.amount ? parseMoneyAmount(p.amount) : null, capacity: false, why: "stated balance outstanding" };
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

  const capturedFace = entries.reduce((a, e) => a + (e.amount ?? 0), 0);
  const residual = statedTotalDebt === null ? null : statedTotalDebt - (capturedFace + statedBridge);
  const residualFraction = residual === null || !statedTotalDebt ? null : Math.abs(residual) / Math.abs(statedTotalDebt);
  const residualPasses = residualFraction === null ? null : residualFraction <= COVERAGE_RESIDUAL_LIMIT;

  const statedCategories = new Set<DebtCategory>((debtMaturity?.proseInstruments ?? []).map((p) => p.category));
  if (debtMaturity?.revolver) statedCategories.add("revolver");
  const capturedCategories = new Set<DebtCategory>(
    entries.filter((e) => e.category !== "table-row" && e.amount !== null).map((e) => e.category as DebtCategory)
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
    entries,
    capacity,
    anchorCaptions,
    line: coverageLine({ statedTotalDebt, capturedFace, residualFraction, residualPasses, categoriesMissing, anchorCaptions, entries, capacity }),
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
  return head + missing + resid + cap;
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
