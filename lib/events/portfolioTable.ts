import { computeCoverage, checkRevolverArithmetic, type CoverageResult } from "./coverage";
import type { CompanyResult, TriggerResult, VerifiedSequenceEntry } from "../agent";
import type { DebtScheduleFilingRef, DateGranularity } from "../agent/claude";
import type { FlashCard } from "./buildEvents";
import { bucketForTrigger, type Bucket } from "./buckets";
import { evaluateEligibility, evaluateRowEligibility, statusFromProjectCompletion } from "./eligibility";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { condenseEvidenceDescription, formatAnnouncedDate, dateTokenMatchesEventDate, truncateRenderedLine } from "./evidenceCondense";
import { formatMoneyForDisplay, formatMoneyValue, normalizeMoneyInText } from "./money";
import { citationDateGaps, sameFactForDisplay } from "./numberGuard";
import { normalizeForMatch } from "../agent/verifyQuote";
import { extractFactTokens } from "../agent/factTokens";
import { BUCKET_LABELS } from "./buckets";
import { shortTriggerLabel } from "./labels";
import { assemblePosition, computeWalkChecksum, computeBalanceSheetCheck, movementKindOf, parseMoneyAmount, rowIdentifiesOneTranche, scheduleIsAggregateDisclosure, type LadderRow, type SubtotalCheck, normalizeScheduleSequence } from "./position";
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
  /**
   * E9 (Session 18, post-stage-2) — set when this line's FACT is already
   * rendered in another bucket, and this line is the cross-reference rather
   * than a second copy. Null on a line that owns its fact.
   */
  crossReferenceTo: Bucket | null;
  /** E9 — the fact's own identity, used only to detect the same fact rendering under two triggers. Empty when the fact has no verified text to key on. */
  factKey: string;
  /** Session 18 D3 sort rank: 1 for a completed event older than 12 months (sinks to the bucket's bottom), 0 otherwise. Reordering only — a stale line is never removed. */
  d3Rank: number;
  /** Age in months of a completed event, 0 when not applicable — the secondary sort within the stale group, so the oldest line is genuinely last. */
  d3AgeMonths: number;
  /**
   * Item 1 (stage-2 review) — set when this line states a date later than
   * every filing it cites was filed, which is a thing no filing can do. The
   * line still renders; this states what is wrong with it.
   *
   * Two real instances in the current book, both the same shape: the
   * extraction's `evidence` paraphrase carries a period its own VERIFIED
   * QUOTE contradicts. One trigger's quote reads "As of March 31, 2026, we
   * had approximately $373 million of borrowings outstanding" — verified,
   * correctly cited to the 10-Q that reports the March quarter — while the
   * evidence sentence rendered beside it says "As of June 30, 2026". The
   * quote goes through lib/agent/verifyQuote.ts; the paraphrase never did,
   * and the paraphrase is what the table renders.
   */
  periodGapNote: string | null;
  /**
   * ITEM 9 (stage-2 review) — set when every figure and date this line
   * states is already stated by ANOTHER line in the SAME bucket, which
   * makes it a restatement rather than a second fact.
   *
   * E9 deduped ACROSS buckets, on fact identity, and one bucket carried the
   * same figure twice: a filer's UK revenue of $1.001 billion in 2025 as its
   * own line, and again inside a foreign-currency exposure line that
   * restates it. Two different triggers, two different verified quotes, so
   * two different factKeys — E9 could not see them as the same thing,
   * because on its own terms they are not. What repeats is the FIGURE.
   *
   * Set on the line with LESS to say, so the fuller statement survives. The
   * line still renders: the restated figure is a real disclosure under that
   * trigger, and the marker says where the reader already saw it rather
   * than removing the line that carries the exposure.
   */
  restatesFiguresOf: string | null;
  /**
   * Item 10 (stage-2 review) — THE WHOLE LINE, composed once and truncated
   * once, at the end.
   *
   * The renderer used to build this by concatenating the cross-reference and
   * the timing phrase onto `description`, which had ALREADY been cut to the
   * 400-char sentence-boundary cap. Anything appended after the cut therefore
   * rendered past it: "…also relevant here; shown under Refi (debt maturity)"
   * arrived truncated mid-clause, and E8's careful sentence-boundary rule had
   * no say over the part that was actually cut.
   *
   * Every rendered string goes through one truncation rule, and that rule
   * runs last. `description` stays as the fact's own condensed text (the
   * cross-reference and timing are presentation, and other consumers read it
   * without them); `text` is what renders.
   */
  text: string;
}

export type BucketLines = Record<Bucket, TableLine[]>;

/** One line in the refi ladder — either individually named (a nearest tranche) or folded into the tail summary, per buildRefiLadder below. */
/**
 * E13 — "from $X (10-Q 2026-04-22)" where a prior balance exists, or "" where
 * it does not. States the movement and stops: falling is deleveraging, rising
 * is a draw, and which one it is is the RM's read, not this function's.
 */
/**
 * E9 — a fact's identity for dedup purposes: its own verified text,
 * whitespace-normalised. Deliberately the VERIFIED text and not the rendered
 * description: two triggers that condense the same source sentence differently
 * are still the same fact, and the description is what the condenser chose to
 * show, not what the filing said.
 */
function factIdentityKey(fact: VerifiedFact): string {
  return (fact.verifiedText ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Item 3 (stage-2 review) — a movement is stated as what the note can
 * support, never as more than that. See position.ts's movementKindOf for the
 * measured basis of the threshold.
 *
 * An immaterial movement is NOT suppressed: it renders with its own size and
 * says why it cannot be read as a repayment. Hiding it would be the third
 * option this project does not take, and an RM who opens the filing should
 * find the tool already told them what is there.
 */
function movementPhraseFor(row: LadderRow): string {
  if (!row.priorBalance) return "";
  const now = parseMoneyAmount(row.amount);
  const before = parseMoneyAmount(row.priorBalance.amount);
  const source = row.priorBalance.filing ? ` (${row.priorBalance.filing.form} ${row.priorBalance.filing.date})` : "";
  const priorText = formatMoneyForDisplay(row.priorBalance.amount);
  if (now === null || before === null) return `unchanged from ${priorText}${source}`;

  const kind = movementKindOf(now, before);
  if (kind === "unchanged") return `unchanged from ${priorText}${source}`;

  const delta = now - before;
  const direction = delta < 0 ? "down" : "up";
  const pct = before === 0 ? null : Math.abs(delta / before) * 100;
  const pctText = pct === null ? "" : ` (${pct < 0.1 ? "<0.1" : pct.toFixed(1)}%)`;

  if (kind === "material") return `${direction} ${formatMoneyValue(Math.abs(delta))}${pctText} from ${priorText}${source}`;
  return `${direction} ${formatMoneyValue(Math.abs(delta))}${pctText} from ${priorText}${source} — too small to read as a repayment; a move this size is what unamortized discount does as it accretes`;
}

export interface RefiLadderLine {
  row: LadderRow;
  /**
   * True when the instrument's own name already states its rate, so the
   * renderer must not print the rate field as well. Computed here rather
   * than in the renderer because it needs the SAME fraction-glyph
   * equivalence the verifier uses: one filer's rate field reads "6.875%"
   * while its note's own row label reads "6 7/8%", and a plain string
   * comparison prints "$42M 6.875% 6 7/8% Senior Notes due 2028".
   */
  rateStatedInName: boolean;
  /**
   * The instrument's ORIGINAL ISSUE SIZE where its name leads with one, as
   * some filers name a tranche by what was issued rather than what is
   * outstanding. Rendering the name verbatim beside the balance printed two
   * amounts with no way to tell them apart — "$1.1B $ 2,500 million 4.25 %
   * Senior Notes". Null when the name states no size, which is most filers.
   */
  issueSizeInName: string | null;
  /** The instrument name with any leading issue size removed — what actually renders. */
  instrumentName: string;
  /** "6mo out", "matures 2026" (never a computed month count for a year-granularity row), or the unconfirmed/date-unverifiable explanation — never blank. */
  timingPhrase: string;
  /** True when this row's own card is one of this company's actual rendered cards above. */
  cardEligible: boolean;
  /** E13 — how this tranche's balance moved since the prior filing, or "" when the corpus carries no prior balance for it. */
  movementPhrase: string;
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
  /** Item 7 — the note's own reconciliation, in its own order. Empty when the note has no sequence to walk. */
  walkLines: WalkLine[];
  /** Item 6 — 8-K tranches withheld from an aggregate ladder, stated beneath it rather than laddered inside a category total that already contains them. */
  issuancesInsideAggregate: LadderRow[];
  /** The base filing this ladder's rows trace to, for the trailing source link — the SAME filing lib/fetch/noteLocation.ts determined and the model was told to use (position.baseFiling), not just whichever citation happened to be listed first. */
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
  /** Session 20, 3d — coverage AT THE ANCHOR. Never blended with post-anchor layers. */
  coverage: CoverageResult;
  /** Session 20, 3b — the revolver's arithmetic check, rendered as its own flag. */
  revolverCheck: { checked: boolean; ok: boolean; note: string };
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
/**
 * E12 — true when the line's own text states a date strictly LATER than
 * `eventDate`. Reuses the same token extraction as
 * descriptionAlreadyStatesDate; a token that cannot be resolved to a real
 * calendar date is skipped rather than guessed at.
 */
function descriptionStatesDateLaterThan(description: string, eventDate: string): boolean {
  const anchor = Date.parse(eventDate.length === 4 ? `${eventDate}-12-31` : eventDate);
  if (Number.isNaN(anchor)) return false;
  return extractFactTokens(description)
    .filter((tok) => tok.kind === "date" && tok.dateValue !== undefined)
    .some((tok) => {
      const d = tok.dateValue!;
      if (d.month === undefined || d.month === null) return false; // a bare year is too coarse to call a contradiction
      const t = Date.UTC(d.year, d.month - 1, d.day ?? 28);
      return t > anchor;
    });
}

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

/** Session 19: the date math, shared with instanceTimingPhrase — an instance ages the same way a trigger does, and two copies is how they drift. */
function monthsSinceDate(date: string | null, now: Date): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 6;
  const months = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
  return months >= 0 ? months : null;
}

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


/** A stated completion date, printed at the granularity the filing gave it — never a month the filing did not state. */
function formatCompletionDate(date: string, granularity: DateGranularity | null): string {
  if (granularity === "year" || /^\d{4}$/.test(date)) return date.slice(0, 4);
  const [y, m, d] = date.split("-");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = m ? MONTHS[Number(m) - 1] : undefined;
  if (!monthName) return date;
  return granularity === "day" && d ? `${monthName} ${Number(d)}, ${y}` : `${monthName} ${y}`;
}


/**
 * The timing phrase for ONE instance of a multi-instance trigger. It reads
 * the instance's own status and date, never the trigger's — the whole point
 * of separate lines is that each states its own facts. Deliberately simpler
 * than timingPhraseFor: an instance carries no maturity window, so there is
 * no month-count convention to get wrong.
 */
function instanceTimingPhrase(
  inst: { description: string; eventStatus: string | null; eventDate: string | null; dateGranularity: DateGranularity | null },
  t: TriggerResult,
  now: Date
): string {
  // 2c REACHES THE INSTANCE PATH TOO, BUT ONLY THE INSTANCE IT BELONGS TO.
  //
  // The completion date is a TRIGGER-level field and a multi-instance
  // trigger has several projects under it: Quest's capex-program carries
  // Project Nova (completion 2032) alongside an undated automation
  // programme. Applying the trigger's date to every instance is precisely
  // the conflation that put UHS's Plaza date on the Medical Center's name,
  // so it is attributed by the trigger's own projectName and to nothing
  // else. An instance the date does not name keeps its own status.
  if (t.projectCompletionDate && t.projectName && inst.description.includes(t.projectName)) {
    const derived = statusFromProjectCompletion(t.projectCompletionDate, t.projectCompletionGranularity, now);
    if (derived === "upcoming") return `completion stated ${formatCompletionDate(t.projectCompletionDate, t.projectCompletionGranularity)}`;
    if (derived === "completed") return "completed";
  }
  if (inst.eventStatus === "completed") {
    const months = monthsSinceDate(inst.eventDate, now);
    if (months !== null && months >= D3_STALE_MONTHS) {
      const years = Math.floor(months / 12);
      const rem = months % 12;
      const age = years >= 1 ? (rem === 0 ? `${years}yr` : `${years}yr ${rem}mo`) : `${months}mo`;
      return `completed ${age} ago`;
    }
    return "completed";
  }
  if (inst.eventStatus === "just_announced") return "announced";
  if (inst.eventStatus === "upcoming") return "upcoming";
  return "ongoing";
}

function timingPhraseFor(t: TriggerResult, timing: TimingInfo, description: string, now: Date): string {
  // SESSION 19, ITEM 2C — THE STATUS WORD COMES FROM THE DERIVATION, NOT
  // FROM THE MODEL'S OWN eventStatus.
  //
  // 2c derived a dated project's status in code and wired it to the GATE
  // only, so the rule was enforced on the eligibility path and violated on
  // the render path in the same run, for the same fact: Quest's Project
  // Nova, completion stated 2032, printed "ongoing" while the gate had
  // already decided it was upcoming. `eventStatus` is exactly the field the
  // rule exists to distrust, so the render must not be the one place that
  // still believes it.
  //
  // The phrase states the filing's own completion date rather than a bare
  // "upcoming" — the date is the fact; "upcoming" is a category.
  const derivedProjectStatus = statusFromProjectCompletion(t.projectCompletionDate, t.projectCompletionGranularity, now);
  if (derivedProjectStatus === "upcoming" && t.projectCompletionDate) {
    return `completion stated ${formatCompletionDate(t.projectCompletionDate, t.projectCompletionGranularity)}`;
  }
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
  // A dated project is never standing (2c). If the derivation says the date
  // has passed, the completed branch below owns it — never "ongoing".
  if (t.eventStatus === "standing" && derivedProjectStatus !== "completed") return "ongoing";
  if (t.eventStatus === "completed" || derivedProjectStatus === "completed") {
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
    // E12 — THE STATUS DATE AND THE LINE'S OWN DATE MUST COME FROM THE SAME
    // FACT, OR THE STATUS IS OMITTED.
    //
    // Real case: a held-for-sale balance stated as of June 30, 2026 rendered
    // "announced Dec 2025". Both dates are real and neither is wrong on its
    // own — the balance is a period-end figure, the announcement is when the
    // classification happened — but printed together on one line they read as
    // one fact that contradicts itself, and the reader cannot tell which date
    // the figure belongs to.
    //
    // A line whose description states a date LATER than the announcement is
    // describing a different moment than the announcement does, so the bare
    // status is used instead of a date that would attach itself to the wrong
    // figure. Structural: it compares the dates the line already carries, and
    // needs no knowledge of what kind of fact it is.
    if (descriptionStatesDateLaterThan(description, t.eventDate)) return "announced";
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
  // E12 (Session 18, post-stage-2) — THE TIMING MUST NOT CONTRADICT THE ROW.
  //
  // "date not verifiable" was returned for every row the window arithmetic
  // could not place, including rows that state a perfectly good date the
  // arithmetic simply put in the past. Cigna's 1.250% notes rendered
  // "maturity 2026-03-01" and "date not verifiable" on the same line, which
  // are not both true. D3 now catches that specific row as matured; this is
  // the general rule behind it — the phrase may only deny a date when the row
  // genuinely has none.
  if (row.maturityDate) return `stated maturity ${row.maturityDate}, outside the card window`;
  return "no maturity date stated in this filing";
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
/**
 * Item 1 (stage-2 review) — see TableLine.periodGapNote. Never suppresses:
 * the line renders, with the discrepancy stated beside it.
 */
function periodGapNoteFor(description: string, citations: TriggerResult["citations"], now: Date): string | null {
  const gaps = citationDateGaps(description, citations, now.toISOString().slice(0, 10));
  if (gaps.length === 0) return null;
  // One note per line, naming the earliest offending date — several
  // mentions of the same impossible period are one problem.
  const earliest = gaps.map((g) => g.stated)[0];
  return `states ${earliest}, but cites nothing filed on or after it (newest: ${gaps[0].newestCitation}) — check the filing before using this date`;
}

/**
 * Item 10 — the one place a rendered table line is assembled, and the one
 * place it is cut. See TableLine.text.
 */
export function composeTableLineText(line: TableLine): string {
  const parts = [line.description];
  if (line.timingPhrase) parts.push(line.timingPhrase);
  if (line.crossReferenceTo) parts.push(`also relevant here; shown under ${BUCKET_LABELS[line.crossReferenceTo]}`);
  if (line.restatesFiguresOf) parts.push(`restates the figures already shown on the ${line.restatesFiguresOf} line`);
  if (line.periodGapNote) parts.push(line.periodGapNote);
  return truncateRenderedLine(parts.join(" — "));
}

/**
 * ITEM 7 (stage-2 review) — RENDER THE WALK, NOT A LIST OF ADJUSTMENTS.
 *
 * Adjustments rendered as bare label-and-number — "($66.5M) Discount,
 * premium and deferred financing costs · ($117.2M) Less current portion" —
 * gave an RM no way to see what they adjust or what they reconcile to. The
 * reconciliation was implied, and showing it is the entire reason those
 * lines are on screen.
 *
 * So the note's own sequence renders in its own order: the rows sum, each
 * adjustment applies, each subtotal states whether it lands. That makes the
 * measure visible without asserting it — where a discount deduction sits
 * between the row sum and the total, the reader can see for themselves that
 * the rows are principal and the total is carrying value (see position.ts's
 * MATERIAL_MOVEMENT_FRACTION for why the measure is shown rather than
 * labelled).
 */
export interface WalkLine {
  label: string;
  amount: string;
  kind: "rows" | "adjustment" | "subtotal";
  /** Subtotals only: whether the running sum landed on the stated figure. */
  tie: boolean | null;
}

function buildWalkLines(sequence: VerifiedSequenceEntry[] | null | undefined, checks: SubtotalCheck[]): WalkLine[] {
  const seq = sequence ?? [];
  if (seq.length === 0) return [];
  const lines: WalkLine[] = [];
  let pendingRows = 0;
  let pendingRowCount = 0;
  let checkIdx = 0;

  const flushRows = () => {
    if (pendingRowCount === 0) return;
    lines.push({
      // "rows in the note", never "tranches" — the note's own row count and
      // the LADDER's count are different sets on purpose (the ladder drops
      // redeemed rows and can add post-period issuances), and item 4's whole
      // point is that two counts on one screen must not look like the same
      // number disagreeing with itself.
      label: `${pendingRowCount} row${pendingRowCount === 1 ? "" : "s"} in the note sum to`,
      amount: formatMoneyValue(pendingRows),
      kind: "rows",
      tie: null,
    });
    pendingRows = 0;
    pendingRowCount = 0;
  };

  for (const entry of seq) {
    const value = parseMoneyAmount(entry.amount);
    if (entry.kind === "row") {
      if (value !== null) { pendingRows += value; pendingRowCount++; }
      continue;
    }
    if (entry.kind === "adjustment") {
      flushRows();
      lines.push({ label: entry.label ?? "(unlabeled adjustment)", amount: formatMoneyForDisplay(entry.amount), kind: "adjustment", tie: null });
      continue;
    }
    flushRows();
    const check = checks[checkIdx++];
    lines.push({ label: entry.label ?? "(unlabeled total)", amount: formatMoneyForDisplay(entry.amount), kind: "subtotal", tie: check ? check.tie : null });
  }
  flushRows();
  return lines;
}

/**
 * Fraction-glyph-aware comparison of a row's rate field against its own
 * instrument name — see RefiLadderLine.rateStatedInName. Reuses the
 * verifier's normalizer so the two can never disagree about whether
 * "6 7/8%" and "6.875%" are the same rate.
 */
function rateAppearsInName(rate: string | null, instrument: string): boolean {
  if (rate === null || rate.trim() === "") return false;
  const squash = (t: string) => normalizeForMatch(t).replace(/\s+/g, "");
  return squash(instrument).includes(squash(rate));
}

/** See RefiLadderLine.issueSizeInName. Moved to lib/agent/issueSize.ts in Session 19 — extraction needs the same rule, and two copies is how they drift apart. */
import { splitIssueSizeFromName } from "../agent/issueSize";

function buildRefiLadder(result: CompanyResult, headlineRowIds: Set<string>, now: Date): RefiLadderBlock {
  const debtMaturity = result.results.find((t) => t.triggerId === "debt-maturity");
  // Session 19: normalized ONCE, here, and used by every read below. The
  // checks already normalize internally, so leaving the RENDER on the raw
  // sequence made the two disagree in public: Centene's subtotals reconciled
  // while the drawer above them still read "9 rows in the note sum to
  // $30.4B" against a stated $16.0B. A guard that ties over a line that says
  // it does not is worse than either alone.
  const normalizedSequence = normalizeScheduleSequence(debtMaturity?.scheduleSequence);
  const walkCheck = computeWalkChecksum(normalizedSequence);
  const balanceSheetCheck = computeBalanceSheetCheck(debtMaturity?.balanceSheetDebtCaptions, normalizedSequence);

  if (!debtMaturity || !debtMaturity.fired) {
    return {
      hasData: false,
      walkCheck,
      balanceSheetCheck,
      completenessStatement: "",
      nearestLines: [],
      tailSummary: null,
      walkLines: [],
      coverage: computeCoverage(debtMaturity),
      revolverCheck: checkRevolverArithmetic(debtMaturity?.revolver),
      issuancesInsideAggregate: [],
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
    const split = splitIssueSizeFromName(row.instrument);
    // Only worth stating when it DIFFERS from the balance — that difference
    // is the fact (a partially repurchased tranche), and "issued at $1.5B"
    // beside a $1.5B balance is the same number twice. E4 makes the same
    // distinction on the card side.
    // Compared as they will RENDER, not as raw values. One filer's tranche
    // is named "$ 1,500 million" and carries $1,481 million — a real $19M
    // difference that the display rule rounds to "$1.5B" on both sides. The
    // difference is true and this line cannot show it, and printing "issued
    // at $1.5B" next to a $1.5B balance asserts a distinction the reader
    // cannot see. Where the two render the same, the line says one number.
    const issueSizeShown = split.issueSize === null ? null : formatMoneyForDisplay(split.issueSize);
    const issueSize = issueSizeShown !== null && issueSizeShown !== formatMoneyForDisplay(row.amount) ? split.issueSize : null;
    const name = split.name;
    return {
      row,
      timingPhrase: refiTimingPhrase(row, timing),
      cardEligible: headlineRowIds.has(row.id),
      movementPhrase: movementPhraseFor(row),
      rateStatedInName: rateAppearsInName(row.rate, row.instrument),
      issueSizeInName: issueSize,
      instrumentName: name,
    };
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
    // ITEM 6 (stage-2 review) — a category rollup is not a bond, and a
    // seventy-year range is not a maturity. "4 more tranches, 2095" described
    // four category totals ("Senior unsecured notes payable through 2095")
    // as four bonds all maturing in one far-future year, which is not a real
    // instrument and reads as an extraction error to anyone who knows debt.
    // The tail names what the rows ARE, and only states a year range for
    // rows that carry a maturity of their own.
    const tailIdentified = tailRows.filter(rowIdentifiesOneTranche).length;
    const tailCategories = tailRows.length - tailIdentified;
    const noun =
      tailCategories === 0
        ? `more tranche${tailRows.length === 1 ? "" : "s"}`
        : tailIdentified === 0
          ? `more line${tailRows.length === 1 ? "" : "s"} reported as ${tailRows.length === 1 ? "a category total" : "category totals"}`
          : `more (${tailIdentified} tranche${tailIdentified === 1 ? "" : "s"}, ${tailCategories} category total${tailCategories === 1 ? "" : "s"})`;
    const datedYears = tailRows.filter(rowIdentifiesOneTranche).length > 0 ? years : [];
    const yearRange = datedYears.length > 0 ? `, ${Math.min(...datedYears) === Math.max(...datedYears) ? Math.min(...datedYears) : `${Math.min(...datedYears)} to ${Math.max(...datedYears)}`}` : "";
    tailSummary = `${tailRows.length} ${noun}${yearRange}`;
  }

  // ITEM 4 (stage-2 review) — THE HEADER COUNTS WHAT RENDERS BENEATH IT.
  //
  // The count came from walkCheck.rowCount, which is the RAW base sequence's
  // row count — a different set from the rows on screen, which are the
  // position-adjusted ladder (8-K issuances added, redeemed rows removed,
  // repaid and matured rows kept). On four of ten companies the header's N
  // and the "3 shown + M more" beneath it did not add up, because they were
  // counting two different things.
  //
  // One set. The header, the named rows and the tail are all displayRows, so
  // 3 + M = N holds by construction rather than by coincidence.
  const tranchCount = displayRows.length;
  const liveCount = displayRows.filter((r) => r.status === "live").length;
  const statusNote = (() => {
    const counts = new Map<string, number>();
    for (const r of displayRows) if (r.status !== "live") counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (counts.size === 0) return "";
    const parts = [...counts.entries()].map(([st, n]) => `${n} ${st}`);
    return `, of which ${liveCount} live and ${parts.join(", ")}`;
  })();

  // Session 18 (post-v9 redesign): structural, not company-specific — see
  // RefiLadderBlock.isAggregateDisclosure's doc comment. Checked against
  // the RAW extracted scheduleSequence's row-kind entries (the base
  // filing's own transcription), not the position-adjusted ladder (which
  // could add a real dated tranche via a later issuance even for an
  // otherwise-aggregate company).
  // E3 (Session 18, post-stage-2) — THE LABEL WAS DERIVED FROM THE WRONG
  // SIGNAL.
  //
  // "aggregate disclosure — no individual tranche maturities stated in this
  // filing" was inferred from DATE PRECISION, so it rendered directly above
  // tables of individually identified tranches on every company whose filing
  // simply prints "due 2031" rather than "due March 15, 2031". Tenet,
  // Encompass, CHS and UHS all carry rate-identified per-tranche ladders and
  // all four were labelled aggregate.
  //
  // Whether the filing prints a month is a fact about its typography.
  // Whether a row identifies ONE instrument — a named instrument carrying its
  // own rate — is a fact about the disclosure, and that is what the label is
  // trying to say.
  //
  // A rate ALONE is not per-tranche identity, and HCA is why. Its note prints
  // four rows — "Commercial paper", "Other debt", "Senior unsecured credit
  // facility", "Senior unsecured notes payable through 2095" — and every one
  // carries a rate, because a category rollup states its WEIGHTED-AVERAGE
  // rate. Three of the four carry no maturity at all and the fourth is a
  // seventy-year range. HCA is the one genuinely aggregate filer in this
  // book, and a bare rate test would relabel it a four-tranche ladder.
  //
  // A single instrument has both a rate and a maturity of its own. Measured
  // across the book, rows carrying both: HCA 1 of 4; Encompass 4 of 7; Tenet
  // 10 of 11; DaVita 9 of 9; Centene 7 of 8; Quest 12 of 13; Cigna 33 of 36;
  // CHS 2 of 2; Molina 5 of 5. "Most rows" separates HCA from the rest with
  // real margin (25% against a next-lowest 57%) and needs no tuned constant.
  const isAggregateDisclosure = scheduleIsAggregateDisclosure(normalizedSequence);

  const identifiedCount = displayRows.filter(rowIdentifiesOneTranche).length;
  const categoryTotalCount = tranchCount - identifiedCount;

  const sourceCitation: TriggerResult["citations"][number] | null = position.baseFiling
    ? { form: position.baseFiling.form, date: position.baseFiling.date, reportDate: position.baseFiling.reportDate, url: position.baseFiling.url }
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
            .map((c) => `"${c.label ?? "(unlabeled)"}" off by ${formatMoneyValue(Math.abs(c.gap))}`)
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
          : `balance-sheet anchor does not tie — ${formatMoneyValue(Math.abs(balanceSheetCheck.nearestGap))} unaccounted; balance-sheet captions [${balanceSheetCheck.captionCategories.join(", ") || "none"}] against note subtotals [${balanceSheetCheck.subtotalCategories.join(", ") || "none"}]`;

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
  // SESSION 20, STAGE 4 — A NOTE WITH NO TABLE IS NOT A NOTE READ WRONG.
  //
  // This statement was written when the ladder could only come from a table,
  // so an empty schedule meant something had gone wrong. It no longer does:
  // a note may state its whole capital structure in bullets and sentences,
  // and UHS is the case — its schedule is empty, its nine prose instruments
  // cover 98% of stated total debt, and the page led with "READ WRONG ...
  // Read the filing" directly above them. The headline has to describe the
  // position that is actually rendered.
  //
  // The column misread is still real and still stated; it is now the
  // subordinate clause it should always have been when a prose ladder
  // stands.
  const proseCarriesTheLadder = (debtMaturity.proseInstruments ?? []).some((p) => p.amount);
  const completenessStatement = columnReadFailure && proseCarriesTheLadder
    ? `NO TABLE IN THIS NOTE — ${(debtMaturity.proseInstruments ?? []).filter((p) => p.amount).length} instrument(s) below are stated in the note's own narrative rather than in a table, which is how this filer discloses. (A table WAS attempted from ${sourceCitationText} and every row of it carried a period column other than that filing's own period of report, so none was trusted; the narrative is the disclosure, not a fallback.)`
    : columnReadFailure
    ? `NOTE FOUND BUT READ WRONG — the debt note in ${sourceCitationText} was located and transcribed, but every row carried a period column other than that filing's own period of report, so none could be trusted. This is a misread, not an absent disclosure; an older filing's ladder is deliberately NOT substituted. Read the filing.`
    : position.rowsNotVerifiedAsTranscribed
    ? `TRANSCRIPTION NOT VERIFIED — the note states ${finalSubtotalText ?? "a total"}, but the rows below sum ${gapPct}% short of it. The rows are shown as extracted and are NOT this company's position; read the filing. (${check1Clause}; ${check2Clause})`
    : isAggregateDisclosure
      ? // ITEM 5 — the label counts the rows it sits above, so it can no longer
        // contradict them. It previously said "no individual tranche
        // maturities stated in this filing" directly over three individually
        // named, rated, dated tranches: the label was computed from the base
        // note and the rows included 8-K issuances the note never carried.
        // Both halves are now the same set.
        `${categoryTotalCount} of ${tranchCount} line${tranchCount === 1 ? "" : "s"} below ${categoryTotalCount === 1 ? "is a category total" : "are category totals"} rather than a named tranche — this filing reports its debt by category${identifiedCount > 0 ? `; the other ${identifiedCount} ${identifiedCount === 1 ? "is an individually named tranche" : "are individually named tranches"}` : ""} (${check1Clause}; ${check2Clause})`
      : `${tranchCount} tranche${tranchCount === 1 ? "" : "s"}${statusNote} — ${check1Clause}; ${check2Clause}`;

  // Session 18 (post-v6): prefer the deterministically-selected base filing
  // (position.baseFiling — exactly what lib/fetch/noteLocation.ts found
  // and what the model was explicitly told to use) over citations[0], which
  // is just whichever citation the model happened to list first and isn't
  // guaranteed to be the actual debtSchedule source filing.


  // Session 18 (post-v11) — prior-period CONTEXT, never a substitution. Only
  // when the base ladder failed BOTH checks does the older filing's schedule
  // get surfaced at all, and even then it sits beneath the base ladder's own

  return { hasData: true, walkCheck, balanceSheetCheck, completenessStatement, nearestLines, tailSummary, walkLines: buildWalkLines(normalizedSequence, walkCheck.subtotalChecks), coverage: computeCoverage(debtMaturity), revolverCheck: checkRevolverArithmetic(debtMaturity.revolver), issuancesInsideAggregate: position.issuancesInsideAggregate, sourceCitation, isAggregateDisclosure, adjustments: position.adjustments, rowsNotVerifiedAsTranscribed: position.rowsNotVerifiedAsTranscribed, walkGapFraction: position.walkGapFraction };
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
    // E11.4 (Session 18, post-stage-2) — ROUTINE PERIOD SPEND IS NOT A
    // PROJECT. capex-program fires on both "we are building Miller Medical
    // Plaza" and "capital expenditures totalled $2,350 million for the six
    // months ended June 30, 2026". The second is a run-rate, and rendering it
    // under a financing-need heading with no qualifier invites it to be read
    // as a discrete project needing a facility. The trigger's own
    // projectName field already separates them — it is null for exactly the
    // period-total case, which is what D2's capex exemption keys on too, so
    // the two rules read the same field the same way.
    //
    // The BUCKET is unchanged: which bucket a trigger belongs to is
    // taxonomy, not a render decision.
    const periodSpendPrefix = t.triggerId === "capex-program" && !t.projectName ? "period spend — " : "";
    // Item 2 — the bucket lines render a written paraphrase, which is why
    // the display formatter never reached them. See normalizeMoneyInText.
    const description = normalizeMoneyInText(`${periodSpendPrefix}${condenseEvidenceDescription(fact)}`);

    // SESSION 19, ITEM 2A — MULTIPLE FACTS OF ONE KIND RENDER AS SEPARATE
    // LINES, EACH WITH ITS OWN SOURCE.
    //
    // The schema stopped being the constraint in run B and the constraint
    // moved one layer down, to here. CHS returned BOTH divestitures in
    // eventInstances -- $459M Crestwood and $110M Arkansas -- and this loop
    // rendered ONE line, because it read the scalar `evidence` field. Worse
    // than lossy: v17 and v18 filled that one slot with DIFFERENT sales, so
    // a reader comparing weeks watched Arkansas vanish and Crestwood appear.
    // A rotation, not a gain.
    //
    // ONE CONVERSATION, NOT SEVERAL CARDS. The standing dedup rule is
    // unchanged, so only the gated instance carries cardEligible; every
    // other instance renders table-only. Two divestitures in one period
    // therefore produce one card and one table line, which is what the gate
    // deciding per FACT rather than per TRIGGER means in practice.
    const instances = t.eventInstances ?? [];
    if (instances.length > 1) {
      instances.forEach((inst, i) => {
        const instDescription = normalizeMoneyInText(
          inst.amount ? `${inst.description} — ${inst.amount}` : inst.description
        );
        // Each line carries ITS OWN source, never the trigger's whole
        // citation list: the point of separate lines is separate provenance.
        const own = t.citations.filter((c) => c.url === inst.citedUrl);
        const citations = own.length > 0 ? own : t.citations;
        buckets[bucket].push({
          triggerId: t.triggerId,
          description: instDescription,
          timingPhrase: instanceTimingPhrase(inst, t, now),
          citations,
          cardEligible: cardEligible && i === 0,
          crossReferenceTo: null,
          // Distinct per instance, or the cross-bucket dedup collapses the
          // very lines this change exists to separate.
          factKey: `${factIdentityKey(fact)}#${i}`,
          isHedgingFlag: bucket === "hedging" && !(cardEligible && i === 0),
          d3Rank: d3SortRank(t, now),
          d3AgeMonths: monthsSinceCompletion(t, now) ?? 0,
          periodGapNote: periodGapNoteFor(instDescription, citations, now),
          restatesFiguresOf: null,
          text: "",
        });
      });
      continue;
    }

    buckets[bucket].push({
      triggerId: t.triggerId,
      description,
      timingPhrase: timingPhraseFor(t, timing, description, now),
      citations: t.citations,
      cardEligible,
      crossReferenceTo: null,
      factKey: factIdentityKey(fact),
      isHedgingFlag: bucket === "hedging" && !cardEligible,
      d3Rank: d3SortRank(t, now),
      d3AgeMonths: monthsSinceCompletion(t, now) ?? 0,
      periodGapNote: periodGapNoteFor(description, t.citations, now),
      restatesFiguresOf: null,
      // Replaced by composeTableLineText once the cross-reference pass has
      // run — every clause must exist before the line is cut.
      text: "",
    });
  }

  // ==========================================================================
  // E9 (Session 18, post-stage-2) — A FACT APPEARS IN EXACTLY ONE BUCKET.
  //
  // Buckets are assigned per TRIGGER, and each trigger has exactly one, so
  // nothing looked wrong. But two different triggers routinely fire on the
  // SAME disclosure, and then one facility renders twice under two headings.
  // Measured across the book, five companies do this:
  //
  //   HCA        floating-rate-debt + debt-maturity   "Commercial paper (average life of 38 days...)"
  //   Encompass  floating-rate-debt + debt-maturity   "Advances under revolving credit facility $ 200.0 $ 130.0"
  //   Centene    floating-rate-debt + debt-maturity   "Term Loan Facility 1,975"
  //   CHS        revolver-near-capacity + floating-rate-debt
  //   Quest      acquisition-announced + new-subsidiary
  //
  // So the dedup key is the FACT, not the bucket. The primary bucket is the
  // earliest in TABLE_BUCKET_ORDER — the order the page already renders in,
  // so the fact appears where a reader meets it first and the cross-reference
  // always points backwards. A ladder row counts as refi, which is first, so
  // a facility on the ladder is never also a free-standing Hedging line.
  //
  // NEVER SUPPRESSED: the other bucket keeps a line saying the fact is
  // relevant there and where it is shown. Removing it outright would hide a
  // real exposure from the bucket an RM scans for exposures.
  const ladderFactKeys = new Set(
    factBase.filter((f) => f.ladderRowId !== null).map((f) => factIdentityKey(f)).filter(Boolean)
  );
  const ownerOf = new Map<string, Bucket>();
  for (const key of ladderFactKeys) ownerOf.set(key, "refi");
  for (const bucket of TABLE_BUCKET_ORDER) {
    for (const line of buckets[bucket]) {
      if (!line.factKey) continue;
      if (!ownerOf.has(line.factKey)) ownerOf.set(line.factKey, bucket);
    }
  }
  for (const bucket of TABLE_BUCKET_ORDER) {
    for (const line of buckets[bucket]) {
      if (!line.factKey) continue;
      const owner = ownerOf.get(line.factKey);
      if (owner && owner !== bucket) line.crossReferenceTo = owner;
    }
  }

  // ITEM 9 — within one bucket, a line whose whole figure/date set is
  // already covered by another line in that same bucket is a restatement.
  // Set-cover, the same question isFullyExplainedByOneFact asks of a card
  // bullet, asked here of a table line against its neighbours.
  for (const bucket of TABLE_BUCKET_ORDER) {
    const lines = buckets[bucket];
    const tokensOf = lines.map((l) => extractFactTokens(l.description).filter((t) => t.kind !== "percent"));
    for (let i = 0; i < lines.length; i++) {
      // A restatement of FIGURES needs figures — a line carrying only a date
      // is not a repeat of a figure however its dates line up.
      if (!tokensOf[i].some((t) => t.kind === "money")) continue;
      for (let j = 0; j < lines.length; j++) {
        if (i === j || lines[i].factKey === lines[j].factKey) continue;
        // Fewer tokens is the restatement. On an exact tie — which item 12's
        // period collapse creates, by trimming the fuller line's prior-year
        // figure away — the LATER line is, deterministically, the repeat.
        if (tokensOf[i].length > tokensOf[j].length) continue;
        if (tokensOf[i].length === tokensOf[j].length && i < j) continue;
        // sameFactForDisplay, not strictFactTokensMatch: deciding whether to
        // SHOW a line requires an exact-precision match. See the precision
        // boundary in numberGuard.ts.
        const covered = tokensOf[i].every((a) => tokensOf[j].some((b) => sameFactForDisplay(a, b)));
        if (covered) {
          lines[i].restatesFiguresOf = shortTriggerLabel(lines[j].triggerId, lines[j].triggerId);
          break;
        }
      }
    }
  }

  // Item 10 — compose the full line and truncate ONCE, after every clause
  // that renders has been appended. See TableLine.text.
  for (const bucket of TABLE_BUCKET_ORDER) {
    for (const line of buckets[bucket]) {
      line.text = composeTableLineText(line);
    }
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
