import type { CompanyResult, TriggerResult, VerifiedSequenceEntry } from "../agent";
import type { DebtScheduleFilingRef } from "../agent/claude";
import type { FlashCard } from "./buildEvents";
import { bucketForTrigger, type Bucket } from "./buckets";
import { evaluateEligibility, evaluateRowEligibility } from "./eligibility";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { condenseEvidenceDescription, formatAnnouncedDate, dateTokenMatchesEventDate } from "./evidenceCondense";
import { assemblePosition, computeWalkChecksum, computeBalanceSheetCheck, type LadderRow } from "./position";
import { extractFactTokens } from "../agent/factTokens";
import type { TimingInfo } from "./textHeuristics";

/**
 * Session 15b Part A: the portfolio table's deterministic renderer,
 * rewritten to render per TRIGGER, not per dedup cluster. Session 15's
 * first version grouped by buildEvents.ts's merged-cluster bucket, which
 * meant a trigger could render under a bucket that wasn't its own (a
 * cluster resolves to ONE bucket by priority tie-break; every constituent
 * trigger inherited it) — confirmed live: HCA's debt-maturity fact
 * rendered under "New debt" because it shared a citation with
 * new-debt-issuance, which won the tie-break. Clusters/dedup stay exactly
 * as they are for CARDS (out of scope this session); the table simply
 * stops using them — it renders every verified trigger independently,
 * under bucketForTrigger(triggerId), which is what "the table is the full
 * picture" requires.
 *
 * Each line is built from the trigger's own evidence prose
 * (evidenceCondense.ts), not from a figure+status template — see that
 * file's doc comment for the three condensing rules this implements.
 *
 * No model call anywhere in this file.
 */

export interface TableLine {
  triggerId: string;
  /** Condensed "what happened, with its amount and date" — evidenceCondense.ts. Never empty (bareLineFallback guarantees a reason string when a fact has nothing else). */
  description: string;
  /** dateGranularity-aware phrase — "~46mo out", "matures 2026" (never a computed month count for a year-granularity fact), "pending/live", "standing", or "". */
  timingPhrase: string;
  /** ALL citations for this trigger, not just the most recent — every line must carry its source link(s). */
  citations: TriggerResult["citations"];
  /** True when this exact trigger is the headline of one of this company's actual rendered cards above — "the carded events appear in the table too, marked." */
  cardEligible: boolean;
  /** True for a hedging-bucket line with no card of its own — renders with the ⚑ marker so a standing exposure is never buried. */
  isHedgingFlag: boolean;
  /** Session 18 D3 sort rank: 1 for a completed event older than 12 months (sinks to the bucket's bottom), 0 otherwise. Reordering only — a stale line is never removed. */
  d3Rank: number;
  /** Age in months of a completed event, 0 when not applicable — the secondary sort within the stale group, so the oldest line is genuinely last. */
  d3AgeMonths: number;
}

export type BucketLines = Record<Bucket, TableLine[]>;

/** One line in the refi ladder — either individually named (a nearest tranche) or folded into the tail summary, per buildRefiLadder below. */
export interface RefiLadderLine {
  row: LadderRow;
  /** "6mo out", "matures 2026" (never a computed month count for a year-granularity row), or the unconfirmed/date-unverifiable explanation — never blank. */
  timingPhrase: string;
  /** True when this row's own card is one of this company's actual rendered cards above. */
  cardEligible: boolean;
}

/**
 * Session 18 F1: the refi bucket's own block, built directly from the
 * assembled position (lib/events/position.ts) — structurally different from
 * every other bucket (a ladder with a completeness statement, not a flat
 * list of independent facts), so it gets its own shape rather than being
 * forced into TableLine[].
 */
export interface RefiLadderBlock {
  /** False only when debt-maturity never fired at all (no debt disclosed) — renders as the bucket's own "no signal" line, same as any other empty bucket. */
  hasData: boolean;
  /**
   * Check 1 (the internal walk) — over the RAW extracted scheduleSequence
   * (the base filing's own transcription), not the position-adjusted
   * ladder. Proves the rows are complete.
   */
  walkCheck: ReturnType<typeof computeWalkChecksum>;
  /**
   * Check 2 (the balance-sheet anchor) — cross-references the note's own
   * subtotals against the base filing's balance-sheet debt captions.
   * Proves the note belongs to THIS period. Reported SEPARATELY from Check
   * 1, never blended into one tie rate — they fail differently and each
   * names its own failure.
   */
  balanceSheetCheck: ReturnType<typeof computeBalanceSheetCheck>;
  /** States both checks' results as distinct clauses. Never suppressed when either check fails — rendering the ladder anyway with this note is the whole point (Part C). */
  completenessStatement: string;
  /** Every row in the CURRENT (position-adjusted) ladder that isn't `retired` — a retired row never gets its own table line, it only explains a live one via a card's KEY POINT (E1). Nearest-first. */
  nearestLines: RefiLadderLine[];
  /** "N more tranches, YYYY to YYYY" for whatever didn't fit in nearestLines, or null when everything fit. */
  tailSummary: string | null;
  /** The base filing this ladder's rows trace to, for the trailing source link — the SAME filing lib/fetch/debtNoteLocator.ts determined and the model was told to use (position.baseFiling), not just whichever citation happened to be listed first. */
  sourceCitation: TriggerResult["citations"][number] | null;
  /**
   * Session 18 (post-v6, live-diagnosed against REAL HCA data): true when
   * NO row in this ladder has day/month-precision maturity — every real
   * itemized company in this book (Tenet, Quest, Centene, Molina, DaVita,
   * Cigna via its 10-K) states most or all of its tranches down to a real
   * day or month; HCA states none at all across either its 10-Q or its
   * 10-K, only category rollups with year-or-no maturity. Purely structural
   * (based on the DATA's own date precision, never a company name check) —
   * the render layer uses this to state "aggregate disclosure, no
   * tranche-level ladder available" instead of the normal "ladder
   * complete"/"does not tie" wording, which would misleadingly imply a
   * per-tranche ladder exists when it doesn't. Never suppresses the bucket
   * — the rows still render, exactly as extracted.
   */
  isAggregateDisclosure: boolean;
  /**
   * Session 18 (post-v6): the base filing's "adjustment" entries
   * (discount/issuance costs, current portion, etc.), rendered as their own
   * visible lines — never buried inside arithmetic no one sees. Real case:
   * HCA's "amounts due within one year: $6,264 million" is genuinely
   * useful timing information on its own, even with no per-tranche
   * breakdown at all.
   */
  adjustments: VerifiedSequenceEntry[];
  /**
   * A3 (Session 18, post-stage-2). True when Check 1 misses by more than
   * CHECK1_MATERIAL_GAP_FRACTION of the ladder's own stated total. The rows
   * are still rendered — never suppressed — but they must be presented as an
   * unreliable transcription rather than as this company's position, and
   * none of them cards.
   */
  rowsNotVerifiedAsTranscribed: boolean;
  /** The size of that miss as a fraction of the stated total, reported whether or not it crosses the threshold. Null when Check 1 has nothing to compare. */
  walkGapFraction: number | null;
}

export interface CompanyTableBlock {
  company: string;
  cik: string;
  ticker: string;
  cardCount: number;
  /** "N cards this week" or "no action this week" — Part B's required header line. */
  headerLine: string;
  /** Part C's fuller empty-state line, set only when cardCount === 0. */
  emptyStateLine: string | null;
  /** New debt / Treasury / Hedging — refi is NOT rendered here (see refiLadder below); its own array in this record always stays empty. */
  buckets: BucketLines;
  /** Session 18 F1: the refi bucket's own dedicated block. */
  refiLadder: RefiLadderBlock;
  relationshipFlags: string[];
  triggersRun: number;
  triggersNoSignalCount: number;
}

/** Individually-named nearest tranches before the rest collapse into a tail summary — chosen to comfortably cover a real card-window's worth of tranches (18mo out) plus a little context, without listing every row on a 10+-tranche ladder. Revisit once real multi-tranche output (HCA, Cigna) is in hand. */
const NAMED_TRANCHE_COUNT = 3;

/** Display order matching the spec's own illustrative table (Refi, New debt, Treasury, Hedging) — presentation only, distinct from buckets.ts's BUCKET_PRIORITY tie-break order. */
export const TABLE_BUCKET_ORDER: Bucket[] = ["refi", "new_debt", "treasury", "hedging"];

/**
 * Session 16 Fix C: every line must carry a status a reader can read as
 * status, never a blank — a blank was indistinguishable from a rendering
 * gap. Confirmed live across both books: any "completed" or "just_announced"
 * fact whose own date is neither a near-future maturity nor within the
 * pending-live recency window (i.e. it happened, but a while ago) fell
 * through every branch below to "" — DaVita's Feb 2026 acquisition, HCA's
 * April offering, Tenet's Nov 2025 issuance, Cigna's Sept 2025 issuance,
 * Quest's May 2026 issuance, Encompass's May 2026 issuance, UHS's Talkspace
 * line, CHS's April 2026 divestiture all did this. The two new branches
 * (completed/just_announced) and the final never-blank fallback close every
 * remaining eventStatus case.
 */
/** True when `description` already states the trigger's own eventDate, at its own granularity — reuses the exact date-matching rule evidenceCondense.ts's debt-maturity clause selection uses, so "does the line already say this" and "which clause matches this date" never disagree. */
function descriptionAlreadyStatesDate(description: string, eventDate: string, granularity: TriggerResult["dateGranularity"]): boolean {
  if (!granularity) return false;
  const dateTokens = extractFactTokens(description).filter((tok) => tok.kind === "date");
  return dateTokens.some((tok) => dateTokenMatchesEventDate(tok, eventDate, granularity));
}

/**
 * Session 18 D3 — A COMPLETED EVENT OVER 12 MONTHS OLD SORTS TO THE BOTTOM
 * OF ITS BUCKET AND RENDERS ITS AGE. NEVER SUPPRESSED.
 *
 * D3 changes POSITION and adds an AGE STRING. It is deliberately not an
 * eligibility rejection: the line stays, because deleting it would imply the
 * event never happened. An RM scanning Treasury should see a stale item last
 * and know it is stale, not have it silently removed.
 *
 * Found missing by the Part E run: Cigna's HCSC divestiture (March 2025) sat
 * at index 1 of 3 in Treasury reading a bare "completed" — indistinguishable
 * from something that closed last month.
 *
 * Age is computed from the event's own fact-guarded eventDate, never from
 * filing dates: a filing can restate an old event, and the event's own date
 * is the only honest source for how old it is. A completed event with no
 * usable date is NOT treated as stale — unknown age sorts normally and shows
 * plain "completed", since "we don't know when" is not evidence of "long
 * ago".
 */
const D3_STALE_MONTHS = 12;

function monthsSinceCompletion(t: TriggerResult, now: Date): number | null {
  if (t.eventStatus !== "completed" || !t.eventDate) return null;
  const m = t.eventDate.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  // A bare-year date is treated as mid-year rather than January: assuming
  // January would systematically overstate age by up to 11 months and could
  // push a recent event over the threshold on precision the filing never
  // gave. Same conservatism as eventTiming.ts's windowDate convention.
  const month = m[2] ? Number(m[2]) - 1 : 6;
  const months = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
  return months >= 0 ? months : null; // a future "completed" date is nonsense; never negative-age a line
}

/** D3's sort key: stale-completed lines sink, everything else keeps its existing relative order (stable sort). */
function d3SortRank(t: TriggerResult, now: Date): number {
  const months = monthsSinceCompletion(t, now);
  return months !== null && months >= D3_STALE_MONTHS ? 1 : 0;
}

function timingPhraseFor(t: TriggerResult, timing: TimingInfo, description: string, now: Date): string {
  if (timing.monthsToNearestFuture !== null) {
    if (timing.dateGranularity === "year") {
      // A bare-year maturity (e.g. "due 2026", no month ever disclosed)
      // must never show a computed month count — that number comes from
      // eventTiming.ts's Dec-31 windowDate convention, not the filing.
      return t.eventDate ? `matures ${t.eventDate}` : "future maturity (year known, month undisclosed)";
    }
    return `~${timing.monthsToNearestFuture}mo out`;
  }
  if (timing.isPendingLive) return "pending/live";
  // Session 17 Item 11: "standing" is internal taxonomy vocabulary, not
  // something an RM should have to parse — replaced with plain English.
  // "ongoing" (not "recurring"): an RM reads "ongoing" as a live, current
  // condition; "recurring" reads as a schedule, which a standing fact
  // usually isn't. Never blank — the never-blank rule this session's own
  // acceptance criteria re-affirms wins over the option to omit entirely.
  if (t.eventStatus === "standing") return "ongoing";
  if (t.eventStatus === "completed") {
    // Session 18 D3: a completed event keeps its line forever, but an OLD
    // one must say how old. "completed" alone reads as recent, and Cigna's
    // HCSC sale (March 2025) sat in Treasury indistinguishable from
    // something that closed last month. Age is stated only when it is known
    // and material (>= the D3 threshold); a recent completion stays plain
    // "completed" rather than gaining noise like "completed 2 months ago".
    const months = monthsSinceCompletion(t, now);
    if (months !== null && months >= D3_STALE_MONTHS) {
      const years = Math.floor(months / 12);
      const rem = months % 12;
      const age = years >= 1 ? (rem === 0 ? `${years}yr` : `${years}yr ${rem}mo`) : `${months}mo`;
      return `completed ${age} ago`;
    }
    return "completed";
  }
  if (t.eventStatus === "just_announced") {
    // Session 17 Item 12: real case — "On February 2, 2026, the Company
    // signed a definitive agreement... — announced Feb 2, 2026" states the
    // same date twice. Suppress the date suffix only when the line's own
    // description already states that exact date (checked structurally,
    // same date-matching rule the debt-maturity condenser uses) — a
    // just_announced fact whose description does NOT already carry the
    // date (e.g. a bare "announced") still needs it shown.
    if (!t.eventDate || !t.dateGranularity) return "announced";
    if (descriptionAlreadyStatesDate(description, t.eventDate, t.dateGranularity)) return "announced";
    return `announced ${formatAnnouncedDate(t.eventDate, t.dateGranularity)}`;
  }
  // Never reached in practice (eventStatus is exhaustive above at
  // "upcoming"/"just_announced"/"completed"/"standing" and "upcoming" with
  // no computable date already returned via monthsToNearestFuture/
  // isPendingLive being null/false above only when there's truly nothing to
  // say) — kept as a hard never-blank floor, not a silent "".
  return t.eventStatus;
}

/** Session 18 F1: a ladder row's own timing phrase — never blank, same never-blank floor as timingPhraseFor above, but with the row's OWN status folded in (unconfirmed is a distinct explanation, not just a missing date). */
function refiTimingPhrase(row: LadderRow, timing: TimingInfo): string {
  if (row.status === "unconfirmed") return "unconfirmed — dropped from newest filing, no redemption explaining it";
  if (row.status === "repaid") return "repaid — filing states a nil balance";
  if (row.status === "matured") {
    return row.retiredBy
      ? `matured ${row.maturityDate} — refinanced: ${row.retiredBy.evidence.slice(0, 90)}`
      : `matured ${row.maturityDate} — nothing in these filings states how it was repaid`;
  }
  if (timing.monthsToNearestFuture !== null) {
    if (timing.dateGranularity === "year") return `matures ${row.maturityDate}`;
    return `${timing.monthsToNearestFuture}mo out`;
  }
  return "date not verifiable";
}

/**
 * Session 18 F1: the refi bucket's own dedicated renderer, built from the
 * assembled position and the checksum, not from a per-trigger fact lookup —
 * see this file's own RefiLadderBlock doc comment for why "refi" can't be a
 * flat TableLine[] like the other three buckets. `retired` rows never get
 * their own line here (Part D2's rule: "renders only where it explains a
 * live one," i.e. as a card's KEY POINT — E1, sonnetEventBriefing.ts); an
 * `unconfirmed` row DOES render, with its status stated, because that's
 * exactly the point of the status (never suppressed, per the checksum's own
 * "never suppress" rule).
 */
function buildRefiLadder(result: CompanyResult, headlineRowIds: Set<string>, now: Date): RefiLadderBlock {
  const debtMaturity = result.results.find((t) => t.triggerId === "debt-maturity");
  const walkCheck = computeWalkChecksum(debtMaturity?.scheduleSequence);
  const balanceSheetCheck = computeBalanceSheetCheck(debtMaturity?.balanceSheetDebtCaptions, debtMaturity?.scheduleSequence);

  if (!debtMaturity || !debtMaturity.fired) {
    return {
      hasData: false,
      walkCheck,
      balanceSheetCheck,
      completenessStatement: "",
      nearestLines: [],
      tailSummary: null,
      sourceCitation: null,
      isAggregateDisclosure: false,
      adjustments: [],
      rowsNotVerifiedAsTranscribed: false,
      walkGapFraction: null,
    };
  }

  const position = assemblePosition(result, now);
  // A retired row never gets its own table line — it only explains a live one
  // via a card's KEY POINT. Everything else renders.
  //
  // Ordering, not filtering: repaid and matured rows are HISTORY, and sorting
  // them purely by maturity would put them at the top (their dates are the
  // earliest) and push the nearest live tranches out of the named list
  // entirely. They keep their place in the ladder, below the live rows.
  const historical = (r: LadderRow) => (r.status === "repaid" || r.status === "matured" ? 1 : 0);
  const displayRows = position.rows.filter((r) => r.status !== "retired").sort((a, b) => historical(a) - historical(b));
  const nearestRows = displayRows.slice(0, NAMED_TRANCHE_COUNT);
  const tailRows = displayRows.slice(NAMED_TRANCHE_COUNT);

  const nearestLines: RefiLadderLine[] = nearestRows.map((row) => {
    const { timing } = evaluateRowEligibility(row, now);
    return { row, timingPhrase: refiTimingPhrase(row, timing), cardEligible: headlineRowIds.has(row.id) };
  });

  let tailSummary: string | null = null;
  if (tailRows.length > 0) {
    const years = tailRows
      // maturityDate is nullable — a null row (real for an aggregate line)
      // contributes NaN here, same as any other unparseable date, and is
      // excluded by the filter below rather than crashing the Date()
      // constructor.
      .map((r) => (r.maturityDate === null ? NaN : r.dateGranularity === "year" ? Number(r.maturityDate) : new Date(r.maturityDate).getUTCFullYear()))
      .filter((y) => !Number.isNaN(y));
    const yearRange = years.length > 0 ? `, ${Math.min(...years) === Math.max(...years) ? Math.min(...years) : `${Math.min(...years)} to ${Math.max(...years)}`}` : "";
    tailSummary = `${tailRows.length} more tranche${tailRows.length === 1 ? "" : "s"}${yearRange}`;
  }

  const tranchCount = walkCheck.rowCount;

  // Session 18 (post-v9 redesign): structural, not company-specific — see
  // RefiLadderBlock.isAggregateDisclosure's doc comment. Checked against
  // the RAW extracted scheduleSequence's row-kind entries (the base
  // filing's own transcription), not the position-adjusted ladder (which
  // could add a real dated tranche via a later issuance even for an
  // otherwise-aggregate company).
  const rawRows = (debtMaturity.scheduleSequence ?? []).filter((e) => e.kind === "row");
  const isAggregateDisclosure = rawRows.length > 0 && rawRows.every((r) => r.dateGranularity !== "day" && r.dateGranularity !== "month");

  const sourceCitation: TriggerResult["citations"][number] | null = position.baseFiling
    ? { form: position.baseFiling.form, date: position.baseFiling.date, url: position.baseFiling.url }
    : (debtMaturity.citations[0] ?? null);
  const sourceCitationText = sourceCitation ? `${sourceCitation.form} ${sourceCitation.date}` : "the base filing";

  const finalSubtotalText = position.finalSubtotal ? `${position.finalSubtotal.label ?? "a total"} of ${position.finalSubtotal.amount}` : null;

  // Session 18 (post-v9 redesign): Check 1 and Check 2 are reported as two
  // distinct clauses, never blended into one tie rate — they fail
  // differently and each names its own failure.
  const check1Clause =
    walkCheck.subtotalChecks.length === 0
      ? "no subtotals to verify"
      : walkCheck.pass
        ? `internal walk ties — ${walkCheck.subtotalChecks.length} subtotal${walkCheck.subtotalChecks.length === 1 ? "" : "s"} reconcile ✓`
        : `internal walk does not tie — ${walkCheck.subtotalChecks
            .filter((c) => !c.tie)
            .map((c) => `"${c.label ?? "(unlabeled)"}" off by $${Math.abs(c.gap).toLocaleString("en-US")}`)
            .join("; ")}`;
  // The nearestGap === null branch is NOT cosmetic: null means there was
  // nothing to compare against at all (no subtotal in the sequence), and
  // the old `?? 0` fallback rendered that as "$0 unaccounted" — which reads
  // as a clean tie, the exact opposite of the truth. Seen live on UHS,
  // whose 10-Q carries no debt-balance table and therefore no subtotal.
  const check2Clause =
    balanceSheetCheck.captionCount === 0
      ? "no balance-sheet captions extracted"
      : balanceSheetCheck.pass
        ? `balance-sheet anchor ties (matches "${balanceSheetCheck.matchedSubtotalLabel ?? "an unlabeled total"}") ✓`
        : balanceSheetCheck.nearestGap === null
          ? "balance-sheet anchor cannot be checked — the note states no subtotal to anchor against"
          : `balance-sheet anchor does not tie — $${Math.abs(balanceSheetCheck.nearestGap).toLocaleString("en-US")} unaccounted vs. nearest subtotal`;

  // A3 — when the walk misses by a material share of the stated total, the
  // block leads with what CANNOT be claimed. The note, its filing and its
  // stated total are all still stated: the fact that this company has a debt
  // ladder is never suppressed, only the claim that these particular rows
  // are it.
  const gapPct = position.walkGapFraction === null ? null : Math.round(position.walkGapFraction * 100);
  // C3 — a note that WAS located and transcribed, with the wrong column read.
  // Distinct from an absent schedule, and it must say so: an empty ladder
  // otherwise reads as "this company discloses no tranche detail", which is
  // the opposite of the truth. The search-order fallback deliberately does
  // not run here (lib/agent/loop.ts), so there is no older ladder standing in
  // front of this statement.
  const columnReadFailure = debtMaturity.columnReadFailure;
  const completenessStatement = columnReadFailure
    ? `NOTE FOUND BUT READ WRONG — the debt note in ${sourceCitationText} was located and transcribed, but every row carried a period column other than that filing's own period of report, so none could be trusted. This is a misread, not an absent disclosure; an older filing's ladder is deliberately NOT substituted. Read the filing.`
    : position.rowsNotVerifiedAsTranscribed
    ? `TRANSCRIPTION NOT VERIFIED — the note states ${finalSubtotalText ?? "a total"}, but the rows below sum ${gapPct}% short of it. The rows are shown as extracted and are NOT this company's position; read the filing. (${check1Clause}; ${check2Clause})`
    : isAggregateDisclosure
      ? `aggregate disclosure — ${tranchCount} line${tranchCount === 1 ? "" : "s"} reported as category total${tranchCount === 1 ? "" : "s"}, no individual tranche maturities stated in this filing (${check1Clause}; ${check2Clause})`
      : `${tranchCount} tranche${tranchCount === 1 ? "" : "s"} — ${check1Clause}; ${check2Clause}`;

  // Session 18 (post-v6): prefer the deterministically-selected base filing
  // (position.baseFiling — exactly what lib/fetch/debtNoteLocator.ts found
  // and what the model was explicitly told to use) over citations[0], which
  // is just whichever citation the model happened to list first and isn't
  // guaranteed to be the actual debtSchedule source filing.


  // Session 18 (post-v11) — prior-period CONTEXT, never a substitution. Only
  // when the base ladder failed BOTH checks does the older filing's schedule
  // get surfaced at all, and even then it sits beneath the base ladder's own

  return { hasData: true, walkCheck, balanceSheetCheck, completenessStatement, nearestLines, tailSummary, sourceCitation, isAggregateDisclosure, adjustments: position.adjustments, rowsNotVerifiedAsTranscribed: position.rowsNotVerifiedAsTranscribed, walkGapFraction: position.walkGapFraction };
}

/**
 * Builds one company's table block. `cardsForCompany` is this company's
 * slice of the SAME flashCardCandidates list the cards section renders
 * from (filter by `.cik`) — it decides both cardCount and which specific
 * trigger lines get the "card above" marker; this function never decides
 * eligibility itself, only groups/labels/formats what the gate already
 * decided (evaluateEligibility is called read-only, purely for each
 * trigger's own TimingInfo — eligibility.ts itself is untouched).
 */
export function buildCompanyTableBlock(result: CompanyResult, cardsForCompany: FlashCard[], now: Date = new Date()): CompanyTableBlock {
  const factBase = buildVerifiedFactBase(result);
  const factByTrigger = new Map(factBase.map((f) => [f.linkedTriggerId, f]));
  const headlineTriggerIds = new Set(cardsForCompany.map((c) => c.headlineTrigger.triggerId));
  const headlineRowIds = new Set(cardsForCompany.flatMap((c) => (c.headlineRowId ? [c.headlineRowId] : [])));

  const buckets: BucketLines = { treasury: [], new_debt: [], refi: [], hedging: [] };

  // Session 18: "debt-maturity" is excluded here — its own dedicated
  // ladder block (buildRefiLadder, below) replaces both this loop's old
  // per-trigger rendering AND the same-citation refi/new-debt dedup that
  // used to live here (Session 16 Fix A1). Both are dead code the position
  // layer makes unnecessary: a newly issued tranche is just another row on
  // the ladder now, so it can no longer double-render in the first place.
  for (const t of result.results) {
    if (t.triggerId === "debt-maturity") continue;
    const fact = factByTrigger.get(t.triggerId);
    if (!fact) continue; // not quote-verified — never described, never implied (same GATED FACTS ONLY rule cards use)
    const bucket = bucketForTrigger(t.triggerId);
    if (!bucket) continue; // distress/covenant-breach — a relationship flag, never a bucket line

    const { timing } = evaluateEligibility(t, now);
    const cardEligible = headlineTriggerIds.has(t.triggerId);
    const description = condenseEvidenceDescription(fact);

    buckets[bucket].push({
      triggerId: t.triggerId,
      description,
      timingPhrase: timingPhraseFor(t, timing, description, now),
      citations: t.citations,
      cardEligible,
      isHedgingFlag: bucket === "hedging" && !cardEligible,
      d3Rank: d3SortRank(t, now),
      d3AgeMonths: monthsSinceCompletion(t, now) ?? 0,
    });
  }

  // Session 18 D3: stale completions sink to the bottom of their own bucket.
  // Array.prototype.sort is stable, so every other line keeps the order it
  // already had — this REORDERS, it never removes.
  for (const key of Object.keys(buckets) as Bucket[]) {
    // Rank first (stale sinks), then OLDER sinks further within the stale
    // group — with two stale completions, "sorts to the bottom" has to mean
    // the oldest is genuinely last, not merely below the fresh lines.
    buckets[key].sort((x, y) => x.d3Rank - y.d3Rank || (x.d3Rank === 1 ? x.d3AgeMonths - y.d3AgeMonths : 0));
  }

  const refiLadder = buildRefiLadder(result, headlineRowIds, now);

  const cardCount = cardsForCompany.length;
  const triggersRun = result.results.length;
  const triggersNoSignalCount = triggersRun - result.results.filter((r) => r.fired).length;

  const headerLine = cardCount > 0 ? `${cardCount} card${cardCount === 1 ? "" : "s"} this week` : "no action this week";
  const emptyStateLine =
    cardCount === 0
      ? `No actionable events this week — 4 buckets checked, ${triggersRun} triggers run, ${triggersNoSignalCount} found no signal.`
      : null;

  return {
    company: result.company,
    cik: result.cik,
    ticker: result.ticker,
    cardCount,
    headerLine,
    emptyStateLine,
    buckets,
    refiLadder,
    // Session 16 Fix A3: was rendering the DISTRESS TRIGGER'S OWN generic
    // definition (t.triggerName, e.g. "Covenant breach / waiver, or
    // going-concern / liquidity warning") whenever one fired, instead of
    // what actually happened — confirmed live for Molina, whose covenant
    // amendment is a real, verified fact with its own evidence sentence.
    // Renders that evidence (condensed the same way every other line is)
    // when a verified fact backs the flag; a fired-but-unverified distress
    // trigger (quote failed verification) is dropped rather than shown with
    // no backing text, same GATED FACTS ONLY rule the rest of the table
    // follows.
    relationshipFlags: result.relationshipFlags
      .map((t) => factByTrigger.get(t.triggerId))
      .filter((f): f is VerifiedFact => f !== undefined)
      .map((f) => condenseEvidenceDescription(f)),
    triggersRun,
    triggersNoSignalCount,
  };
}

/** Part C, book level: shown in place of the flash-card section when NO company in the whole book produced a single card. */
export function buildBookEmptyStateLine(blocks: CompanyTableBlock[]): string {
  const companyCount = blocks.length;
  const totalTriggersRun = blocks.reduce((sum, b) => sum + b.triggersRun, 0);
  const totalNoSignal = blocks.reduce((sum, b) => sum + b.triggersNoSignalCount, 0);
  return `No actionable events this week — ${companyCount} compan${companyCount === 1 ? "y" : "ies"} assessed, 4 buckets checked each, ${totalTriggersRun} triggers run, ${totalNoSignal} found no signal.`;
}
