/**
 * SESSION 21 — WHAT COUNTS AS DEBT CONTENT, FOR BOUNDING A NOTE.
 *
 * The locator already has a notion of debt content — a coupon near a maturity
 * year — and it is the right one for FINDING a note and the wrong one for
 * BOUNDING one. Measured on the real ten, a boundary built on it removed
 * DaVita's revolver line, Quest's entire maturity schedule and Centene's
 * $1,289 million repurchase, because a maturity-year ladder, a facility
 * balance and a repurchase sentence are all debt and none of them carries a
 * coupon.
 *
 * So this is a second, wider definition, used only to decide where a note
 * ENDS. Two positive tests, either sufficient; two exclusions that apply
 * regardless.
 *
 * CIRCULARITY GUARD, AND IT IS THE CONSTRAINT THAT SHAPES EVERYTHING HERE:
 * the boundary runs BEFORE extraction, so it may use only the XBRL stated
 * total (the filer's own tags) and the figures printed in the span. It may
 * never use an extracted ladder row, because those do not exist yet and
 * because a boundary that depended on them would be deciding what to show
 * the model from what the model already said.
 */

/** A comma-grouped figure, with an explicit currency scale word when the text prints one. */
export interface PrintedFigure {
  raw: string;
  at: number;
  /** Digits only, unscaled — a table prints "5,642" and means millions or thousands depending on its caption. */
  value: number;
  /** Set when the text states the scale beside the figure ("$ 1,289 million"). */
  scaleWord: 1e3 | 1e6 | 1e9 | null;
}

const FIGURE_RE = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+\.\d+)\s*(thousand|million|billion)?/gi;
const SCALE: Record<string, 1e3 | 1e6 | 1e9> = { thousand: 1e3, million: 1e6, billion: 1e9 };

export function printedFigures(region: string): PrintedFigure[] {
  const out: PrintedFigure[] = [];
  for (const m of region.matchAll(FIGURE_RE)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    // EXCLUSION 2 — a figure with no currency scale is not a debt amount.
    // Ratios and covenant thresholds ("4.50 to 1.00", "2.5") print as bare
    // decimals and would otherwise drift into every test below.
    const grouped = m[1].includes(",");
    const scaleWord = m[2] ? SCALE[m[2].toLowerCase()] : null;
    if (!grouped && !scaleWord) continue;
    out.push({ raw: m[0].trim(), at: m.index ?? 0, value, scaleWord });
  }
  return out;
}

/** Every plausible dollar reading of a printed figure — a table states its scale in a caption, not on the row. */
function scaledValues(f: PrintedFigure): number[] {
  return f.scaleWord ? [f.value * f.scaleWord] : [f.value, f.value * 1e3, f.value * 1e6];
}

const TOTAL_TOLERANCE = 0.02;
/**
 * Below this share of stated total debt, an amount is not a debt principal at
 * this company's scale. Set at the top of the interest/fee band Stage 2
 * measured: a quarter's coupon on a tranche runs 0.1%–10% OF THAT TRANCHE,
 * which against the whole book is a fraction of a percent.
 */
const MIN_PRINCIPAL_SHARE = 0.005;

export interface DebtContentContext {
  /** The filer's own XBRL stated total debt, in dollars. Null when it tags none — the tests that need it then abstain rather than guess. */
  xbrlStatedTotal: number | null;
  /** Figures printed in the part of the span already established as debt disclosure. A figure repeated from there is the same fact restated. */
  knownDebtFigures: Set<number>;
  /** Offsets of coupon-near-maturity matches, for positive test (b). */
  couponSites: number[];
}

/** How close a figure must sit to a coupon+maturity to be read as that instrument's own amount. */
const COUPON_PROXIMITY = 200;

/**
 * POSITIVE TEST (a) — the figure relates to a debt principal.
 * POSITIVE TEST (b) — the figure sits with a stated coupon and maturity.
 * Either is sufficient.
 */
export function figureIsDebtContent(f: PrintedFigure, ctx: DebtContentContext): { debt: boolean; why: string } {
  // (b) first: it is the cheapest and it needs no total.
  if (ctx.couponSites.some((c) => Math.abs(c - f.at) <= COUPON_PROXIMITY)) {
    return { debt: true, why: "sits with a stated coupon and maturity" };
  }
  // (a2) the same figure already appears in this note's debt disclosure —
  // a balance restated in prose after the table that states it.
  if (ctx.knownDebtFigures.has(f.value)) {
    return { debt: true, why: "this figure already appears in the note's debt disclosure" };
  }
  if (ctx.xbrlStatedTotal === null || ctx.xbrlStatedTotal <= 0) {
    // No total to relate to. ABSTAIN — treat as debt, because the boundary
    // must never cut on an absence of evidence.
    return { debt: true, why: "no XBRL stated total to relate this figure to; abstaining, which keeps it" };
  }
  const total = ctx.xbrlStatedTotal;
  for (const v of scaledValues(f)) {
    // (a1) it IS the stated total, at some scale.
    if (Math.abs(v - total) / total <= TOTAL_TOLERANCE) return { debt: true, why: `matches the filer's XBRL stated total at ${v.toLocaleString("en-US")}` };
    // (a3) it is a principal-sized component of it. EXCLUSION 1 rides here:
    // interest, fees and amortization are small against the whole book and
    // fall under the floor.
    if (f.scaleWord && v >= total * MIN_PRINCIPAL_SHARE && v <= total * 1.05) {
      return { debt: true, why: `a stated amount of ${v.toLocaleString("en-US")}, ${((v / total) * 100).toFixed(1)}% of stated total debt` };
    }
  }
  return { debt: false, why: `no relation to stated total debt at any scale, no coupon beside it, and not a figure this note's debt disclosure states` };
}

/**
 * A run of figures is a NON-DEBT TABLE when none of its figures passes a
 * positive test AND the run closes on its own subtotal — the signature of a
 * self-contained table of something else. UHS's cash reconciliation is the
 * measured case: 138,800 + 133,583 = 272,383, a total that is 5.6% of its
 * debt and is the table's own bottom line.
 */
export function runIsNonDebtTable(figs: PrintedFigure[], ctx: DebtContentContext): { nonDebt: boolean; sumsTo: number | null } {
  if (figs.length < 3) return { nonDebt: false, sumsTo: null };
  if (figs.some((f) => figureIsDebtContent(f, ctx).debt)) return { nonDebt: false, sumsTo: null };
  // LARGEST CANDIDATE FIRST. A table's bottom line is its biggest figure, and
  // reporting a smaller coincidental match would name the wrong number in an
  // explanation a reader is meant to check against the filing.
  let best: number | null = null;
  for (const candidate of [...figs].sort((a, b) => b.value - a.value)) {
    const rest = figs.filter((o) => o !== candidate).map((o) => o.value);
    let sum = 0;
    for (const v of [...rest].sort((a, b) => b - a)) {
      if (sum + v > candidate.value * 1.02) continue;
      sum += v;
      if (Math.abs(sum - candidate.value) <= candidate.value * 0.02) { best = candidate.value; break; }
    }
    if (best !== null) break;
  }
  if (best !== null) return { nonDebt: true, sumsTo: best };
  // A run of figures that relate to nothing in this company's debt is not
  // debt content even when it does not visibly close on a subtotal.
  return { nonDebt: true, sumsTo: null };
}
