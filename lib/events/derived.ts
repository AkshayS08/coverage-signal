/**
 * SESSION 21, STAGE 5 — DERIVED LINES: ARITHMETIC ON VERIFIED FACTS, AND
 * NOTHING ELSE.
 *
 * A card states facts. What makes a fact a call is the arithmetic beside it:
 * how long until this matures, has this company refinanced early before,
 * what is behind it on the ladder, and what liquidity sits next to it. Every
 * one of those is computable from fields already extracted and already
 * verified. None of them needs a model.
 *
 * SO NONE OF THEM USES ONE. These lines are computed in code and rendered as
 * their own block, deliberately outside the Sonnet-drafted body. Three
 * reasons:
 *
 *   1. Cost. This is arithmetic; it does not need a narration bump.
 *   2. Determinism. A computed month count is the same on every run.
 *   3. Rule 6, in its strongest form. A field the model is shown must be a
 *      field the guards can see — and a field the model is never shown
 *      cannot drift from what the guards see at all.
 *
 * WHAT IS FORBIDDEN HERE, permanently: anything about market conditions, the
 * rate environment, "favourable timing", or whether a company should act.
 * That is the unsupported-inference class Session 19 removed and it does not
 * return through a side door labelled "derived". The test is mechanical — if
 * a line is not arithmetic over a field some filing states, it does not
 * render.
 *
 * NEVER SUPPRESSED. A line that cannot compute renders and says why. "The
 * filing states only the year, so no month count is computed" is information;
 * a blank is not.
 *
 * WHAT A DERIVED LINE MAY PRINT, and this is what the guard enforces: its
 * own computed value, plus dates, instrument names and amounts that appear
 * VERBATIM in one of the source sentences it declares as input. It does not
 * restate a figure the card and the ladder already carry — partly because
 * two surfaces stating one number is this project's oldest defect, and partly
 * because an extracted field's DISPLAY form ("$1,067 million") legitimately
 * differs from the bare cell its filing prints ("1,067"), and a guard strict
 * enough to catch a guessed scale must reject that difference. So the line
 * does not print it.
 *
 * THE CLOCK IS PASSED IN AND HAS NO DEFAULT. Session 18 shipped a bug where
 * one code path pinned an as-of date and another called `new Date()`, and the
 * two disagreed about which rows were still live. `asOf` here is a required
 * parameter for exactly that reason: a second clock cannot be introduced by
 * forgetting to pass the first.
 */
import type { FlashCard } from "./buildEvents";
import type { CompanyPosition, LadderRow } from "./position";
import { parseMoneyAmount } from "./position";
import type { TriggerResult } from "../agent";
import { monthsBetween, isValidIsoDate } from "./eventTiming";
import { extractFactTokens } from "../agent/factTokens";
import { strictFactTokensMatch } from "./numberGuard";

export type DerivedKind = "months-to-maturity" | "refi-pattern" | "next-tranche" | "liquidity";

export interface DerivedLine {
  kind: DerivedKind;
  /** The label the surface prints beside it. */
  label: string;
  /** The rendered sentence. */
  text: string;
  /**
   * The verified text this line is arithmetic OVER, verbatim — a row's own
   * sourceLine, a claim's own sourceLine, the revolver's own sentence. The
   * guard checks the line's figures against these, and the surface can show
   * them so a reader checks the arithmetic against the filing rather than
   * trusting it.
   *
   * Empty is a failure, not a state: a derived line with no verified input
   * behind it is an assertion, and assertions do not render here.
   */
  inputs: string[];
  /**
   * INPUTS THAT ARE FIELDS, NOT SENTENCES.
   *
   * `inputs` above are verbatim filing text and can be located in a
   * document. Some inputs are not: a normalized `eventDate` of "2025-11-18"
   * is verified — by the event-date guard, against the filing — but the
   * filing prints "November 18, 2025", so searching for the ISO form finds
   * nothing. A verification sheet that reported that as NOT FOUND would
   * teach its reader to skip warnings, which on a sheet meant for signature
   * is worse than showing none.
   *
   * So a field value is declared HERE, with the guard that established it
   * named. The token guard treats both kinds identically; only the sheet
   * renders them differently, and it can then say what it means.
   */
  fieldInputs: { value: string; verifiedBy: string }[];
  /**
   * The ONE value this line computed — the month count, the gap, the
   * coverage ratio. Null when the line could not compute (and then the text
   * says why). Declared rather than inferred so the guard can tell a
   * computed figure from a copied one; everything else in the text must
   * trace to `inputs`.
   */
  computed: string | null;
}

/** A month count is stated in whole months; the underlying arithmetic is shared with the gate's own timing. */
function wholeMonths(fromIso: string, asOf: Date): number {
  return monthsBetween(fromIso, asOf);
}

/** The pinned run date, printed ONCE by the surface for the whole block rather than inside every line. */
export function runDateLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * THE YEAR-GRANULARITY RULE, and it is the same one the narration prompt has
 * carried since Session 17: when a filing states only a year, no month count
 * is computed. Only December of that year is N months out, the filing does
 * not say which month, and a month count there is precision nobody
 * disclosed. The line still renders — it states the year and states why
 * there is no count.
 */
function statesOnlyAYear(row: { dateGranularity: string | null }): boolean {
  return row.dateGranularity === "year";
}

// ============================================================================
// 1. MONTHS TO MATURITY — the verified maturity date against the pinned as-of
// ============================================================================

function monthsToMaturity(row: LadderRow, asOf: Date): DerivedLine {
  const label = "Months to maturity";
  const inputs = [row.sourceLine];

  if (!row.maturityDate) {
    return { kind: "months-to-maturity", label, inputs, fieldInputs: [], computed: null,
      text: `The filing states no maturity date for ${row.instrument}, so no month count is computed. The row renders on its stated amount alone.` };
  }
  if (statesOnlyAYear(row)) {
    return { kind: "months-to-maturity", label, inputs, fieldInputs: [], computed: null,
      text: `Matures during ${row.maturityDate}. The filing states only the year, so no month count is computed — which month it falls in is precision the filing does not disclose.` };
  }
  if (!isValidIsoDate(row.maturityDate)) {
    return { kind: "months-to-maturity", label, inputs, fieldInputs: [], computed: null,
      text: `The filing states a maturity of "${row.maturityDate}" for ${row.instrument}, which is not a date this can compute against. No month count is computed.` };
  }

  const months = wholeMonths(row.maturityDate, asOf);
  const computed = `${Math.abs(months)} months`;
  // PAST OR FUTURE IS DECIDED BY THE DATES, NEVER BY THE ROUNDED MONTH COUNT.
  // monthsBetween rounds, so a tranche that matured three days ago returns
  // 0 — and a `months >= 0` test then reads it as upcoming. Measured: UHS's
  // 1.65% notes matured 2026-09-01 and rendered "0 months out" three days
  // later, which is the one thing this line exists to get right.
  const isPast = new Date(row.maturityDate).getTime() < asOf.getTime();
  // The run date is not printed. It is the same for every line on the page
  // and the surface states it once; repeating it here would put a token in
  // every line that no filing states.
  // "0 months" is true and reads wrong for something days old — say what it is.
  const ago = months === 0 ? "less than a month" : computed;
  const out = months === 0 ? "Under a month" : computed;
  const text = isPast
    ? `MATURED ${ago} ago, on ${row.maturityDate}, and is still carried. Nothing in the corpus confirms repayment.`
    : `${out} out — matures ${row.maturityDate}.`;
  return { kind: "months-to-maturity", label, inputs, fieldInputs: [], computed, text };
}

// ============================================================================
// 2. REFI PATTERN — the company's own verified issuance-redeems history
// ============================================================================

/**
 * Has this company refinanced before, and how recently — from its own
 * verified, corroborated-completed redemption claims and the pinned as-of.
 *
 * IT IS DATED BY THE ISSUANCE, AND THE LINE SAYS "REFINANCED" FOR THAT
 * REASON. A RedeemsClaim carries no date of its own; the only date available
 * is the issuance's `eventDate`, which dates the OFFERING. Writing "last
 * retired debt on <that date>" would assert a retirement date no filing
 * states — the amount-join defect one field over, and this line was written
 * that way first: Encompass's 8-K prices its 2034 notes on 2026-05-29 and
 * the line read as though the 2028 notes were called that day.
 *
 * A refinancing IS the issuance, and the retirement is what its proceeds
 * did. So the issuance's date is the refinancing's date, correctly, and the
 * retirement is stated without one.
 *
 * The months-early clause is CONDITIONAL on the retired instrument's
 * maturity being structurally available: the redemption claim itself carries
 * no maturity field, so it is joined to a ladder row on the SAME identity
 * rule everything else in this pipeline uses — rate and instrument together,
 * never a loose substring, which measured on this book matched CHS's 5.625%
 * claim to its unrelated 6% row.
 *
 * Where no row carries the maturity, the line still renders with the
 * redemption's date, amount and age, and states that the months-early figure
 * is not computable. Measured across the book, that is five of six
 * redemptions: the structured maturity for a tranche the note no longer
 * carries genuinely is not there, and inventing one by parsing the
 * instrument's name would be extraction wearing arithmetic's clothes.
 */
function refiPattern(
  card: FlashCard,
  position: CompanyPosition,
  newDebtIssuance: TriggerResult | undefined,
  asOf: Date
): DerivedLine {
  const label = "Refinancing pattern";
  const claims = (newDebtIssuance?.redeems ?? []).filter((c) => c.verified && c.status === "completed");

  if (claims.length === 0) {
    return { kind: "refi-pattern", label, inputs: [], fieldInputs: [], computed: null,
      text: `No verified, corroborated-completed redemption in this corpus, so no refinancing pattern is computed. An unverified or merely intended retirement is not a pattern.` };
  }

  // The most recent one. Its own date is the issuance's verified eventDate,
  // falling back to the citation that carries it — both already fact-guarded.
  const when = newDebtIssuance?.eventDate ?? null;
  const claim = claims[0];
  // The claim's own sentence, plus the issuance's own verified quote — the
  // date this line computes an age from is stated in one of the two, and
  // both are verified filing text rather than extracted field values.
  // The claim's own sentence, the issuance's own verified quote, and the
  // issuance's eventDate. The date is a declared input rather than a printed
  // token with nothing behind it: it is verified by the event-date guard
  // against the filing text (the same guard that rejected CHS's claimed
  // 2028-04-01 and normalized Cigna's fabricated 2025-01-01), so declaring
  // it states a fact another guard established — not a field validating
  // itself.
  const inputs = [claim.sourceLine ?? claim.instrument, newDebtIssuance?.verifiedQuote ?? ""].filter(Boolean);
  const fieldInputs = newDebtIssuance?.eventDate
    ? [{ value: newDebtIssuance.eventDate, verifiedBy: "the event-date guard, against the filing text — the same guard that rejected one filer's claimed 2028-04-01 and normalized another's fabricated 2025-01-01" }]
    : [];

  if (!when || !isValidIsoDate(when)) {
    return { kind: "refi-pattern", label, inputs, fieldInputs: [], computed: null,
      text: `An issuance in this corpus retired ${claim.instrument}, and the filing states no date this can compute against, so no age is computed.` };
  }

  const ageMonths = Math.abs(wholeMonths(when, asOf));
  const computed = `${ageMonths} months`;

  // The join: rate AND instrument, never a substring. A retired tranche the
  // note still carries (a PARTIAL redemption) is the case this finds.
  // Measured from the ISSUANCE date, which is what the text now claims.
  const retired = matchClaimToRow(claim.instrument, position.rows);
  const early =
    retired && retired.maturityDate && !statesOnlyAYear(retired) && isValidIsoDate(retired.maturityDate)
      ? Math.abs(monthsBetween(retired.maturityDate, new Date(when)))
      : null;

  if (retired) inputs.push(retired.sourceLine);

  const base = `Last refinanced ${computed} ago — an issuance dated ${when} whose proceeds retired ${claim.instrument}.`;
  const tail =
    early !== null
      ? ` That issuance came ${early} months ahead of the retired tranche's stated ${retired!.maturityDate} maturity.`
      : ` The retired tranche carries no structured maturity in this corpus, so how far ahead of maturity the refinancing came is not computed.`;
  return { kind: "refi-pattern", label, inputs, fieldInputs, computed, text: base + tail };
}

/**
 * Rate AND instrument, together. Same discipline as redemptionRetiresRow and
 * for the same reason: two tranches of one company routinely share a size and
 * a year and differ only in lien or coupon.
 */
function matchClaimToRow(instrument: string, rows: LadderRow[]): LadderRow | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const target = norm(instrument);
  const matches = rows.filter((r) => {
    if (!r.rate) return false;
    const rate = norm(r.rate).replace("%", "");
    if (rate.length < 3 || !target.includes(rate)) return false;
    // The rate alone is not identity — "6%" is a substring of "6.250%". The
    // row's own maturity year must also appear in the claim's name.
    const year = r.maturityDate?.slice(0, 4);
    return !!year && target.includes(year);
  });
  // AMBIGUOUS is not a match. Two rows answering to one claim means the
  // identity rule did not identify anything.
  return matches.length === 1 ? matches[0] : null;
}

// ============================================================================
// 3. NEXT TRANCHE UP — a sort of the company's own ladder
// ============================================================================

function nextTranche(row: LadderRow, position: CompanyPosition, asOf: Date): DerivedLine {
  const label = "Next tranche up";
  const inputs = [row.sourceLine];

  // The ladder is already sorted by maturity in assemblePosition. Capacity is
  // excluded: undrawn commitment has no maturity conversation.
  const ladder = position.rows.filter((r) => !r.isCapacity && r.maturityDate);
  const idx = ladder.findIndex((r) => r.id === row.id);
  const next = idx >= 0 ? ladder[idx + 1] : undefined;

  if (idx < 0) {
    return { kind: "next-tranche", label, inputs, fieldInputs: [], computed: null,
      text: `This tranche is not on the assembled ladder, so nothing can be said about what follows it.` };
  }
  if (!next) {
    return { kind: "next-tranche", label, inputs, fieldInputs: [], computed: null,
      text: `Nothing behind it — this is the last dated tranche on the ladder as the anchor filing states it.` };
  }

  inputs.push(next.sourceLine);
  const gap =
    !statesOnlyAYear(row) && !statesOnlyAYear(next) && isValidIsoDate(row.maturityDate!) && isValidIsoDate(next.maturityDate!)
      ? Math.abs(monthsBetween(next.maturityDate!, new Date(row.maturityDate!)))
      : null;
  const computed = gap === null ? null : `${gap} months`;
  const tail =
    gap === null
      ? ` The gap is not computed: at least one of the two states only a year.`
      : ` ${computed} behind this one.`;
  return {
    kind: "next-tranche", label, inputs, fieldInputs: [], computed,
    text: `${next.instrument}, maturing ${next.maturityDate}.${tail}`,
  };
}

// ============================================================================
// 4. LIQUIDITY BESIDE THE MATURITY — the verified revolver fields
// ============================================================================

/**
 * TWO FIGURES SIDE BY SIDE, AND NO RATIO BETWEEN THEM.
 *
 * This line first rendered the capacity as a percentage of the maturity —
 * "$1.900 billion of undrawn revolver capacity, 127% of this maturity" — and
 * that is wrong twice over. It implies COVERAGE, which is a judgement this
 * tool does not make; and it divides non-substitutes, because a revolver is
 * liquidity and is not how a term maturity gets refinanced. A ratio between
 * two things that do not substitute for each other reads as an answer to a
 * question nobody asked.
 *
 * So the line places them beside each other and stops: what is maturing, and
 * what undrawn capacity the filing states, with the as-of date that capacity
 * belongs to. The reader draws the conclusion, which is the reader's job.
 *
 * This is the one derived line that computes nothing by design. It is still
 * a derived line — it assembles two verified figures from two different
 * disclosures onto one row — and the guard still holds every figure in it to
 * a source sentence, which is what withholds it for the one filer whose
 * stated availability appears in no sentence it cites.
 */

function liquidity(row: LadderRow, debtMaturity: TriggerResult | undefined): DerivedLine {
  const label = "Liquidity beside it";
  const rev = debtMaturity?.revolver ?? null;

  if (!rev) {
    return { kind: "liquidity", label, inputs: [], fieldInputs: [], computed: null,
      text: `The anchor filing states no revolving facility, so no liquidity figure sits beside this maturity.` };
  }
  // ONLY the revolver's own sentence. Deliberately not `rev.available` as a
  // value: a field checking itself proves nothing, and this is the check
  // that caught one filer whose stated availability appears nowhere in the
  // sentence it cites — the same figure its own revolver arithmetic already
  // reports as not reconciling.
  // The revolver's own sentence, and the ROW's own sentence for the maturing
  // amount. `row.amount` is declared alongside it because it is verified
  // against that same sourceLine by the amount guard upstream (the one that
  // drops a figure "not printed on or beside its row") — the same standing
  // as the issuance eventDate in the refinancing line: a fact another guard
  // established, not a field validating itself. Without it a display form
  // like "$ 1,500 million" could never match its filing's own bare cell
  // "1,500" under the strict same-representation rule, and the line the user
  // asked for could not render at all.
  const inputs = [rev.sourceLine];
  // Parsed only to establish that the stated availability is a readable
  // figure at all — no arithmetic is done with it.
  const available = rev.available ? parseMoneyAmount(rev.available) : null;
  if (rev.available === null || available === null) {
    return { kind: "liquidity", label, inputs, fieldInputs: [], computed: null,
      text: `The anchor filing states a revolving facility${rev.facilitySize ? ` of ${rev.facilitySize}` : ""} but no available figure${rev.drawn ? `, with ${rev.drawn} drawn` : ""}, so no coverage is computed.` };
  }

  const drawnClause = rev.drawn ? `, with ${rev.drawn} drawn` : "";
  const asOfClause = rev.asOfDate ?? "the anchor";
  return {
    kind: "liquidity", label,
    inputs: [...inputs, row.sourceLine],
    fieldInputs: [{ value: row.amount, verifiedBy: "the amount guard, against this row's own sourceLine — the one that drops a figure not printed on or beside its row" }],
    // Nothing is computed. See this section's header: the two figures are
    // placed side by side and no ratio is drawn between them.
    computed: null,
    text: `${row.amount} maturing; ${rev.available} of undrawn revolver capacity as of ${asOfClause}${drawnClause}. Two separate disclosures, stated side by side — a revolver is liquidity, not how a term maturity is refinanced.`,
  };
}

// ============================================================================
// THE GUARD — Rule 6 applied to arithmetic
// ============================================================================

/**
 * Every money, percent and date figure a derived line states must either
 * trace to one of its own declared `inputs` at the SAME scale, or BE the one
 * value the line declared it computed. Nothing else renders.
 *
 * This is the deterministic half of the rule the number guard enforces on
 * Sonnet's prose. It is not redundant with it: these lines never pass through
 * narration, so the card's own audit never sees them, and an unaudited line
 * on an audited card is the worst of both.
 */
export function derivedLinePasses(line: DerivedLine): { ok: boolean; unverified: string[] } {
  if (line.inputs.length === 0 && line.fieldInputs.length === 0 && line.computed !== null) {
    return { ok: false, unverified: ["<computed a value with no verified input behind it>"] };
  }
  // BOTH kinds of input. A field value is trusted exactly as a source
  // sentence is — the difference is only that one can be located in a
  // document and the other cannot, which matters to the sheet, not here.
  const inputTokens = extractFactTokens([...line.inputs, ...line.fieldInputs.map((f) => f.value)].join(" ; "));
  const computedTokens = line.computed ? extractFactTokens(line.computed) : [];
  const unverified = extractFactTokens(line.text)
    .filter((t) => !inputTokens.some((i) => strictFactTokensMatch(t, i)))
    .filter((t) => !computedTokens.some((c) => strictFactTokensMatch(t, c)))
    .map((t) => t.raw);
  return { ok: unverified.length === 0, unverified };
}

// ============================================================================

export interface DerivedBlock {
  lines: DerivedLine[];
  /** Lines the guard rejected, with what failed — reported, never silently dropped. */
  withheld: { kind: DerivedKind; unverified: string[] }[];
}

/**
 * `asOf` is REQUIRED and has no default — see the module header. Callers pin
 * one clock per run and pass it.
 */
export function buildDerivedLines(params: {
  card: FlashCard;
  position: CompanyPosition;
  debtMaturity: TriggerResult | undefined;
  newDebtIssuance: TriggerResult | undefined;
  asOf: Date;
}): DerivedBlock {
  const { card, position, debtMaturity, newDebtIssuance, asOf } = params;
  const candidates: DerivedLine[] = [];

  // The refinancing pattern is about the COMPANY, so it renders on any card.
  candidates.push(refiPattern(card, position, newDebtIssuance, asOf));

  // The other three are about one tranche, so they need the card to be about
  // one. A card with no headline ladder row gets the pattern line alone —
  // scoped by what the line needs, never by which trigger it happens to be.
  const row = card.headlineRowId ? position.rows.find((r) => r.id === card.headlineRowId) : undefined;
  if (row) {
    candidates.unshift(monthsToMaturity(row, asOf));
    candidates.push(nextTranche(row, position, asOf));
    candidates.push(liquidity(row, debtMaturity));
  }

  const lines: DerivedLine[] = [];
  const withheld: DerivedBlock["withheld"] = [];
  for (const line of candidates) {
    const check = derivedLinePasses(line);
    if (check.ok) lines.push(line);
    else withheld.push({ kind: line.kind, unverified: check.unverified });
  }
  return { lines, withheld };
}
