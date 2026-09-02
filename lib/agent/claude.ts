import Anthropic from "@anthropic-ai/sdk";
import type { TriggerDef } from "./triggers";
import { recordUsage } from "./costMeter";

const HAIKU_MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface FilingCatalogEntry {
  form: string;
  filingDate: string;
  items: string;
  url: string;
}

export interface CorpusDoc {
  form: string;
  filingDate: string;
  url: string;
  text: string;
}

/**
 * upcoming — a stated future date (a maturity, a pending closing).
 * just_announced — announced or executed and still live/actionable.
 * completed — already settled (redeemed, paid off, closed) — nothing left
 *   to act on, UNLESS the completed-issuance proceeds test says otherwise
 *   (see lib/events/eligibility.ts).
 * standing — an ongoing condition with no specific date (annual capex,
 *   existing exposure, an unchanged buyback program).
 */
export type EventStatus = "upcoming" | "just_announced" | "completed" | "standing";

/**
 * How a debt/equity issuance's proceeds are used, per the filing's own
 * words — only meaningful for "new debt issuance / notes pricing"; null for
 * every other trigger. Feeds the completed-issuance proceeds test: a
 * completed raise only cards when there's a real balance left to compete
 * for (partly_unapplied) and it's recent — see eligibility.ts.
 *
 * Classified by SONNET, not Haiku (see lib/agent/proceedsUse.ts) — moved
 * there after this field proved genuinely ambiguous on real disclosures
 * (Encompass's "...redeem $400M, repay $100M, and pay fees and expenses"
 * read as fully-accounted refinancing by some readings and as leaving an
 * unaccounted sliver by others) and Haiku's own label for the IDENTICAL
 * real disclosure varied across otherwise-identical extraction runs. One
 * narrow, single-field call per fired issuance fact, not folded into the
 * 15-trigger classification.
 */
export type ProceedsUse = "refinancing_only" | "partly_unapplied" | "unstated";

/**
 * Precision the filing actually discloses for `eventDate` — "day" (a real
 * calendar date, "June 1, 2030"), "month" (month+year only, "November
 * 2027" — eventDate defaults to the 1st), or "year" (a bare year, "due
 * 2026", with NO month stated anywhere). Null exactly when eventDate is
 * null. This exists so a bare-year date is never silently upgraded to a
 * fabricated day: eventDate for "year" granularity is the bare 4-digit
 * year string itself ("2026"), never an invented "2026-12-31" — any
 * worst-case convention date for window arithmetic is computed separately
 * downstream (see lib/events/eventTiming.ts's windowDate) and must never
 * be read back as if the filing had stated it.
 */
export type DateGranularity = "year" | "month" | "day";

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateNormalizationResult {
  eventDate: string | null;
  eventDateGranularity: DateGranularity | null;
  /** True when a year-granularity claim carried a fabricated month/day and was corrected down to the bare year — the exact defect this exists for: Haiku's own prompt (above) explicitly forbids writing "2026-12-31" for a bare "2026," but the wording alone didn't stop it happening live. */
  wasNormalized: boolean;
  /** True when a day- or month-granularity claim lands exactly on 12-31 or 01-01 — the two values a model fabricates when it applies its own worst-case convention instead of reading a real date. Never auto-corrected (a real date can legitimately fall on either), only surfaced for review. Note: a genuine month-granularity January date ("January 2027" -> "2027-01-01") always matches the 01-01 pattern too, since day defaults to the 1st by convention for "month" granularity — an expected false positive, not a bug. */
  suspiciousRoundDate: boolean;
}

/**
 * Post-extraction validation for the eventDate/eventDateGranularity pair —
 * enforces in code what the prompt above only asks for in words. Real
 * case: Haiku returned {eventDate: "2026-12-31", eventDateGranularity:
 * "year"} for UHS's debt-maturity fact — the LITERAL forbidden example
 * from this file's own INSTRUCTIONS text, self-contradicting its own
 * granularity label. Never rejects the fact: a bare-year maturity is
 * legitimate and eventTiming.ts's windowDate convention already exists
 * specifically to handle it downstream.
 */
export function normalizeEventDate(eventDate: string | null, eventDateGranularity: DateGranularity | null): DateNormalizationResult {
  if (!eventDate || !eventDateGranularity) {
    return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate: false };
  }
  const full = eventDate.match(FULL_DATE_RE);
  if (!full) {
    return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate: false };
  }
  if (eventDateGranularity === "year") {
    return { eventDate: full[1], eventDateGranularity: "year", wasNormalized: true, suspiciousRoundDate: false };
  }
  const [, , month, day] = full;
  const suspiciousRoundDate = (month === "12" && day === "31") || (month === "01" && day === "01");
  return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate };
}

/**
 * Session 18 A1, redesigned post-v9 (three rounds of label-matching —
 * category, feedsIntoTotal, and a proposed numeric fallback — all tried to
 * answer "which total does this line belong to," a question the filing
 * itself never poses). Live hand-verification of both pilot companies
 * established the real model: a debt note is a RUNNING TOTAL, not a set of
 * lines belonging to one grand total. Every printed subtotal equals the sum
 * of everything printed above it — no labels needed to reconcile it. This
 * is the ordered transcription of that running sequence: every row,
 * adjustment, and subtotal, in PRINTED order — never repositioned.
 *
 * Post-v10 correction: an earlier version of this schema asked the model to
 * REPOSITION entries (e.g. move HCA's "Commercial paper" out of its printed
 * position to sit later in the sequence, where the arithmetic needed it).
 * That instruction was itself an instance-fit — it forced one company's
 * shape into a flat running total instead of representing what the filing
 * actually prints, and the live pilot showed the model couldn't reliably
 * follow it either. The real structure is that a debt note is NESTED: the
 * filing prints section headings (e.g. "Long-term debt", "Short-term
 * borrowings"), and a subtotal reconciles against the rows in its OWN
 * section plus any earlier subtotals/open sections it rolls up — never
 * against a reordered flat list. `section` (below) captures that heading
 * verbatim; printed order is preserved exactly. See
 * lib/events/position.ts's computeWalkChecksum for the nested walk this
 * enables.
 */
export type ScheduleEntryKind = "row" | "adjustment" | "subtotal";

export interface ScheduleSequenceEntry {
  kind: ScheduleEntryKind;
  /**
   * "row": the instrument's own name (e.g. "Term Loan A-2", "Commercial
   * paper"). "adjustment": the reconciling line's own label (e.g. "Debt
   * issuance costs and discounts"). "subtotal": the total line's own
   * verbatim label, or null when the filing prints the figure with no
   * "Total ..." caption at all — real and expected (DaVita's post-discount
   * running total has none), never invent one.
   */
  label: string | null;
  /**
   * Signed as printed — parentheses mean negative; copy the sign, never
   * convert to a bare positive number. Unit always attached, same rule as
   * every other money field in this schema. For "row"/"adjustment" this is
   * the entry's own contribution to the running sum; for "subtotal" this is
   * the CLAIMED running total at this point — checked against the actual
   * running sum by the checksum, never trusted on the model's word alone.
   */
  amount: string;
  /** Verbatim, verified against the filing text the same way `quote` is — a row/adjustment/subtotal whose sourceLine can't be verified is dropped, not trusted. */
  sourceLine: string;
  /**
   * Post-v10 correction: the note's own section heading this entry sits
   * under, copied verbatim (e.g. "Long-term debt", "Short-term borrowings") —
   * or null when the filing prints no such heading for this entry (a flat,
   * single-section note like DaVita's, or a genuinely unplaced top-level
   * line like HCA's final "less amounts due within one year" adjustment).
   * Entries are captured in PRINTED order and NEVER repositioned — this
   * field, not reordering, is what lets Check 1 (lib/events/position.ts's
   * computeWalkChecksum) tell which rows a given subtotal is summing over.
   * If a row plainly sits under a heading but which one is genuinely
   * unclear, leave this null rather than guess — a null is read as
   * top-level, which surfaces any resulting mismatch honestly in Check 1
   * instead of silently mis-assigning the row to a section it may not
   * belong to.
   */
  section: string | null;
  /**
   * Session 18 (post-v12) — COLUMN BINDING. Every debt table prints at
   * least two amount columns (this period and the prior comparative), and
   * until this field existed nothing in the schema said which one an
   * `amount` came from. That is a silent-corruption class, not a one-off:
   * a set of prior-column rows sums to the prior-column subtotal and passes
   * Check 1 perfectly, because the internal walk is self-consistent within
   * either column. Only Check 2 catches it, and only because a balance
   * sheet is current-period by definition. Live case: Quest, where the
   * model read prior-column values for several rows and both subtotals and
   * still walked cleanly.
   *
   * The verbatim column header this specific amount was read from, exactly
   * as the table prints it (e.g. "June 30, 2026", "December 31, 2025").
   * Verified in CODE against the base filing's own EDGAR period-of-report
   * (lib/agent/loop.ts) — an entry bound to a different period is DROPPED,
   * never accepted. Null only when the table genuinely prints a single
   * amount column with no period header at all.
   */
  periodColumn: string | null;
  /** Only meaningful for kind "row" — null for "adjustment"/"subtotal". Same copy-never-compute rules as eventDate; null when this specific row states no rate. */
  rate: string | null;
  /** Only meaningful for kind "row". Verbatim from the debt note's own section header; null when the filing states no seniority for this row — never guessed. */
  seniority: string | null;
  /** Only meaningful for kind "row". Nullable — a real aggregate line (e.g. "Other debt") can genuinely state no maturity; a claimed value with no matching date token in this row's own sourceLine is dropped downstream, never trusted. */
  maturityDate: string | null;
  dateGranularity: DateGranularity | null;
}

/**
 * Session 18 (post-v9) — Check 2's own input. Every 10-Q/10-K carries a
 * balance sheet with debt captions, independent of the debt note's own
 * running sequence — cross-referencing the two proves the note actually
 * belongs to THIS period (an internal walk on a stale, prior-quarter note
 * ties perfectly on its own; the balance sheet is what catches that). NOT a
 * fixed set of captions — a company states whichever ones its own balance
 * sheet actually prints (see lib/events/position.ts's computeBalanceSheetCheck).
 */
export interface BalanceSheetDebtCaption {
  /** Verbatim, e.g. "Current portion of long-term debt", "Long-term debt", "Commercial paper". */
  label: string;
  amount: string;
  sourceLine: string;
  /** Session 18 (post-v12) — same column binding as ScheduleSequenceEntry.periodColumn. A balance sheet is comparative too, and Check 2 is only a current-period anchor if its captions actually came from the current column. */
  periodColumn: string | null;
}

/** A single newly-priced tranche from an issuance 8-K — NOT part of the debt note's running-total walk (that's scheduleSequence), just a row to append to the ladder. Same field shape as a scheduleSequence "row" entry, minus kind/label (uses `instrument` instead, since it's never part of an ordered sequence with adjustments/subtotals). */
export interface IssuedTrancheRow {
  instrument: string;
  rate: string | null;
  seniority: string | null;
  amount: string;
  maturityDate: string | null;
  dateGranularity: DateGranularity | null;
  sourceLine: string;
}

/** Session 19, item 2a — one entry per real-world instance of a multi-instance trigger. See EVENT_INSTANCE_SCHEMA. */
export interface EventInstanceRow {
  /** What happened, as the filing names it. */
  description: string;
  /** This instance's OWN amount, unit attached, or null when the filing states none for it. Never another instance's figure. */
  amount: string | null;
  eventDate: string | null;
  dateGranularity: DateGranularity | null;
  eventStatus: EventStatus;
  /** Verbatim from the filing, verified literally and bounded to its own region — the same contract a ladder row's sourceLine carries. */
  sourceLine: string;
}

/** Session 21, item 1d — a retirement this issuance claims, with the filing's own words for it. See REDEEMS_SCHEMA. */
export interface RedeemsClaim {
  /** The instrument being retired, as the filing names it. */
  instrument: string;
  /** The amount retired where the filing states one — a partial call names a figure. Null when it states none. */
  amount: string | null;
  /** "completed" when the filing describes the retirement as done; "intended" when it describes a plan or a use of proceeds. */
  status: "completed" | "intended" | null;
  /** Verbatim, verified literally against the cited filing. A claim that moves a balance carries its evidence. */
  sourceLine: string | null;
}

/** Session 20, item 3a — an instrument stated in the located note's narrative. See PROSE_INSTRUMENT_SCHEMA. */
export interface ProseInstrumentRow {
  category: "term-loan" | "revolver" | "delayed-draw-term-loan" | "senior-notes" | "finance-lease" | "other";
  name: string | null;
  amount: string | null;
  /**
   * SESSION 20, STAGE 4 — WHAT THE AMOUNT IS, NOT JUST WHAT IT IS.
   *
   * Debt is what is drawn. An undrawn commitment is capacity, and the two are
   * printed in the same sentence in the same units, so nothing about the
   * figure itself separates them — only the words around it do, and the model
   * is the layer that has those words. Measured on v22: Molina's revolver
   * contributed $1.25 billion to coverage (its FACILITY SIZE; it has drawn
   * nothing) and Tenet's contributed $1.900 billion (its facility size, with
   * drawn stated as $0). Both read as over-100% coverage.
   *
   * A category list would have caught those two and nothing else. This is the
   * distinction itself, so an instrument type nobody has seen yet is caught
   * on the same test.
   */
  amountBasis: "outstanding" | "commitment" | null;
  asOfDate: string | null;
  dateGranularity: DateGranularity | null;
  maturityDate: string | null;
  rate: string | null;
  sourceLine: string;
}

/** Session 20, item 3b — the revolver's four figures, kept separate so drawn + LCs + available = size can be checked. See REVOLVER_SCHEMA. */
export interface RevolverRow {
  facilitySize: string | null;
  drawn: string | null;
  lettersOfCredit: string | null;
  available: string | null;
  delayedDrawCapacity: string | null;
  asOfDate: string | null;
  sourceLine: string;
}

/** Session 19, item 2b — a retirement or repurchase the debt note states in its own prose. See NOTE_RETIREMENT_SCHEMA. */
export interface NoteRetirementRow {
  /** The instrument as the note names it. */
  instrument: string;
  /** The amount retired or repurchased, unit attached, or null when the prose names none. */
  amount: string | null;
  eventDate: string | null;
  dateGranularity: DateGranularity | null;
  sourceLine: string;
}

export interface TriggerVerdict {
  triggerId: string;
  fired: boolean;
  dataAvailable: boolean;
  evidence: string | null;
  quote: string | null;
  /** True when `quote` itself states the transaction's material figure(s) (amount, value, consideration, rate). False when quote is a fallback — the most specific factual sentence available, with no single sentence in the filing found to carry a figure — or when quote is null. Lets callers tell "verified AND useful" apart from "verified but figure-less" without re-parsing the quote text; see loop.ts's logging when false. */
  quoteHasFigure: boolean;
  /** ISO date (YYYY-MM-DD) when day/month granularity, or a bare 4-digit year ("2026") when only a year is stated — or null if the filing states none. See DateGranularity above and the INSTRUCTIONS prompt for the exact rules. Verified against the filing text downstream (lib/agent/factGuard.ts) before it's trusted for any card decision. */
  eventDate: string | null;
  eventDateGranularity: DateGranularity | null;
  eventStatus: EventStatus;
  confidence: number;
  needsDig: boolean;
  digHint: string | null;
  citedUrls: string[];
  /**
   * Session 18 A1, redesigned post-v9 — "debt-maturity" ONLY, empty array
   * for every other trigger. The base filing's ENTIRE debt note,
   * transcribed as an ordered row/adjustment/subtotal sequence — see
   * ScheduleSequenceEntry's doc comment for the running-total model this
   * replaces label-matching with. This — not eventDate/quote/evidence
   * above — is what lib/events/position.ts and the gate now read for this
   * trigger.
   */
  scheduleSequence: ScheduleSequenceEntry[];
  /**
   * Session 18 — "debt-maturity" ONLY. The SAME transcription, but from the
   * next-most-recent 10-Q or 10-K already present in the corpus (not the
   * newest one — that's scheduleSequence above). Exists so
   * lib/events/position.ts can detect a tranche that silently dropped off
   * the newest filing with no 8-K explaining why (the `unconfirmed` case).
   * Empty array if the corpus holds only one periodic filing with a debt
   * schedule.
   */
  priorScheduleSequence: ScheduleSequenceEntry[];
  /**
   * Session 18 (post-v9) — "debt-maturity" ONLY. The SAME base filing's own
   * balance sheet debt captions — Check 2's input (lib/events/position.ts's
   * computeBalanceSheetCheck), independent of scheduleSequence's own
   * internal walk. Proves the note belongs to THIS period; an internal walk
   * on a stale note ties perfectly on its own. Empty for every other
   * trigger.
   */
  balanceSheetDebtCaptions: BalanceSheetDebtCaption[];
  /**
   * Session 18 (post-v11) — "debt-maturity" ONLY, null for every other
   * trigger. The scheduleSequence table's OWN unit declaration, copied
   * verbatim from the table's header/caption (e.g. "(In millions)",
   * "(amounts in thousands)") — or null when the table declares none. Many
   * filings state the scale ONCE here instead of on every row, which left
   * rows reading a bare "$ 549" and either dropped as indeterminate or,
   * worse, silently read as literal dollars a million times too small
   * (Cigna's 10-K, live). Applied in CODE, never by the model — see
   * lib/agent/moneyScale.ts's applyTableUnitToAmount.
   */
  scheduleTableUnit: string | null;
  /** Session 18 (post-v11) — "debt-maturity" ONLY. Same, for priorScheduleSequence's own table (a different filing, so a separately-declared unit). */
  priorScheduleTableUnit: string | null;
  /** Session 18 (post-v11) — "debt-maturity" ONLY. Same, for the BALANCE SHEET's own unit declaration — a different statement from the debt note, with its own caption, so never assume the note's unit carries over. */
  balanceSheetTableUnit: string | null;
  /** Session 18 A2 — "new-debt-issuance" ONLY. Verbatim description of the notes named as being redeemed/repaid by THIS issuance, or null. Copied, never inferred — this is what lets lib/events/position.ts retire the right ladder row instead of leaving a card pointed at dead debt. Null for every other trigger. */
  /**
   * SESSION 21, ITEM 1D — THE LAST BALANCE-MOVING FIELD WITH NO SOURCE LINE.
   *
   * This was free text: a description with nothing verifying it and no
   * statement of whether the retirement had HAPPENED. It retired ladder rows
   * on that basis for twenty sessions. Measured on the book:
   *
   *   UHS      "1.650% Senior Secured Notes due 2026" — and the cited 8-K
   *            names those notes only in a ranking clause, as the "Existing
   *            2026 Notes" the new notes rank alongside. A live $700 million
   *            obligation rendered as retired.
   *   Tenet    the filing says "intends to use the net proceeds ... to
   *            finance ... the redemption" — an intent, not an event.
   *   Cigna,   the described instrument does not appear in the cited filing
   *   Molina   at all.
   *   HCA,     "we redeemed all $1.500 billion ..." / "repaid in full at
   *   Quest    maturity" — genuinely completed, and these must keep working.
   *
   * Rule 15 one layer up: an instrument NAMED in a filing is a name, not an
   * event. The claim now carries its own verbatim sourceLine, verified
   * literally like every other claim in this schema, and states whether the
   * filing describes something done or something intended.
   */
  redeems: RedeemsClaim | null;
  /**
   * Session 18 — "new-debt-issuance" ONLY, empty array for every other
   * trigger. The row(s) for the tranche(s) THIS issuance just priced,
   * transcribed from the pricing 8-K itself (which states
   * instrument/rate/amount/maturity/seniority just as concretely as a
   * periodic debt note does). This is what lets lib/events/position.ts add
   * the newly issued tranche(s) to the ladder as `live` rows, not just
   * remove the redeemed one.
   */
  issuedTranches: IssuedTrancheRow[];
  /**
   * Session 19, item 2a — ONLY for the multi-instance triggers (see
   * MULTI_INSTANCE_TRIGGERS in lib/agent/triggers.ts), empty for the rest.
   * Every qualifying event in the period, in printed order.
   */
  eventInstances: EventInstanceRow[];
  /**
   * Session 19, item 2b — "debt-maturity" ONLY, empty for every other
   * trigger. Retirements and repurchases stated in the debt note's own
   * narrative rather than in an 8-K.
   */
  noteRetirements: NoteRetirementRow[];
  /** Session 20, 3a — instruments stated in the note's narrative. Empty for every trigger except debt-maturity. */
  proseInstruments: ProseInstrumentRow[];
  /** Session 20, 3b — the revolver's own figures. Null when the note states none. */
  revolver: RevolverRow | null;
  /**
   * Session 19, item 2c — "capex-program" ONLY, null elsewhere. The stated
   * completion date of a named project, which is what makes its status
   * derivable instead of defaulting to `standing`.
   */
  projectCompletionDate: string | null;
  projectCompletionGranularity: DateGranularity | null;
  /**
   * Session 18 A3 — every trigger. The amount THIS event's own filing text
   * states for it, or null. Not a general dollar figure that happens to
   * appear near the disclosure — the amount actually being received, paid,
   * or committed for this specific event. A classification (e.g. assets
   * reclassified as held-for-sale, which states a carrying value but no
   * realized cash) is null, not that carrying value. An announcement or a
   * launch with no stated amount is null. Never extract direction — the
   * trigger's own bucket already carries that, and a second, possibly
   * disagreeing source of truth is worse than none.
   */
  cashAmount: string | null;
  /**
   * Session 18 A3 — every trigger. The discrete, NAMED project the filing
   * calls out (e.g. "Alan B. Miller Medical Center"), or null when the
   * amount is a period total with no named project ("six-month capital
   * expenditures of $348 million"). Amount plus a name is a project; amount
   * with no name is period spend — both are real facts, this field is only
   * what tells them apart.
   */
  projectName: string | null;
}

const SCHEDULE_SEQUENCE_ENTRY_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: { type: "string", enum: ["row", "adjustment", "subtotal"] },
    label: { type: ["string", "null"] },
    amount: { type: "string" },
    sourceLine: { type: "string" },
    section: { type: ["string", "null"] },
    periodColumn: { type: ["string", "null"] },
    rate: { type: ["string", "null"] },
    seniority: { type: ["string", "null"] },
    maturityDate: { type: ["string", "null"] },
    dateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
  },
  required: ["kind", "amount", "sourceLine"],
};

const BALANCE_SHEET_CAPTION_SCHEMA = {
  type: "object" as const,
  properties: {
    label: { type: "string" },
    amount: { type: "string" },
    sourceLine: { type: "string" },
    periodColumn: { type: ["string", "null"] },
  },
  required: ["label", "amount", "sourceLine"],
};

const ISSUED_TRANCHE_SCHEMA = {
  type: "object" as const,
  properties: {
    instrument: { type: "string" },
    rate: { type: ["string", "null"] },
    seniority: { type: ["string", "null"] },
    amount: { type: "string" },
    maturityDate: { type: ["string", "null"] },
    dateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    sourceLine: { type: "string" },
  },
  required: ["instrument", "amount", "sourceLine"],
};

/**
 * SESSION 19, ITEM 2a — ONE ENTRY PER REAL-WORLD INSTANCE.
 *
 * The one-slot shape that Session 18 replaced for `debt-maturity` is still
 * everywhere else, and it strands facts that were extracted successfully.
 * CHS's filing describes TWO divestitures; the structured slot took the
 * smaller, more recent $110M deal, and the larger — "the sale of Crestwood
 * Medical Center in Huntsville, Alabama on April 1, 2026 for $459 million in
 * cash" — survived only as prose inside `evidence`, which the condenser then
 * trimmed. Nothing was missed by the model. There was nowhere to put it.
 *
 * Same verification contract as a ladder row (BRD 8.3): every entry carries
 * its OWN sourceLine, verified literally, bounded to its own region. This is
 * TRANSCRIPTION, not selection — copy every qualifying event in printed
 * order, never rank, never choose, never keep "the most important one".
 */
const EVENT_INSTANCE_SCHEMA = {
  type: "object" as const,
  properties: {
    description: { type: "string" },
    amount: { type: ["string", "null"] },
    eventDate: { type: ["string", "null"] },
    dateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    eventStatus: { type: "string", enum: ["upcoming", "just_announced", "completed", "standing"] },
    sourceLine: { type: "string" },
  },
  required: ["description", "sourceLine", "eventStatus"],
};

/**
 * SESSION 19, ITEM 2b — A RETIREMENT THE DEBT NOTE STATES IN ITS OWN PROSE.
 *
 * An 8-K's `redeems` field is currently the ONLY path to a retired ladder
 * row. A repayment described in the note's own narrative cannot reach the
 * position layer at all: the row either vanishes from the schedule and comes
 * back marked "dropped from the newest filing with no redemption explaining
 * it" — while the filing explains it two paragraphs below the table — or it
 * moves and the ladder reports a balance change with no cause.
 *
 * Centene is the shape: "During the three and six months ended June 30,
 * 2026, the Company repurchased $118 million and $1,147 million,
 * respectively, of its par value Senior Notes due 2027." That text is inside
 * the located note span and already in the model's input. There was no field.
 *
 * Copied verbatim, never inferred, with the amount and the instrument as the
 * filing names them.
 */
/**
 * SESSION 20, ITEM 3A — AN INSTRUMENT STATED IN THE NOTE'S NARRATIVE.
 *
 * Half a capital structure can live in prose. UHS is the measured case: its
 * rendered ladder covers $1.1B of a stated $4,851,847K, and the missing
 * $3.7B is not missing from the FILING — it is a term loan, a revolver and
 * five senior notes written out in sentences and bullets, in the same note
 * the table would have been in if there were a table.
 *
 * CATEGORY-TYPED, NEVER NAME-MATCHED. A company has one term loan A and one
 * revolver; "Eleventh Amendment" and "Twelfth Amendment" are display text
 * describing the same facility, not two facilities. Identity across periods
 * is category plus amount continuity, so the category is a required field
 * and the name is not a key.
 *
 * NO STATED AMOUNT MEANS NO COVERAGE ENTRY. An instrument the filing
 * mentions without sizing is narrative context; counting it as captured
 * would let coverage claim completeness it cannot demonstrate, and counting
 * it as missing would flag every passing reference. It is extracted with a
 * null amount and excluded from the sum, which is a third state and is
 * stated as one.
 */
const PROSE_INSTRUMENT_SCHEMA = {
  type: "object" as const,
  properties: {
    category: {
      type: "string",
      enum: ["term-loan", "revolver", "delayed-draw-term-loan", "senior-notes", "finance-lease", "other"],
    },
    /** The filing's own name for it, verbatim. Display only — never a match key. */
    name: { type: ["string", "null"] },
    /** Verbatim, with its unit as printed. Null when the filing states the instrument but not its size. */
    amount: { type: ["string", "null"] },
    /** Whether that amount is a balance OUTSTANDING or a COMMITMENT not drawn. Debt is the first; the second is capacity. */
    amountBasis: { type: ["string", "null"], enum: ["outstanding", "commitment", null] },
    /** The date the amount is stated AS OF, verbatim from the sentence that carries it. */
    asOfDate: { type: ["string", "null"] },
    dateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    maturityDate: { type: ["string", "null"] },
    rate: { type: ["string", "null"] },
    /** The verbatim sentence. Verified inside the located note, same contract as a ladder row (BRD 8.3). */
    sourceLine: { type: "string" },
  },
  required: ["category", "sourceLine"],
};

/**
 * SESSION 20, ITEM 3B — REVOLVER AND LIQUIDITY, AS SEPARATE NAMED FIELDS.
 *
 * "What is owed and when" is only half a treasury conversation; the other
 * half is what they can reach for. These are extracted as distinct fields
 * rather than one blob precisely so the arithmetic can be checked:
 *
 *   drawn + letters of credit + available = facility size
 *
 * UHS states all four in one sentence — a $1.5B facility, $225M drawn, $3M
 * of letters of credit, $1.272B available — and 225 + 3 + 1,272 = 1,500.
 * A filing whose four numbers do not reconcile has been misread or misprints,
 * and either way that renders as its own flag rather than as a liquidity
 * figure someone might act on.
 */
const REVOLVER_SCHEMA = {
  type: "object" as const,
  properties: {
    facilitySize: { type: ["string", "null"] },
    drawn: { type: ["string", "null"] },
    lettersOfCredit: { type: ["string", "null"] },
    available: { type: ["string", "null"] },
    /** Capacity committed but not yet drawn — a delayed-draw term loan is not a revolver but belongs on the same liquidity line. */
    delayedDrawCapacity: { type: ["string", "null"] },
    asOfDate: { type: ["string", "null"] },
    sourceLine: { type: "string" },
  },
  required: ["sourceLine"],
};

const NOTE_RETIREMENT_SCHEMA = {
  type: "object" as const,
  properties: {
    instrument: { type: "string" },
    amount: { type: ["string", "null"] },
    eventDate: { type: ["string", "null"] },
    dateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    sourceLine: { type: "string" },
  },
  required: ["instrument", "sourceLine"],
};

const VERDICT_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    triggerId: { type: "string" },
    fired: { type: "boolean" },
    dataAvailable: { type: "boolean" },
    evidence: { type: ["string", "null"] },
    quote: { type: ["string", "null"] },
    quoteHasFigure: { type: "boolean" },
    eventDate: { type: ["string", "null"] },
    eventDateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    eventStatus: { type: "string", enum: ["upcoming", "just_announced", "completed", "standing"] },
    confidence: { type: "number" },
    needsDig: { type: "boolean" },
    digHint: { type: ["string", "null"] },
    citedUrls: { type: "array", items: { type: "string" } },
    scheduleSequence: { type: "array", items: SCHEDULE_SEQUENCE_ENTRY_SCHEMA },
    priorScheduleSequence: { type: "array", items: SCHEDULE_SEQUENCE_ENTRY_SCHEMA },
    balanceSheetDebtCaptions: { type: "array", items: BALANCE_SHEET_CAPTION_SCHEMA },
    scheduleTableUnit: { type: ["string", "null"] },
    priorScheduleTableUnit: { type: ["string", "null"] },
    balanceSheetTableUnit: { type: ["string", "null"] },
    redeems: {
      type: ["object", "null"],
      properties: {
        instrument: { type: "string" },
        amount: { type: ["string", "null"] },
        status: { type: ["string", "null"], enum: ["completed", "intended", null] },
        sourceLine: { type: "string" },
      },
      required: ["instrument", "status", "sourceLine"],
    },
    issuedTranches: { type: "array", items: ISSUED_TRANCHE_SCHEMA },
    cashAmount: { type: ["string", "null"] },
    projectName: { type: ["string", "null"] },
    eventInstances: { type: "array", items: EVENT_INSTANCE_SCHEMA },
    noteRetirements: { type: "array", items: NOTE_RETIREMENT_SCHEMA },
    // Session 20, 3a/3b — the prose half of the capital structure.
    proseInstruments: { type: "array", items: PROSE_INSTRUMENT_SCHEMA },
    revolver: { type: ["object", "null"], properties: REVOLVER_SCHEMA.properties },
    projectCompletionDate: { type: ["string", "null"] },
    projectCompletionGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
  },
  required: ["triggerId", "fired", "dataAvailable", "eventStatus", "quoteHasFigure", "confidence", "needsDig"],
};

const INSTRUCTIONS = `You are triaging a public company's SEC filings for a commercial bank relationship manager. For each of the 15 triggers listed, decide:
- fired: does the evidence show this trigger actually happened / is present?
- Perspective check: every trigger is evaluated from the perspective of the SUBJECT COMPANY named at the top of this prompt (Company: ...) — the company whose filings you were given, not any counterparty mentioned in them. This matters most for M&A: first work out whether the subject company is the BUYER/acquirer or the SELLER/divestor in the transaction. "Acquisition announced" fires ONLY when the subject company is the one doing the acquiring. When the subject company is selling, divesting, or exiting a business or asset, that is "Asset sale / divestiture closing" — never "Acquisition announced" — even if the filing or a counterparty's press release frames the deal from the buyer's side.
- dataAvailable: could this realistically be assessed from what you were given? Set this to false only when the trigger is fundamentally the kind of thing public filings don't disclose (e.g. internal treasury/banking relationships) — not merely because you personally didn't spot it this quarter. If the trigger is marked PUBLIC and you simply see no evidence, that's fired=false, dataAvailable=true ("checked, no signal").
- evidence: a short quote or paraphrase of what you found, or null if nothing. State the DATES the filing gives (a maturity date, a pending closing date, an effective date) plainly in the evidence text — e.g. "5.250% notes due June 2026" or "divestiture closing pending". Do NOT compute or state how far away that date is ("~10 months out", "refi window open now") — that arithmetic is code's job now, done from the eventDate/eventStatus fields below, never from the model's own reading of a calendar. Only surface a date when the filing genuinely discloses it; never invent one. Always write evidence in plain English, as if briefing a human banker — never quote or include raw XBRL tags, machine element names, namespace prefixes (e.g. "us-gaap:...", "uhs:...", any "company-prefix:ElementName" form), or accession-number-style identifiers. If the only source for a fact is a tagged data element, describe what it means in words instead of naming the tag (e.g. write "foreign-exchange hedging contracts disclosed in fair-value measurements", not "DesignatedAsHedgingInstrumentMember"; write "UK revenue reported as a separate segment line", not "uhs:UKRevenueMember").
- eventDate: the date of the event THIS SPECIFIC fact describes — a maturity date, a closing date, an announcement date, an issuance date. Copy it from the same sentence(s) that support this fact's evidence, not from a different, unrelated sentence elsewhere in the passage — e.g. if this fact is about a note maturing "due 2026" and a nearby sentence separately mentions a hospital lease expiring in a different month, that lease date belongs to a DIFFERENT fact, not this one; do not borrow it. Match the precision to what's actually stated, and set eventDateGranularity to match:
  - A real calendar date ("June 1, 2030", "6/1/2030") -> eventDate "2030-06-01", eventDateGranularity "day".
  - Only a month and year ("November 2027") -> eventDate "2027-11-01" (the 1st, by convention), eventDateGranularity "month".
  - ONLY A BARE YEAR with no month anywhere ("due 2026", "matures in 2028") -> eventDate is the bare year itself, exactly four digits ("2026"), eventDateGranularity "year". Do NOT invent a month or day — never write "2026-12-31" or "2026-01-01" for a bare "2026"; that fabricates precision the filing never stated.
  - If the filing states no date for this specific fact — or you're not certain which date belongs to it — eventDate is null and eventDateGranularity is null. A null is correct and useful; a borrowed, guessed, or over-precise date is not. Only meaningful when fired is true; both null when fired is false.
- eventStatus: exactly one of "upcoming" (a stated future date — a maturity, a pending closing), "just_announced" (announced or executed and still live/actionable — proceeds not yet fully placed, a deal not yet closed), "completed" (already settled — redeemed, paid off, the transaction closed with nothing left to act on this week), or "standing" (an ongoing condition with no specific date — recurring/annual capex, an existing exposure, an unchanged buyback program). Label exactly what the filing's own words state, do not infer beyond them: "were redeemed" -> completed. "due November 2027" -> upcoming. "each year" / "actively pursue" / "ongoing" -> standing. Only meaningful when fired is true.
- quote: REQUIRED whenever fired is true and evidence states a specific number, date, rate, or other precise fact. Defined precisely, not as a preference: **quote is the ONE contiguous sentence from the filing text given above that STATES the transaction's material figures — the amount, value, consideration, or rate.** Not the sentence that introduces the transaction. Not the sentence that names the parties. The sentence with the number in it. Copy it VERBATIM — character-for-character, copy-pasted, not paraphrased, not corrected, not reconstructed from memory. This is the only place numbers and dates are allowed to come from downstream.
  - quoteHasFigure: set this to true when the quote you wrote actually contains the material figure. Set it to false ONLY when you searched and no single sentence anywhere in the filing text contains one — in that case, quote instead the single most specific factual sentence available (whatever best identifies the fact, even without a number), and quoteHasFigure stays false. Do not set quoteHasFigure true because the quote is "close enough" or mentions a different, smaller number — it means the quote you wrote literally contains the fact's own headline figure.
  - NEVER assemble a quote by joining text from two different locations in the filing into what looks like one contiguous span, even when both pieces are individually true and even when the join reads naturally. If it is not one real, unbroken, back-to-back span of the source text, it does not belong in this field. This is the single most important rule here: a spliced quote is not a paraphrase, it is a fabrication of contiguity that didn't happen, and downstream verification exists specifically to catch it. An opening sentence that introduces the deal ("On [date], Company entered into an agreement...") is almost never the right quote by itself if a later sentence states the figure — go find that later sentence and quote it alone instead of the opener.
  - If you cannot find any single contiguous sentence that reflects the fact at all, do not write one — set quote to null and quoteHasFigure to false; a missing quote is far better than a spliced or misremembered one. Also set quote to null (and quoteHasFigure to false) if fired is false, or if the evidence is a general statement with no specific figure to verify (e.g. "no signal found").
- confidence: 0-1.
- needsDig: true only if the evidence is genuinely ambiguous (e.g. an event is mentioned but a key detail like amount or maturity is missing) AND a specific other filing in the catalog (not already in the excerpts below) looks likely to resolve it.
- digHint: if needsDig, the exact url from the filing catalog you want read next. Otherwise null.
- citedUrls: the filing url(s) you actually drew evidence from, from the excerpts or catalog below.

- scheduleSequence / priorScheduleSequence / balanceSheetDebtCaptions — ONLY for the "debt-maturity" trigger. Leave all three at their empty default ([], [], []) for every other trigger.
  - THE ANCHOR FILING IS THE ONLY FILING THESE THREE FIELDS MAY COME FROM. It is named explicitly in the "Debt-schedule filing guidance" section above — read it first, and read nothing else for these fields. It is always the company's most recent 10-Q or 10-K. Do NOT search the catalog yourself, and do NOT use an older filing for any part of this, including when the anchor's own debt note tells you to: a note that ends "for more information see Note 7 to the Consolidated Financial Statements in the Company's 2025 Form 10-K" is telling a reader where a fuller description lives, NOT telling you that the older table states today's balances. Following that cross-reference produces a ladder as of last December printed beside this quarter's balance sheet, which is worse than no ladder at all.
  - THIS FIELD IS THE NOTE'S TABLE. Only what the note prints as a table — rows in columns under headers — belongs here. Instruments the note states in BULLETS or in SENTENCES are real and must not be lost, but they do not go here: they go in proseInstruments, one entry each, described in that field's own instructions below. A note with no table at all therefore returns an EMPTY scheduleSequence and a full proseInstruments list, and that is a complete, correct answer rather than a failure.
  - Never put the same instrument in both fields. Every instrument the note states belongs to exactly one of them, decided by how the note prints it, and nothing else.
  - IF THE ANCHOR'S DEBT NOTE CARRIES NO TRANSCRIBABLE SCHEDULE, RETURN AN EMPTY scheduleSequence. That is a correct, expected, useful answer — many 10-Q debt notes are three narrative paragraphs and no table. An empty array says "this filing states no ladder"; a filled one built from somewhere else says something false. Never fabricate a table, even a plausible-looking one, and never substitute another filing's.
  - THE KEY IDEA: a debt note is a RUNNING TOTAL, not a set of lines belonging to one grand total. Every printed subtotal equals the sum of everything printed above it WITHIN ITS OWN SECTION, plus any earlier subtotal or section it rolls up. Your job is to transcribe the note EXACTLY AS PRINTED, in the SAME order the filing prints it, capturing each entry's own section heading — you are NEVER deciding which lines "belong to" which total, and you NEVER reorder or reposition anything to make the arithmetic work. If a line printed first needs to be reordered for a subtotal to reconcile, that is a sign you have the section wrong, not a reason to move the line.
  - scheduleSequence is an ORDERED array, IN PRINTED ORDER — literally the order these lines appear on the page, top to bottom, exactly as printed. Each entry has a kind:
    - "row": one debt instrument/tranche/category line (e.g. "Term Loan A-2", "Commercial paper", "Senior unsecured notes payable through 2095"). label = the instrument's own name. Also carries rate, seniority (verbatim from the note's own section header, null if not stated), maturityDate + dateGranularity (same copy-never-compute rules as eventDate above — bare year stays bare, and BOTH ARE NULLABLE: null is the correct answer whenever this specific row states no maturity — a catch-all line like "Other debt (effective interest rate of 4.9%)" often states a rate with no maturity year anywhere next to it; do not default to the reporting period or any other plausible-looking year — that is fabrication, independently checked downstream against this row's own sourceLine).
    - "adjustment": a reconciling line between rows and a subtotal — unamortized discount/premium, issuance costs, finance leases, current portion, "amounts due within one year." label = the line's own text. amount is signed exactly as printed — a value in parentheses is negative; copy the parentheses/minus sign, never convert to a bare positive number. rate/seniority/maturityDate/dateGranularity are null for this kind.
    - "subtotal": a printed running total — "Total long-term debt," "Total debt," or a figure the filing simply prints with NO "Total ..." caption at all (real and expected — set label to null in that case, never invent a label that isn't there). rate/seniority/maturityDate/dateGranularity are null for this kind.
  - section: EVERY entry (row, adjustment, AND subtotal) carries this field — the note's own section heading it sits under, copied VERBATIM (e.g. "Long-term debt", "Short-term borrowings"), or null when the filing prints no such heading for this entry (a flat, single-section note has no headings at all — every entry is null; that is the normal, expected case for most companies). A subtotal that closes out a section (e.g. "Total long-term debt" closing the "Long-term debt" section) carries THAT section's own name. A subtotal that rolls multiple sections together (e.g. "Total debt," which is not itself scoped to one heading) carries section: null. If you cannot tell which heading a specific row sits under, leave section null rather than guess — do not force an assignment you are not sure of.
  - PRINTED ORDER, NEVER REPOSITIONED — worked example. THE FIGURES BELOW ARE FAKE PLACEHOLDERS (deliberately impossible repeated-digit numbers) FROM AN IMAGINARY FILING. They exist ONLY to show the SHAPE of the nesting. Never copy any number, label, or section name from this example into your answer; every value you return must come from the filing text you were actually given. If the filing you were given does not contain a debt schedule, return an empty scheduleSequence — do NOT reproduce this example.
    The imaginary filing prints "Short-term borrowings:" first, with one row, "Commercial paper" (11,111, section "Short-term borrowings") — this goes into the sequence FIRST, exactly where it is printed, never moved later. THEN it prints the "Long-term debt:" section: rows "Instrument A" (22,222), "Instrument B" (33,333), "Instrument C" (44,444), each section "Long-term debt"; then adjustment "Debt issuance costs and discounts" (-1,111), also section "Long-term debt"; then subtotal "Total long-term debt" (98,888), section "Long-term debt" — reconciles against the "Long-term debt" section's own rows+adjustment only: 22,222+33,333+44,444-1,111=98,888 (commercial paper is NOT part of this sum — it's a different section). THEN subtotal "Total debt" (109,999), section null — this is a ROLLUP: it reconciles against "Total long-term debt" (98,888) PLUS the "Short-term borrowings" section's own total (11,111) = 109,999. THEN adjustment "Less amounts due within one year" (-2,222), section null. THEN a FINAL subtotal with label null, section null (the filing prints this figure — 107,777 — with no "Total ..." caption at all) — reconciles against "Total debt" (109,999) minus the adjustment above it (-2,222) = 107,777. Every entry stayed exactly where the filing printed it; only the section field, not position, tells the checksum how to group them.
  - periodColumn — EVERY entry (row, adjustment, AND subtotal). A debt table prints at least TWO amount columns: this period and the prior comparative period (e.g. "June 30, 2026" and "December 31, 2025"). READ ONLY THE CURRENT-PERIOD COLUMN — the one matching the period end named in the "Debt-schedule filing guidance" section above — and copy that column's own header here VERBATIM. This is checked in code against the filing's actual period of report, and any entry bound to a different period is DROPPED, so guessing costs you the row. Two specific traps: (a) when the current-period cell is a dash or blank (the instrument was repaid), the amount is ZERO or the row is simply absent — do NOT reach across to the prior column's number to fill the gap; (b) a subtotal row has two figures too, and the FIRST one is the current period. Set periodColumn to null only when the table genuinely prints a single amount column with no period header at all.
  - EVERY entry's amount MUST carry its own unit (same "unit always attached" rule as everywhere else in this schema) — a bare "98,888" with no unit is wrong even when the sign is correctly preserved.
  - COPY THE DIGITS AS PRINTED. NEVER RESTATE THEM IN ANOTHER UNIT. The amount you return is the number the filing prints at that point, character for character, with the unit that governs it there — and nothing else. Do not rescale, do not normalise, and do not make one entry's units match another's.
    - A table cell printing "700,000" under an "(In thousands)" caption is "$700,000 thousand". Correct: the digits are the cell's, the unit is the caption's.
    - A bullet or sentence printing "$ 700 million" is "$700 million". Correct, for the same reason: the digits and the unit are both printed right there.
    - "$700,000 thousand" for a bullet that prints "$ 700 million" is WRONG, even though the value is identical. You rewrote the number. Code checks that the amount you report is actually printed on or beside the line you quoted, so a restated figure is indistinguishable from an invented one and the entry is discarded — the row is lost and the ladder comes up short.
    - The same in reverse is equally wrong: "$700 million" for a cell that prints "700,000" under a thousands caption.
    There is never a reason to convert. A schedule whose rows come from a table stated in thousands and whose other rows come from bulleted sentences stated in millions is transcribed with BOTH units exactly as each was printed; making them uniform is not tidying, it is altering the source.
  - scheduleTableUnit: MANY filings state the table's scale ONCE, in the table's own header or caption, instead of repeating it on every row — e.g. "(In millions)", "(amounts in thousands)", "(dollars in thousands)". Copy that declaration here VERBATIM, exactly as printed, whenever the table has one. This is NOT a substitute for the per-entry unit rule above — still attach each entry's unit whenever the row itself states one. It is what lets code recover the correct scale for rows that genuinely state none, so a row reading only "$ 555" (again an illustrative placeholder, not a figure to copy) under an "(In millions)" caption is read as $555 million and not as 555 dollars. Set it to null ONLY when the table truly prints no scale declaration anywhere in or above it — never invent one, and never infer a scale from how large the numbers look.
  - priorScheduleTableUnit: the same, for the PRIOR-period filing's own table (a different document with its own separate caption — never assume it matches the base filing's).
  - balanceSheetTableUnit: the same, for the BALANCE SHEET's own unit declaration. The balance sheet is a different statement from the debt note, with its own caption — never carry the note's declaration over to it.
  - sourceLine for EVERY entry (row, adjustment, and subtotal alike) — copied VERBATIM, character-for-character, exactly as it appears in the filing text given above, held to the EXACT SAME standard as the "quote" field's instructions above (re-read them). Not a clean sentence you compose describing the line — the filing's own raw text at that point, cells run together exactly as extracted, spacing and all.
  - The prior-period filing (if any) is ALSO named in the "Debt-schedule filing guidance" section — do not search the catalog for it yourself. Transcribe ITS OWN running sequence the same way into priorScheduleSequence. If the guidance section says no second filing exists, priorScheduleSequence is [].
  - balanceSheetDebtCaptions: from the SAME base filing's own BALANCE SHEET — a different section of the same document from the debt note, not the note's own totals. Every debt-related line item that balance sheet actually prints (e.g. "Current portion of long-term debt," "Long-term debt," and, for some companies, a separate "Commercial paper" caption). This is NOT a fixed set of captions to fill in — read whichever ones THIS SPECIFIC company's balance sheet actually states; some companies split out finance leases separately, some fold commercial paper into a combined line, some have no separate short-term caption at all. Copy each caption's own label and amount verbatim (unit always attached), with sourceLine verified the same verbatim way as everything else. The balance sheet is comparative too — read ONLY the current-period column and record its header in that caption's own periodColumn, same rule and same code check as scheduleSequence above. Leave empty only if the balance sheet genuinely states no debt captions at all — should be rare.

- redeems / issuedTranches — ONLY for the "new-debt-issuance" trigger. Leave both at their empty default (null, []) for every other trigger.
  - redeems: the instrument THIS issuance retires, or null. This field REMOVES DEBT FROM THE LADDER, so it is held to the same standard as every other claim here: copy what the filing says, and give the sentence you copied it from.
    - instrument: the instrument being retired, as the filing names it.
    - amount: the amount retired, verbatim with its unit, when the filing states one. A partial call names a figure ("redeem at par $ 400 million in aggregate principal amount of the $ 800 million in outstanding principal amount of our 4.50 % Senior Notes due 2028") — the amount is the $400 million being redeemed, not the $800 million outstanding. Null when the filing states no figure.
    - status: "completed" when the filing describes the retirement as something that HAS HAPPENED ("we redeemed all $1.500 billion aggregate principal amount of...", "repaid in full at maturity"). "intended" when it describes a plan, an expectation, or a use of proceeds ("intends to use the net proceeds ... to finance ... the redemption of..."). The difference is the whole point of the field: an intent is not a retirement, and a tranche is not removed from a company's debt because somebody said they meant to pay it.
    - sourceLine: the sentence stating it, copied VERBATIM, character for character, to the EXACT SAME standard as "quote". This is verified in code against the cited filing, and a claim whose sourceLine cannot be found there is discarded.
  - AN INSTRUMENT NAMED IS NOT AN INSTRUMENT RETIRED. A pricing 8-K routinely lists a company's other outstanding notes to say what the new notes rank alongside — "secured equally and ratably with the Issuer's senior secured credit facility, the Issuer's 1.650% Senior Secured Notes due 2026 (the 'Existing 2026 Notes'), 4.625% Senior Secured Notes due 2029 ...". Every instrument in that sentence is OUTSTANDING; the sentence exists to say so. It is not a redemption of any of them. Return null rather than reading a list of existing obligations as a retirement.
  - issuedTranches: the row(s) for the tranche(s) THIS issuance itself just priced (instrument/rate/seniority/amount/maturityDate/dateGranularity/sourceLine) — a pricing 8-K states these just as concretely as a periodic debt note does. One row per distinct tranche priced in this issuance. sourceLine here follows the exact same verbatim-copy rule as scheduleSequence's sourceLine above — copy the pricing 8-K's own text for that tranche, never a composed summary sentence.

- cashAmount / projectName — EVERY trigger.
  - cashAmount: the dollar amount THIS SPECIFIC event's own filing text states for it, with its unit — or null. Not any dollar figure that happens to appear nearby; the amount actually being received, paid, committed, or raised for this exact event. A classification with no realized cash movement (e.g. assets reclassified as held-for-sale, which states a carrying value but nothing has actually been sold or received yet) is null, even though a dollar figure is present in the disclosure — the carrying value is not this event's cashAmount. An announcement, launch, or formation with no dollar figure stated anywhere for it is null. Do not extract which direction the cash moves (in or out) — that already comes from the trigger itself; do not create a second, possibly disagreeing answer to a question this schema doesn't ask.
  - projectName: the discrete, NAMED project or facility the filing calls out for this event (e.g. "Alan B. Miller Medical Center"), or null when the amount is a period total with no specific named thing behind it (e.g. "capital expenditures of $348 million for the six months ended..."). Amount plus a name is a named project; amount with no name is period spend — this field is only what tells the two apart, never a judgment about whether either one matters.

- eventInstances — ONLY for these six triggers: "asset-sale", "acquisition-announced", "capex-program", "ipo-secondary", "dividend-buyback", "new-subsidiary". Leave it at its empty default ([]) for every other trigger.
  - WHY THIS EXISTS: these are events, and a company routinely has more than one of them in a single period. Until now this schema had exactly one slot per trigger, so a second real event had nowhere to go — one filing describes TWO hospital divestitures, the slot took the smaller one, and the larger (a $459 million sale) survived only as prose inside evidence and was then trimmed for length. Nothing was missed by the reader of the filing. There was nowhere to put it.
  - TRANSCRIPTION, NOT SELECTION. Copy EVERY qualifying event the filings state, in the order they are printed. Do not rank them, do not choose the most important, do not keep only the most recent, and do not stop at one because one feels like enough. If the filings describe four acquisitions, return four entries. If they describe one, return one. If none, return [].
  - Each entry carries its OWN fields, describing THAT event and no other:
    - description: what happened, in the filing's own terms — enough that a reader knows which event this is ("the sale of Crestwood Medical Center in Huntsville, Alabama").
    - amount: THIS event's own amount with its unit attached, or null when the filing states none FOR THIS EVENT. Never borrow the figure from a sibling event, and never use a combined total covering several of them.
    - eventDate + dateGranularity: THIS event's own date, under the exact same copy-never-compute rules as the top-level eventDate above. A bare year stays a bare year.
    - eventStatus: THIS event's own status, from the same four values.
    - sourceLine: copied VERBATIM, character-for-character, from the filing text given above — held to the EXACT SAME standard as the "quote" field (re-read its instructions). The filing's own raw text for this event, never a sentence you compose describing it. This is verified in code against the filing, and an entry whose sourceLine cannot be found is dropped.
  - The top-level evidence/quote/eventDate/cashAmount fields still describe the trigger as a whole and are unchanged. eventInstances is additional, not a replacement — fill both.

- noteRetirements — ONLY for the "debt-maturity" trigger. Leave it at its empty default ([]) for every other trigger.
  - A debt note often states, IN ITS OWN PROSE rather than in the table, that some of an instrument was repaid, repurchased, called, or redeemed during the period — e.g. "During the three and six months ended June 30, 2026, the Company repurchased $118 million and $1,147 million, respectively, of its par value Senior Notes due 2027." That text is inside the debt note you were already given, and until now there was no field for it, so the ladder could show a balance moving with no stated cause.
  - Read ONLY the located debt note — the same section the schedule came from. Do NOT go looking through the rest of the filing for retirement language; the note's own narrative is the whole scope of this field.
  - One entry per retirement the note describes. Copy, never infer:
    - instrument: the instrument as the note names it.
    - amount: the amount retired or repurchased, unit attached, or null when the prose names no figure. Where the note states several figures for different periods (a three-month and a six-month figure in one sentence), record the one matching THIS FILING'S OWN PERIOD OF REPORT, named in the guidance section above.
    - eventDate + dateGranularity: the date the note states for it, or null. Same copy-never-compute rules.
    - sourceLine: VERBATIM from the note, same standard as everywhere else.
  - If the note's prose describes no retirement at all, return []. Do not manufacture one from the fact that a balance changed.


- proseInstruments — ONLY for the "debt-maturity" trigger. Leave it at its empty default ([]) for every other trigger.
  - HALF A CAPITAL STRUCTURE CAN LIVE IN PROSE. Some companies present their debt as a table; others describe it in sentences and bullets in the same note, with no table at all. When there is no table, the schedule sequence above will be empty and this field is the ONLY record of what the company owes. When there IS a table, this field captures what the table leaves out — typically the credit agreement's term loan and revolver, which are often described in narrative even by companies whose notes are tabular.
  - A BULLETED LIST OF INSTRUMENTS IS ONE ENTRY PER BULLET. Some notes present the whole of a debt class as bullets under an introductory sentence — "As of June 30, 2026, we had combined aggregate principal of $ 3.0 billion from the following senior secured notes:" followed by "• $ 700 million of aggregate principal amount of 1.65 % senior secured notes due in September, 2026 (\"2026 Notes\") ...", and four more like it. That is five instruments and it becomes FIVE entries here, in printed order, each with its own amount, rate and maturityDate taken from its OWN bullet and no other. Do not merge them, do not summarise them, and do not return only the introductory aggregate — the aggregate is the total of the five, not a sixth instrument.
  - THE AMOUNT IS COPIED IN THE UNIT THE BULLET OR SENTENCE PRINTS IT IN, exactly as the schedule field above requires of a table cell. A bullet printing "$ 700 million" is "$700 million" — never "$700,000 thousand", even to match some other entry's units. Code checks the amount you report is actually printed in the text you quoted, so a restated figure is indistinguishable from an invented one and the entry is discarded.
  - Read ONLY the located debt note IN THE ANCHOR FILING — the same section everything else came from, in the same filing named in the guidance section. Do NOT search the rest of the filing, and do NOT take an instrument's balance from an earlier quarter's filing: a balance is as of the filing that states it, and one read from March printed beside a June ladder is a position at neither date.
  - One entry per instrument the note states. Copy, never infer:
    - category: which KIND of instrument, from the fixed list — term-loan, revolver, delayed-draw-term-loan, senior-notes, finance-lease, other. This is the field identity is matched on, so choose it by what the instrument IS, not by what it is called. A "Tranche A term loan" is term-loan. A "delayed draw term loan A facility" is delayed-draw-term-loan, because undrawn capacity is not drawn debt.
    - name: the filing's own name for it, verbatim, or null. This is DISPLAY TEXT ONLY. "Eleventh Amendment" and "Twelfth Amendment" describe amendments to the same facility, not two facilities — never treat a name as an identity.
    - amount: the outstanding or stated amount, VERBATIM with its unit as printed ("$ 1.448 billion", "$225 million"). If the note states the instrument but gives it no amount, set this to null — do NOT estimate, and do NOT borrow a figure from a neighbouring sentence about a different instrument. Where a sentence states BOTH a facility's size and what is drawn against it ("$ 1.272 billion of available borrowing capacity pursuant to the terms of our $ 1.5 billion revolving credit facility (net of $ 225 million of outstanding borrowings...)"), the amount for this instrument is the OUTSTANDING one — $225 million — never the size.
    - amountBasis: what that amount IS — "outstanding" when the note states it as a balance owed, drawn, borrowed, or outstanding; "commitment" when it states a facility's size, capacity, availability, or an amount that may be borrowed but has not been. Null only when the sentence genuinely does not say which. This is not a judgment about importance: a $1.25 billion revolving credit facility with nothing drawn is a real and useful fact, and it is capacity, not debt. Copy what the sentence says; code decides what to do with each.
    - Where the note describes a facility's amendment history, the amount is the one stated for NOW, never an amount the sentence describes as prior ("increased the existing term loan A by $ 300 million to $ 1.455 billion ($ 1.448 billion outstanding as of June 30, 2026) from $ 1.155 billion previously" — the amount is $ 1.448 billion, the outstanding balance; $ 1.155 billion is what it used to be and is not this instrument's amount).
    - asOfDate + dateGranularity: the date the amount is stated AS OF, copied from the sentence carrying it ("$1.448 billion outstanding as of June 30, 2026" -> asOfDate "2026-06-30"). Null if the sentence states no date.
    - maturityDate, rate: only when the note states them for this instrument. Null otherwise.
    - sourceLine: copied VERBATIM, character-for-character, from the located note. Held to the EXACT same standard as "quote". This is verified in code against the note's own span, and an entry whose sourceLine cannot be found there is dropped.
  - A LIABILITY THE NOTE SAYS IS INCLUDED IN DEBT IS AN INSTRUMENT, even when the sentence names no facility and no lender. "our consolidated balance sheets at June 30, 2026 and December 31, 2025 reflect financial liabilities, which are included in debt, of approximately $ 68 million and $ 70 million, respectively" is one entry: category "other", amountBasis "outstanding", the filing's own words as the name. It is part of the balance the balance sheet reports, so a ladder that omits it cannot reconcile to that balance. Do not skip a sentence because it describes an obligation rather than a facility.
    - WHERE ONE SENTENCE GIVES FIGURES FOR TWO DATES, take the one for THIS FILING'S OWN PERIOD OF REPORT, named in the guidance section above — the same rule as reading the current column of a comparative table. In the example, at a June 30, 2026 period of report the amount is "$ 68 million", never "$ 70 million".
  - AN AMOUNT AND ITS INSTRUMENT MUST COME FROM THE SAME SENTENCE. A sentence about a revolver's capacity sitting next to a sentence about a term loan's balance are two instruments, not one; do not combine them.
  - Do NOT duplicate rows that are already in the schedule sequence. If an instrument appears as a row in the table above, it does not belong here as well.

- revolver — ONLY for the "debt-maturity" trigger. Null for every other trigger, and null when the located note states nothing about a revolving facility.
  - A revolver's SIZE, what is DRAWN against it, letters of credit issued under it, and what remains AVAILABLE are four different numbers, and filings usually state them in one sentence: "we had $1.272 billion of available borrowing capacity pursuant to the terms of our $1.5 billion revolving credit facility (net of $225 million of outstanding borrowings and $3 million of letters of credit)".
  - Copy each into its OWN field, verbatim with units — facilitySize, drawn, lettersOfCredit, available. Any the note does not state stays null. Do not compute a missing one from the others; code checks that drawn + lettersOfCredit + available equals facilitySize, and that check is only meaningful if all four were read rather than derived.
  - delayedDrawCapacity: committed but undrawn term-loan capacity, when the note states it. This is capacity, not debt.
  - asOfDate: the date those figures are stated as of. sourceLine: the verbatim sentence, same standard as above.

- projectCompletionDate / projectCompletionGranularity — ONLY for the "capex-program" trigger. Leave both null for every other trigger.
  - When the filing states when a named project is expected to be, or was, completed — "scheduled to be completed in December 2026", "opened during the second quarter of 2026" — copy that date here under the same copy-never-compute rules as every other date in this schema. A bare year stays a bare year; a quarter with no month stated is that quarter's own year unless the filing names a month.
  - Null when the filing names no completion date, which is the normal case for a period-spend figure with no specific project behind it.
  - Do NOT derive a status from this date yourself — code does that. Your job is only to copy the date the filing states.

Return a result for every one of the 15 triggers, even ones with no signal at all.`;

function formatTriggers(triggers: TriggerDef[]): string {
  return triggers
    .map(
      (t) =>
        `- id: ${t.id}\n  name: ${t.name}\n  signal: ${t.signal}\n  needType: ${t.needType}\n  detectability: ${t.detectability}`
    )
    .join("\n");
}

function formatCatalog(catalog: FilingCatalogEntry[]): string {
  return catalog
    .map((f) => `${f.form} | ${f.filingDate} | items=${f.items || "-"} | ${f.url}`)
    .join("\n");
}

function formatCorpus(docs: CorpusDoc[]): string {
  return docs
    .map((d) => `--- ${d.form} filed ${d.filingDate} (${d.url}) ---\n${d.text}`)
    .join("\n\n");
}

/**
 * Session 18 (post-v6, live-diagnosed): the old instruction — "find the
 * SINGLE most recent 10-Q or 10-K" — leaves the model to search for a
 * filing that may not have a locatable debt schedule at all (Centene: 28
 * fabricated rows resembling ANOTHER company's real debt structure, because
 * the "most recent" filing by date didn't carry the table and the model
 * filled the gap rather than say so; Cigna: the table exists ONLY in the
 * 10-K, never either 10-Q — a strict "most recent by date" reading would
 * have picked a 10-Q with nothing there). A locator miss and a fabrication
 * risk are the same event: whichever filing the model is asked to
 * transcribe from should be one CODE has already confirmed has a real,
 * locatable schedule (lib/fetch/noteLocation.ts), never one merely
 * guessed to be "most recent." This is computed once per company in
 * loop.ts (deterministic, zero LLM cost) and handed to the model as a
 * closed choice instead of an open search.
 */
export interface DebtScheduleFilingRef {
  form: string;
  /** Filing date (when it was submitted to EDGAR). */
  date: string;
  url: string;
  /** Session 18 (post-v12): EDGAR's own period-of-report for this filing — the authoritative answer to "which column is the current one," taken from filing metadata rather than inferred from the table or trusted from the model. Drives the column-binding check in lib/agent/loop.ts. */
  reportDate: string;
}
export interface DebtScheduleFilingGuidance {
  base: DebtScheduleFilingRef | null;
  prior: DebtScheduleFilingRef | null;
}

function formatDebtScheduleGuidance(g: DebtScheduleFilingGuidance): string {
  if (!g.base) {
    return [
      `## Debt-schedule filing guidance (determined in code, not for you to search)`,
      `No filing in this company's corpus was found to contain a locatable, itemized debt schedule table — checked across every 10-Q/10-K fetched, not guessed. If debt-maturity fires based on narrative evidence elsewhere (a single MD&A sentence, an 8-K), that is fine for evidence/quote/eventDate as usual, but debtSchedule and priorDebtSchedule MUST stay empty ([]) and statedTotal MUST stay null. Do NOT fabricate rows, and do NOT reach for a structure that resembles a typical debt schedule from memory or from a different company's usual shape — a filing genuinely lacking a locatable table is a real, reportable fact, not a gap to paper over.`,
    ].join("\n");
  }
  const priorLine = g.prior
    ? `The prior-period filing for priorDebtSchedule is: ${g.prior.form} filed ${g.prior.date}, period ending ${g.prior.reportDate} (${g.prior.url}) — transcribe ITS OWN debt note the same way, from that filing alone, reading ITS OWN current column (the one for ${g.prior.reportDate}).`
    : `No second filing with a locatable schedule exists in this corpus — priorDebtSchedule stays [].`;
  return [
    `## Debt-schedule filing guidance (determined in code, not for you to search)`,
    `The base filing for debtSchedule/statedTotal is: ${g.base.form} filed ${g.base.date} (${g.base.url}) — use ONLY this filing's own debt note table, transcribed in full.`,
    `THE CURRENT PERIOD FOR THIS FILING IS ${g.base.reportDate}. Every amount you report from it — every scheduleSequence entry AND every balance-sheet caption — must come from the column for ${g.base.reportDate}, and each entry's periodColumn must be that column's own verbatim header. Amounts read from the prior comparative column are dropped in code, so a row taken from the wrong column is a row lost, not a row saved.`,
    `Continuing on the base filing: This is NOT necessarily the single newest 10-Q/10-K by date — it is whichever filing was confirmed (in code, before this prompt was built) to actually contain a locatable schedule. Do not substitute a different, newer filing even if one exists in the catalog below; that newer filing's own debt note either doesn't exist or wasn't locatable, which is exactly why this one was selected instead.`,
    priorLine,
  ].join("\n");
}

/**
 * Session 18: the new debtSchedule/priorDebtSchedule/reconcilingLines/
 * issuedTranches/cashAmount/projectName/redeems/statedTotal fields are all
 * OPTIONAL in the tool schema (not in VERDICT_ITEM_SCHEMA's `required`) so
 * the 14 unrelated triggers' existing behavior is never disturbed by their
 * mere addition — but that means a verdict can come back with them simply
 * missing (undefined), not an empty default. Every downstream reader
 * (position.ts, eligibility.ts, factBase.ts) is written against the
 * documented defaults ([]/[]/[]/  null etc.), never against "possibly
 * undefined" — this is where that guarantee is made true, once, for both
 * call sites below.
 */
const SESSION18_OPTIONAL_FIELDS = [
  "scheduleSequence",
  "priorScheduleSequence",
  "balanceSheetDebtCaptions",
  "scheduleTableUnit",
  "priorScheduleTableUnit",
  "balanceSheetTableUnit",
  "redeems",
  "issuedTranches",
  "cashAmount",
  "projectName",
  // Session 19 fields join the same list for the same reason: optional in
  // the tool schema so an unrelated trigger is never disturbed by their
  // addition, defaulted here so no downstream reader ever sees undefined.
  "eventInstances",
  "noteRetirements",
  "proseInstruments",
  "revolver",
  "projectCompletionDate",
  "projectCompletionGranularity",
] as const;
type Session18OptionalField = (typeof SESSION18_OPTIONAL_FIELDS)[number];
/** A raw verdict as the tool call (or a hand-built synthetic one) may legitimately omit the Session 18 fields — the shape withFieldDefaults accepts. */
export type TriggerVerdictInput = Omit<TriggerVerdict, Session18OptionalField> & Partial<Pick<TriggerVerdict, Session18OptionalField>>;

/** rate/seniority/maturityDate/dateGranularity are optional in SCHEDULE_SEQUENCE_ENTRY_SCHEMA/ISSUED_TRANCHE_SCHEMA for the same "don't disturb the 14 unrelated triggers" reason every other Session 18 field is optional — an entry that omits one entirely needs the same undefined-to-null normalization withFieldDefaults already does at the verdict level. */
function normalizeRow<T extends { rate?: string | null; seniority?: string | null; maturityDate?: string | null; dateGranularity?: DateGranularity | null }>(
  row: T
): T & { rate: string | null; seniority: string | null; maturityDate: string | null; dateGranularity: DateGranularity | null } {
  return {
    ...row,
    rate: row.rate ?? null,
    seniority: row.seniority ?? null,
    maturityDate: row.maturityDate ?? null,
    dateGranularity: row.dateGranularity ?? null,
  };
}

/** `label`/`section` are optional in SCHEDULE_SEQUENCE_ENTRY_SCHEMA (a genuinely unlabeled subtotal, or a top-level entry with no heading, is real and expected) — need the same undefined-to-null normalization. */
function normalizeSequenceEntry(entry: ScheduleSequenceEntry & { label?: string | null; section?: string | null; periodColumn?: string | null }): ScheduleSequenceEntry {
  return { ...normalizeRow(entry), label: entry.label ?? null, section: entry.section ?? null, periodColumn: entry.periodColumn ?? null };
}

export function withFieldDefaults(v: TriggerVerdictInput): TriggerVerdict {
  return {
    ...v,
    scheduleSequence: (v.scheduleSequence ?? []).map(normalizeSequenceEntry),
    priorScheduleSequence: (v.priorScheduleSequence ?? []).map(normalizeSequenceEntry),
    balanceSheetDebtCaptions: (v.balanceSheetDebtCaptions ?? []).map((c) => ({ ...c, periodColumn: c.periodColumn ?? null })),
    scheduleTableUnit: v.scheduleTableUnit ?? null,
    priorScheduleTableUnit: v.priorScheduleTableUnit ?? null,
    balanceSheetTableUnit: v.balanceSheetTableUnit ?? null,
    // A legacy cached answer carries `redeems` as a bare string: a
    // description with no evidence and no status. It is normalised to the
    // object shape with BOTH missing, which is precisely what it is — an
    // unverified claim — and the position layer will not retire on it.
    redeems:
      typeof v.redeems === "string"
        ? { instrument: v.redeems, amount: null, status: null, sourceLine: null }
        : v.redeems
          ? { instrument: v.redeems.instrument, amount: v.redeems.amount ?? null, status: v.redeems.status ?? null, sourceLine: v.redeems.sourceLine ?? null }
          : null,
    issuedTranches: (v.issuedTranches ?? []).map(normalizeRow),
    cashAmount: v.cashAmount ?? null,
    projectName: v.projectName ?? null,
    eventInstances: (v.eventInstances ?? []).map((e) => ({
      ...e,
      amount: e.amount ?? null,
      eventDate: e.eventDate ?? null,
      dateGranularity: e.dateGranularity ?? null,
    })),
    noteRetirements: (v.noteRetirements ?? []).map((r) => ({
      ...r,
      amount: r.amount ?? null,
      eventDate: r.eventDate ?? null,
      dateGranularity: r.dateGranularity ?? null,
    })),
    proseInstruments: (v.proseInstruments ?? []).map((p) => ({
      ...p,
      name: p.name ?? null,
      amount: p.amount ?? null,
      amountBasis: p.amountBasis ?? null,
      asOfDate: p.asOfDate ?? null,
      dateGranularity: p.dateGranularity ?? null,
      maturityDate: p.maturityDate ?? null,
      rate: p.rate ?? null,
    })),
    revolver: v.revolver
      ? {
          facilitySize: v.revolver.facilitySize ?? null,
          drawn: v.revolver.drawn ?? null,
          lettersOfCredit: v.revolver.lettersOfCredit ?? null,
          available: v.revolver.available ?? null,
          delayedDrawCapacity: v.revolver.delayedDrawCapacity ?? null,
          asOfDate: v.revolver.asOfDate ?? null,
          sourceLine: v.revolver.sourceLine,
        }
      : null,
    projectCompletionDate: v.projectCompletionDate ?? null,
    projectCompletionGranularity: v.projectCompletionGranularity ?? null,
  };
}

/**
 * Session 18: a `max_tokens` stop is a genuinely different failure from "the
 * checksum didn't tie" — a truncated response can ALSO make the checksum
 * fail (a partial schedule under-sums the stated total), but truncation
 * needs a bigger token budget, not a prompt fix, and conflating the two
 * would send whoever's debugging a tie-rate miss down the wrong path. Loud
 * and named, same "never silent" standing guard the rest of this pipeline
 * already follows — never inferred after the fact from a downstream guard.
 */
function assertNotTruncated(response: { stop_reason: string | null }, context: string): void {
  if (response.stop_reason === "max_tokens") {
    throw new Error(`TRUNCATED RESPONSE for ${context} — stop_reason was "max_tokens"; raise max_tokens, this is not a checksum/extraction-accuracy issue`);
  }
}

/**
 * Session 18: retry-once wrapper — a malformed tool-call response
 * (`results` not an array, or no tool_use at all) is a genuinely rare but
 * observed transient shape for this much LARGER response (a full
 * debtSchedule + priorDebtSchedule on top of the other 14 triggers), not a
 * deterministic bug: confirmed live, an identical re-ask of the exact same
 * company/corpus (temperature 0) succeeded cleanly on the very next call.
 * One retry, same "loud failure only after genuinely exhausting the
 * option" pattern draftEventBriefing already uses for the narration guard —
 * a SECOND malformed response throws for real, never silently degrades.
 */
export async function classifyAllTriggers(params: {
  companyName: string;
  triggers: TriggerDef[];
  catalog: FilingCatalogEntry[];
  corpus: CorpusDoc[];
  debtScheduleGuidance: DebtScheduleFilingGuidance;
}): Promise<TriggerVerdict[]> {
  try {
    return await attemptClassifyAllTriggers(params);
  } catch (err) {
    console.warn(`[claude] ${params.companyName} — classifyAllTriggers malformed response, retrying once: ${err instanceof Error ? err.message : String(err)}`);
    return await attemptClassifyAllTriggers(params);
  }
}

async function attemptClassifyAllTriggers(params: {
  companyName: string;
  triggers: TriggerDef[];
  catalog: FilingCatalogEntry[];
  corpus: CorpusDoc[];
  debtScheduleGuidance: DebtScheduleFilingGuidance;
}): Promise<TriggerVerdict[]> {
  const { companyName, triggers, catalog, corpus, debtScheduleGuidance } = params;

  const userContent = [
    `Company: ${companyName}`,
    ``,
    `## The 15 triggers`,
    formatTriggers(triggers),
    ``,
    formatDebtScheduleGuidance(debtScheduleGuidance),
    ``,
    `## Full filing catalog (available for digging; not all are excerpted below)`,
    formatCatalog(catalog),
    ``,
    `## Filing excerpts`,
    formatCorpus(corpus),
  ].join("\n");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    // Session 18: raised from 6144 — a full multi-tranche debtSchedule PLUS
    // its priorDebtSchedule counterpart PLUS the other 14 triggers' normal
    // answers, all in one tool call, can be considerably larger than any
    // single-fact-per-trigger response ever was. Tunable; confirm against a
    // real HCA/Cigna (both ~10-tranche companies) response size during the
    // pilot re-extraction and raise further if assertNotTruncated ever
    // fires for a real company.
    // SESSION 20, STAGE 3 — RAISED FROM 12,000, BY MEASUREMENT.
    //
    // Cigna carries the book's largest note (38 schedule entries) and was
    // already generating ~11,600 output tokens at v17 — 96% of the old
    // ceiling. Adding proseInstruments and revolver pushed it over, and
    // assertNotTruncated stopped the run rather than banking a partial
    // extraction, which is exactly what that guard is for: a truncated
    // response and a wrong one both fail the checksum, and they need
    // different fixes. The error names this one.
    //
    // An unused ceiling costs nothing — output tokens are billed as
    // generated, not as budgeted — so the headroom is set well clear of the
    // largest real response rather than just above it. The 8 companies
    // already extracted under the old ceiling are unaffected: they stopped
    // on end_turn, so they are complete, and max_tokens is not part of the
    // cache key.
    max_tokens: 20000,
    temperature: 0,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: userContent }],
    tools: [
      {
        name: "submit_triage",
        description: "Submit the triage verdict for all 15 triggers.",
        input_schema: {
          type: "object",
          properties: {
            results: { type: "array", items: VERDICT_ITEM_SCHEMA },
          },
          required: ["results"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_triage" },
  });

  recordUsage(HAIKU_MODEL, response.usage);
  assertNotTruncated(response, `${companyName} — classifyAllTriggers`);

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Haiku did not return a submit_triage tool call");
  }
  const input = toolUse.input as { results: TriggerVerdict[] };
  if (!Array.isArray(input.results)) {
    throw new Error(`malformed submit_triage response for ${companyName} — results is not an array (got ${typeof input.results})`);
  }
  return input.results.map(withFieldDefaults);
}

/** Follow-up call for a single ambiguous trigger, given one additional filing's text. */
export async function classifyOneTrigger(params: {
  companyName: string;
  trigger: TriggerDef;
  priorVerdict: TriggerVerdict;
  extraDoc: CorpusDoc;
}): Promise<TriggerVerdict> {
  const { companyName, trigger, priorVerdict, extraDoc } = params;

  const userContent = [
    `Company: ${companyName}`,
    ``,
    `## Trigger to resolve`,
    `- id: ${trigger.id}`,
    `  name: ${trigger.name}`,
    `  signal: ${trigger.signal}`,
    `  needType: ${trigger.needType}`,
    `  detectability: ${trigger.detectability}`,
    ``,
    `## Prior (ambiguous) verdict`,
    JSON.stringify(priorVerdict),
    ``,
    `## Newly fetched filing (the one you asked to dig into)`,
    `--- ${extraDoc.form} filed ${extraDoc.filingDate} (${extraDoc.url}) ---`,
    extraDoc.text,
    ``,
    `Re-evaluate this one trigger with the new evidence and submit a final verdict. Set needsDig to false regardless — no further digs are available for this trigger.`,
  ].join("\n");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    // Session 18: raised from 3072 — a dig on "debt-maturity" specifically
    // can still need to return a full debtSchedule, same reasoning as
    // classifyAllTriggers above.
    max_tokens: 6144,
    temperature: 0,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: userContent }],
    tools: [
      {
        name: "submit_trigger_verdict",
        description: "Submit the final verdict for this one trigger.",
        input_schema: VERDICT_ITEM_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_trigger_verdict" },
  });

  recordUsage(HAIKU_MODEL, response.usage);
  assertNotTruncated(response, `${companyName} — classifyOneTrigger(${trigger.id})`);

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Haiku did not return a submit_trigger_verdict tool call");
  }
  return withFieldDefaults(toolUse.input as TriggerVerdict);
}
