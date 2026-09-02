import type { CompanyResult, TriggerResult, VerifiedBalanceSheetCaption, VerifiedIssuedTranche, VerifiedSequenceEntry, VerifiedNoteRetirement, ProseInstrumentRow, RevolverRow } from "../agent";
import { dedupAgainstRows, debtContribution } from "./instrument";
import { buildTier2, isPostAnchorSource, type Tier2 } from "./tier2";
import type { DateGranularity, DebtScheduleFilingRef } from "../agent/claude";
import { extractFactTokens, factTokensMatch, type FactToken } from "../agent/factTokens";
import { isStatedZeroAmount } from "../agent/moneyScale";

/**
 * Session 18 Part B — the deterministic position layer. Until now no
 * component held "here is this company's debt as of today": the
 * one-fact-per-trigger extraction schema forced `debt-maturity` to pick a
 * single tranche, the table condenser reconstructed a fake ladder from a
 * run-on evidence sentence and appended "+N more tranches," and the gate
 * guessed a refi fact and a new-debt fact were the same event because they
 * shared a citation. This file replaces all three. Pure code, no model
 * calls — reads only the already-verified `scheduleSequence`/
 * `priorScheduleSequence`/`redeems`/`issuedTranches` fields on
 * `TriggerResult` (lib/agent/loop.ts), so rebuilding a position from cached
 * answers costs nothing.
 *
 * Redesigned post-v9: three rounds of label-matching (category,
 * feedsIntoTotal, a proposed numeric fallback) all tried to answer "which
 * total does this line belong to," a question the filing itself never
 * poses. Hand-verification of both pilot companies established the real
 * model — a debt note is a RUNNING TOTAL. See computeWalkChecksum (Check 1)
 * and computeBalanceSheetCheck (Check 2) below.
 */

interface DebtRowLike {
  rate: string | null;
  maturityDate: string | null;
  dateGranularity: DateGranularity | null;
}

export interface LadderRow {
  instrument: string;
  rate: string | null;
  seniority: string | null;
  amount: string;
  maturityDate: string | null;
  dateGranularity: DateGranularity | null;
  sourceLine: string;
  citedUrl: string;
  /** Deterministic, content-derived identity (instrument+rate+maturity — never amount, same rule as matching elsewhere in this file) — NOT a random id, since determinism across identical runs matters throughout this pipeline. Lets a company's several debt-maturity cards (one per qualifying tranche, buildEvents.ts) each point at the specific row they're about. */
  id: string;
  /**
   * "live"        — on the newest filing's ladder, not yet due.
   * "retired"     — redeemed by a later issuance named in an 8-K.
   * "unconfirmed" — on the prior filing, gone from the current one, nothing explaining it.
   * "repaid"      — C1: the filing itself states a nil balance for this tranche.
   * "matured"     — D3: the maturity date the filing states has already passed.
   *
   * Only "live" ever cards. All five RENDER — a repaid tranche and a matured
   * one are both facts an RM wants, and neither is the same thing as a row
   * that quietly vanished.
   */
  status: "live" | "retired" | "unconfirmed" | "repaid" | "matured";
  /** Set when status is "retired", or when a "matured" row's retirement IS explained by a redemption in the corpus — the text that explains it, and where it came from. */
  retiredBy?: { evidence: string; citedUrl: string };
  /**
   * Set when a pricing 8-K in the corpus prices THIS tranche. The 8-K never
   * replaces the note's row and never overwrites its outstanding amount — it
   * contributes only the date the tranche was priced. Present on a note row
   * that an 8-K also names, and on a post-period issuance that has no note
   * row of its own.
   */
  issuedOn?: { date: string; citedUrl: string };
  /**
   * E13 (Session 18, post-stage-2) — this tranche's balance in the PRIOR
   * period, where the corpus carries one, and where the prior filing came
   * from.
   *
   * A ladder is otherwise a static list: it says a tranche exists and what it
   * is worth today, and says nothing about whether that number moved. The
   * movement is the fact an RM reads — a balance falling is deleveraging or a
   * repurchase, a balance rising is a draw — and it is already extracted, in
   * the prior filing's own current column.
   *
   * Recorded, never interpreted: no inference about WHY it moved, and no
   * prose parsed to find out. Absent for the three companies whose prior
   * sequence is empty (no prior filing with a schedule, or every prior entry
   * column-dropped).
   */
  priorBalance?: { amount: string; filing: DebtScheduleFilingRef | null };
  /**
   * Session 19, item 2b — the debt note's OWN prose explaining why this
   * row's balance moved, when it names this tranche unambiguously. Never
   * changes the amount: the note's table is already net of what its prose
   * describes. Distinct from retiredBy, which means the row is gone.
   */
  retiredByNote?: { evidence: string; citedUrl: string };
  /**
   * Item 8 (stage-2 review) — WHICH SOURCE THIS ROW CAME FROM.
   *
   * The block's header describes the debt NOTE: how many rows it had,
   * whether they walk, whether they anchor. Rows appended from a pricing
   * 8-K are not in that scope and never were, and until now nothing said
   * so. On a company whose note could not be read at all, the header said
   * "none could be trusted" and two rows rendered directly beneath it with
   * no visible distinction — a block contradicting itself in its first two
   * lines.
   *
   * The rows are legitimate. What was missing is that they answer a
   * different question than the header does.
   */
  /**
   * SESSION 21 — "note-narrative" joins the two that were here.
   *
   * A note may state an instrument in a table, in a bullet, or in a
   * sentence. All three are the same kind of fact, and the position must
   * carry all three or a prose-only filer has no position at all — which is
   * exactly the state UHS was in: nine instruments, 98% coverage, and
   * NOTHING in `rows`, so no ladder line to render and no instrument to
   * build a card from.
   */
  provenance: "note" | "pricing-8-K" | "note-narrative";
  /**
   * Committed but undrawn. Renders on the ladder — headroom is a fact an RM
   * wants — and never cards, because there is no maturity conversation to
   * have about money nobody has borrowed.
   */
  isCapacity?: boolean;
}

export interface CompanyPosition {
  /** Sorted by maturity date. Built from the base filing's scheduleSequence "row" entries, adjusted for redemptions/new issuance/unconfirmed drops. */
  rows: LadderRow[];
  /**
   * Item 6 (stage-2 review) — tranches priced by an 8-K that CANNOT be added
   * to this ladder because the note reports category totals, and a new
   * issuance is inside one of those categories by construction. Empty for
   * every itemized filer. Never dropped — the render states them beneath the
   * ladder, as what they are.
   */
  issuancesInsideAggregate: LadderRow[];
  /**
   * SESSION 21, STAGE 3 — events since the anchor, kept OUT of `rows`.
   *
   * `rows` is the anchor position and nothing else, because that is the only
   * thing the coverage percentage can be checked against. A tranche priced
   * three weeks after the anchor is real and is not part of a June 30
   * balance sheet, and blending the two produced a position true at no date
   * at all.
   */
  tier2: Tier2;
  /**
   * SESSION 21 — retirements the filer STATED AN INTENTION about, verified
   * but not completed. They are not Tier 2 unless their filing post-dates
   * the anchor, because an intention announced BEFORE the anchor's period
   * end is already resolved one way or the other inside the anchor's own
   * balance sheet — rendering it as an event "since" the anchor would state
   * the wrong date about a real fact.
   *
   * They still render: for a filer with no ladder rows at all, a stated
   * intention is the only instrument-level signal there is.
   */
  statedIntentions: { instrument: string; amount: string | null; date: string | null; sourceLine: string; citedUrl: string; postAnchor: boolean }[];
  /** The base filing's "adjustment" entries (discount/issuance costs, current portion, etc.) — for display; see portfolioTable.ts. Not summed here; Check 1 (computeWalkChecksum) does that from the raw TriggerResult directly. */
  adjustments: VerifiedSequenceEntry[];
  /** The LAST "subtotal" entry in the base filing's sequence — the natural "headline total" for display. Null if the sequence has no subtotals at all. */
  finalSubtotal: VerifiedSequenceEntry | null;
  /** Session 18 (post-v6) — which filing scheduleSequence was transcribed from, so the render layer can state which filing the ladder came from rather than leave it implicit. Null when no filing had a locatable schedule. */
  baseFiling: DebtScheduleFilingRef | null;
  /**
   * Session 18 (post-v16): `priorSequence` and `priorFiling` were REMOVED
   * with the render path that consumed them (RefiLadderBlock's
   * priorPeriodContext). They existed to show an older filing's schedule as
   * labelled context beside a base ladder that failed both checks; the
   * locator search-order rule supersedes that by advancing the BASE filing
   * to the first one that actually yields a schedule, and recording its own
   * form and date.
   *
   * The trigger's `priorScheduleSequence` is deliberately NOT removed: the
   * `unconfirmed` pass below still diffs against it to find a tranche that
   * dropped off with no redemption explaining it. This was a render-layer
   * deletion, never a data-layer one.
   */

  /**
   * True when the base ladder failed BOTH checks, which is what suppresses
   * the `unconfirmed` pass (see assemblePosition). Exposed rather than left
   * implicit so the reason no row is marked unconfirmed is inspectable, not
   * something a reader has to infer from an absence.
   */
  baseLadderUntrustworthy: boolean;
  /**
   * A3 (Session 18, post-stage-2) — the walk misses by so much that the rows
   * cannot be presented as the position, even though the note itself is real
   * and its subtotals may well be right.
   *
   * CHS is the measured case: Check 1 is off by $6.07B against a stated total
   * of $9.578B, and its rows rendered normally beside the failure notice —
   * three of the five fabricated. Check 2 TIED throughout, because the
   * balance-sheet captions and the subtotals were both transcribed correctly
   * while everything between them was not; so `baseLadderUntrustworthy`
   * (which needs BOTH checks to fail) never fired.
   *
   * This suppresses the CLAIM, never the fact: the bucket still states that a
   * debt note exists, which filing it is in, what total it states and how far
   * the transcription misses by. What it stops is the individual rows being
   * read as the company's tranches.
   */
  rowsNotVerifiedAsTranscribed: boolean;
  /** The worst Check-1 gap as a fraction of the largest subtotal claimed, or null when there is nothing to compare. Reported whether or not it crosses the threshold — never only on failure. */
  walkGapFraction: number | null;
}

/**
 * The threshold A3 turns on. Deliberately a FRACTION of the ladder's own
 * stated total rather than an absolute figure: the same $500M gap is noise on
 * a $45B ladder and a missing tranche on a $3B one, and this rule has to hold
 * across companies two orders of magnitude apart.
 *
 * Set well above the checksum's own tolerance (which is absolute and sized
 * below the smallest row, see CHECKSUM_ABSOLUTE_FLOOR) so that "does not tie"
 * and "cannot be shown as the position" stay two different statements. A
 * ladder that misses by a rounding artefact still renders its rows and still
 * says it does not tie; only a ladder missing a material share of itself
 * stops claiming its rows are the position.
 */
export const CHECK1_MATERIAL_GAP_FRACTION = 0.05;

export function walkGapFractionOf(walk: WalkChecksumResult): number | null {
  const failing = walk.subtotalChecks.filter((c) => !c.tie);
  if (failing.length === 0) return null;
  // Scale against the LARGEST claimed subtotal — the ladder's own stated
  // total — not against the failing subtotal, so a small section subtotal
  // missing entirely can't read as a large fraction of itself.
  const statedTotal = Math.max(...walk.subtotalChecks.map((c) => Math.abs(c.claimedAmount)));
  if (!Number.isFinite(statedTotal) || statedTotal === 0) return null;
  return Math.max(...failing.map((c) => Math.abs(c.gap))) / statedTotal;
}

function ladderRowId(row: DebtRowLike & { instrument: string }): string {
  return `${row.instrument}::${row.rate ?? "?"}::${row.maturityDate ?? "no-maturity-stated"}`;
}

/**
 * Does a row identify ONE instrument? A named instrument carries both its
 * own rate and its own maturity. A category rollup carries at most one of
 * them — and often a rate, because a rollup states its WEIGHTED-AVERAGE
 * rate, which is why a rate alone cannot be the test.
 *
 * Moved here from portfolioTable.ts (item 5, stage-2 review) because it now
 * decides ROW MEMBERSHIP, not only a label: an 8-K tranche cannot be added
 * to a ladder that reports category totals without double-counting it
 * inside one. Two callers, one definition.
 */
export function rowIdentifiesOneTranche(r: { rate: string | null; maturityDate: string | null }): boolean {
  return r.rate !== null && r.rate.trim() !== "" && r.maturityDate !== null;
}

/**
 * True when the base note reports CATEGORY TOTALS rather than individual
 * tranches. "Most rows" separates the one genuinely aggregate filer in this
 * book from the rest with real margin (25% against a next-lowest 57%) and
 * needs no tuned constant.
 */
export function scheduleIsAggregateDisclosure(scheduleSequence: VerifiedSequenceEntry[] | null | undefined): boolean {
  // Normalizes internally rather than trusting callers to have done it.
  // Both callers currently pass a normalized sequence; "currently" is not a
  // property, and a mistyped subtotal counted as a row skews the very ratio
  // this function exists to compute. Idempotent, so it costs nothing.
  const rows = normalizeScheduleSequence(scheduleSequence).filter((e) => e.kind === "row");
  if (rows.length === 0) return false;
  return rows.filter(rowIdentifiesOneTranche).length * 2 <= rows.length;
}

/**
 * Item 3 (stage-2 review) — WHEN A BALANCE MOVEMENT IS A PRINCIPAL CHANGE.
 *
 * A ladder's amount column is not one measure across filers, and the
 * difference decides what a movement between periods MEANS. Read out of the
 * three live notes where it matters:
 *
 *   One filer's rows moved 2,211 -> 1,067 on a note whose own label says
 *   "$2,500 million 4.25% Senior Notes", and its prose two paragraphs below
 *   the table says it "repurchased $118 million ... of its par value Senior
 *   Notes". Those rows are PRINCIPAL, and the movement is real.
 *
 *   Another filer's 4.75% notes moved 787.7 -> 788.4 in a quarter. That is
 *   $700K on an untouched fixed-rate note, and the very next table in that
 *   same filing prints its two measures side by side under the headings
 *   "Face Amount" and "Net Amount" — 788.4 is the Net one. That movement is
 *   discount accretion, and rendering it as a change invites a call about
 *   something that did not happen.
 *
 * CLASSIFYING THE MEASURE ITSELF WAS TRIED AND ABANDONED, deliberately. The
 * structural candidate — an adjustment for unamortized discount sitting
 * between the rows and the subtotal they walk into — is right for six of the
 * ten and wrong for at least one: that filer prints its PRINCIPAL total
 * first and deducts the discount after it, so the discount adjustment sits
 * downstream of the subtotal the rows sum into and the test reads its
 * par rows as carrying value. Separating a discount deduction from a
 * current-portion reclassification needs the labels' meaning, and a
 * vocabulary guard is the one thing this codebase does not do. A measure
 * label that is wrong on a tenth of the book is worse on screen than no
 * label, so there is none — the walk (portfolioTable.ts) renders the
 * adjustments instead, which shows the same thing without asserting it.
 *
 * What IS decidable is the MOVEMENT, on its own relative size. Measured
 * across every moving row in the book:
 *
 *   accretion-shaped   0.076%, 0.089%, 0.2%   of the prior balance
 *   principal-shaped   6.1%, 10.0%
 *
 * A 30x gap with nothing in it. The threshold below sits in the middle of
 * that gap and is not tuned to either end.
 */
export const MATERIAL_MOVEMENT_FRACTION = 0.01;

export type MovementKind = "unchanged" | "material" | "immaterial";

export function movementKindOf(nowValue: number, priorValue: number): MovementKind {
  if (nowValue === priorValue) return "unchanged";
  if (priorValue === 0) return "material";
  return Math.abs(nowValue - priorValue) / Math.abs(priorValue) >= MATERIAL_MOVEMENT_FRACTION ? "material" : "immaterial";
}

function ladderRowFromSequenceEntry(entry: VerifiedSequenceEntry, status: LadderRow["status"]): LadderRow {
  const instrument = entry.label ?? "(unlabeled)";
  return {
    instrument,
    rate: entry.rate,
    seniority: entry.seniority,
    amount: entry.amount,
    maturityDate: entry.maturityDate,
    dateGranularity: entry.dateGranularity,
    sourceLine: entry.sourceLine,
    citedUrl: entry.citedUrl,
    id: ladderRowId({ instrument, rate: entry.rate, maturityDate: entry.maturityDate, dateGranularity: entry.dateGranularity }),
    status,
    provenance: "note",
  };
}

/**
 * SESSION 21, ITEM 1A — AN INSTRUMENT IS AN INSTRUMENT, WHATEVER FIELD IT
 * ARRIVED IN.
 *
 * `debtContribution` decides what this instrument owes — the same function
 * the coverage figure is built from — so a ladder line and the total above
 * it cannot disagree about a revolver's drawn balance again.
 */
function ladderRowFromProseInstrument(
  p: ProseInstrumentRow & { citedUrl?: string },
  revolver: RevolverRow | null | undefined,
  status: LadderRow["status"]
): LadderRow {
  const c = debtContribution(p, revolver);
  const instrument = p.name ?? p.category;
  // A revolver's line leads with what is DRAWN, naming the facility it is
  // drawn under rather than in place of it.
  const stated = p.amount ? parseMoneyAmount(p.amount) : null;
  const showsDrawn = c.amount !== null && c.amount > 0 && stated !== null && stated !== c.amount;
  const amount = showsDrawn
    ? `${formatPlainMoney(c.amount as number)} drawn under ${p.amount}`
    : (p.amount ?? "(no amount stated)");
  return {
    instrument,
    rate: p.rate,
    seniority: null,
    amount,
    maturityDate: p.maturityDate,
    dateGranularity: p.dateGranularity,
    sourceLine: p.sourceLine,
    citedUrl: p.citedUrl ?? "",
    id: ladderRowId({ instrument, rate: p.rate, maturityDate: p.maturityDate, dateGranularity: p.dateGranularity }),
    status,
    provenance: "note-narrative",
    isCapacity: c.capacity,
  };
}

/** Whole-unit money for a derived figure the filing did not print in that form. */
function formatPlainMoney(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(3).replace(/\.?0+$/, "")} billion` : `$${Math.round(n / 1e6)} million`;
}

function ladderRowFromIssuedTranche(row: VerifiedIssuedTranche, status: LadderRow["status"]): LadderRow {
  return { ...row, id: ladderRowId(row), status, provenance: "pricing-8-K" };
}

/**
 * A row's maturity as a FactToken, for token-based comparison — bare-year
 * rows carry no month/day, matching factTokensMatch's existing
 * partial-precision date rules (a year-only claim matches a full date in
 * the same year). Null when the row states no maturity at all (a real,
 * expected case — e.g. HCA's "Other debt" line has a rate but no stated
 * maturity year; a fabricated one is nulled upstream in loop.ts's
 * verifySequenceEntries before this ever runs) — a row with no maturity
 * can never match a redemption or a prior-period tranche by identity, which
 * is correct: there's nothing to confirm the match against.
 */
function debtRowDateToken(row: DebtRowLike): FactToken | null {
  if (!row.maturityDate) return null;
  if (row.dateGranularity === "year") {
    const year = Number.parseInt(row.maturityDate, 10);
    if (Number.isNaN(year)) return null;
    return { kind: "date", raw: row.maturityDate, index: 0, dateValue: { year, month: null, day: null } };
  }
  const m = row.maturityDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    kind: "date",
    raw: row.maturityDate,
    index: 0,
    dateValue: { year: Number(m[1]), month: Number(m[2]), day: row.dateGranularity === "day" ? Number(m[3]) : null },
  };
}

/** A row's own rate as a FactToken, or null when the filing stated none. */
function debtRowRateToken(row: DebtRowLike): FactToken | null {
  if (!row.rate) return null;
  return extractFactTokens(row.rate).find((t) => t.kind === "percent") ?? null;
}

/**
 * "Match on instrument description + rate + maturity together, never on
 * amount alone" (the prompt's own explicit rule — Tenet's two same-size
 * $1.5B 2027 tranches, distinguished only by lien, is what amount-only
 * matching would wrongly conflate). Amount is never read by either matching
 * function in this file. Maturity is the required signal (every row has
 * one); rate corroborates whenever the row states one. Known, accepted
 * simplification: a `redeems` description naming two DIFFERENT tranches in
 * one sentence could in principle cross-match a row whose rate appears
 * near a different row's maturity in the same text — not observed in any
 * real case this session, and every real worked example describes exactly
 * one retired tranche per issuance.
 */
function rowMatchesRedemptionText(row: DebtRowLike, redeemsText: string): boolean {
  const descTokens = extractFactTokens(redeemsText);
  const maturityToken = debtRowDateToken(row);
  if (!maturityToken) return false; // can't confirm a match without a comparable maturity — never guess
  if (!descTokens.some((dt) => dt.kind === "date" && factTokensMatch(maturityToken, dt))) return false;
  const rateToken = debtRowRateToken(row);
  if (rateToken && !descTokens.some((dt) => dt.kind === "percent" && factTokensMatch(rateToken, dt))) return false;
  return true;
}

/**
 * Session 18 (post-v16) — A PARTIAL REDEMPTION DOES NOT RETIRE A TRANCHE.
 *
 * Found live on Tenet. Its 8-K redeems TWO different tranches in one
 * sentence, one fully and one partly:
 *
 *   "...redemption of all $1.5 billion aggregate principal amount
 *    outstanding of its 6.250% senior secured second lien notes due February
 *    2027 AND THE PARTIAL REDEMPTION OF $0.75 BILLION outstanding of its
 *    6.125% senior notes due October 2028"
 *
 * rowMatchesRedemptionText matched the 6.125%/2028 row on rate+maturity and
 * marked it `retired` — but only $0.75B of that $1.75B tranche was called.
 * A retired row leaves the live ladder and can never card, so Tenet silently
 * lost a ~$1.0B still-outstanding tranche. Meanwhile the tranche actually
 * redeemed in full (6.250% due February 2027) matched nothing, because the
 * current filing had already dropped it.
 *
 * The fix scopes the question to the CLAUSE that names this row's own
 * tranche, rather than asking it of the whole sentence — the whole sentence
 * contains both a full and a partial redemption, so any sentence-level test
 * is answering about the wrong tranche half the time. Splitting on "and the"
 * / ";" / " and " is what separates the two real clauses above.
 *
 * "partial"/"portion"/"in part" is a small CLOSED set describing quantity,
 * not company or instrument vocabulary — the same kind of closed list as
 * moneyScale.ts's SCALE_WORDS. When the clause says a redemption is partial,
 * the row stays LIVE and keeps the filing's own amount: the base ladder comes
 * from the newest 10-Q, which already reflects whatever was actually called,
 * so the filing is authoritative and nothing needs adjusting here.
 *
 * A row whose clause cannot be isolated falls back to NOT retiring. That is
 * deliberate asymmetry: wrongly retiring a live tranche removes real debt
 * from the ladder and from the gate, while wrongly keeping one shows a row
 * the filing itself still lists. The first is a silent loss, the second is
 * visible and self-correcting at the next filing.
 */
const PARTIAL_REDEMPTION_RE = /\b(?:partial(?:ly)?|portion|in part)\b/i;

function redemptionClauseFor(row: DebtRowLike, redeemsText: string): string | null {
  const clauses = redeemsText.split(/\s+and\s+the\s+|\s*;\s*|\s+and\s+/i).filter((c) => c.trim().length > 0);
  const maturityToken = debtRowDateToken(row);
  if (!maturityToken) return null;
  const rateToken = debtRowRateToken(row);
  for (const clause of clauses) {
    const tokens = extractFactTokens(clause);
    if (!tokens.some((t) => t.kind === "date" && factTokensMatch(maturityToken, t))) continue;
    if (rateToken && !tokens.some((t) => t.kind === "percent" && factTokensMatch(rateToken, t))) continue;
    return clause;
  }
  return null;
}

/** True when this row's own redemption clause describes a FULL call — the only case that retires a tranche. */
export function redemptionRetiresRow(row: DebtRowLike, redeemsText: string): boolean {
  if (!rowMatchesRedemptionText(row, redeemsText)) return false;
  const clause = redemptionClauseFor(row, redeemsText);
  if (!clause) return false; // matched the sentence but not an isolable clause — never retire on ambiguity
  return !PARTIAL_REDEMPTION_RE.test(clause);
}

/** Same instrument+rate+maturity rule, row-to-row (both sides already structured, so no text-token extraction needed for maturity — direct FactToken comparison). Used by the `unconfirmed` pass to tell "this prior-period row still exists under the current ladder" from "it's genuinely gone." */
function rowsRepresentSameTranche(a: DebtRowLike, b: DebtRowLike): boolean {
  const aDate = debtRowDateToken(a);
  const bDate = debtRowDateToken(b);
  if (!aDate || !bDate || !factTokensMatch(aDate, bDate)) return false;
  const aRate = debtRowRateToken(a);
  const bRate = debtRowRateToken(b);
  if (aRate && bRate) return factTokensMatch(aRate, bRate);
  return true; // maturity alone matched, and at least one side has no rate to check further — still the best available signal, never amount
}

/** No stated maturity (real for an aggregate line) sorts to the end — there's nothing to order it by, and the far end of the ladder is where "no known timing" belongs, never surfaced as if it were a real date. */
/**
 * D3. True when the maturity this row states is already in the past. A
 * bare-year maturity is only past once the WHOLE year is — 2026 is not
 * matured in August 2026, because the filing never said which month.
 */
function maturityHasPassed(row: DebtRowLike, now: Date): boolean {
  if (!row.maturityDate) return false;
  const raw = row.maturityDate.trim();
  const iso = row.dateGranularity === "year" || /^\d{4}$/.test(raw) ? `${raw.slice(0, 4)}-12-31` : raw;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t < now.getTime();
}

function maturitySortKey(row: DebtRowLike): number {
  if (!row.maturityDate) return Number.POSITIVE_INFINITY;
  if (row.dateGranularity === "year") {
    const year = Number.parseInt(row.maturityDate, 10);
    // Year-only rows sort as if at year-end — same Dec-31 "safe for ordering, never for display" convention lib/events/eventTiming.ts already uses; never surfaced to a user as a real date.
    return Number.isNaN(year) ? Number.POSITIVE_INFINITY : Date.UTC(year, 11, 31);
  }
  const t = Date.parse(row.maturityDate);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Assembles one company's current debt ladder from its already-verified
 * extraction fields. Algorithm (Part B):
 *   1. Base ladder = every "row"-kind entry in debt-maturity's
 *      `scheduleSequence` (already sourced from the base filing per the
 *      extraction prompt) — every one of these rows is `live` BY
 *      DEFINITION, since the most current filing itself lists it. There is
 *      nothing to "confirm."
 *   2. If new-debt-issuance fired and has `redeems` populated: retire the
 *      base-ladder row it describes (matched on rate+maturity, never
 *      amount), then append `issuedTranches` as new `live` rows.
 *   3. Unconfirmed pass: any "row"-kind entry present in
 *      `priorScheduleSequence` (the next-most-recent periodic filing) that
 *      does NOT match any row produced by steps 1-2 has silently
 *      disappeared between filings with no redemption explaining it — added
 *      back with status `unconfirmed`. This is the ONLY place a row is
 *      added rather than carried forward.
 *   4. Sort by maturity date.
 *
 * Documented simplification: extraction currently returns ONE
 * new-debt-issuance verdict per company (not one per 8-K in the corpus), so
 * step 2 applies at most one issuance's delta — the same pre-existing limit
 * new-debt-issuance already has today, out of this session's scope to lift.
 */
/**
 * SESSION 19, ITEM 2b — A RETIREMENT THE NOTE STATES IN ITS OWN PROSE.
 *
 * The authority rule, extended as written: an 8-K wins only when it
 * post-dates the note's period of report, because it describes an action the
 * note could not yet know about. Prose INSIDE the note is different — it is
 * the note speaking about itself, and it is authoritative for that note's
 * own period without any date comparison at all.
 *
 * A CORRECTION TO WHAT THIS WAS ASKED TO DO, stated rather than silently
 * applied either way. The instruction was "a partial reduces the balance and
 * the row stays live". Applied literally that DOUBLE-COUNTS, and the reason
 * is the same rule that motivated the field: the note's table is as-of the
 * period end, so it ALREADY reflects every repurchase the note's prose
 * describes. Centene's table prints $1,067 million for the 2027 notes; the
 * prose two paragraphs below says $118 million was repurchased in the
 * quarter; $1,067 is the figure AFTER that repurchase. Subtracting again
 * would report $949 million, a number in no filing.
 *
 * So a note-prose retirement never changes a balance. It supplies the CAUSE
 * of a movement the ladder already shows — which is exactly the gap this
 * field was added to close, since the ladder could previously show a balance
 * falling with nothing saying why. The three outcomes the instruction asks
 * to see are all still distinguishable, they are just reached without
 * arithmetic:
 *
 *   FULL      the note carries the tranche at nil, or no longer carries it
 *             at all. The row is retired (C1 already does the nil case) and
 *             the prose is attached as what explains it, instead of the row
 *             reading "dropped with no redemption explaining it".
 *   PARTIAL   the note still carries a balance. The row stays LIVE at the
 *             note's own figure, with the retirement attached as the reason
 *             it moved.
 *   AMBIGUOUS the prose names an instrument that cannot be matched to one
 *             ladder row — no rate, no maturity, or several rows equally
 *             consistent. Nothing is attached and nothing is changed. Fails
 *             safe toward KEEPING, per BRD 6.0.
 */
function applyNoteRetirements(rows: LadderRow[], retirements: VerifiedNoteRetirement[]): LadderRow[] {
  if (retirements.length === 0) return rows;
  return rows.map((row) => {
    // Match on the retirement's own text against the row, using the SAME
    // identity rule redemptions use — never on amount, which is expected to
    // differ here (the prose states what was retired, the row states what
    // remains).
    const matches = retirements.filter((r) => rowMatchesRedemptionText(row, `${r.instrument} ${r.sourceLine}`));
    // AMBIGUOUS: not exactly one. Attach nothing, change nothing.
    if (matches.length !== 1) return row;
    const retirement = matches[0];
    const explains = { evidence: retirement.sourceLine, citedUrl: retirement.citedUrl };
    // FULL: the note itself already carries this at nil, so C1 has marked it
    // repaid. The prose turns "repaid, cause unknown" into "repaid, and here
    // is the sentence that says so".
    if (row.status === "repaid" || row.status === "retired") return { ...row, retiredBy: row.retiredBy ?? explains };
    // PARTIAL: live, at the note's own post-repurchase figure, with the cause.
    return { ...row, retiredBy: undefined, retiredByNote: explains };
  });
}

export function assemblePosition(result: CompanyResult, now: Date = new Date()): CompanyPosition {
  const debtMaturity = result.results.find((r) => r.triggerId === "debt-maturity");
  const newDebtIssuance = result.results.find((r) => r.triggerId === "new-debt-issuance");

  // Defensive `?? []` on every Session 18 field read here: TriggerResult's
  // TYPE declares these always-present, but real-world data predating this
  // session (a cached fixture JSON, an old live cache entry) can genuinely
  // lack them — plain JSON.parse has no way to apply loop.ts's own
  // withFieldDefaults. Never crash on legacy-shaped input; treat a missing
  // field exactly like an empty/null one.
  const baseSequence = normalizeScheduleSequence(debtMaturity?.scheduleSequence);
  const baseRowEntries = baseSequence.filter((e) => e.kind === "row");
  let rows: LadderRow[] = baseRowEntries.map((entry) => ladderRowFromSequenceEntry(entry, "live"));

  // SESSION 21, ITEM 1A — the note's narrative half joins the position.
  //
  // Deduped against the table rows by the SAME function coverage uses, so
  // the ladder and the coverage figure count one set. A prose entry that
  // duplicates a table row is one instrument; three notes that are each
  // $500 million with different maturities stay three (Rule 19).
  const proseKept = dedupAgainstRows(debtMaturity?.proseInstruments ?? [], baseRowEntries).kept;
  rows = rows.concat(
    proseKept.map((p) => ladderRowFromProseInstrument(p as ProseInstrumentRow & { citedUrl?: string }, debtMaturity?.revolver, "live"))
  );

  // SESSION 21, ITEM 1D — ONLY A VERIFIED, COMPLETED RETIREMENT RETIRES.
  //
  // Three conditions, and each one was a real defect before it was a
  // condition:
  //
  //   verifiedRedemption   the claim's own sourceLine was found in a cited
  //                        filing. Cigna and Molina both state a redeems
  //                        whose instrument appears nowhere in the filing
  //                        they cite.
  //   status "completed"   the filing describes something DONE. Tenet's says
  //                        it "intends to use the net proceeds ... to
  //                        finance ... the redemption", which is a plan.
  //   the row still matches the described instrument, as before.
  //
  // UHS is the case that cost the most: its 8-K names the "Existing 2026
  // Notes" in a clause listing what the new notes rank alongside, and a live
  // $700 million obligation was retired on that naming alone.
  // SESSION 21 — EVERY claim is judged on its own, and only the ones that
  // pass BOTH gates act. One filing does several things and they can need
  // opposite answers: UHS's August 8-K repays a revolver (completed,
  // verified) and names its 2026 notes in a ranking clause (no retirement at
  // all).
  const allClaims = newDebtIssuance?.redeems ?? [];
  const actionableClaims = allClaims.filter((c) => c.verified && c.status === "completed");
  const statedIntentions = allClaims.filter((c) => c.verified && c.status === "intended");
  if (newDebtIssuance?.fired && actionableClaims.length > 0) {
    const redeemsText = actionableClaims.map((c) => [c.instrument, c.sourceLine ?? ""].join(" ")).join(" ;; ");
    const retiredByEvidence = { evidence: actionableClaims.map((c) => c.sourceLine ?? c.instrument).join("; "), citedUrl: newDebtIssuance.citations[0]?.url ?? "" };
    rows = rows.map((row) => {
      if (row.status !== "live" || !redemptionRetiresRow(row, redeemsText)) return row;
      // THE NOTE IS THE POSITION (found live, stage-2 review). An 8-K
      // describes an ACTION; the note states the RESULT, at the filing's own
      // period end. Where the two disagree, the note wins — the same rule
      // the issued-tranche merge below already applies for amounts.
      //
      // The case: one filer's 8-K redeems "4.500% senior notes due 2028",
      // naming no quantity and using no partial-redemption wording, while
      // its own debt note reports that tranche at $396.9 million, down from
      // $792.0 million. Half of it was called. Text alone cannot show that;
      // the note already has. Retiring it dropped this company's NEAREST
      // maturity off the ladder entirely — a retired row does not render and
      // cannot card, so the single most callable thing about the company
      // became invisible.
      //
      // redemptionRetiresRow's own partial-redemption parsing still runs and
      // still matters for a tranche the note no longer carries. This is the
      // check that comes first when the note does carry it.
      // ...but only where the note is the NEWER fact. An 8-K that prices or
      // calls a tranche AFTER the base filing's period of report is
      // describing something that note could not yet know, and there the
      // 8-K is the current word. The comparison is the base filing's own
      // period of report against the issuance's filing date — both already
      // carried, neither inferred. When either is missing there is nothing
      // to compare and the redemption stands, which is the prior behaviour.
      // SESSION 21 — A CLAIM STATED INSIDE THE ANCHOR CANNOT BE NEWER THAN
      // THE ANCHOR.
      //
      // The comparison below puts the redemption document's FILING DATE
      // against the anchor's PERIOD OF REPORT, and a filing date is always
      // after its own period. So whenever the redemption is described in the
      // anchor filing's own debt note — which is the ordinary case, not an
      // edge one — the test concludes the redemption is newer than the note
      // that contains it, and the note-wins rule never runs.
      //
      // Measured across the book: three of the four companies whose
      // redemption retires anything cite the ANCHOR ITSELF (Encompass, Quest,
      // HCA). Encompass is the one it cost: its own June 30 table carries the
      // 4.50% 2028 notes at $396.9 million, down from $792.0 million after a
      // $400 million partial call, and the row was retired anyway — removing
      // a live $396.9 million obligation seventeen months from maturity, and
      // with it the company's nearest cardable tranche.
      //
      // Identity, not chronology: if the redemption's own citation IS the
      // anchor, the anchor states the result and wins outright.
      const anchorUrl = debtMaturity?.debtScheduleSourceFiling?.url ?? "";
      const redemptionCitedUrl = newDebtIssuance.citations[0]?.url ?? "";
      const redemptionIsFromAnchor = anchorUrl !== "" && redemptionCitedUrl === anchorUrl;
      const basePeriod = debtMaturity?.debtScheduleSourceFiling?.reportDate ?? "";
      const issuanceDate = newDebtIssuance.citations[0]?.date ?? "";
      const noteIsNewer =
        redemptionIsFromAnchor ||
        (/^\d{4}-\d{2}-\d{2}$/.test(basePeriod) && /^\d{4}-\d{2}-\d{2}$/.test(issuanceDate) && issuanceDate <= basePeriod);
      const balance = parseMoneyAmount(row.amount);
      if (noteIsNewer && balance !== null && balance !== 0) return row;
      return { ...row, status: "retired" as const, retiredBy: retiredByEvidence };
    });
  }
  // THE NOTE'S ROW WINS (Session 18, post-stage-2).
  //
  // A tranche disclosed in BOTH the debt note and its own pricing 8-K was
  // being appended twice, so the same borrowing rendered as two separate
  // rows: Tenet's 5.500% due 2032 and 6.000% due 2033, Encompass's 5.875% due
  // 2034 three times over, Molina's 6.500% due 2031, four of Cigna's. Tenet's
  // "14-row ladder" was really twelve tranches.
  //
  // The two sources say different things about the same instrument and only
  // one of them is the position. The note states what is OUTSTANDING at the
  // filing's own period end — net of discount, net of repurchases, which is
  // the number an RM is refinancing. The 8-K states what was ISSUED on one
  // day, which is the original face amount and is already stale the moment
  // any of it is repurchased. So the note's row survives and keeps its own
  // amount; the 8-K contributes only the date the tranche was priced.
  //
  // An 8-K tranche earns its own row exactly when the note does not carry it
  // — the post-period issuance, priced after the base filing's period end and
  // therefore genuinely absent from the note. That is the case this append
  // was added for, and it still works: UHS's and Encompass's August pricings
  // both post-date their base filings.
  //
  // Matched on instrument identity via rowsRepresentSameTranche — maturity
  // and rate, never amount, the same rule redemption matching already uses
  // and for the same reason (the amounts are EXPECTED to differ here; that
  // difference is the whole point).
  //
  // ITEM 6 (stage-2 review) — AND NOT WHEN THE NOTE REPORTS CATEGORY TOTALS.
  //
  // rowsRepresentSameTranche matches on maturity and rate, so it can only
  // ever match a row that HAS them. An aggregate rollup — "Senior unsecured
  // notes payable through 2095" — has neither, so a newly-priced tranche can
  // never match it, and three tranches got their own rows sitting inside a
  // rollup that already contains them. The same run rendered "4 more
  // tranches, 2095": four category totals, sorted by a seventy-year range
  // read as a maturity, described as bonds.
  //
  // A tranche cannot be added to a ladder that has no place to add it. Where
  // the note reports categories, a new issuance is inside one of those
  // categories by construction, so it is withheld from the rows and carried
  // separately — stated in full beneath the ladder, never silently dropped.
  const noteIsAggregate = scheduleIsAggregateDisclosure(baseSequence);
  const issuancesInsideAggregate: LadderRow[] = [];
  const issuedTranches = newDebtIssuance?.issuedTranches ?? [];
  if (newDebtIssuance?.fired && issuedTranches.length > 0) {
    const issuanceDateFor = (url: string): string | null => newDebtIssuance.citations.find((c) => c.url === url)?.date ?? null;
    const newRows: LadderRow[] = [];
    for (const tranche of issuedTranches) {
      const candidate = ladderRowFromIssuedTranche(tranche, "live");
      const existingIdx = rows.findIndex((r) => rowsRepresentSameTranche(r, candidate));
      const date = issuanceDateFor(tranche.citedUrl);
      if (existingIdx === -1) {
        const row = { ...candidate };
        if (date) row.issuedOn = { date, citedUrl: tranche.citedUrl };
        // Item 6: inside a category total already on the ladder — stated,
        // not laddered.
        if (noteIsAggregate) issuancesInsideAggregate.push(row);
        else newRows.push(row);
        continue;
      }
      // Same tranche. Keep the note's row and its outstanding amount; take
      // only the pricing date from the 8-K. Status is untouched — a row the
      // note reports at nil is still repaid, and one a redemption retired is
      // still retired, whatever its original pricing 8-K said.
      if (date) rows[existingIdx] = { ...rows[existingIdx], issuedOn: { date, citedUrl: tranche.citedUrl } };
    }
    rows = [...rows, ...newRows];
  }

  // Unconfirmed pass. A prior-period row can be missing from the current
  // base ladder for two different reasons, and only one of them is a real
  // gap: (a) it was genuinely redeemed BEFORE the base filing's own cutoff
  // — the base filing correctly omits it, and the SAME `redeems` text that
  // explains a still-listed row (handled above) explains this one too, it
  // just never had a "live" row to retire in the first place; or (b) it
  // dropped off with nothing explaining it at all, which is the real
  // `unconfirmed` case. Checking redemption text again here (not just
  // matching against `rows`) is what tells these apart — without it, every
  // tranche redeemed before the base filing was filed would be
  // misreported as an extraction gap instead of a fully-explained
  // retirement.
  // Session 18 (post-v11): the unconfirmed pass is SKIPPED entirely when the
  // base ladder itself failed both checks. "This tranche vanished between
  // filings with no 8-K explaining it" is only a statement about the
  // COMPANY when the current filing's own schedule is trustworthy; when the
  // base ladder doesn't reconcile at all, the same comparison is a
  // statement about the EXTRACTION, and running it anyway quietly merges
  // the entire prior schedule into the current ladder one "unconfirmed" row
  // at a time. Live case: CHS's newest 10-Q carries two maturity mentions
  // and no table, so every row of the 10-K's real 36-row schedule would
  // have been merged in this way — a stale ladder presented as the current
  // position, which is precisely what the prior-period CONTEXT block
  // (portfolioTable.ts) exists to show honestly instead.
  const baseWalk = computeWalkChecksum(baseSequence);
  const baseAnchor = computeBalanceSheetCheck(debtMaturity?.balanceSheetDebtCaptions, baseSequence);
  const baseLadderUntrustworthy = !baseWalk.pass && !baseAnchor.pass;

  const priorRowEntries = baseLadderUntrustworthy ? [] : normalizeScheduleSequence(debtMaturity?.priorScheduleSequence).filter((e) => e.kind === "row");
  // Same gate as the live pass above: an unverified or merely intended
  // claim explains nothing, so it cannot mark a prior-period row retired
  // either — it would relabel "we do not know what happened to this" as "it
  // was redeemed", which is the more confident of the two and the wrong one.
  const redeemsText =
    newDebtIssuance?.fired && actionableClaims.length > 0
      ? actionableClaims.map((c) => [c.instrument, c.sourceLine ?? ""].join(" ")).join(" ;; ")
      : null;
  const retiredByEvidence = redeemsText
    ? { evidence: redeemsText, citedUrl: newDebtIssuance?.citations[0]?.url ?? "" }
    : null;
  for (const priorEntry of priorRowEntries) {
    // A ROW THAT CANNOT BE MATCHED CANNOT BE MISSING (found live, stage-2
    // review). rowsRepresentSameTranche keys on rate and maturity, so a row
    // carrying neither — "Advances under revolving credit facility", "Other
    // notes payable", "Finance lease obligations" — can never match its own
    // counterpart on the current ladder. It is therefore declared vanished
    // every single time, and re-added beside the identical live row it
    // failed to match: one filer rendered its revolver, its other notes and
    // its finance leases twice each, once live and once "dropped from the
    // newest filing with no redemption explaining it". Six of the nine rows
    // on that ladder were three instruments counted twice.
    //
    // The absence of a match is only evidence of absence when a match was
    // possible. These rows are on the current ladder, under the same
    // caption, and nothing about them is unconfirmed.
    if (!rowIdentifiesOneTranche(priorEntry)) continue;
    if (rows.some((r) => rowsRepresentSameTranche(r, priorEntry))) continue; // still on the current ladder (live or already retired above) — nothing to add
    if (redeemsText && retiredByEvidence && redemptionRetiresRow(priorEntry, redeemsText)) {
      rows.push(ladderRowFromSequenceEntry({ ...priorEntry, citedUrl: priorEntry.citedUrl }, "retired"));
      rows[rows.length - 1].retiredBy = retiredByEvidence;
      continue;
    }
    rows.push(ladderRowFromSequenceEntry(priorEntry, "unconfirmed"));
  }

  // C1 — a tranche the filing itself reports at nil is REPAID, and says so.
  // Applied only to rows still "live": a redemption already explained is a
  // better explanation than a zero balance, and should not be overwritten.
  rows = rows.map((r) => (r.status === "live" && parseMoneyAmount(r.amount) === 0 ? { ...r, status: "repaid" as const } : r));

  // D3 — a maturity date that has already passed means MATURED, not live.
  // Nothing compared a row's date to today before this, so a ladder from an
  // older base filing carried tranches that had since come due and rendered
  // them as though they were still outstanding.
  //
  // Where an issuance in the corpus actually names the tranche, that
  // explanation is attached and stated. Where nothing states it, nothing is
  // said — a matured row with no refinancing on file is reported as exactly
  // that, never as an inferred repayment.
  rows = rows.map((r) => {
    if (r.status !== "live" || !maturityHasPassed(r, now)) return r;
    const explained = redeemsText && retiredByEvidence && redemptionRetiresRow(r, redeemsText) ? retiredByEvidence : undefined;
    return explained ? { ...r, status: "matured" as const, retiredBy: explained } : { ...r, status: "matured" as const };
  });

  // E13 — attach the prior period's balance for the same tranche. Matched on
  // instrument identity (rowsRepresentSameTranche — maturity and rate, never
  // amount), for the same reason as everywhere else in this file: the amounts
  // are expected to differ, and the difference is the whole point.
  const priorRows = normalizeScheduleSequence(debtMaturity?.priorScheduleSequence).filter((e) => e.kind === "row");
  if (priorRows.length > 0) {
    rows = rows.map((r) => {
      const match = priorRows.find((p) => rowsRepresentSameTranche(r, p));
      return match ? { ...r, priorBalance: { amount: match.amount, filing: debtMaturity?.debtSchedulePriorFiling ?? null } } : r;
    });
  }

  // Session 19, item 2b — the note's own prose, applied after every other
  // status rule so it explains whatever those produced rather than competing
  // with them.
  rows = applyNoteRetirements(rows, debtMaturity?.noteRetirements ?? []);

  rows.sort((a, b) => maturitySortKey(a) - maturitySortKey(b));

  const adjustments = baseSequence.filter((e) => e.kind === "adjustment");
  const subtotalEntries = baseSequence.filter((e) => e.kind === "subtotal");
  const finalSubtotal = subtotalEntries.length > 0 ? subtotalEntries[subtotalEntries.length - 1] : null;

  const walkGapFraction = walkGapFractionOf(baseWalk);
  // SESSION 21, STAGE 3 — THE TIER SPLIT.
  //
  // Identity first (see tier2.ts): a document that IS the anchor cannot
  // describe an event since the anchor, whatever its filing date says. Only
  // a pricing 8-K that is a DIFFERENT document and post-dates the anchor's
  // period of report moves a row out of Tier 1.
  const anchorRef = debtMaturity?.debtScheduleSourceFiling ?? null;
  const postAnchorIssuances = rows.filter(
    (r) => r.provenance === "pricing-8-K" && isPostAnchorSource(r.issuedOn?.citedUrl ?? r.citedUrl, r.issuedOn?.date ?? null, anchorRef)
  );
  rows = rows.filter((r) => !postAnchorIssuances.includes(r));

  // The pending state: matured, still carried, and nothing in the corpus
  // says it was paid. It stays in Tier 1 as well — it is still owed — and
  // Tier 2 states its status.
  const maturedUnconfirmed = rows.filter((r) => r.status === "matured" && !r.retiredBy);

  // A repayment reaches Tier 2 only on the same two gates a retirement needs
  // anywhere: corroborated COMPLETED status and a verified sourceLine.
  const eventIsPostAnchor =
    !!newDebtIssuance?.fired && isPostAnchorSource(newDebtIssuance.citations[0]?.url, newDebtIssuance.citations[0]?.date, anchorRef);
  const confirmedRepayments = eventIsPostAnchor
    ? actionableClaims.map((c) => ({
        instrument: c.instrument,
        amount: c.amount ? parseMoneyAmount(c.amount) : null,
        date: newDebtIssuance?.citations[0]?.date ?? null,
        sourceLine: c.sourceLine ?? c.instrument,
        citedUrl: newDebtIssuance?.citations[0]?.url ?? "",
      }))
    : [];

  const intentions = statedIntentions.map((c) => ({
    instrument: c.instrument,
    amount: c.amount,
    date: newDebtIssuance?.citations[0]?.date ?? null,
    sourceLine: c.sourceLine ?? c.instrument,
    citedUrl: newDebtIssuance?.citations[0]?.url ?? "",
    postAnchor: eventIsPostAnchor,
  }));

  const tier2 = buildTier2({
    anchor: anchorRef,
    anchorCapturedFace: rows.reduce((a, r) => a + (r.isCapacity ? 0 : parseMoneyAmount(r.amount) ?? 0), 0) || null,
    postAnchorIssuances,
    maturedUnconfirmed,
    confirmedRepayments,
    // A stated intention from a filing that POST-DATES the anchor is an
    // event since it, and belongs in Tier 2 as a pending line. One from
    // before the anchor is not.
    pendingIntentions: intentions.filter((i) => i.postAnchor),
    parseAmount: parseMoneyAmount,
  });

  return {
    rows,
    tier2,
    statedIntentions: intentions,
    issuancesInsideAggregate,
    adjustments,
    finalSubtotal,
    baseFiling: debtMaturity?.debtScheduleSourceFiling ?? null,
    baseLadderUntrustworthy,
    rowsNotVerifiedAsTranscribed: walkGapFraction !== null && walkGapFraction > CHECK1_MATERIAL_GAP_FRACTION,
    walkGapFraction,
  };
}

// ============================================================================
// Checksum redesign (post-v9): two independent checks, reported separately,
// never blended into one tie rate. They fail differently — Check 1 proves
// the rows are complete; Check 2 proves the note is the right one (the
// current period's, not a stale prior-quarter note that happens to tie
// perfectly on its own).
// ============================================================================

/**
 * Absolute, not relative — a flat percentage of the total scales up right
 * alongside it and can end up larger than a whole small tranche, which
 * would let a dropped row hide inside the tolerance band on a large enough
 * company. ABSOLUTE_FLOOR alone accounts for genuine filing-side rounding
 * (a subtotal is itself often printed rounded to the nearest $0.1B);
 * capping the actual tolerance below half the smallest row on the ladder is
 * what guarantees a fully-missing row can never tie by accident, regardless
 * of company size.
 */
const CHECKSUM_ABSOLUTE_FLOOR = 100_000_000;
const CHECKSUM_TOLERANCE_FRACTION_OF_SMALLEST_ROW = 0.5;

/**
 * Parses a money string into a signed dollar value — handles a leading "-"
 * or the accounting parenthesized-negative convention, on top of the
 * existing money-token extraction the rest of this pipeline already uses.
 * Null when unparseable — never guessed.
 *
 * Real bug found live in this session's own pilot re-extraction: DaVita's
 * real reconciling line came back as "$(66,503) thousand" — the "$" OUTSIDE
 * the parens and the scale word AFTER them, not the whole string wrapped
 * ("($66,503 thousand)") the original regex assumed. The parens sitting
 * between "$"/digits and between digits/"thousand" broke
 * extractMoneyUnitSuffixed's adjacency requirement entirely, silently
 * falling through to the scale-blind bare-number path (66,503 read as
 * $66,503, not $66,503,000) AND missing the negative sign — turning a
 * correct-to-the-dollar checksum into a large false "does not tie."
 * Stripping the parens themselves before tokenizing (after first checking
 * for their presence, to still detect the negative) fixes both at once,
 * regardless of exactly where within the string they fall.
 */
export function parseMoneyAmount(raw: string): number | null {
  const trimmed = raw.trim();
  // C1 — a dash alone is the accounting convention for nil, and nil is zero.
  // It must PARSE, not fail: a zero row contributes zero to the walk, which is
  // arithmetically identical to skipping it but leaves the row visible as a
  // repaid tranche instead of an unexplained absence.
  if (isStatedZeroAmount(trimmed)) return 0;
  const isNegative = (trimmed.includes("(") && trimmed.includes(")")) || /^-/.test(trimmed.replace(/^\(/, ""));
  const withoutParens = trimmed.replace(/[()]/g, "");
  const token = extractFactTokens(withoutParens).find((t) => t.kind === "money");
  if (!token) return null;
  const magnitude = token.moneyValue ?? token.bareNumber;
  if (magnitude === undefined) return null;
  return isNegative ? -Math.abs(magnitude) : magnitude;
}

/**
 * SESSION 19 (run B diagnosis) — AN ENTRY THAT EQUALS THE ROWS ABOVE IT IS
 * NOT A ROW.
 *
 * Centene's v17 note came back with `Total senior notes 14,204` typed
 * `kind: "row"`. The seven note rows above it sum to exactly 14,204, so the
 * walk counted the subtotal alongside the rows that produce it and reported
 * $30.4B against a stated $16.0B. The model typed both OUTER subtotals
 * correctly ("Total debt", "Long-term debt") and this one INNER subtotal
 * wrong; nowhere in the raw response is it typed correctly, so there is
 * nothing to recover downstream and the shape has to be re-derived here.
 *
 * THE TEST IS ARITHMETIC, NOT VOCABULARY. A guard keying on /^total/ would
 * be a wording guard, and this project does not ship those: it would miss a
 * subtotal captioned "Senior notes, net" and would fire on a genuine row in
 * a filing that happens to caption a tranche "Total Return Swap Facility".
 * What actually identifies a subtotal is that it restates the sum of the
 * consecutive rows immediately preceding it, which no genuine tranche does
 * except by coincidence.
 *
 * THE FALSE-POSITIVE MODE, NAMED: a real row whose amount coincidentally
 * equals the running sum of the rows above it. Two guards, and then the log.
 *   - At least two preceding rows. A single row "summing" to itself is not
 *     evidence of anything, and two equal-sized tranches in sequence are
 *     common enough to be a real hazard.
 *   - Exact equality, to float representation only. The epsilon here is
 *     1e-9 RELATIVE, which exists because 1067+2160+... accumulates binary
 *     error, not because a near-miss should pass. This is not a tolerance
 *     that can be widened to make a company tie.
 * Every re-typing is reported through `onRetype` and printed book-wide, so a
 * coincidence is visible in the log rather than silently folded into a
 * ladder. That is the whole reason the callback exists.
 *
 * Idempotent: re-running over already-corrected entries changes nothing,
 * which is what lets all three read sites apply it without coordinating.
 */
/**
 * The book-wide re-typing log. Every correction the normalizer makes prints
 * once, wherever it was triggered from — a coincidental row-equals-running-
 * sum is the false-positive mode, and this line is the only way anyone would
 * see it. Deduplicated because four read sites normalize the same sequence
 * and the correction is a property of the filing, not of who asked.
 */
const reportedRetypes = new Set<string>();

export function reportRetype(r: SubtotalRetype): void {
  const key = `${r.label}|${r.amount}|${r.runningSum}`;
  if (reportedRetypes.has(key)) return;
  reportedRetypes.add(key);
  console.log(
    `  SUBTOTAL RE-TYPED — ${JSON.stringify(r.label)} states ${JSON.stringify(r.amount)}, which is exactly the sum of the ${r.rowsSummed} rows immediately above it (${r.runningSum.toLocaleString("en-US")}); it was emitted as kind="row" and would have been walked alongside the rows that produce it. Re-typed to "subtotal". If this label names a real tranche, this is the coincidence case and the ladder is now wrong — say so rather than trusting it.`
  );
}

/** Test seam: the dedupe set is process-lifetime, which a suite asserting the log must be able to clear. */
export function resetRetypeLog(): void {
  reportedRetypes.clear();
}

export interface SubtotalRetype {
  label: string;
  amount: string;
  /** The sum this entry restated — equal to its own parsed amount, by construction. */
  runningSum: number;
  /** How many consecutive preceding rows produced that sum. */
  rowsSummed: number;
}

export function retypeEmbeddedSubtotals(
  scheduleSequence: VerifiedSequenceEntry[] | null | undefined,
  onRetype?: (r: SubtotalRetype) => void
): VerifiedSequenceEntry[] {
  const entries = scheduleSequence ?? [];
  const out: VerifiedSequenceEntry[] = [];
  let runSum = 0;
  let runCount = 0;

  for (const entry of entries) {
    if (entry.kind !== "row") {
      // An adjustment or an already-correct subtotal closes the group. The
      // next row starts a fresh run rather than continuing across it.
      runSum = 0;
      runCount = 0;
      out.push(entry);
      continue;
    }
    const value = parseMoneyAmount(entry.amount);
    if (value === null) {
      // Indeterminate amount: it cannot extend a run (the sum would be
      // wrong) and it cannot be tested against one.
      runSum = 0;
      runCount = 0;
      out.push(entry);
      continue;
    }
    // ZERO IS DEGENERATE, AND IT IS NOT HYPOTHETICAL. A nil balance is a
    // legitimate row (C1: the filing states a repaid tranche as "$ —"), and a
    // run of them sums to zero, so a third nil row "equals the running sum"
    // and every one after it would be re-typed out of the ladder. Cigna has
    // exactly this: two matured tranches carrying "$ —". They must render as
    // repaid rows, not disappear into a subtotal that restates nothing. A
    // subtotal of zero also carries no information, so nothing is lost by
    // refusing the test here.
    const epsilon = Math.abs(runSum) * 1e-9;
    if (runCount >= 2 && runSum !== 0 && value !== 0 && Math.abs(value - runSum) <= epsilon) {
      onRetype?.({ label: entry.label ?? "(unlabeled)", amount: entry.amount, runningSum: runSum, rowsSummed: runCount });
      out.push({ ...entry, kind: "subtotal" });
      runSum = 0;
      runCount = 0;
      continue;
    }
    runSum += value;
    runCount += 1;
    out.push(entry);
  }
  return out;
}


/**
 * SESSION 19 — A STATED DEDUCTION IS NEGATIVE, HOWEVER IT IS PUNCTUATED.
 *
 * Tenet's note uses BOTH conventions in the same table:
 *
 *   Unamortized issue costs and note discounts   ( 85 )   ( 94 )
 *   Less: Current portion                          160       79
 *   Long-term debt, net of current portion     $ 13,088  $ 13,092
 *
 * One line is parenthesised; the next carries its sign in the LABEL and
 * prints the figure bare. The model transcribed both faithfully. The walk
 * read the sign only from punctuation, added 160 where the filing subtracts
 * it, and reported "off by $320M" — twice the figure, the signature of a
 * dropped sign rather than a missing row.
 *
 * This is the em-dash lesson again: the label carries meaning the digits do
 * not. Reading "Less:" is READING THE FILING, not guessing at it — which is
 * what separates this from a vocabulary guard. The project's rule bans
 * guards keyed on how the MODEL happens to word something; this is keyed on
 * a printing convention the filing itself uses, transcribed verbatim.
 *
 * Scoped tightly, because the cost of over-applying is a silently wrong
 * balance:
 *   - `adjustment` entries only. A row is a position, not a deduction.
 *   - Only when the amount is not ALREADY negative, so a filing that both
 *     labels and parenthesises is not double-negated back to positive.
 *   - The marker must LEAD the label. "Less: current portion" is a
 *     deduction; "Notes issued at less than par" is not.
 * Every correction logs, for the same reason every re-typing does.
 */
const STATED_DEDUCTION = /^\s*(?:less|deduct|deductions|minus)\b\s*:?/i;

export interface DeductionSignFix {
  label: string;
  amount: string;
}

export function applyStatedDeductionSigns(
  entries: VerifiedSequenceEntry[],
  onFix?: (f: DeductionSignFix) => void
): VerifiedSequenceEntry[] {
  return entries.map((e) => {
    if (e.kind !== "adjustment") return e;
    const label = e.label ?? "";
    if (!STATED_DEDUCTION.test(label)) return e;
    const value = parseMoneyAmount(e.amount);
    if (value === null || value <= 0) return e; // already negative, nil, or unparseable — leave it exactly as the filing printed it
    onFix?.({ label, amount: e.amount });
    // The AMOUNT STRING is rewritten to the accounting form the rest of the
    // pipeline already parses, rather than carrying a sign flag no other
    // reader would know to check.
    return { ...e, amount: `(${e.amount.trim()})` };
  });
}

/**
 * The one normalization every reader of a schedule sequence applies. Both
 * corrections are shape corrections over transcribed text, both are
 * idempotent, and keeping them behind one name is what stops a future reader
 * from applying one and not the other — which is precisely the bug the
 * render side had when it walked the raw sequence while the checks walked
 * the normalized one.
 */
export function normalizeScheduleSequence(
  scheduleSequence: VerifiedSequenceEntry[] | null | undefined
): VerifiedSequenceEntry[] {
  return applyStatedDeductionSigns(retypeEmbeddedSubtotals(scheduleSequence, reportRetype), reportDeductionFix);
}

const reportedFixes = new Set<string>();
export function reportDeductionFix(f: DeductionSignFix): void {
  const key = `${f.label}|${f.amount}`;
  if (reportedFixes.has(key)) return;
  reportedFixes.add(key);
  console.log(
    `  STATED DEDUCTION SIGNED — ${JSON.stringify(f.label)} prints ${JSON.stringify(f.amount)} unsigned, but its own label states a deduction, so it is subtracted. If this line is not a deduction, the walk is now wrong in the other direction — say so rather than trusting it.`
  );
}

export interface SubtotalCheck {
  /** Verbatim, or null when the filing prints this figure with no "Total ..." caption at all (real and expected). */
  label: string | null;
  /** The section this subtotal closes (its own computed section sum was checked against it), or null when this subtotal is a rollup checked against the top-level running total instead. Same field as the entry's own `section` — reported here for the same reason `label` is: so a failing check can be described without re-walking the sequence. */
  section: string | null;
  claimedAmount: number;
  /** The actual computed sum this subtotal was checked against — its own section's rows/adjustments for a section-scoped subtotal, or the top-level running total (every still-open section folded in) for a rollup. */
  runningSum: number;
  gap: number;
  tie: boolean;
}

export interface WalkChecksumResult {
  /** True only when the sequence has at least one subtotal AND every one of them reconciles. */
  pass: boolean;
  subtotalChecks: SubtotalCheck[];
  rowCount: number;
  adjustmentCount: number;
}

/**
 * Check 1 — the internal walk. Post-v10: a debt note is NESTED, not flat —
 * the filing prints section headings (e.g. "Long-term debt", "Short-term
 * borrowings"), and each subtotal reconciles against the rows/adjustments in
 * its OWN section (verbatim `section` field, never inferred from position)
 * plus any earlier subtotal or still-open section it rolls up. A flat,
 * single-section note (every entry's `section` is null, e.g. DaVita's) is
 * the degenerate case: everything falls into the one top-level scope and
 * this walk behaves exactly like the original flat running-total check.
 *
 * Entries are walked in PRINTED order — never reordered, per
 * ScheduleSequenceEntry's doc comment in lib/agent/claude.ts (an earlier
 * version of the prompt asked the model to reposition entries to make the
 * arithmetic work; that was itself an instance-fit and is no longer asked
 * for). Algorithm:
 *   - row/adjustment entries with a `section` accumulate into that
 *     section's own running sum; entries with `section: null` accumulate
 *     directly into the top-level running sum.
 *   - a "subtotal" entry WITH a `section` closes that section: checked
 *     against the section's own computed sum (never the claimed amount —
 *     see below), then that COMPUTED sum (not the claimed one) folds into
 *     the top-level running sum, and the section is reset/closed.
 *   - a "subtotal" entry with `section: null` is a rollup: any sections
 *     still open at this point (no subtotal has closed them yet — e.g.
 *     HCA's "Short-term borrowings", which never gets its own subtotal)
 *     fold their computed sums into the top level first, THEN the rollup is
 *     checked against the resulting top-level total.
 *
 * Never resets a running total to a subtotal's CLAIMED amount — only ever
 * to what was actually computed. This is deliberate: a missing or
 * fabricated row corrupts every subtotal after it, not just the nearest
 * one, so the corruption stays visible at every checkpoint instead of being
 * silently absorbed the moment one subtotal is reached.
 *
 * Operates on the RAW extracted scheduleSequence (the base filing's own
 * transcription), not the assembled position — this is a proof about
 * whether extraction completely transcribed ONE filing's table, independent
 * of how position.ts later layers 8-K deltas on top of it.
 */
export function computeWalkChecksum(scheduleSequence: VerifiedSequenceEntry[] | undefined): WalkChecksumResult {
  // Session 19: a mistyped inner subtotal is re-typed before it is walked,
  // or it is counted alongside the rows that produce it. Idempotent, so the
  // three read sites need not coordinate about who normalizes.
  const entries = normalizeScheduleSequence(scheduleSequence);
  const rowValues = entries
    .filter((e) => e.kind === "row")
    .map((e) => parseMoneyAmount(e.amount))
    .filter((v): v is number => v !== null);
  const smallestRow = rowValues.length > 0 ? Math.min(...rowValues.map(Math.abs)) : Number.POSITIVE_INFINITY;
  const tolerance = Math.min(CHECKSUM_ABSOLUTE_FLOOR, smallestRow * CHECKSUM_TOLERANCE_FRACTION_OF_SMALLEST_ROW);

  let topLevelSum = 0;
  const sectionSums = new Map<string, number>();
  const openSections = new Set<string>(); // sections with an accumulated sum not yet folded into topLevelSum
  let rowCount = 0;
  let adjustmentCount = 0;
  const subtotalChecks: SubtotalCheck[] = [];

  const foldOpenSectionsIntoTopLevel = () => {
    for (const section of openSections) {
      topLevelSum += sectionSums.get(section) ?? 0;
    }
    openSections.clear();
  };

  for (const entry of entries) {
    const value = parseMoneyAmount(entry.amount);
    if (value === null) continue; // unparseable — shouldn't happen post-verification (amount scale is already checked), but never crash

    if (entry.kind === "row" || entry.kind === "adjustment") {
      if (entry.kind === "row") rowCount++;
      else adjustmentCount++;
      if (entry.section) {
        sectionSums.set(entry.section, (sectionSums.get(entry.section) ?? 0) + value);
        openSections.add(entry.section);
      } else {
        topLevelSum += value;
      }
      continue;
    }

    // "subtotal"
    if (entry.section) {
      const sectionSum = sectionSums.get(entry.section) ?? 0;
      const gap = value - sectionSum;
      subtotalChecks.push({ label: entry.label, section: entry.section, claimedAmount: value, runningSum: sectionSum, gap, tie: Math.abs(gap) <= tolerance });
      // Close the section: its COMPUTED sum (never the claimed subtotal) folds into the top level, so a corrupted section keeps propagating even when this checkpoint itself happens to tie.
      topLevelSum += sectionSum;
      sectionSums.set(entry.section, 0);
      openSections.delete(entry.section);
    } else {
      foldOpenSectionsIntoTopLevel();
      const gap = value - topLevelSum;
      subtotalChecks.push({ label: entry.label, section: null, claimedAmount: value, runningSum: topLevelSum, gap, tie: Math.abs(gap) <= tolerance });
      // Not reset to the claimed amount — top-level running total stays computed, same propagation rule as above.
    }
  }

  const pass = subtotalChecks.length > 0 && subtotalChecks.every((c) => c.tie);
  return { pass, subtotalChecks, rowCount, adjustmentCount };
}

export interface BalanceSheetCheckResult {
  pass: boolean;
  captionSum: number;
  captionCount: number;
  /** Which subtotal the caption sum matched, when it did. Null on failure — never force a match. */
  matchedSubtotalLabel: string | null;
  matchedSubtotalAmount: number | null;
  /** Gap to the NEAREST subtotal, reported whether or not it's within tolerance — never suppressed. Null only when there's nothing to compare against at all (no captions or no subtotals). */
  nearestGap: number | null;
  /**
   * E2 — how the anchor was matched. "section-sum" means the captions were
   * compared against the sum of the note's own section-closing subtotals
   * rather than any single one, which is the only correct comparison for a
   * note that prints no combined rollup.
   */
  matchedVia: "single-subtotal" | "section-sum" | null;
  /** E2 — the categories on each side, so a failure names WHAT was compared with what rather than only how far apart they were. */
  captionCategories: string[];
  subtotalCategories: string[];
}

/**
 * Check 2 — the balance-sheet anchor. Every 10-Q/10-K carries a balance
 * sheet with its own debt captions, independent of the debt note's own
 * running sequence. Reconciling the two proves the note actually belongs to
 * THIS period — an internal walk on a stale, prior-quarter note ties
 * perfectly on its own (Check 1 would pass); the balance sheet is what
 * catches that it's the wrong note. NOT a fixed formula: sums whichever
 * captions the model actually extracted (lib/agent/claude.ts's prompt reads
 * the balance sheet's own captions, never assumes a fixed set) and looks
 * for a match against ANY subtotal in the sequence — a company whose
 * captions land on an intermediate subtotal (not necessarily the final one)
 * still passes.
 */
export function computeBalanceSheetCheck(
  captions: VerifiedBalanceSheetCaption[] | undefined,
  scheduleSequence: VerifiedSequenceEntry[] | undefined
): BalanceSheetCheckResult {
  const captionList = captions ?? [];
  if (captionList.length === 0) {
    return { pass: false, captionSum: 0, captionCount: 0, matchedSubtotalLabel: null, matchedSubtotalAmount: null, nearestGap: null, matchedVia: null, captionCategories: [], subtotalCategories: [] };
  }
  const captionValues = captionList.map((c) => parseMoneyAmount(c.amount)).filter((v): v is number => v !== null);
  const captionSum = captionValues.reduce((a, b) => a + b, 0);

  // Session 19 — normalized ONCE for this whole function. It previously
  // normalized for `subtotals` and then read the RAW sequence twice more
  // below (the section-closing totals, and the reported subtotalCategories),
  // so a re-typed subtotal was visible to the check that matched and
  // invisible to the check that built its candidates. Same
  // one-caller-bypasses-the-normalizer shape as the Centene render defect,
  // this time inside a single function.
  const normalized = normalizeScheduleSequence(scheduleSequence);

  const subtotals = normalized
    .filter((e) => e.kind === "subtotal")
    .map((e) => ({ label: e.label, amount: parseMoneyAmount(e.amount) }))
    .filter((s): s is { label: string | null; amount: number } => s.amount !== null);
  if (subtotals.length === 0) {
    return { pass: false, captionSum, captionCount: captionList.length, matchedSubtotalLabel: null, matchedSubtotalAmount: null, nearestGap: null, matchedVia: null, captionCategories: captionList.map((c) => c.label), subtotalCategories: [] };
  }

  const smallestCaption = captionValues.length > 0 ? Math.min(...captionValues.map(Math.abs)) : Number.POSITIVE_INFINITY;
  const tolerance = Math.min(CHECKSUM_ABSOLUTE_FLOOR, smallestCaption * CHECKSUM_TOLERANCE_FRACTION_OF_SMALLEST_ROW);

  // E2 (Session 18, post-stage-2) — MATCH THE CATEGORY, NOT THE NEAREST
  // NUMBER.
  //
  // Picking the numerically closest subtotal silently compares a two-category
  // caption sum against a one-category subtotal. Cigna is the measured case
  // and the arithmetic gives it away exactly: its balance sheet carries
  // "Short-term debt $592M" and "Long-term debt $30,871M"; its note is
  // SECTIONED and closes each section with its own subtotal — $592M and
  // $30,871M — and prints no combined rollup at all. The nearest single
  // subtotal is long-term, so the anchor missed by $592M, which is not a gap
  // but the entire short-term category. Both walks tied throughout; the note
  // was transcribed perfectly and Cigna still read as FAIL.
  //
  // The fix is structural and needs no category vocabulary: when the note
  // prints section-scoped subtotals, the sum of those sections IS the
  // combined total the filing never wrote down, and that is what a
  // multi-caption balance sheet should be compared against. A flat note
  // (every section null — DaVita's shape) produces no such candidate and
  // behaves exactly as before.
  const sectionClosingTotals = new Map<string, number>();
  for (const e of normalized) {
    if (e.kind !== "subtotal" || !e.section) continue;
    const v = parseMoneyAmount(e.amount);
    if (v !== null) sectionClosingTotals.set(e.section, v); // last subtotal per section wins
  }
  type Candidate = { label: string | null; amount: number; via: "single-subtotal" | "section-sum" };
  const candidates: Candidate[] = subtotals.map((s) => ({ ...s, via: "single-subtotal" as const }));
  if (sectionClosingTotals.size >= 2) {
    candidates.push({
      label: `sum of ${[...sectionClosingTotals.keys()].join(" + ")}`,
      amount: [...sectionClosingTotals.values()].reduce((a, b) => a + b, 0),
      via: "section-sum",
    });
  }

  let best = candidates[0];
  let bestGap = captionSum - best.amount;
  for (const c of candidates.slice(1)) {
    const gap = captionSum - c.amount;
    if (Math.abs(gap) < Math.abs(bestGap)) {
      best = c;
      bestGap = gap;
    }
  }

  const pass = Math.abs(bestGap) <= tolerance;
  return {
    pass,
    captionSum,
    captionCount: captionList.length,
    matchedSubtotalLabel: pass ? best.label : null,
    matchedSubtotalAmount: pass ? best.amount : null,
    nearestGap: bestGap,
    matchedVia: pass ? best.via : null,
    captionCategories: captionList.map((c) => c.label),
    subtotalCategories: [...new Set(normalized.filter((e) => e.kind === "subtotal").map((e) => e.section ?? e.label ?? "(unlabeled)"))],
  };
}

/**
 * A ladder row's own citation — looked up from the debt-maturity trigger's
 * own citations (form/date metadata), falling back to a bare url-only
 * citation when the row's citedUrl isn't in that list for some reason
 * (shouldn't happen — every row's citedUrl comes from a filing that was
 * actually fetched — but never silently drop a citation for want of
 * metadata). Shared by buildEvents.ts (a row card's own citations) and
 * factBase.ts (a row's VerifiedFact citations) so the two can never
 * disagree about the same row.
 */
export function citationsForLadderRow(row: LadderRow, debtMaturityTrigger: TriggerResult): TriggerResult["citations"] {
  const known = debtMaturityTrigger.citations.find((c) => c.url === row.citedUrl);
  return [known ?? { form: "filing", date: "", reportDate: "", url: row.citedUrl }];
}
