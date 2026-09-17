import { createHash } from "node:crypto";
import { TRIGGERS, type TriggerDef } from "./triggers";
import { selectBaselineFilings } from "./selectFilings";
import { getRecentFilings, readFiling, searchNews } from "./tools";
import { quoteAppearsIn } from "./verifyQuote";
import { verifyFacilities, type VerifiedFacility, type FigureRejection } from "./verifyFacility";
import { corpusOf } from "./corpus";
import type { FilingEntry } from "../fetch";
import {
  classifyAllTriggers,
  classifyOneTrigger,
  normalizeEventDate,
  withFieldDefaults,
  type BalanceSheetDebtCaption,
  type CorpusDoc,
  type DateGranularity,
  type DebtScheduleFilingGuidance,
  type DebtScheduleFilingRef,
  type EventStatus,
  type FilingCatalogEntry,
  type IssuedTrancheRow,
  type EventInstanceRow,
  type NoteRetirementRow,
  type ProseInstrumentRow,
  type SeniorityStatement,
  type ProceedsUseRow,
  type ProceedsUse,
  type RedeemsClaim,
  normalizeRedeems,
  type ScheduleSequenceEntry,
  type TriggerVerdict,
} from "./claude";
import { verifyTriggerQuote, verifyClaim, discriminatingDigitGroups } from "./verifyQuote";
import { verifyEventDate, type EventDateGuardResult } from "./factGuard";
import { classifyProceedsUse } from "./proceedsUse";
import { boundProceedsFilingText } from "./proceedsUseInput";
import { extractFactTokens, factTokensMatch, type FactToken } from "./factTokens";
import { textOutsideInstrumentLabel, splitIssueSizeFromName } from "./issueSize";
import { assertBlobConfigured } from "../fetch/cache";
import { corpusFingerprint, cachedBaseClassification, cachedDigClassification, cachedProceedsUse } from "../cache/answerCache";
import { LEAD_CHARS, buildExtractionText, assertCompanyHasLocatableDebtNote, type DebtNoteFilingStatus } from "../fetch/noteLocation";
import { fetchXbrlDebtTotal, fetchXbrlMaturityBuckets, type XbrlDebtTotal, type XbrlMaturityBuckets } from "../fetch/xbrlDebt";
import { computeScheduleCompleteness, type ScheduleCompletenessResult } from "../fetch/scheduleCompleteness";
import { checkMoneyScale, hasDeterminableMoneyScale, applyTableUnitToAmount, isSelfDescribingAmount, scaleWordFromDeclaration } from "./moneyScale";
import { detectDollarScaleAt } from "./scaleNormalize";
import { createTextLocator } from "./verifyQuote";
import { corroborateRedemptionStatus } from "./redemptionStatus";
import { beginCompanyCostScope, currentCompanySpend, formatCompanyCostLine, persistCompanySpend } from "./costMeter";

/** Session 18 (post-v11): rewrites each entry's `amount` with its own table's declared unit where the amount states none — see moneyScale.ts's applyTableUnitToAmount. Generic over every money-bearing extracted array (sequence entries, balance-sheet captions) since all of them share the `amount` field and hit the identical bug. */
function applyTableUnit<T extends { amount: string }>(entries: T[], declaration: string | null): T[] {
  if (!declaration) return entries;
  return entries.map((e) => {
    const rescaled = applyTableUnitToAmount(e.amount, declaration);
    return rescaled === e.amount ? e : { ...e, amount: rescaled };
  });
}

/**
 * Session 18 (post-v12) — COLUMN BINDING, the Quest class.
 *
 * Every debt table is comparative: this period's column and the prior
 * period's, side by side. Nothing in the schema said which one an `amount`
 * came from, and that gap is silently corrupting rather than loudly wrong —
 * a set of prior-column rows sums to the prior-column subtotal and passes
 * Check 1 perfectly, because the internal walk is self-consistent within
 * EITHER column. Only Check 2 catches it, and only because a balance sheet
 * is current-period by definition. Live case: Quest read prior-column
 * values for several rows and both subtotals, walked cleanly, and was
 * caught solely by a $29M anchor gap.
 *
 * The binding is deterministic and does not rest on the model's judgment:
 * the expected period comes from EDGAR's own period-of-report for the base
 * filing (FilingEntry.reportDate), not from the table, not from the model.
 * The model's only job is to copy the column header it actually read; code
 * decides whether that header is the right one.
 *
 * An entry whose stated column is a DIFFERENT period is dropped, never
 * accepted — per the same "never trust an unverified claim" rule sourceLine
 * and maturityDate already follow. An entry with no stated column is kept:
 * a genuinely single-column table is real (and null is the honest answer
 * there), so dropping on absence would discard good data to punish a
 * missing label. Both outcomes are logged.
 *
 * Deliberately NOT attempted: positionally binding the amount to the first
 * money token in its own sourceLine. Real sourceLines routinely embed
 * figures in the LABEL itself ("$ 550 million, 1.250 % Notes due March
 * 2026 549   —"), so "first number" is the face value, not the current
 * column, and the rule would misfire on exactly the companies it matters
 * most for.
 */
function bindEntriesToPeriod<T extends { amount: string; periodColumn: string | null }>(
  entries: T[],
  expectedReportDate: string | null,
  log: (line: string) => void,
  label: string,
  describe: (entry: T) => string,
  /** C2/C3 — written into by this function so the caller can tell "read the wrong column" apart from "no schedule here". */
  outcome?: { total: number; droppedForPeriod: number; unbound: number }
): T[] {
  if (outcome) { outcome.total = entries.length; outcome.droppedForPeriod = 0; outcome.unbound = 0; }
  if (!expectedReportDate) return entries;
  // Built explicitly from the ISO string rather than run through
  // extractFactTokens: that tokenizer does not parse a bare "2026-06-30" at
  // full day precision, so the expected side degraded to a YEAR-ONLY token
  // and factTokensMatch's partial-precision rule then accepted any date in
  // the same year — "March 31, 2026" passed against a June 30 filing.
  // Caught by columnBinding.test.ts [10]; a quarter-off column is exactly
  // what this check exists to reject.
  const iso = expectedReportDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) return entries;
  const expectedTokens: FactToken[] = [
    { kind: "date", raw: expectedReportDate, index: 0, dateValue: { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) } },
  ];
  const kept: T[] = [];
  let unbound = 0;
  let droppedForPeriod = 0;
  for (const entry of entries) {
    if (!entry.periodColumn || !entry.periodColumn.trim()) {
      unbound++;
      kept.push(entry);
      continue;
    }
    const columnTokens = extractFactTokens(entry.periodColumn).filter((t) => t.kind === "date");
    if (columnTokens.length === 0) {
      unbound++;
      kept.push(entry);
      continue;
    }
    const matches = columnTokens.some((ct) => expectedTokens.some((et) => factTokensMatch(et, ct)));
    if (matches) {
      kept.push(entry);
      continue;
    }
    droppedForPeriod++;
    log(
      `  ⚠ WRONG-COLUMN ENTRY DROPPED for ${label} — "${describe(entry)}" reports amount ${JSON.stringify(entry.amount)} from column ${JSON.stringify(entry.periodColumn)}, but this filing's period of report is ${expectedReportDate}; a prior-column amount walks cleanly against a prior-column subtotal, so it is dropped rather than trusted`
    );
  }
  if (unbound > 0) {
    log(`  COLUMN BINDING for ${label} — ${unbound} entr${unbound === 1 ? "y" : "ies"} stated no period column; kept (a single-column table is real), not verifiable either way`);
  }
  // C2 (Session 18, post-stage-2) — ASSERT THAT EXTRACTION CHOSE THE RIGHT
  // COLUMN, not merely that wrong ones get discarded. Those are different
  // claims: a filing every one of whose rows was discarded for period is a
  // filing that was READ WRONG, and until now that was indistinguishable
  // from a filing with no debt note at all. Stated per filing, loudly.
  if (entries.length > 0 && droppedForPeriod === entries.length) {
    log(
      `  ⚠ WRONG COLUMN READ for ${label} — all ${entries.length} transcribed entr${entries.length === 1 ? "y" : "ies"} state a period column that is not this filing's own period of report (${expectedReportDate}). The note was located and transcribed; the wrong column of it was read. This is a READ FAILURE, not an absent schedule.`
    );
  }
  if (outcome) { outcome.total = entries.length; outcome.droppedForPeriod = droppedForPeriod; outcome.unbound = unbound; }
  return kept;
}

/**
 * Session 18 (post-v14) — CODE-LEVEL SCALE DERIVATION.
 *
 * Every prior fix for the missing-scale class depended on the MODEL
 * volunteering the scale somewhere: per-row units (v3-v6), then the table
 * caption as its own field (v12). Tenet is the regression pair that shows
 * why that is not enough. Same filing, two consecutive runs: v13 came back
 * with per-row units ("$13,248 million") and verified 32/32; v14 came back
 * with bare amounts ("$ 1,750") AND no caption, and 24 of 28 rows were
 * dropped. Nothing about the filing changed — only what the model happened
 * to volunteer. A guard whose coverage swings on that is not a guard.
 *
 * So the scale is now derived from the FILING'S OWN governing declaration,
 * which is always there and never varies: "dollar amounts presented in our
 * Condensed Consolidated Financial Statements ... are expressed in
 * millions" (Tenet), "(In millions)" under a statement heading (HCA,
 * Centene, Molina), "Dollar amounts below are reflected in thousands"
 * (UHS). Verified against all 10 companies' real base filings at zero API
 * cost: every one resolves, and Tenet resolves to MILLIONS — matching the
 * per-row unit its v13 run happened to supply, which is exactly the
 * property the regression pair requires.
 *
 * Reuses scaleNormalize.ts's existing detectDollarScaleAt rather than
 * adding a second declaration finder. That function is already deliberately
 * conservative — it anchors on the word "dollar" (so a share-count "(in
 * thousands)" can never be mistaken for a money scale), or on a primary
 * financial-statement heading immediately followed by a bare caption, and
 * returns null rather than guessing.
 *
 * Resolution order, most authoritative first:
 *   1. The amount states its own scale ("$13,248 million") — always wins.
 *   2. The filing's own governing declaration nearest-preceding THIS
 *      entry's own verified sourceLine position. Deterministic, from the
 *      document, not the model.
 *   3. The model-reported table caption (scheduleTableUnit) — kept as a
 *      fallback for the case where the entry's sourceLine can't be located
 *      in the text (a co-occurrence-verified entry has no literal position).
 *   4. Nothing. The amount stays indeterminate and is dropped downstream.
 *      No inference, no default, no "probably millions."
 *
 * Per-ENTRY rather than per-table on purpose: each entry is resolved from
 * its own position, so balance-sheet captions pick up the balance sheet's
 * declaration rather than the debt note's, without needing to locate the
 * balance sheet separately.
 */
function deriveScaleFromFilingDeclaration<T extends { amount: string; sourceLine: string }>(
  entries: T[],
  filingText: string | undefined,
  log: (line: string) => void,
  label: string
): T[] {
  if (!filingText || entries.length === 0) return entries;
  let derived = 0;
  // Session 18 (post-v16): located the SAME way verification matched —
  // whitespace/glyph-normalized, mapped back to raw offsets. A raw indexOf
  // here silently failed on entries that had verified perfectly well, which
  // cost Molina four base-ladder rows. Built once per filing, not per entry.
  const locator = createTextLocator(filingText);
  const out = entries.map((entry) => {
    if (isSelfDescribingAmount(entry.amount)) return entry; // (1) the row's own scale always wins
    if (!entry.sourceLine) return entry;
    const at = locator.find(entry.sourceLine);
    if (at === null) return entry; // genuinely absent under normalization too -> no derivation; falls through to the caption fallback
    const scale = detectDollarScaleAt(filingText, at);
    if (!scale) return entry; // (4) filing declares nothing in range -> stays indeterminate, dropped later
    const candidate = `${entry.amount} ${scale.scaleWord}`;
    if (!checkMoneyScale(candidate).determinable) return entry;
    derived++;
    return { ...entry, amount: candidate };
  });
  if (derived > 0) {
    log(`  SCALE DERIVED FROM FILING for ${label} — ${derived} amount(s) had no unit of their own; resolved from the filing's own governing declaration (not the model)`);
  }
  return out;
}

/**
 * Session 18 (post-v15) — cashAmount is the FOURTH field of the same class
 * as scheduleSequence / priorScheduleSequence / balanceSheetDebtCaptions,
 * and was the only one still left on bare checkMoneyScale.
 *
 * The v15 live run is what exposed it. DaVita reports in thousands, so its
 * real cashAmounts come back as "$ 986,000", "$ 271,836", "$ 2,000,000",
 * "$ 668,963", "$ 4,392" — five figures, all nulled, and D2 (cashAmount
 * null never cards) meant DaVita carded nothing at all. Pre-v15 the same
 * five were ACCEPTED as literal dollars, i.e. read a thousand times too
 * small, silently. Routing cashAmount through the identical derivation
 * closes both directions at once: the filing's own "(dollars and shares in
 * thousands)" resolves them, and anything the filing does not govern stays
 * indeterminate and is still nulled.
 *
 * Deliberately calls deriveScaleFromFilingDeclaration itself, on a
 * one-element array, rather than reimplementing the resolution order for a
 * scalar — four fields sharing one rule must share one implementation, or
 * they drift apart exactly the way this one did.
 *
 * The anchor is the trigger's own VERIFIED quote, not the model's raw
 * quote: it is known-verbatim filing text, so indexOf locates it and
 * detectDollarScaleAt reads the declaration governing that position. A
 * fact whose quote never verified has no anchor and is left alone —
 * unverified text must never be used to position a scale lookup.
 */
function deriveCashAmountScale(
  cashAmount: string | null,
  anchorText: string | null,
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string
): string | null {
  if (!cashAmount || !anchorText) return cashAmount;
  // The filing this fact's own quote actually lives in — cited first, then
  // the rest of the fetched corpus, the same cited-first-then-fallback order
  // verifySourceLineAndScale uses.
  for (const url of [...new Set([...citedUrls, ...textByUrl.keys()])]) {
    const text = textByUrl.get(url);
    // Normalized location, same as everywhere else — a raw `includes` here
    // was the second half of the same anchor mismatch, and cost DaVita four
    // cashAmounts whose quotes had verified as literal.
    if (!text || createTextLocator(text).find(anchorText) === null) continue;
    const [derived] = deriveScaleFromFilingDeclaration([{ amount: cashAmount, sourceLine: anchorText }], text, log, `${label} (cashAmount)`);
    return derived.amount;
  }
  return cashAmount;
}

const MAX_DIG_STEPS = 5;

export type TraceHandler = (line: string) => void;

/** Session 18 (post-v9 redesign): a ScheduleSequenceEntry whose `sourceLine` verified against the fetched corpus, plus which specific filing it verified against — an unverified entry never reaches this shape, it's dropped (see verifySequenceEntries below). */
export interface VerifiedSequenceEntry extends ScheduleSequenceEntry {
  citedUrl: string;
}

/** Same verification, for new-debt-issuance's issuedTranches (not part of the debt note's running-total walk, just rows to append to the ladder). */
export interface VerifiedIssuedTranche extends IssuedTrancheRow {
  citedUrl: string;
}

/** Session 19, item 2a — an eventInstance whose sourceLine verified. An unverified entry never reaches this shape; it is dropped. */
export interface VerifiedEventInstance extends EventInstanceRow {
  citedUrl: string;
}

/** Session 19, item 2b — a note-prose retirement whose sourceLine verified INSIDE the located note (Rule 5). */
/** Session 20, 3a — a prose instrument whose sourceLine verified INSIDE the located note. An unverified entry never reaches this shape; it is dropped. */
export interface VerifiedProseInstrument extends ProseInstrumentRow {
  citedUrl: string;
}

/** Session 20, 3b — the revolver figures, once the sentence carrying them verified. */
/** A redemption claim after both gates: its status corrected by corroboration, and whether its sourceLine was found. */
export interface VerifiedRedeemsClaim extends RedeemsClaim {
  verified: boolean;
}

/**
 * Session 22, Stage 3 — VerifiedRevolver is gone. A verified facility now
 * lives in verifyFacility.ts, where the per-figure guard that produces it
 * lives, so the type and the check that earns it cannot drift apart.
 */

export interface VerifiedNoteRetirement extends NoteRetirementRow {
  citedUrl: string;
}

/** Same verification, for balanceSheetDebtCaptions (Check 2's input). */
export interface VerifiedBalanceSheetCaption extends BalanceSheetDebtCaption {
  citedUrl: string;
}

export interface TriggerResult {
  triggerId: string;
  triggerName: string;
  fired: boolean;
  dataAvailable: boolean;
  evidence: string | null;
  mappedNeed: string;
  needType: "credit" | "treasury" | "distress";
  confidence: number;
  citations: { form: string; date: string; url: string; /** EDGAR's period of report — "" when the filing states none (8-Ks). A periodic report cannot report a period ending after this date. */ reportDate: string }[];
  /** Did the model's `quote` field appear verbatim in the filing text we actually fetched? */
  quoteVerified: boolean;
  /** The verbatim source sentence(s) backing this trigger — only set when quoteVerified is true. Always the raw filing text, never scale-adjusted (see verifiedQuoteNormalized). */
  verifiedQuote: string | null;
  /** Which pass verified the quote — "literal" (the model's quote is a genuine contiguous substring of the filing) or "co-occurrence" (verified via the table-row fallback instead). Null when unverified. See verifyQuote.ts's QuoteVerificationResult.matchType doc for why this distinction matters. */
  quoteMatchType: "literal" | "co-occurrence" | null;
  /** Model-reported: does verifiedQuote itself contain the fact's material figure, or is it a figure-less fallback (the most specific factual sentence available, with no single sentence found to carry a figure)? False whenever quote/verifiedQuote is null. See claude.ts's quote instruction. */
  quoteHasFigure: boolean;
  /** Same fact as verifiedQuote, but with any bare (unit-less) table figure replaced by its scale-normalized dollar form where a governing "dollar amounts... in millions/thousands" declaration was found (scaleNormalize.ts). Falls back to the raw text when no bare figures needed normalizing or none could be safely resolved. This — not verifiedQuote — is what card narration is built from. */
  verifiedQuoteNormalized: string | null;
  /** ISO date ("YYYY-MM-DD") or bare year ("YYYY") of the event this fact describes, fact-guarded against the cited filing text (factGuard.ts) — null if the model gave none, or if it claimed one that couldn't be verified in the filing. The card-eligibility gate's sole source of "when" (lib/events/eligibility.ts); never re-derived from evidence prose. */
  eventDate: string | null;
  /** Precision eventDate actually carries — "year" means eventDate is a bare 4-digit year with no month/day; display code must never render it as a specific date or a computed month count. Null exactly when eventDate is null. */
  dateGranularity: DateGranularity | null;
  /** Model-labeled status ("upcoming" / "just_announced" / "completed" / "standing") — the gate's sole source of "is this dated/live or a standing condition," replacing the old regex guesswork over evidence text. */
  eventStatus: EventStatus;
  /** Only meaningful for "new-debt-issuance" — null for every other trigger. Feeds the completed-issuance proceeds test (eligibility.ts). */
  proceedsUse: ProceedsUse | null;
  /**
   * Session 18 (post-v9 redesign) — "debt-maturity" ONLY. The base filing's
   * debt note, transcribed as an ordered row/adjustment/subtotal sequence
   * and verified entry-by-entry (sourceLine + money-scale, same rigor as
   * every other fact-guarded field). lib/events/position.ts's
   * computeWalkChecksum walks this in order and asserts each subtotal
   * reconciles — no label matching. Empty array for every other trigger.
   */
  scheduleSequence: VerifiedSequenceEntry[];
  /** Session 18 — "debt-maturity" ONLY. Same verification, for the next-most-recent period's sequence — what lib/events/position.ts diffs against to find a tranche that dropped off with no 8-K explaining it (`unconfirmed`). */
  priorScheduleSequence: VerifiedSequenceEntry[];
  /** Session 18 (post-v9) — "debt-maturity" ONLY. The base filing's own balance-sheet debt captions, verified the same way — Check 2's input (lib/events/position.ts's computeBalanceSheetCheck). Empty for every other trigger. */
  balanceSheetDebtCaptions: VerifiedBalanceSheetCaption[];
  /** Session 18 (post-v6) — "debt-maturity" ONLY. Which filing scheduleSequence was actually transcribed from — determined in code (lib/fetch/noteLocation.ts) BEFORE the model was asked, not self-reported. Null when no filing had a locatable schedule (scheduleSequence is then also empty). Surfaced so the render layer can state which filing the ladder came from, and so a caller can tell "genuinely no schedule anywhere" apart from "schedule exists but wasn't reachable this run." Null for every other trigger. */
  debtScheduleSourceFiling: DebtScheduleFilingRef | null;
  /**
   * Session 18 (post-v11) — "debt-maturity" ONLY. Which filing
   * priorScheduleSequence was transcribed from, determined in code the same
   * deterministic way as debtScheduleSourceFiling. Exists so that when the
   * BASE ladder fails both checks, the render layer can surface the older
   * filing's schedule as explicitly-labelled prior-period CONTEXT (with its
   * own form and date shown) instead of the tool silently substituting a
   * tidier stale ladder for the current one — see lib/events/portfolioTable.ts.
   * Null when no second filing with a locatable schedule exists.
   */
  debtSchedulePriorFiling: DebtScheduleFilingRef | null;
  /**
   * Session 18 (post-v6): raw row counts before/after verification, summed
   * across scheduleSequence + priorScheduleSequence + issuedTranches +
   * balanceSheetDebtCaptions for this trigger — zero for the 13 triggers
   * with no rows to count. Exists so a per-company report can flag "N rows
   * dropped" explicitly for every company, not just as a console log line
   * someone has to go looking for — Centene's 28 fabricated rows were
   * caught correctly, but were only visible because someone happened to
   * look at the log.
   */
  rowsExtracted: number;
  rowsVerified: number;
  /**
   * Session 18 E1 — how many entries were TRANSCRIBED for the base ladder
   * alone, before verification. `rowsExtracted` sums four arrays, three of
   * which never enter either check; only this one is a statement about
   * whether the current ladder is complete. Zero for every trigger but
   * debt-maturity.
   */
  baseRowsExtracted: number;
  /**
   * Session 18 (post-v11) — "debt-maturity" ONLY, null for every other
   * trigger. A deterministic, zero-LLM-cost cross-check of scheduleSequence
   * against the SAME full filing text already fetched — surfaces the class
   * of gap both checksum checks can miss entirely: a transcription that
   * stops short of the source table's real end can still pass Check 1 (the
   * internal walk) and Check 2 (the balance-sheet anchor) on what WAS
   * captured. See lib/fetch/scheduleCompleteness.ts. Null when there was no
   * locatable debt-note section to check against (nothing to compare).
   */
  scheduleCompleteness: ScheduleCompletenessResult | null;
  /**
   * Session 18 — "new-debt-issuance" ONLY. EVERY retirement this issuance
   * states, each with the filing's own words for it. Session 21: an array,
   * because one filing does several things; each entry's `status` has
   * already been corroborated against its own sourceLine and each carries
   * its own `verified` flag. Only a claim that is BOTH corroborated
   * "completed" AND verified ever retires a ladder row.
   */
  redeems: VerifiedRedeemsClaim[];
  /** Session 22, Stage 3 — every stated use of the proceeds, one entry each. */
  proceedsUses: ProceedsUseRow[];
  /**
   * SESSION 21, STAGE 2 — "debt-maturity" ONLY. Stated total debt from the
   * filer's own XBRL tags at the anchor's period end, or an explained
   * absence. Fetched in the loop (cached HTTP, no model call) and attached
   * here so computeCoverage stays a pure function of a TriggerResult.
   */
  xbrlDebtTotal?: XbrlDebtTotal | null;
  /** Session 21, 2d — the filer's own contractual maturity ladder, where it tags one. The floor beneath the ladder. */
  xbrlMaturityBuckets?: XbrlMaturityBuckets | null;
  /** Session 18 — "new-debt-issuance" ONLY. The row(s) for the tranche(s) this issuance itself priced, verified the same way scheduleSequence rows are. Empty for every other trigger. */
  issuedTranches: VerifiedIssuedTranche[];
  /** Session 18 A3 — every trigger. The amount this event's OWN filing text states for it, or null — never a figure merely present nearby. Feeds gate restriction D2 (cashAmount: null never cards, any trigger except debt-maturity). */
  cashAmount: string | null;
  /** Session 18 A3 — every trigger. The discrete named project this event's filing calls out, or null when the amount is a period total with no named project. */
  projectName: string | null;
  /** Session 19, item 2a — the multi-instance triggers ONLY. Every qualifying event in the period, each sourceLine-verified. Empty elsewhere. */
  eventInstances: VerifiedEventInstance[];
  /** Session 19, item 2b — "debt-maturity" ONLY. Retirements stated in the note's own prose, each verified INSIDE the located note. Empty elsewhere. */
  noteRetirements: VerifiedNoteRetirement[];
  /** Session 20, 3a — verified instruments from the note's narrative. Empty except on debt-maturity. */
  proseInstruments: VerifiedProseInstrument[];
  /** Session 22, Stage 3 — every verified facility, each figure checked against its own sentence. */
  facilities: VerifiedFacility[];
  /** Figures rejected by that check, kept so a surface can say WHY a line is absent. */
  facilityRejections: FigureRejection[];
  /** Session 22, Stage 3 — the note's own seniority sentence, verified, or null. */
  seniorityStatement: SeniorityStatement | null;
  /** Session 19, item 2c — "capex-program" ONLY. The stated completion date of a named project, or null. Code derives the status from it; the model only copies it. */
  projectCompletionDate: string | null;
  projectCompletionGranularity: DateGranularity | null;
  /**
   * Session 18 C3 — "debt-maturity" ONLY, false for every other trigger.
   * True when the base filing's debt note WAS located and transcribed but
   * every entry stated a period column other than that filing's own period of
   * report. Distinct from "no schedule": the note is there and was read
   * wrong. Surfaced so the render layer can say so rather than leaving an
   * empty ladder to read as an absent disclosure.
   */
  columnReadFailure: boolean;
}

export interface CompanyResult {
  company: string;
  cik: string;
  ticker: string;
  results: TriggerResult[];
  verdict: "CALL" | "NO ACTIONABLE TRIGGER";
  relationshipFlags: TriggerResult[];
}

const FORM_ORDER = ["10-Q", "10-K", "8-K"];

function pluralizeForm(form: string, count: number): string {
  return count > 1 ? `${form}s` : form;
}

/** e.g. "2 10-Qs, 10-K, 6 8-Ks" — for the plain-English "reading filings" line. */
function describeBaseline(baseline: FilingEntry[]): string {
  const counts = new Map<string, number>();
  for (const f of baseline) counts.set(f.form, (counts.get(f.form) ?? 0) + 1);
  return FORM_ORDER.filter((form) => counts.has(form))
    .map((form) => {
      const n = counts.get(form)!;
      return n > 1 ? `${n} ${pluralizeForm(form, n)}` : form;
    })
    .join(", ");
}

function shorten(text: string | null, maxLen = 100): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}...`;
}

/** Plain-English outcome phrase for a verdict, no "checking..." prefix. */
function describeVerdict(trigger: TriggerDef, v: TriggerVerdict): string {
  if (v.fired) return `FIRED — ${shorten(v.evidence)}`;
  if (v.dataAvailable) return "no signal found";
  return trigger.detectability === "INTERNAL"
    ? "no public signal (internal data only)"
    : "no public signal (not disclosed in these filings)";
}

export async function runAgentLoop(
  companyName: string,
  onTrace?: TraceHandler
): Promise<CompanyResult> {
  function log(line: string) {
    console.log(line);
    onTrace?.(line);
  }

  // Fail fast and loud, before any work starts, if the answer/wording cache
  // has no way to persist — see lib/fetch/cache.ts's doc comment for why a
  // missing token must never silently degrade into an uncached run.
  assertBlobConfigured();

  // Session 18: every API call from here on bills into this company's own
  // scope. Safe as a module-level scope only because companies run
  // sequentially — see costMeter.ts's doc comment for what breaks if that
  // changes.
  beginCompanyCostScope(companyName);

  const filingsResult = await getRecentFilings(companyName, ["8-K", "10-Q", "10-K"]);

  const catalog: FilingCatalogEntry[] = filingsResult.filings.map((f) => ({
    form: f.form,
    filingDate: f.filingDate,
    items: f.items,
    url: f.primaryDocUrl,
  }));

  // reportDate rides along with form/filingDate because a periodic report's
  // PERIOD OF REPORT is the only thing that says what a 10-Q is allowed to
  // have reported. Free EDGAR metadata, already fetched — see
  // numberGuard.ts's citationDateGaps for what reads it and why.
  const citationLookup = new Map(
    filingsResult.filings.map((f) => [f.primaryDocUrl, { form: f.form, date: f.filingDate, reportDate: f.reportDate }])
  );

  const baseline = selectBaselineFilings(filingsResult.filings);
  const baselineUrls = new Set(baseline.map((f) => f.primaryDocUrl));

  log(`${companyName} → reading recent filings (${describeBaseline(baseline)})...`);

  const corpus: CorpusDoc[] = [];
  // Verification (verifyDebtRows, verifyTriggerQuote, ...) always checks
  // against the FULL fetched text, never just whatever bounded excerpt was
  // sent to the model — a row genuinely present outside the excerpt window
  // must still verify, not be falsely dropped because of a prompt-cost
  // bound that has nothing to do with whether the claim is real.
  const textByUrl = new Map<string, string>();
  const debtNoteStatusByFiling: { form: string; filingDate: string; reportDate: string; url: string; status: DebtNoteFilingStatus; tabular?: boolean }[] = [];
  // C3 — set when EVERY transcribed base-ladder entry was discarded for
  // stating the wrong period column. That is a read failure, and it must not
  // be confused with the filing having no schedule (see the search-order
  // block below).
  let baseColumnReadFailure = false;
  // Session 20: tracked SEPARATELY from the column failure. Both end in an
  // empty ladder, but a note read against the wrong PERIOD and a row read
  // from the wrong FILING need different fixes, and a single flag would send
  // the next reader to the wrong one.
  let baseOffAnchorFailure = false;
  // Session 18 A1: where each filing's debt note was located, in that
  // filing's FULL text — the bound verification uses to reject a "row" that
  // is really a cash-flow line or a narrative mention. Only 10-Q/10-K
  // filings have one; an 8-K has no note to locate.
  const noteSpanByUrl = new Map<string, { start: number; end: number }>();
  // SESSION 21 — the debt-note BOUNDARY needs the filer's own stated total,
  // and it runs while the corpus is built, so the XBRL read moves ahead of
  // classification. One cached HTTP call, at the newest periodic filing's own
  // period end; absent, the boundary abstains and cuts nothing.
  const newestPeriodic = [...baseline]
    .filter((f) => f.form === "10-Q" || f.form === "10-K")
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
  const anchorXbrl = newestPeriodic ? await fetchXbrlDebtTotal(filingsResult.cik, newestPeriodic.reportDate) : null;

  for (const filing of baseline) {
    const { text: fullText } = await readFiling(filing.primaryDocUrl);
    const extraction = buildExtractionText({ form: filing.form, url: filing.primaryDocUrl, fullText, xbrlStatedTotal: anchorXbrl?.total ?? null });
    corpus.push({ form: filing.form, filingDate: filing.filingDate, url: filing.primaryDocUrl, text: extraction.text });
    textByUrl.set(filing.primaryDocUrl, fullText);
    if (extraction.noteSpan) noteSpanByUrl.set(filing.primaryDocUrl, extraction.noteSpan);
    if (filing.form === "10-Q" || filing.form === "10-K") {
      debtNoteStatusByFiling.push({ form: filing.form, filingDate: filing.filingDate, reportDate: filing.reportDate, url: filing.primaryDocUrl, status: extraction.debtNoteStatus, tabular: extraction.debtNoteTabular });
      log(
        `  debt-note locator: ${filing.form} ${filing.filingDate} → ${extraction.debtNoteStatus}` +
          (extraction.matchCount !== undefined ? ` (${extraction.matchCount} matches)` : "") +
          (extraction.debtNoteTabular === undefined ? "" : extraction.debtNoteTabular ? " [tabular]" : " [PROSE-ONLY — the schedule field is withheld from the schema for this filer]")
      );
    }
  }

  // Session 18 (post-v6): deterministic base/prior filing selection for
  // debtSchedule/priorDebtSchedule — replaces the old "ask the model to
  // find the most recent 10-Q or 10-K itself" instruction, which is exactly
  // what let Centene's extraction fabricate 28 rows (the "most recent"
  // filing by date had no locatable table, and the model filled the gap
  // with a plausible-looking schedule resembling a DIFFERENT company's real
  // structure) and would have picked the wrong filing entirely for Cigna
  // (whose schedule exists ONLY in the 10-K, never either 10-Q). "found" and
  // "under_cap" both mean the filing's own debt note is reachable in the
  // text the model was given; "not_found" means it isn't, regardless of how
  // recent the filing is. Newest-first among the reachable ones.
  //
  // SESSION 20, STAGE 4 — THE ANCHOR IS THE MOST RECENT 10-Q/10-K. FULL STOP.
  //
  // The rule above filtered to filings whose debt note the LOCATOR could
  // reach, then took the newest of those. That reads as a sensible
  // precondition and is in fact a fallback wearing a precondition's clothes:
  // when the newest filing's note is prose, or abbreviated, or simply
  // unlocatable, the anchor silently becomes an older filing — and every
  // downstream check then validates the older filing's position as though it
  // were current.
  //
  // Measured on the committed v22 book, this had already happened to two of
  // ten, and to more fields than the ladder:
  //
  //   UHS    11 rows from the 10-K (period Dec 31 2025), balance-sheet
  //          captions read off the June 10-Q's DECEMBER COMPARATIVE column,
  //          prose instruments from a THIRD filing (the Q1 10-Q). One
  //          rendered position assembled from three dates.
  //   Cigna  38 rows from the 10-K (period Dec 31 2025) beside a June 30
  //          balance sheet; its captions were "Short-term debt 2,792   592"
  //          read as 592 — again the December column.
  //
  // AND THE COLUMN READS WERE NOT THE MODEL'S MISTAKE. The guidance section
  // names the base filing's period of report, the prompt says read the
  // column matching it, and the guidance was saying December 31 2025. The
  // model did as instructed. Fixing the anchor is what fixes the columns;
  // there is no separate column defect to chase.
  //
  // So: newest 10-Q/10-K, whatever its note looks like. A filing whose note
  // yields no ladder renders EMPTY WITH REASON. The locator's per-filing
  // status is still logged — it is diagnostic, and it is no longer allowed
  // to choose which quarter the reader is looking at.
  const anchorCandidates = [...debtNoteStatusByFiling].sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  const debtScheduleGuidance: DebtScheduleFilingGuidance = {
    base: anchorCandidates[0] ? { form: anchorCandidates[0].form, date: anchorCandidates[0].filingDate, reportDate: anchorCandidates[0].reportDate, url: anchorCandidates[0].url } : null,
    prior: anchorCandidates[1] ? { form: anchorCandidates[1].form, date: anchorCandidates[1].filingDate, reportDate: anchorCandidates[1].reportDate, url: anchorCandidates[1].url } : null,
  };
  log(
    debtScheduleGuidance.base
      ? `  debt-schedule ANCHOR (most recent 10-Q/10-K, never an older one): ${debtScheduleGuidance.base.form} ${debtScheduleGuidance.base.date} (period ${debtScheduleGuidance.base.reportDate}), note locator says ${anchorCandidates[0].status}` +
          (debtScheduleGuidance.prior ? `; prior: ${debtScheduleGuidance.prior.form} ${debtScheduleGuidance.prior.date}` : "; no prior filing available")
      : `  debt-schedule ANCHOR: NONE — this corpus contains no 10-Q or 10-K`
  );

  // News isn't wired up yet (later session) — call the stub but don't narrate an empty result.
  await searchNews(companyName);

  // Session 14: the answer cache. A filing's content never changes once
  // filed, so the fingerprint of "which filings exist for this company"
  // (corpusFingerprint, over the FULL catalog — see its doc comment) is a
  // stable key for "what Haiku was actually asked." A hit means Haiku is
  // never re-asked; a miss (new filing entered the catalog, or this
  // company/corpus has never been seen) is exactly one Haiku call, same as
  // before this session — this call was already batched over the whole
  // corpus, never split per filing.
  // CACHE_BUST is a MEASUREMENT lever, inert unless explicitly set. It exists
  // so identical-input runs can be forced to actually re-ask the model —
  // the only way to measure the extraction variance floor, i.e. how much
  // output moves between two runs at the SAME version on the SAME filings.
  // Without a number for that, a change like Tenet's 34 -> 30 entries cannot
  // be told apart from noise, and no regression can be attributed.
  // Deliberately NOT a version bump: a bump would invalidate all 10
  // companies' cached answers and change what the model is asked, which is
  // the opposite of the controlled comparison this is for.
  const cacheBust = process.env.CACHE_BUST;
  const fingerprint = corpusFingerprint(filingsResult.filings) + (cacheBust ? `-bust${cacheBust}` : "");
  if (cacheBust) log(`  ⚠ CACHE_BUST=${cacheBust} — answer cache deliberately bypassed; this run BILLS. Measurement only.`);
  log(`checking all 15 triggers...`);
  const { data: baseVerdicts, hit: baseHit } = await cachedBaseClassification(
    filingsResult.cik,
    fingerprint,
    () =>
      classifyAllTriggers({
        companyName: filingsResult.company,
        triggers: TRIGGERS,
        catalog,
        corpus,
        debtScheduleGuidance,
        // Rule 22: when the anchor's debt disclosure is not a table, the
        // schedule field is withheld from the schema entirely rather than
        // argued against in the prompt.
        anchorNoteTabular: anchorCandidates[0]?.tabular,
      })
  );
  log(`  answer cache ${baseHit ? "HIT" : "MISS"} (base classification, fingerprint ${fingerprint.slice(0, 8)})`);
  // Session 18: classifyAllTriggers applies withFieldDefaults to a FRESH
  // response, but a cache HIT returns whatever was stored in Blob at
  // classification time — for any answer cached before this session, that's
  // the old shape, missing debtSchedule/etc. entirely (undefined, not []).
  // Re-applying it here, unconditionally, to every verdict regardless of
  // hit/miss is what actually guarantees the "always present, never
  // undefined" contract the rest of this pipeline (position.ts,
  // eligibility.ts) is written against.
  const verdictById = new Map(baseVerdicts.map((v) => [v.triggerId, withFieldDefaults(v)]));

  // Session 18: company-level hard failure (never per-filing — see
  // noteLocation.ts's doc comment: a SINGLE 10-Q genuinely not repeating
  // the full ladder is normal, confirmed live for 4 of 30 real filings
  // across companies whose 10-K carried it instead). If debt-maturity
  // fired but the locator found a cluster in NONE of this company's fetched
  // 10-Q/10-K filings, that's a real anomaly worth stopping on before any
  // debtSchedule rows from this company are trusted.
  assertCompanyHasLocatableDebtNote(companyName, verdictById.get("debt-maturity")?.fired ?? false, debtNoteStatusByFiling);

  // Deterministic fact-check: a fired trigger's `quote` must either appear
  // literally in the filing text we actually fetched, or its key facts
  // (amount/rate/date — see factTokens.ts) must co-occur within a bounded
  // window, so a genuine table-row fact (a debt-schedule row is never an
  // English sentence) verifies too. A trigger whose quote can't be
  // verified either way never reaches a card (see buildEvents.ts); it
  // stays in the portfolio table, marked unverified, so nothing vanishes.
  function finalizeVerified(trigger: TriggerDef, v: TriggerVerdict, label: string): TriggerResult {
    const result = verifyTriggerQuote({
      fired: v.fired,
      quote: v.quote,
      citedUrls: v.citedUrls ?? [],
      textByUrl,
    });
    if (v.fired && !result.verified) {
      log(`  ⚠ QUOTE VERIFICATION FAILED for ${label} — model's quote not found in the fetched filing text; evidence discarded, excluded from cards`);
    }
    if (v.fired && result.verified && v.quoteHasFigure === false) {
      log(`  ⚠ QUOTE HAS NO FIGURE for ${label} — verified, but the model reported no single sentence carried the fact's material figure; verifiedQuote is a figure-less fallback`);
    }
    // Post-extraction validation, before the fact-guard even runs: enforce
    // in code what the prompt only asks for in words. Real case: Haiku
    // returned {eventDate: "2026-12-31", eventDateGranularity: "year"} for
    // UHS's debt-maturity fact — the literal forbidden example from its
    // own instructions. A year-granularity claim with a fabricated
    // month/day is corrected down to the bare year (never rejected —
    // eventTiming.ts's windowDate convention exists to handle exactly
    // this); a day/month-granularity claim landing exactly on 12-31 or
    // 01-01 is only logged for review, never auto-corrected.
    const normalizedDate = normalizeEventDate(v.eventDate ?? null, v.eventDateGranularity ?? null);
    if (normalizedDate.wasNormalized) {
      log(
        `  ⚠ EVENT DATE NORMALIZED for ${companyName} — ${label}: claimed "${v.eventDate}" carried a fabricated month/day for a year-granularity fact; corrected to "${normalizedDate.eventDate}"`
      );
    }
    if (normalizedDate.suspiciousRoundDate) {
      log(
        `  ⚠ EVENT DATE FLAGGED FOR REVIEW for ${companyName} — ${label}: "${normalizedDate.eventDate}" (granularity ${normalizedDate.eventDateGranularity}) lands exactly on 12-31 or 01-01 — a pattern models sometimes fabricate; not auto-corrected`
      );
    }
    const dateGuard = verifyEventDate({
      eventDate: normalizedDate.eventDate,
      eventDateGranularity: normalizedDate.eventDateGranularity,
      anchorText: v.quote ?? v.evidence ?? null,
      citedUrls: v.citedUrls ?? [],
      textByUrl,
    });
    if (normalizedDate.eventDate && !dateGuard.accepted) {
      log(
        `  ⚠ EVENT DATE REJECTED for ${companyName} — ${label}: claimed "${normalizedDate.eventDate}" not found (or not anchored to this fact) in the fetched filing text; eventDate set to null`
      );
    }

    // Session 18 (post-v9 redesign): entry-level verification for
    // debt-maturity's ordered walk (scheduleSequence/priorScheduleSequence),
    // its balance-sheet captions, and new-debt-issuance's issuedTranches —
    // same "never trust an unverified claim" rule `quote` already gets,
    // applied per entry instead of once per trigger. An entry that fails to
    // verify is dropped, not trusted; the checksum (lib/events/position.ts)
    // is what's supposed to surface a dropped entry, not this step silently
    // letting it through.
    // Session 18 (post-v11): apply each table's OWN declared unit to its own
    // bare amounts BEFORE verification — the drop happens inside
    // verifySequenceEntries, so recovering the scale afterwards would be too
    // late. Strictly scoped: each array gets only the unit its own table
    // declared, and an amount that already carries a unit is never touched
    // (see moneyScale.ts's applyTableUnitToAmount for the full contract).
    // Column binding runs FIRST — a wrong-column entry should never reach
    // the unit rescale or verification at all; it is not a scale problem
    // and dropping it later would mean rescaling a figure from the wrong
    // period. The base filing's own EDGAR period-of-report is the
    // authority; the prior sequence is bound to the PRIOR filing's period,
    // since that is its own current column.
    const baseColumnOutcome = { total: 0, droppedForPeriod: 0, unbound: 0 };
    const columnBound = {
      scheduleSequence: bindEntriesToPeriod(v.scheduleSequence, debtScheduleGuidance.base?.reportDate ?? null, log, label, (e) => e.label ?? e.kind, baseColumnOutcome),
      priorScheduleSequence: bindEntriesToPeriod(v.priorScheduleSequence, debtScheduleGuidance.prior?.reportDate ?? null, log, `${label} (prior period)`, (e) => e.label ?? e.kind),
      balanceSheetDebtCaptions: bindEntriesToPeriod(v.balanceSheetDebtCaptions, debtScheduleGuidance.base?.reportDate ?? null, log, `${label} (balance sheet)`, (c) => c.label),
    };

    // Scale resolution, most authoritative first: the amount's own unit,
    // then the FILING'S governing declaration (code-derived, deterministic),
    // then the model-reported caption as a last resort. See
    // deriveScaleFromFilingDeclaration for why the model can no longer be
    // the only source — Tenet v13/v14 is the regression pair.
    const baseText = debtScheduleGuidance.base ? textByUrl.get(debtScheduleGuidance.base.url) : undefined;
    const priorText = debtScheduleGuidance.prior ? textByUrl.get(debtScheduleGuidance.prior.url) : undefined;
    const filingScaled = {
      scheduleSequence: deriveScaleFromFilingDeclaration(columnBound.scheduleSequence, baseText, log, label),
      priorScheduleSequence: deriveScaleFromFilingDeclaration(columnBound.priorScheduleSequence, priorText, log, `${label} (prior period)`),
      balanceSheetDebtCaptions: deriveScaleFromFilingDeclaration(columnBound.balanceSheetDebtCaptions, baseText, log, `${label} (balance sheet)`),
    };

    const unitScoped = {
      scheduleSequence: applyTableUnit(filingScaled.scheduleSequence, v.scheduleTableUnit),
      priorScheduleSequence: applyTableUnit(filingScaled.priorScheduleSequence, v.priorScheduleTableUnit),
      balanceSheetDebtCaptions: applyTableUnit(filingScaled.balanceSheetDebtCaptions, v.balanceSheetTableUnit),
    };
    for (const [field, declared] of [
      ["scheduleSequence", v.scheduleTableUnit],
      ["priorScheduleSequence", v.priorScheduleTableUnit],
      ["balanceSheetDebtCaptions", v.balanceSheetTableUnit],
    ] as const) {
      // Counts amounts actually REWRITTEN, not the change in how many parse
      // — the most consequential case ("$ 549" under an "(In millions)"
      // caption) parses fine both before and after and would be invisible
      // to a determinability delta, even though its value just moved by a
      // factor of a million. See moneyScale.ts's applyTableUnitToAmount.
      // Compared against the FILING-SCALED list so this line counts only
      // what the model's CAPTION added on top of what the filing's own
      // declaration already resolved — otherwise the caption would get
      // credit for rescales the code-level derivation actually performed.
      const original = filingScaled[field] as { amount: string }[];
      const rescaled = unitScoped[field] as { amount: string }[];
      const changed = original.filter((e, i) => e.amount !== rescaled[i]?.amount).length;
      const recovered = original.filter((e, i) => !hasDeterminableMoneyScale(e.amount) && hasDeterminableMoneyScale(rescaled[i]?.amount ?? e.amount)).length;
      if (changed > 0) {
        log(
          `  TABLE UNIT APPLIED for ${label} — ${field}: ${changed} amount(s) rescaled by the table's own declared unit ${JSON.stringify(declared)} (${recovered} of them would otherwise have been dropped as indeterminate; the rest parsed but at the wrong scale)`
        );
      }
    }

    const verifiedBaseSequence = verifySequenceEntries(unitScoped.scheduleSequence, v.citedUrls ?? [], textByUrl, log, label, noteSpanByUrl);
    const priorScheduleSequence = verifySequenceEntries(unitScoped.priorScheduleSequence, v.citedUrls ?? [], textByUrl, log, label, noteSpanByUrl);

    // SESSION 20 — THE ANCHOR FILING IS THE POSITION, ACROSS FILINGS.
    //
    // BRD 6.0's authority rule already says the note is the position and an
    // 8-K wins only when it post-dates it. That rule was written about
    // EVENTS. It says nothing about where a SCHEDULE ROW may come from, and
    // the gap is not theoretical: UHS's v20 ladder carried
    //
    //   "1.65 % Senior Secured Notes due 2026 , net of unamortized discount
    //    of $ 113 in 2025 and $ 288 in 2024"   $699,887 thousands
    //
    // transcribed from the 10-K's December 2025 table, while the ladder's own
    // debtScheduleSourceFiling named the June 2026 10-Q. Every existing guard
    // passed it: the sourceLine verifies literally, the amount corroborates,
    // the note bound holds — all against the WRONG FILING, because nothing
    // required the row's filing and the position's filing to be the same one.
    // A stale carrying amount then rendered as the current ladder and carded.
    //
    // So the rule extends: a schedule row must cite the anchor. A row cited
    // from any other filing is dropped with its reason stated, never shown as
    // the current position. Two comparative columns inside the anchor's own
    // table are unaffected — those cite the anchor, which is why the prior
    // schedule legitimately does too on a two-column note.
    const anchorUrl = debtScheduleGuidance.base?.url ?? null;
    const { kept: scheduleSequence, dropped: offAnchor } = rowsOnAnchor(verifiedBaseSequence, anchorUrl);
    // THE GUARD THAT ENFORCES IT. Without this the drop is silent and the
    // ladder just looks thin; the mismatch is a READ FAILURE and says so, so
    // an empty ladder states why it is empty rather than implying there is
    // nothing to find.
    const offAnchorReadFailure = offAnchor.length > 0;
    if (offAnchorReadFailure) {
      const from = [...new Set(offAnchor.map((e) => e.citedUrl))].join(", ");
      log(
        `  ⚠ OFF-ANCHOR ROWS DROPPED for ${label} — ${offAnchor.length} schedule row(s) verified against ${from}, but this company's anchor filing is ${debtScheduleGuidance.base?.form} ${debtScheduleGuidance.base?.date} (${anchorUrl}). A row from another filing is a balance as of THAT filing's date; rendering it as the current ladder states a position the anchor does not report.`
      );
    }
    const issuedTranches = verifyIssuedTranches(v.issuedTranches, v.citedUrls ?? [], textByUrl, log, label);
    // Session 19: the new arrays go through the SAME walk. A field in the
    // schema and the prompt but not here is the drift item 1a killed on the
    // guard side, one layer over.
    const eventInstances = verifyEventInstances(v.eventInstances ?? [], v.citedUrls ?? [], textByUrl, log, label);
    const noteRetirements = verifyNoteRetirements(v.noteRetirements ?? [], v.citedUrls ?? [], textByUrl, log, label, noteSpanByUrl);
    // Session 20, 3a/3b — bounded to the located note, same contract as a row.
    const proseVerified = verifyProseInstruments(v.proseInstruments ?? [], v.citedUrls ?? [], textByUrl, log, label, noteSpanByUrl);
    const proseDropped = (v.proseInstruments ?? []).length - proseVerified.length;
    if (proseDropped > 0) {
      log(`  ⚠ ${proseDropped} prose instrument(s) for ${label} could not be verified INSIDE the located note — dropped, not trusted (Rule 5)`);
    }
    // Stage 4 — and then the anchor rule, same as a row. UHS's v22 prose came
    // from the MARCH 10-Q while its ladder was dated June; an instrument
    // balance is as of the filing that states it, and a position assembled
    // from two dates is a position at neither.
    const { kept: proseInstruments, dropped: offAnchorProse } = onAnchor(proseVerified, anchorUrl);
    if (offAnchorProse.length > 0) {
      log(
        `  ⚠ OFF-ANCHOR PROSE INSTRUMENTS DROPPED for ${label} — ${offAnchorProse.length} instrument(s) (${offAnchorProse.map((p) => p.name ?? p.category).join(", ")}) verified against ${[...new Set(offAnchorProse.map((p) => p.citedUrl))].join(", ")}, not the anchor ${debtScheduleGuidance.base?.form} ${debtScheduleGuidance.base?.date}. A balance is as of the filing that states it.`
      );
    }
    // SESSION 22, STAGE 3 — EVERY FIGURE AGAINST ITS OWN SENTENCE.
    //
    // This verified ONE sentence for the whole revolver object, so a figure
    // was accepted because a DIFFERENT figure's sentence was found. Encompass
    // is the measured cost: $824 million of "available" rode in on a sentence
    // that says only "$200.0 million was drawn". A real number and a real
    // quote, joined by nothing, which is the composite-fabrication class.
    //
    // The guard is now per figure and lives in verifyFacility.ts with the
    // type it produces. A figure whose sentence does not state it is dropped
    // and NAMED; the facility survives, because withholding a figure and
    // erasing an instrument are different acts and only one of them is honest.
    const facilityCheck = verifyFacilities({
      facilities: v.facilities ?? [],
      // THE FETCHED CORPUS, not `v.citedUrls`. The model's self-reported
      // citation list is routinely empty — Centene's was — and checking
      // against an empty list rejected eight figures, six of them verbatim
      // in its own anchor 10-Q, deleting every facility it has.
      textByUrl,
    });
    const facilities = facilityCheck.verified;
    const facilityRejections = facilityCheck.rejections;
    for (const r of facilityRejections) {
      log(`  ⚠ FACILITY FIGURE REJECTED for ${label} — ${r.facility}.${r.field} = ${r.value}: ${r.reason}. Sentence given: "${r.sourceLine.replace(/\s+/g, " ").slice(0, 120)}"`);
    }
    for (const d of facilityCheck.droppedFacilities) {
      log(`  ⚠ FACILITY DROPPED ENTIRELY for ${label} — "${d}": no figure survived verification, so nothing supports asserting this instrument exists`);
    }

    // The seniority sentence is held to the same standard as every other
    // quote: it must appear in a filing this run actually fetched.
    //
    // RULE 37 — AND THE DENOMINATOR IS THE FETCHED CORPUS, not `v.citedUrls`.
    // This was written against the model's self-reported citation list, which
    // is the same defect that deleted Centene's entire facility set: a filer
    // reporting no citations would have had a real, verbatim seniority
    // sentence silently dropped, and with it the class of every row on its
    // ladder. Measured across the book at v29, nothing is dropped today
    // either way — the fix is latent, and latent is exactly when to make it,
    // since the observable version of it cost a whole company's facilities.
    const seniorityCorpus = corpusOf(textByUrl);
    const seniorityHit = v.seniorityStatement ? seniorityCorpus.find(v.seniorityStatement.statement) : null;
    const seniorityStatement = seniorityHit?.outcome === "present" ? v.seniorityStatement : null;
    if (v.seniorityStatement && !seniorityStatement) {
      // The two failures are different claims and are never collapsed: one
      // says the sentence is in no filing we read, the other says we could
      // not read the filings.
      log(
        seniorityHit?.outcome === "undetermined"
          ? `  ⚠ SENIORITY STATEMENT NOT CHECKED for ${label} — ${seniorityHit.why}. This is NOT a finding about the filing; the class it claims is withheld because nothing could confirm it, which is a different statement from "the sentence is not there"`
          : `  ⚠ SENIORITY STATEMENT DROPPED for ${label} — the sentence is in no fetched filing, so the class it claims rests on nothing`
      );
    }
    const instancesDropped = (v.eventInstances ?? []).length - eventInstances.length;
    if (instancesDropped > 0) {
      log(`  ⚠ ${instancesDropped} event instance(s) for ${label} failed sourceLine verification — dropped, not trusted`);
    }
    const retirementsDropped = (v.noteRetirements ?? []).length - noteRetirements.length;
    if (retirementsDropped > 0) {
      log(`  ⚠ ${retirementsDropped} note-prose retirement(s) for ${label} could not be verified INSIDE the located debt note — dropped, not trusted (Rule 5: a claim about the note must be found in the note)`);
    }
    // SESSION 21, ITEM 1D — EVERY redemption claim goes through the same
    // walk as every other claim about a filing, INDEPENDENTLY of the others.
    //
    // Two gates per claim, and each is load-bearing alone (pinned as
    // position.test.ts [S21a]-[S21d]):
    //   corroboration — does the claim's OWN sourceLine state a completed
    //                   payment, or only an intention (redemptionStatus.ts)
    //   verification  — is that sourceLine actually in one of this trigger's
    //                   cited filings
    // Per claim, because one filing does several things: UHS's August 8-K
    // repays a revolver AND names its 2026 notes in a ranking clause, and
    // those two need opposite answers from the same document.
    const verifiedRedeems: VerifiedRedeemsClaim[] = (v.redeems ?? []).map((claim) => {
      const check = corroborateRedemptionStatus(claim.status, claim.sourceLine);
      if (check.demotedReason) {
        log(
          `  ⚠ REDEMPTION STATUS NOT CORROBORATED for ${label} — "${claim.instrument}" ${check.demotedReason}. Treated as INTENDED; the tranche stays on the ladder. An intention is not a completion.`
        );
      }
      // RULE 37, SEVENTH OCCURRENCE — THE FETCHED CORPUS, NOT `v.citedUrls`.
      //
      // This asked whether the sentence appears in a filing the MODEL said it
      // cited. Quest is the measured cost: its redemption sentence — "the net
      // proceeds from the 2036 Senior Notes and cash on hand were used to
      // repay in full at maturity the outstanding indebtedness under the
      // 3.45% Senior Notes due June 2026" — is real, verbatim, in a filing
      // this run fetched, and was marked UNVERIFIED because it was not in the
      // model's own citation list. Quest's refinancing pattern then read "no
      // verified, corroborated-completed redemption in this corpus" about a
      // company whose filing states one in plain words.
      //
      // Widening the denominator can only turn "unverified" into "verified",
      // and a verified claim can retire a tranche — so this is the direction
      // that needs measuring rather than assuming, and it was measured across
      // the book before being kept. The other two gates are untouched: the
      // claim must still be corroborated COMPLETED, so nothing merely
      // intended retires anything.
      const redeemCorpus = corpusOf(textByUrl);
      const hit = claim.sourceLine ? redeemCorpus.find(claim.sourceLine) : null;
      const verified = hit?.outcome === "present";
      if (claim.sourceLine && hit?.outcome === "undetermined") {
        log(`  ⚠ REDEMPTION CLAIM NOT CHECKED for ${label} — "${claim.instrument}": ${hit.why}. Nothing is retired, and this is NOT a finding that the sentence is absent.`);
      }
      if (!claim.sourceLine) {
        log(`  ⚠ REDEMPTION CLAIM WITHOUT EVIDENCE for ${label} — "${claim.instrument}" carries no sourceLine; nothing retired.`);
      } else if (!verified) {
        log(
          `  ⚠ REDEMPTION CLAIM UNVERIFIED for ${label} — "${claim.instrument}" is claimed ${claim.status ?? "(no status)"}, but its stated sourceLine is not in any cited filing. A claim that removes debt from the ladder must be found in the filing; nothing retired.`
        );
      } else if (check.status !== "completed") {
        log(
          `  redemption for ${label} is stated as ${JSON.stringify(check.status)} rather than completed — "${claim.instrument}" stays on the ladder; an intent is not a retirement`
        );
      }
      return { ...claim, status: check.status, verified };
    });
    if (verifiedRedeems.length > 1) {
      log(
        `  ${verifiedRedeems.length} redemption claim(s) for ${label}, judged independently — ${verifiedRedeems.map((r) => `${r.instrument}: ${r.status}${r.verified ? ", verified" : ", UNVERIFIED"}`).join("; ")}`
      );
    }
    v = { ...v, redeems: verifiedRedeems };

    const captionsVerified = verifyBalanceSheetCaptions(unitScoped.balanceSheetDebtCaptions, v.citedUrls ?? [], textByUrl, log, label);
    // Stage 4 — the anchor rule reaches the DENOMINATOR too. Stated total
    // debt is the number coverage divides by; a caption from another filing
    // measures this quarter's ladder against last year's balance sheet.
    const { kept: balanceSheetDebtCaptions, dropped: offAnchorCaptions } = onAnchor(captionsVerified, anchorUrl);
    if (offAnchorCaptions.length > 0) {
      log(
        `  ⚠ OFF-ANCHOR BALANCE-SHEET CAPTIONS DROPPED for ${label} — ${offAnchorCaptions.length} caption(s) (${offAnchorCaptions.map((c) => c.label).join(", ")}) verified against ${[...new Set(offAnchorCaptions.map((c) => c.citedUrl))].join(", ")}, not the anchor. Coverage renders unmeasured rather than measured against another filing's balance sheet.`
      );
    }
    const rowsExtracted = v.scheduleSequence.length + v.priorScheduleSequence.length + v.issuedTranches.length + v.balanceSheetDebtCaptions.length;
    const rowsVerified = scheduleSequence.length + priorScheduleSequence.length + issuedTranches.length + balanceSheetDebtCaptions.length;
    const droppedCount = rowsExtracted - rowsVerified;
    if (droppedCount > 0) {
      log(
        `  ⚠ ${droppedCount} debt-schedule entr${droppedCount === 1 ? "y" : "ies"} for ${label} failed sourceLine verification or had an indeterminate amount scale — dropped, not trusted; the checksum will surface the gap`
      );
    }

    // Session 18 (post-v5): same money-scale validator applied to cashAmount
    // (every trigger, feeds the D2 gate) — one validator, applied uniformly
    // at the schema boundary.
    // Session 18 (post-v15): the filing's own governing declaration resolves
    // cashAmount FIRST, exactly as it does for the other three fields of this
    // class — see deriveCashAmountScale. checkMoneyScale is still the gate;
    // it just no longer has to answer the question alone.
    const scaledCashAmount = deriveCashAmountScale(v.cashAmount, result.displayText, v.citedUrls ?? [], textByUrl, log, label);
    const cashAmountCheck = checkMoneyScale(scaledCashAmount);
    if (!cashAmountCheck.determinable) {
      log(`  ⚠ CASH AMOUNT SCALE INDETERMINATE for ${label} — "${cashAmountCheck.raw}" has no determinable unit and the filing declares none in range; treated as null`);
    }
    const vSanitized: TriggerVerdict = {
      ...v,
      cashAmount: cashAmountCheck.determinable ? scaledCashAmount : null,
    };

    // Session 18 (post-v11): zero-LLM-cost completeness cross-check against
    // the SAME base filing text already fetched — surfaces a transcription
    // that stops short of the source table's real end, a class both
    // checksum checks can pass on without ever seeing (see
    // lib/fetch/scheduleCompleteness.ts's doc comment).
    let scheduleCompleteness: ScheduleCompletenessResult | null = null;
    if (trigger.id === "debt-maturity" && debtScheduleGuidance.base) {
      const baseFilingText = textByUrl.get(debtScheduleGuidance.base.url);
      if (baseFilingText) {
        scheduleCompleteness = computeScheduleCompleteness(baseFilingText, scheduleSequence);
        if (scheduleCompleteness.checked && !scheduleCompleteness.complete) {
          const missing = [
            ...scheduleCompleteness.missingLabeledTotals.map((t) => `unaccounted labeled total: "${t}"`),
            ...(scheduleCompleteness.trailingUnconsumedText ? [`trailing unconsumed source text: "${scheduleCompleteness.trailingUnconsumedText}"`] : []),
          ];
          log(
            `  ⚠ SCHEDULE COMPLETENESS: ${label} transcribed ${scheduleCompleteness.subtotalsTranscribed} subtotal(s), but the source section appears to contain more — ${missing.join("; ")}`
          );
        }
      }
    }

    if (trigger.id === "debt-maturity") {
      baseColumnReadFailure = baseColumnOutcome.total > 0 && baseColumnOutcome.droppedForPeriod === baseColumnOutcome.total;
      baseOffAnchorFailure = offAnchorReadFailure && scheduleSequence.length === 0;
    }

    return finalize(
      trigger,
      citationLookup,
      vSanitized,
      result,
      dateGuard,
      textByUrl,
      { scheduleSequence, priorScheduleSequence, issuedTranches, balanceSheetDebtCaptions, eventInstances, noteRetirements, proseInstruments, facilities, facilityRejections, seniorityStatement },
      debtScheduleGuidance.base,
      debtScheduleGuidance.prior,
      { rowsExtracted, rowsVerified, baseRowsExtracted: v.scheduleSequence.length },
      trigger.id === "debt-maturity" && baseColumnOutcome.total > 0 && baseColumnOutcome.droppedForPeriod === baseColumnOutcome.total,
      scheduleCompleteness
    );
  }

  let digBudget = MAX_DIG_STEPS;
  const results: TriggerResult[] = [];

  for (const trigger of TRIGGERS) {
    const v = verdictById.get(trigger.id);
    const label = trigger.name.toLowerCase();

    if (!v) {
      log(`checking ${label}... couldn't be classified — treating as no public signal.`);
      results.push(
        finalizeVerified(
          trigger,
          withFieldDefaults({
            triggerId: trigger.id,
            fired: false,
            dataAvailable: false,
            evidence: null,
            quote: null,
            quoteHasFigure: false,
            eventDate: null,
            eventDateGranularity: null,
            eventStatus: "standing",
            confidence: 0,
            needsDig: false,
            digHint: null,
            citedUrls: [],
          }),
          label
        )
      );
      continue;
    }

    if (v.needsDig && v.digHint && baselineUrls.has(v.digHint)) {
      log(`${label} unclear, but nothing new to check — ${describeVerdict(trigger, v)}.`);
      results.push(finalizeVerified(trigger, v, label));
      continue;
    }

    if (v.needsDig && digBudget > 0 && v.digHint) {
      const digFiling = filingsResult.filings.find((f) => f.primaryDocUrl === v.digHint);
      if (!digFiling) {
        log(`${label} unclear, but the follow-up filing wasn't found — ${describeVerdict(trigger, v)}.`);
        results.push(finalizeVerified(trigger, v, label));
        continue;
      }
      digBudget--;
      log(`${label} unclear → digging into the ${digFiling.form}...`);
      const { text: digFullText } = await readFiling(digFiling.primaryDocUrl);
      textByUrl.set(digFiling.primaryDocUrl, digFullText);
      // Same bounded-excerpt treatment as the main corpus (see above) —
      // getFilingText no longer truncates at fetch time, so a dig target
      // needs its own cap here or a large 10-K would send its full ~500k+
      // chars to the model for what's usually a narrow, single-trigger
      // follow-up question unrelated to the debt schedule.
      const digExtraction = buildExtractionText({ form: digFiling.form, url: digFiling.primaryDocUrl, fullText: digFullText });
      const { data: refined, hit: digHit } = await cachedDigClassification(
        filingsResult.cik,
        fingerprint,
        trigger.id,
        digFiling.primaryDocUrl,
        () =>
          classifyOneTrigger({
            companyName: filingsResult.company,
            trigger,
            priorVerdict: v,
            extraDoc: {
              form: digFiling.form,
              filingDate: digFiling.filingDate,
              url: digFiling.primaryDocUrl,
              text: digExtraction.text,
            },
          })
      );
      log(`  answer cache ${digHit ? "HIT" : "MISS"} (dig, ${trigger.id})`);
      log(`${label} resolved — ${describeVerdict(trigger, refined)}.`);
      // Same reasoning as baseVerdicts above — a cached dig answer from
      // before Session 18 lacks the new fields entirely.
      results.push(finalizeVerified(trigger, withFieldDefaults(refined), label));
    } else if (v.needsDig && digBudget === 0) {
      log(`${label} unclear, but out of follow-up budget for this run — ${describeVerdict(trigger, v)}.`);
      results.push(finalizeVerified(trigger, v, label));
    } else {
      log(`checking ${label}... ${describeVerdict(trigger, v)}`);
      results.push(finalizeVerified(trigger, v, label));
    }
  }

  // ==========================================================================
  // SESSION 20, STAGE 4 — THE SEARCH-ORDER FALLBACK IS GONE.
  //
  // It walked backwards from the newest 10-Q through older periodic filings
  // and took the first one that yielded a schedule. Its reasoning was sound
  // on its own terms — an abbreviated 10-Q note is ordinary, not an error —
  // and its conclusion was still wrong, because the thing it produced was a
  // ladder dated one quarter to three quarters before the balance sheet
  // printed beside it. Two guards were bolted on over two sessions (a
  // wrong-column read suppresses it; an off-anchor drop suppresses it) and
  // each one was a signal-specific patch on a rule that should not run at
  // all.
  //
  // The replacement is one line of policy, keyed on the structural
  // condition and not on any signal: THE ANCHOR IS THE MOST RECENT
  // 10-Q/10-K, AND IF ITS DEBT NOTE YIELDS NO LADDER THE LADDER RENDERS
  // EMPTY WITH REASON. An RM told "the June 10-Q states no schedule" knows
  // exactly what they have. An RM shown February's ladder under a June
  // heading does not, and cannot tell from the page.
  //
  // Cigna is the case that costs the most and settles it: its 10-Q debt note
  // is four narrative paragraphs ending "For more information regarding our
  // short-term and long-term debt, see Note 7 to the Consolidated Financial
  // Statements in the Company's 2025 Form 10-K." Following that cross-
  // reference is what produced a 38-row ladder as of December 31 2025 beside
  // a June 30 2026 balance sheet. The filing is telling the reader where the
  // ladder is; it is not telling them the ladder is current.
  // SESSION 21, STAGE 2 — THE DENOMINATOR AND THE FLOOR, FROM THE FILER'S
  // OWN TAGS.
  //
  // Two cached HTTP reads of the SEC's public company-facts endpoint, no
  // model call, at the ANCHOR's own period end. Attached to the trigger so
  // computeCoverage stays a pure function of what it is given — a coverage
  // figure that had to await a network read could not be recomputed in an
  // offline test, and every threshold this project has is pinned by one.
  //
  // Absence is normal and is carried as an explained absence, never as a
  // failure: HCA's company-facts data stops a quarter short of its anchor,
  // and its coverage must keep working on the read captions and say so.
  const debtIdx = results.findIndex((r) => r.triggerId === "debt-maturity");
  const debtTriggerDef = TRIGGERS.find((t) => t.id === "debt-maturity");
  if (debtIdx !== -1 && debtTriggerDef && results[debtIdx].fired && results[debtIdx].scheduleSequence.length === 0) {
    const label = debtTriggerDef.name.toLowerCase();
    const why = baseOffAnchorFailure
      ? "every transcribed row was verified against a filing OTHER than the anchor, so none states the anchor's own position"
      : baseColumnReadFailure
        ? "the anchor's debt note was located and transcribed, but every entry stated a period column other than the anchor's own period of report — a misread, not an absent schedule"
        : "the anchor's debt note yields no transcribable ladder (an abbreviated or narrative note is ordinary, and is not a reason to show an older filing's table)";
    log(
      `  ⚠ NO LADDER AT THE ANCHOR for ${label} — ${why}. The anchor is ${debtScheduleGuidance.base?.form} ${debtScheduleGuidance.base?.date} (period ${debtScheduleGuidance.base?.reportDate}) and the ladder renders EMPTY WITH THIS REASON. It is never filled from an older filing.`
    );
  }

  if (debtIdx !== -1 && results[debtIdx].fired) {
    const period = debtScheduleGuidance.base?.reportDate ?? "";
    const [xbrlDebtTotal, xbrlMaturityBuckets] = await Promise.all([
      fetchXbrlDebtTotal(filingsResult.cik, period),
      fetchXbrlMaturityBuckets(filingsResult.cik, period),
    ]);
    results[debtIdx] = { ...results[debtIdx], xbrlDebtTotal, xbrlMaturityBuckets };
    log(
      xbrlDebtTotal.total !== null
        ? `  XBRL stated total debt at ${period}: ${xbrlDebtTotal.parts.map((p) => `${p.tag}=${p.value.toLocaleString("en-US")}`).join(" + ")} — the denominator comes from the filer's own tags` +
            (xbrlDebtTotal.separateLeases.length ? `; leases tagged SEPARATELY and not added: ${xbrlDebtTotal.separateLeases.map((l) => l.tag).join(", ")}` : "")
        : `  ⚠ NO XBRL DEBT TOTAL at ${period} — ${xbrlDebtTotal.unavailableReason}. The denominator falls back to the balance-sheet captions as read, labelled as such on the surface.`
    );
    log(
      xbrlMaturityBuckets.buckets.length > 0
        ? `  XBRL maturity buckets at ${period}: ${xbrlMaturityBuckets.buckets.map((b) => `${b.label} ${b.value.toLocaleString("en-US")}`).join("; ")}`
        : `  no XBRL maturity buckets at ${period} — the ladder stands alone; no floor is fabricated`
    );
  }

  // proceedsUse: one Sonnet call, at most, per company — only when the
  // issuance trigger actually fired. Kept out of the main Haiku
  // classification (see the ProceedsUse doc comment in claude.ts for why).
  // Reads the FULL cited filing text (already fetched, in textByUrl) —
  // not just evidence/quote — since the use-of-proceeds sentence is
  // frequently outside whatever narrow excerpt Haiku's own evidence/quote
  // happened to select (see proceedsUse.ts's doc comment). Also always
  // includes the most recent 10-Q, regardless of whether Haiku happened to
  // cite it for THIS trigger: confirmed live that Haiku's own citation
  // choice for new-debt-issuance is itself non-deterministic — sometimes
  // it cites only the terse issuance 8-K (which frequently doesn't discuss
  // use of proceeds at all), sometimes the fuller 10-Q MD&A ("Liquidity
  // and Capital Resources," which routinely does). No new filing fetch —
  // the 10-Q is already in textByUrl from the main corpus read.
  const issuanceIdx = results.findIndex((r) => r.triggerId === "new-debt-issuance");
  if (issuanceIdx !== -1 && results[issuanceIdx].fired) {
    const issuance = results[issuanceIdx];
    try {
      const mostRecentTenQ = baseline
        .filter((f) => f.form === "10-Q")
        .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
      const urls = new Set([...issuance.citations.map((c) => c.url), ...(mostRecentTenQ ? [mostRecentTenQ.primaryDocUrl] : [])]);
      // Session 19, item 2d: each filing's contribution is BOUNDED before it
      // is sent. The cited pricing 8-Ks still go whole; the supplementary
      // 10-Q, which measured 83% of this call's entire input, is reduced to
      // regions around the issuance's own figures. See proceedsUseInput.ts
      // for the bound and the measurements behind it.
      const anchorText = [issuance.verifiedQuote ?? "", issuance.evidence ?? ""].join(" ");
      const bounded = [...urls]
        .map((url) => ({ url, text: textByUrl.get(url) }))
        .filter((f): f is { url: string; text: string } => !!f.text)
        .map((f) => ({ url: f.url, ...boundProceedsFilingText(f.text, anchorText) }));
      for (const b of bounded) {
        if (b.mode === "whole") continue;
        log(
          b.mode === "no-anchor"
            ? `  proceedsUse input: ${b.originalChars.toLocaleString()} chars DROPPED — this issuance's own figures appear nowhere in that filing, so there is no region to excerpt`
            : `  proceedsUse input: ${b.originalChars.toLocaleString()} → ${b.sentChars.toLocaleString()} chars across ${b.regions} region(s)`
        );
      }
      const filingTexts = bounded.map((b) => b.text).filter((t) => t.length > 0);
      // 3f: the key covers the bounded input, so a changed anchor cannot serve
      // an answer computed from different text. Hashes exactly what is sent.
      const proceedsInputHash = createHash("sha256")
        .update(JSON.stringify({ evidence: issuance.evidence, quote: issuance.verifiedQuote, filingTexts }))
        .digest("hex")
        .slice(0, 12);
      const { data: proceedsUse, hit: proceedsHit } = await cachedProceedsUse(filingsResult.cik, fingerprint, proceedsInputHash, () =>
        classifyProceedsUse({
          companyName,
          evidence: issuance.evidence,
          quote: issuance.verifiedQuote,
          filingTexts,
        })
      );
      results[issuanceIdx] = { ...issuance, proceedsUse };
      log(`  answer cache ${proceedsHit ? "HIT" : "MISS"} (proceedsUse)`);
      log(`  proceeds-use classified (Sonnet): ${proceedsUse}`);
    } catch (err) {
      log(
        `  ⚠ PROCEEDS-USE CLASSIFICATION FAILED for ${companyName} — new-debt-issuance: ${err instanceof Error ? err.message : String(err)}; proceedsUse left null`
      );
    }
  }

  const callTriggers = results.filter(
    (r) => r.fired && (r.needType === "credit" || r.needType === "treasury")
  );
  const relationshipFlags = results.filter((r) => r.fired && r.needType === "distress");
  const verdict: CompanyResult["verdict"] = callTriggers.length > 0 ? "CALL" : "NO ACTIONABLE TRIGGER";

  log(`verdict: ${verdict}`);
  for (const t of callTriggers) {
    log(`→ ${t.triggerName} — ${t.mappedNeed}`);
  }
  for (const t of relationshipFlags) {
    log(`relationship flag, not a sell → ${t.triggerName}`);
  }

  // Reported on EVERY run, cached or not — a fully-cached company logs
  // "$0.0000 — 0 API calls (fully cached)", which is the useful signal, not
  // a blank. Card narration (sonnetEventBriefing) bills into this same
  // scope but runs AFTER this function returns, so this line is the
  // EXTRACTION subtotal; callers that also build cards should read
  // currentCompanySpend() afterwards for the all-in figure.
  log(formatCompanyCostLine());
  // Written as well as printed: a backgrounded run's trace can be truncated,
  // and a pre-registered Rule 13 cost that cannot be reconciled afterwards is
  // not a control. See persistCompanySpend.
  persistCompanySpend();

  return {
    company: filingsResult.company,
    cik: filingsResult.cik,
    ticker: filingsResult.ticker,
    results,
    verdict,
    relationshipFlags,
  };
}

/** Builds a comparable date FactToken from an entry's own maturityDate/dateGranularity, or null if unset/unparseable — same convention lib/events/position.ts's debtRowDateToken uses, kept local here since loop.ts doesn't otherwise depend on the events layer. */
function rowMaturityToken(row: { maturityDate: string | null; dateGranularity: DateGranularity | null }): FactToken | null {
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

/**
 * Session 18 (post-v9 redesign): the shared core of every debt-note-entry
 * verifier below — sourceLine verified against the fetched corpus (cited
 * URLs first, then every other fetched URL, same cited-first-then-fallback
 * pattern verifyTriggerQuote already uses for `quote`), and amount required
 * to have a determinable money scale (moneyScale.ts) — an entry can pass
 * sourceLine verification (the text really is in the filing) and still be
 * untrustworthy for arithmetic if its own amount is a bare, unscaled number
 * ("45,828" with no unit). Either failure drops the entry, never trusted on
 * the model's word alone, so the checksum surfaces the resulting gap
 * instead of silently doing wrong math with it.
 */
/**
 * Session 18 (post-v15) — THE AMOUNT MUST BE IN THE FILING TOO.
 *
 * Found live on CHS: its verified sequence contained 1,069 / 1,010 / 44,200
 * / 45,828 / 49,718 — HCA's figures, copied verbatim out of the worked
 * example in this repo's own extraction prompt. Not one of those strings
 * appears anywhere in CHS's 183,593-character filing. They passed because
 * verification only ever checked `sourceLine`, and the subtotals' sourceLine
 * was the bare caption "Total long-term debt", which appears in very nearly
 * every debt note ever filed. A generic caption plus a fabricated figure was
 * therefore a free pass. Only the balance-sheet anchor caught it, and only
 * because the fabrication happened to be $36B out; a cleanly-copied example
 * would have walked through Check 1 intact.
 *
 * The check is on the PRINTED DIGIT GROUP, not the decorated amount string,
 * because by this point the amount may legitimately have been rewritten by
 * deriveScaleFromFilingDeclaration ("1,069" -> "$ 1,069 million") into a form
 * the filing never printed. Digits survive that rewrite; the decoration does
 * not.
 *
 * Deliberately permissive in two places, because a false DROP here is worse
 * than a false keep (a wrongly-dropped row corrupts every subtotal after it,
 * while a wrongly-kept one still has both checksums waiting for it):
 *   - ANY of the amount's digit groups matching is enough.
 *   - Groups shorter than MIN_DISCRIMINATING_DIGITS are skipped entirely.
 *     "34" occurs in essentially every filing, so requiring it would prove
 *     nothing, and treating its absence as fabrication would drop real rows.
 *     An amount with no discriminating group at all is passed through
 *     unchecked rather than dropped — the check abstains instead of guessing.
 */
const MIN_DISCRIMINATING_DIGITS = 3;

export function amountAppearsIn(amount: string, text: string): boolean {
  const groups = (amount.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).filter((g) => g.replace(/\D/g, "").length >= MIN_DISCRIMINATING_DIGITS);
  if (groups.length === 0) return true; // nothing discriminating to test — abstain, never fabricate a failure
  return groups.some((g) => text.includes(g));
}

/**
 * The digit-group scan above is necessary but not sufficient, because the
 * SAME VALUE can be printed in forms that share no digits. Found live on
 * UHS: the entry "$800,000 thousands" is the correct balance of a note the
 * filing names "$800 million, 2.65% Senior Notes due 2030" — identical
 * value, and "800,000" appears nowhere. The first cut of this check dropped
 * four such rows as fabricated, which is precisely the false drop the whole
 * design is supposed to avoid.
 *
 * So corroboration is tried by VALUE first, against the entry's own verified
 * sourceLine — text already proven to be in the filing, and short enough to
 * tokenize per entry. Only if that finds nothing does it fall back to the
 * digit scan over the full filing. CHS is unaffected either way: its
 * subtotals' sourceLine is the bare caption "Total long-term debt", which
 * carries no figure at all, so there is nothing to corroborate by value and
 * the digit scan still rejects them.
 */
/**
 * A1 (Session 18, post-stage-2) — AN AMOUNT MUST BE FOUND NEAR ITS OWN ROW,
 * NOT ANYWHERE IN THE DOCUMENT.
 *
 * The scan this replaces looked for the amount's digit groups across the
 * WHOLE filing. In a 183,000-character document that proves nothing: "350",
 * "400" and "708" all occur somewhere. Measured live on CHS — "350" appears
 * in a comprehensive-income figure, in the text of an accounting standard
 * ("Topic 350"), and in a capital-expenditure sentence; "708" appears once,
 * in the CASH FLOW STATEMENT, as "Proceeds from ABL Facility 708". That last
 * one is on the rendered ladder as an $708M ABL balance, against a real
 * balance of zero, and it verified LITERALLY — it is a genuine line of the
 * filing, just not from the debt note.
 *
 * So corroboration is bounded twice over, and both bounds are needed:
 *   - to the row's own matched position, because an amount belonging to this
 *     row is printed on this row; and
 *   - to the located debt note, because a real line from the cash flow
 *     statement is still not a debt-schedule row.
 *
 * The value-equality path stays and is checked first — it is what lets UHS's
 * "$800,000 thousands" corroborate against a note the filing names "$800
 * million", identical value sharing no digits. It now compares against the
 * text the FILING actually printed at the match (`verifiedText`) rather than
 * the model's own sourceLine. Under a literal match those are the same string
 * by definition; under co-occurrence they are not, and the old form was
 * value-matching the model's claim against the model's own claim.
 */
const AMOUNT_PROXIMITY_CHARS = 300;

/**
 * A1's note bound is applied with a margin, because the located span is a
 * padded window around DETECTED CONTENT, not the note's true closing
 * boundary. A debt note's own total and adjustment lines routinely sit past
 * its last coupon-bearing row, and where the filing writes them as "Total
 * debt before unamortized financing costs 4,752,551" no stated-total pattern
 * catches them either — so the window ends before the note does. Measured:
 * without this margin UHS lost its subtotal, its walk went from a clean tie
 * to a 24% miss, and A3 then correctly refused to render rows that were
 * never wrong.
 *
 * The margin costs the check nothing it was built for. The row it exists to
 * reject — CHS's cash-flow "Proceeds from ABL Facility 708" — sits about
 * 37,000 characters from that filing's debt note, three orders of magnitude
 * outside this bound. A boundary this rule polices to within a few hundred
 * characters would be measuring the locator's padding, not the filing.
 */
const NOTE_SPAN_MARGIN_CHARS = 3000;

/**
 * A filing at or under the lead window was sent to the model WHOLE, so it is
 * its own bound. Session 20: imported from noteLocation.ts rather than
 * re-declared here. This file used to carry its own 40000 under a comment
 * saying it "mirrors" the locator's — a verification bound depending on two
 * constants agreeing, with nothing but prose enforcing it.
 */
const SINGLE_EVENT_FILING_CHARS = LEAD_CHARS;

function noteSpanWithMargin(span: { start: number; end: number } | undefined): { start: number; end: number } | null {
  if (!span) return null;
  return { start: Math.max(0, span.start - NOTE_SPAN_MARGIN_CHARS), end: span.end + NOTE_SPAN_MARGIN_CHARS };
}

function moneyValuesOf(s: string): number[] {
  return extractFactTokens(s)
    .filter((t) => t.kind === "money")
    .map((t) => t.moneyValue)
    .filter((v): v is number => v !== undefined);
}

export function amountCorroborated(
  amount: string,
  verifiedText: string,
  filingText: string,
  span: { start: number; end: number } | null,
  noteSpan: { start: number; end: number } | null
): boolean {
  const claimed = moneyValuesOf(amount);
  if (claimed.length > 0) {
    // SESSION 19 — AN ISSUE SIZE IN A NAME IS A NAME, NOT A BALANCE.
    // This path was written FOR UHS, to let "$800,000 thousands" corroborate
    // against a note the filing names "$800 million" — identical value, no
    // shared digits. That reads as a scale win and is actually the hole: the
    // "$800 million" it matched is the issue size printed inside the row's
    // OWN LABEL, not a balance in any column. In an interest-expense table
    // whose real columns hold 5,357 and 10,713, every row's amount
    // corroborated against its own title and five interest rows verified as
    // a debt ladder. A balance must be corroborated by something other than
    // the instrument's name.
    const printed = moneyValuesOf(textOutsideInstrumentLabel(verifiedText));
    // Exact value equality — not a tolerance. Two figures that are merely
    // close are two different figures, and this is a fabrication check.
    if (claimed.some((c) => printed.some((p) => Math.abs(c) === Math.abs(p)))) return true;
  }
  const groups = discriminatingDigitGroups(amount);
  if (groups.length === 0) return true; // nothing discriminating to test — abstain, never fabricate a failure
  // No position means no way to bound the search, and an unbounded search is
  // the thing this function exists to stop.
  if (!span) return false;
  // A SINGLE-EVENT FILING IS ITS OWN BOUND. The whole point of the proximity
  // rule is that "somewhere in this document" is meaningless across 183,000
  // characters of a 10-K. It is not meaningless across an 8-K, which is short
  // enough that the model receives all of it and which exists to announce one
  // transaction. Cigna's pricing 8-K is the measured case: the model quoted
  // the interest-rate sentence for each tranche while the principal amount is
  // stated a paragraph above, and proximity alone dropped three real tranches.
  // The bound is the lead window — the same threshold buildExtractionText
  // uses to decide a filing needs no excerpting at all.
  if (!noteSpan && filingText.length <= SINGLE_EVENT_FILING_CHARS) {
    return groups.some((g) => filingText.includes(g));
  }
  let from = Math.max(0, span.start - AMOUNT_PROXIMITY_CHARS);
  let to = Math.min(filingText.length, span.end + AMOUNT_PROXIMITY_CHARS);
  if (noteSpan) {
    from = Math.max(from, noteSpan.start);
    to = Math.min(to, noteSpan.end);
  }
  if (to <= from) return false;
  // The row's OWN issue size is inside this window, so an unmasked search
  // finds Centene's "$2,500 million" name and calls it corroboration of a
  // $2,500M balance. Value equality was only half the hole; the digit-group
  // path reaches the same label by another route. Mask this row's issue size
  // where it sits — one occurrence, inside the row's own matched span — and
  // leave every other appearance in the window searchable.
  let window = filingText.slice(from, to);
  const ownIssueSize = splitIssueSizeFromName(verifiedText).issueSize;
  if (ownIssueSize) {
    const rel = filingText.slice(from, to).indexOf(ownIssueSize, Math.max(0, span.start - from));
    if (rel !== -1) window = window.slice(0, rel) + " ".repeat(ownIssueSize.length) + window.slice(rel + ownIssueSize.length);
  }
  return groups.some((g) => window.includes(g));
}

function verifySourceLineAndScale<T extends { sourceLine: string; amount: string | null }>(
  entries: T[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string,
  describe: (entry: T) => string,
  /**
   * A1. The located debt note per filing. Passed for the debt-note sequences
   * (whose rows must come from inside the note) and deliberately NOT for
   * balance-sheet captions — those live in the balance sheet by definition,
   * outside every debt note — nor for 8-K issued tranches, whose filings have
   * no note to locate at all.
   */
  noteSpanByUrl?: Map<string, { start: number; end: number }>
): (T & { citedUrl: string })[] {
  const orderedUrls = [...new Set([...citedUrls, ...textByUrl.keys()])];
  const out: (T & { citedUrl: string })[] = [];
  for (const entry of entries) {
    if (!entry.sourceLine || !entry.sourceLine.trim()) continue;
    // Session 19: an entry may legitimately state NO amount. Every ladder
    // row has one — a debt row without a balance is meaningless — but an
    // acquisition or a subsidiary formation routinely names none, and the
    // eventInstances array carries those. A null amount is not an
    // indeterminate scale; there is simply nothing to scale, and nothing to
    // corroborate the sourceLine against either. The sourceLine itself is
    // still verified literally and still bounded, which is the part that
    // matters.
    if (entry.amount !== null) {
      const scaleCheck = checkMoneyScale(entry.amount);
      if (!scaleCheck.determinable) {
        log(`  ⚠ AMOUNT SCALE INDETERMINATE for ${label} — "${describe(entry)}: ${scaleCheck.raw}" has no determinable unit; dropped, not trusted for arithmetic`);
        continue;
      }
    }
    let matched = false;
    let sourceLineFoundButAmountAbsent = false;
    let foundOutsideNote = false;
    for (const url of orderedUrls) {
      const text = textByUrl.get(url);
      if (!text) continue;
      // A2 — a co-occurrence match must carry this entry's own amount, not
      // just an instrument caption that happens to sit near a matching year.
      const noteSpan = noteSpanWithMargin(noteSpanByUrl?.get(url));
      const result = verifyClaim(entry.sourceLine, [text], { requireAmount: entry.amount ?? undefined, preferWithin: [noteSpan] });
      if (!result.verified) continue;

      // A1, first bound — the row must come from inside the located debt
      // note. Only enforced where a note was actually located in THIS filing:
      // a filing with no locatable note (an 8-K, an abbreviated 10-Q) has no
      // span to be outside of, and rejecting on its absence would be a false
      // drop rather than a check.
      if (noteSpan && result.sourceSpan && (result.sourceSpan.end < noteSpan.start || result.sourceSpan.start > noteSpan.end)) {
        foundOutsideNote = true;
        continue; // a different filing may carry this row inside its own note
      }

      // A1, second bound — the amount must be printed near the row it is
      // claimed for. Checked per-filing rather than across the corpus, so a
      // figure that is only real in some OTHER filing can never rescue it.
      // Session 19: no amount, nothing to corroborate. The sourceLine has
      // already been verified literally and bounded above; this bound exists
      // to stop a figure being attached to a row that does not print it, and
      // an entry claiming no figure cannot commit that error.
      if (entry.amount !== null && !amountCorroborated(entry.amount, result.displayText ?? entry.sourceLine, text, result.sourceSpan, noteSpan)) {
        sourceLineFoundButAmountAbsent = true;
        continue;
      }
      matched = true;
      out.push({ ...entry, citedUrl: url });
      break;
    }
    if (!matched && foundOutsideNote) {
      log(
        `  ⚠ ROW OUTSIDE THE DEBT NOTE for ${label} — "${describe(entry)}" matches real filing text, but that text sits outside the located debt-note section (a cash-flow line or narrative mention, not a schedule row); dropped, not trusted`
      );
    }
    if (!matched && sourceLineFoundButAmountAbsent) {
      log(
        `  ⚠ AMOUNT NOT PRINTED NEAR ITS ROW for ${label} — "${describe(entry)}" cites a sourceLine that IS in the filing, but its amount ${JSON.stringify(entry.amount)} is not printed on or beside that row; dropped as fabricated, not trusted`
      );
    }
    if (!matched && process.env.DIAG_DEBT_ROWS) {
      console.error(`[DIAG] unverified sourceLine (${label}, ${describe(entry)}): ${JSON.stringify(entry.sourceLine)}`);
    }
  }
  return out;
}

/**
 * Session 18 (post-v6, live-diagnosed against REAL HCA data): a verified
 * sourceLine only proves the ROW TEXT is real — it says nothing about
 * whether a claimed maturityDate riding along with it is real. HCA's live
 * extraction returned "Other debt (effective interest rate of 4.9%)" as
 * sourceLine (genuinely verbatim — passes) paired with maturityDate "2026"
 * (not stated anywhere in that text — the reporting year, fabricated). So a
 * non-null maturityDate is independently checked here: its own row's
 * sourceLine must contain a matching date token, or the date is dropped
 * (nulled, not the whole entry — instrument/rate/amount are still real and
 * worth keeping for an aggregate-disclosure line with no stated maturity).
 * Shared by verifySequenceEntries (row-kind entries only) and
 * verifyIssuedTranches (every issued tranche is row-shaped).
 */
/**
 * Session 18 (post-v16) — RECOVER A MONTH THE FILING ACTUALLY PRINTS.
 *
 * A year-granularity row is deliberately never carded (eligibility.ts: the
 * month can't be verified, so it's held to the table). That rule is right,
 * but it was firing on rows whose month IS printed in the filing, purely
 * because the model returned "year".
 *
 * Measured across all 10 companies at zero cost: 11 of 98 verified rows
 * carry a month in their own verified sourceLine yet came back as bare
 * year — and ALL 11 are Quest ("4.60 % Senior Notes due December 2027" ->
 * 2027). Every other company is zero; Cigna's 30 rows, identically shaped,
 * resolve to month granularity correctly. So this is model inconsistency,
 * not a systemic pipeline bug — which is exactly the class this project
 * fixes in code rather than by asking the prompt again.
 *
 * Reads ONLY the row's own verified sourceLine (never the label, which is
 * not independently verified) and only ever ADDS precision the document
 * itself states, never invents a day. The year must match what the model
 * already claimed, so this can only sharpen an existing correct answer —
 * it can never move a row to a different year.
 */
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_NAMES.join("|")})\\s+((?:19|20)\\d{2})\\b`, "i");

/**
 * D2 (Session 18, post-stage-2) — SEARCH THE WHOLE LOCATED NOTE, NOT THE ROW'S
 * OWN LINE.
 *
 * The first cut read only the row's own verified sourceLine, and the
 * measurement taken from it — "0 of 28 year-only rows carry a month" —
 * undercounted, because a filing routinely states maturity months in the
 * PROSE around its table: a redemption discussion, a maturity-range sentence.
 * Tenet's 6.125% due 2028 is the worked case, printed as "6.125 % due 2028"
 * in the table and "6.125% senior notes due October 2028" in the narrative a
 * few hundred characters away.
 *
 * THE AMBIGUITY RULE IS THE WHOLE SAFETY. A note mentioning two different
 * months against the same year gives no basis to pick one, so the row stays
 * year-only. Only a single unambiguous candidate is applied — this can
 * sharpen a correct answer and can never move a row to a different year, both
 * because the year must already match and because two candidates abstain.
 */
function monthsStatedForYear(noteText: string, year: string): number[] {
  const re = new RegExp(`\b(${MONTH_NAMES.join("|")})\s+${year}\b`, "gi");
  const found = new Set<number>();
  for (const m of noteText.matchAll(re)) {
    const idx = MONTH_NAMES.indexOf(m[1].toLowerCase());
    if (idx >= 0) found.add(idx + 1);
  }
  return [...found];
}

function recoverStatedMonth<T extends { maturityDate: string | null; dateGranularity: DateGranularity | null; sourceLine: string }>(
  row: T,
  log: (line: string) => void,
  label: string,
  describe: (row: T) => string,
  noteText?: string
): T {
  if (row.dateGranularity !== "year" || !row.maturityDate) return row;
  const year = row.maturityDate.trim();

  // 1. The row's own verified sourceLine — most specific, always wins.
  const m = row.sourceLine.match(MONTH_YEAR_RE);
  if (m && m[2] === year) {
    const month = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1;
    if (month >= 1) {
      const recovered = `${year}-${String(month).padStart(2, "0")}-01`;
      log(`  MATURITY MONTH RECOVERED for ${label} — "${describe(row)}" was bare year ${year}, but its own verified sourceLine prints "${m[0]}"; sharpened to ${recovered}`);
      return { ...row, maturityDate: recovered, dateGranularity: "month" as DateGranularity };
    }
  }

  // 2. The located debt note, but ONLY when it states exactly one month for
  // this year. Two or more and there is nothing to choose between them.
  if (!noteText) return row;
  const candidates = monthsStatedForYear(noteText, year);
  if (candidates.length === 0) return row;
  if (candidates.length > 1) {
    log(`  MATURITY MONTH AMBIGUOUS for ${label} — "${describe(row)}" is bare year ${year}, and the note states ${candidates.length} different months against ${year}; held at year precision rather than picked`);
    return row;
  }
  const recovered = `${year}-${String(candidates[0]).padStart(2, "0")}-01`;
  log(`  MATURITY MONTH RECOVERED for ${label} — "${describe(row)}" was bare year ${year}; the located debt note states exactly one month for ${year}; sharpened to ${recovered}`);
  return { ...row, maturityDate: recovered, dateGranularity: "month" as DateGranularity };
}

function withVerifiedMaturity<T extends { maturityDate: string | null; dateGranularity: DateGranularity | null; sourceLine: string }>(
  row: T,
  log: (line: string) => void,
  label: string,
  describe: (row: T) => string
): T {
  const claimedDate = rowMaturityToken(row);
  if (!claimedDate) return row;
  const sourceLineDateTokens = extractFactTokens(row.sourceLine).filter((t) => t.kind === "date");
  const dateConfirmed = sourceLineDateTokens.some((t) => factTokensMatch(claimedDate, t));
  if (dateConfirmed) return row;
  log(
    `  ⚠ MATURITY DATE NOT IN SOURCE LINE for ${label} — "${describe(row)}" claimed maturity ${row.maturityDate}, but no matching date token exists in its own verified sourceLine; maturityDate/dateGranularity nulled, entry kept`
  );
  return { ...row, maturityDate: null, dateGranularity: null };
}

/**
 * Session 18 (post-v9 redesign): verifies every entry in a debt note's
 * ordered walk (scheduleSequence/priorScheduleSequence) — row, adjustment,
 * AND subtotal kinds alike need sourceLine+scale verification (a fabricated
 * subtotal is just as much a lie as a fabricated row); maturityDate
 * verification only applies to "row" kind entries (adjustment/subtotal have
 * no maturity concept at all).
 */
function verifySequenceEntries(
  entries: ScheduleSequenceEntry[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string,
  noteSpanByUrl: Map<string, { start: number; end: number }>
): VerifiedSequenceEntry[] {
  const verified = verifySourceLineAndScale(entries, citedUrls, textByUrl, log, label, (e) => e.label ?? e.kind, noteSpanByUrl);
  const noteTextFor = (url: string): string | undefined => {
    const span = noteSpanByUrl.get(url);
    const text = textByUrl.get(url);
    return span && text ? text.slice(span.start, span.end) : undefined;
  };
  return verified.map((entry) =>
    entry.kind === "row"
      ? withVerifiedMaturity(recoverStatedMonth(entry, log, label, (e) => e.label ?? "row", noteTextFor(entry.citedUrl)), log, label, (e) => e.label ?? "row")
      : entry
  );
}

/** Same verification as verifySequenceEntries, for new-debt-issuance's issuedTranches — always row-shaped, so maturity verification always applies. */
function verifyIssuedTranches(
  rows: IssuedTrancheRow[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string
): VerifiedIssuedTranche[] {
  const verified = verifySourceLineAndScale(rows, citedUrls, textByUrl, log, label, (r) => r.instrument);
  return verified.map((row) => withVerifiedMaturity(recoverStatedMonth(row, log, label, (r) => r.instrument), log, label, (r) => r.instrument));
}

/**
 * SESSION 19, ITEM 2a — THE SAME VERIFICATION WALK, FOR eventInstances.
 *
 * A field that exists in the schema and the prompt but not in the verifier's
 * walk is the drift item 1a just killed on the guard side, one layer over:
 * the model would be asked for a sourceLine held to the quote standard, and
 * nothing would ever check it. Every entry goes through the SAME
 * verifySourceLineAndScale every ladder row goes through — literal match
 * against the cited filing, money-scale determinable, and an entry that
 * fails is DROPPED rather than trusted.
 *
 * `amount` is nullable here and is not on a ladder row: an acquisition or a
 * subsidiary formation genuinely often states no figure. The shared verifier
 * now takes a nullable amount and skips the scale and corroboration checks
 * when there is none — the sourceLine is still verified literally and still
 * bounded, which is the part that matters.
 */
/**
 * Splits verified schedule entries into those that state the ANCHOR's own
 * position and those transcribed from some other filing. Exported so the
 * rule is testable on its own terms rather than only through a full run.
 *
 * A null anchor abstains: with no anchor identified there is nothing to be
 * off, and dropping every row would turn "we could not tell" into "there is
 * no debt".
 */
/**
 * SESSION 20, STAGE 4 — THE RULE COVERS THE POSITION, NOT ONE FIELD OF IT.
 *
 * This was written for `scheduleSequence` and applied there alone. Three
 * other fields state the same position and none of them was checked, so the
 * rule held on a quarter of its own domain:
 *
 *   balanceSheetDebtCaptions   the denominator the whole coverage check
 *                              divides by
 *   proseInstruments           half a capital structure, for a prose filer
 *   revolver                   what is drawn, and the liquidity line
 *
 * Measured on v22: UHS's rows came from the 10-K, its captions from the
 * June 10-Q's December column, and its prose instruments from the MARCH
 * 10-Q — three filings, three dates, one rendered position, and the rule
 * that exists to stop exactly that was watching one of the three.
 *
 * Generic over anything carrying a citedUrl, so a fifth position-bearing
 * field cannot be added without this applying to it.
 */
export function onAnchor<T extends { citedUrl?: string | null }>(
  entries: T[],
  anchorUrl: string | null
): { kept: T[]; dropped: T[] } {
  if (!anchorUrl) return { kept: entries, dropped: [] };
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const e of entries) {
    if (!e.citedUrl || e.citedUrl === anchorUrl) kept.push(e);
    else dropped.push(e);
  }
  return { kept, dropped };
}

/** The schedule-row case, kept as its own name because that is how the rule is referred to everywhere it is discussed. */
export function rowsOnAnchor(
  entries: VerifiedSequenceEntry[],
  anchorUrl: string | null
): { kept: VerifiedSequenceEntry[]; dropped: VerifiedSequenceEntry[] } {
  return onAnchor(entries, anchorUrl);
}

/**
 * SESSION 20, 3A/3B — THE PROSE HALF GOES THROUGH THE SAME WALK.
 *
 * A field in the schema and the prompt but not in the verifier is the drift
 * Session 19's item 1a killed on the guard side. These verify exactly as a
 * ladder row does: literal match first, bounded to the LOCATED NOTE'S OWN
 * SPAN. A claim about the note must be found in the note (Rule 5).
 *
 * Amounts are deliberately NOT scale-corroborated here. A prose amount is
 * written out with its unit ("$1.448 billion"), so there is no bare figure
 * whose scale has to be inferred — the corroboration step exists for table
 * cells and would only add a way to drop a correct entry.
 */
export function verifyProseInstruments(
  rows: ProseInstrumentRow[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string,
  noteSpanByUrl?: Map<string, { start: number; end: number }>
): VerifiedProseInstrument[] {
  return verifySourceLineAndScale(
    rows.map((r) => ({ ...r, amount: null })),
    citedUrls,
    textByUrl,
    log,
    `${label} (prose instruments)`,
    (e) => `${e.category}${e.name ? ` "${e.name}"` : ""}`,
    noteSpanByUrl
  ).map((v, i) => ({ ...rows[i], citedUrl: v.citedUrl })) as VerifiedProseInstrument[];
}

export function verifyEventInstances(
  rows: EventInstanceRow[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string
): VerifiedEventInstance[] {
  return verifySourceLineAndScale(rows, citedUrls, textByUrl, log, label, (r) => r.description);
}

/**
 * SESSION 19, ITEM 2b — SAME WALK, BOUNDED TO THE NOTE (Rule 5).
 *
 * noteSpanByUrl is passed, and that is the whole point of the field. A
 * retirement is claimed to be stated in the debt note's own prose, so its
 * sourceLine must be found INSIDE the located note — not merely somewhere in
 * a 180,000-character filing, which is the unbounded search Rule 5 exists to
 * forbid. An entry whose text sits outside the note is dropped exactly as a
 * ladder row outside the note is dropped.
 */
export function verifyNoteRetirements(
  rows: NoteRetirementRow[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string,
  noteSpanByUrl: Map<string, { start: number; end: number }>
): VerifiedNoteRetirement[] {
  return verifySourceLineAndScale(rows, citedUrls, textByUrl, log, label, (r) => r.instrument, noteSpanByUrl);
}

/** Same sourceLine+scale verification, for Check 2's balance-sheet captions — no maturity concept at all for these. */
function verifyBalanceSheetCaptions(
  captions: BalanceSheetDebtCaption[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string
): VerifiedBalanceSheetCaption[] {
  return verifySourceLineAndScale(captions, citedUrls, textByUrl, log, label, (c) => c.label);
}

/**
 * Session 18 E2 fix: narrows a fact's citations to the filings that
 * genuinely back it, at the SOURCE (here, before TriggerResult.citations is
 * ever built) rather than downstream in card assembly. Diagnosed live
 * against Session 17's real Quest card: a fact's citedUrls is Haiku's own
 * self-reported list, which can legitimately name 2+ filings (a QoQ cash
 * comparison citing two 10-Qs) — but nothing previously checked whether
 * EACH individual cited filing's own text actually contains the fact's
 * verified content, vs. being listed as background context the model
 * happened to also look at. Keeps a citation whenever that specific
 * filing's own text contains a match for the fact's own verified tokens;
 * drops one that doesn't. Deliberately NOT "keep only the most recent
 * citation" — that would drop a genuinely-used older filing and reintroduce
 * Session 17's Blocker 4 (a card citing only its own filing while its own
 * text narrates from another). Single-citation facts are untouched (nothing
 * to narrow); a fact where narrowing would drop every citation keeps the
 * original set rather than end up uncited.
 */
/**
 * SESSION 22, STAGE 7 — RULE 37'S COROLLARY, IN THE CITATION LAYER.
 *
 * This NARROWS a list the model supplied. An empty list therefore stays
 * empty — and Centene supplies an empty one for every trigger. Measured: five
 * triggers fired, every one with `verifiedQuote: yes`, and ZERO citations. The
 * pipeline had found each quote in a fetched filing, knew which filing, and
 * cited nothing, because the citation came from the model's self-report while
 * the verification came from the corpus.
 *
 * The cost was not cosmetic. It emptied Centene's filing set, which is a
 * golden file's IDENTITY — a pin against no documents is a pin every future
 * run matches trivially, so Centene could not be signed at all. It is the same
 * self-report-as-denominator defect that deleted its facilities (Rule 37) and
 * marked Quest's real redemption unverified.
 *
 * So where the model cites nothing and the quote verified, the citation is
 * the document the quote was FOUND in. That is a fact this pipeline
 * established rather than one it was told.
 */
function citationsFromCorpus(verifiedText: string | null, textByUrl: Map<string, string>): string[] {
  if (!verifiedText) return [];
  const found: string[] = [];
  for (const [url, text] of textByUrl) {
    if (text && createTextLocator(text).find(verifiedText) !== null) found.push(url);
  }
  return found;
}

function narrowCitationsToBackedFilings(verifiedText: string | null, citedUrls: string[], textByUrl: Map<string, string>): string[] {
  // The model named no filing. Fall back to the corpus, which knows.
  if (citedUrls.length === 0) return citationsFromCorpus(verifiedText, textByUrl);
  if (!verifiedText || citedUrls.length <= 1) return citedUrls;
  const factTokensList = extractFactTokens(verifiedText);
  if (factTokensList.length === 0) return citedUrls;
  const backed = citedUrls.filter((url) => {
    const text = textByUrl.get(url);
    if (!text) return true; // can't check this one — never drop for lack of evidence, that isn't evidence of anything
    const urlTokens = extractFactTokens(text);
    return factTokensList.some((t) => urlTokens.some((ut) => factTokensMatch(t, ut)));
  });
  return backed.length > 0 ? backed : citedUrls;
}

function finalize(
  trigger: TriggerDef,
  citationLookup: Map<string, { form: string; date: string; reportDate: string }>,
  v: TriggerVerdict,
  verification: { verified: boolean; displayText: string | null; normalizedText: string | null; matchType: "literal" | "co-occurrence" | null },
  dateGuard: EventDateGuardResult,
  textByUrl: Map<string, string>,
  debtFields: {
    eventInstances: VerifiedEventInstance[];
    noteRetirements: VerifiedNoteRetirement[];
    proseInstruments: VerifiedProseInstrument[];
    facilities: VerifiedFacility[];
    facilityRejections: FigureRejection[];
    seniorityStatement: SeniorityStatement | null;
    scheduleSequence: VerifiedSequenceEntry[];
    priorScheduleSequence: VerifiedSequenceEntry[];
    issuedTranches: VerifiedIssuedTranche[];
    balanceSheetDebtCaptions: VerifiedBalanceSheetCaption[];
  },
  debtScheduleBaseFiling: DebtScheduleFilingRef | null,
  debtSchedulePriorFiling: DebtScheduleFilingRef | null,
  rowAccounting: { rowsExtracted: number; rowsVerified: number; baseRowsExtracted: number },
  columnReadFailure: boolean,
  scheduleCompleteness: ScheduleCompletenessResult | null
): TriggerResult {
  const narrowedCitedUrls = narrowCitationsToBackedFilings(
    verification.verified ? verification.displayText : null,
    v.citedUrls ?? [],
    textByUrl
  );
  return {
    proseInstruments: trigger.id === "debt-maturity" ? debtFields.proseInstruments : [],
    facilities: trigger.id === "debt-maturity" ? debtFields.facilities : [],
    facilityRejections: trigger.id === "debt-maturity" ? debtFields.facilityRejections : [],
    seniorityStatement: trigger.id === "debt-maturity" ? debtFields.seniorityStatement : null,
    triggerId: trigger.id,
    triggerName: trigger.name,
    fired: v.fired,
    dataAvailable: v.dataAvailable,
    evidence: v.evidence ?? null,
    mappedNeed: trigger.mappedNeed,
    needType: trigger.needType,
    confidence: v.confidence,
    citations: narrowedCitedUrls.map((url) => {
      const known = citationLookup.get(url);
      return { form: known?.form ?? "filing", date: known?.date ?? "", reportDate: known?.reportDate ?? "", url };
    }),
    quoteVerified: verification.verified,
    verifiedQuote: verification.verified ? verification.displayText : null,
    verifiedQuoteNormalized: verification.verified ? (verification.normalizedText ?? verification.displayText) : null,
    quoteMatchType: verification.matchType,
    quoteHasFigure: verification.verified ? (v.quoteHasFigure ?? false) : false,
    eventDate: dateGuard.eventDate,
    dateGranularity: dateGuard.eventDateGranularity,
    scheduleSequence: debtFields.scheduleSequence,
    priorScheduleSequence: debtFields.priorScheduleSequence,
    balanceSheetDebtCaptions: debtFields.balanceSheetDebtCaptions,
    debtScheduleSourceFiling: trigger.id === "debt-maturity" ? debtScheduleBaseFiling : null,
    debtSchedulePriorFiling: trigger.id === "debt-maturity" ? debtSchedulePriorFiling : null,
    rowsExtracted: rowAccounting.rowsExtracted,
    rowsVerified: rowAccounting.rowsVerified,
    baseRowsExtracted: rowAccounting.baseRowsExtracted,
    columnReadFailure,
    scheduleCompleteness,
    redeems: normalizeRedeems(v.redeems).map((c, i) => ({ ...c, verified: (v.redeems as VerifiedRedeemsClaim[])[i]?.verified ?? false })),
    proceedsUses: trigger.id === "new-debt-issuance" ? (v.proceedsUses ?? []) : [],
    issuedTranches: debtFields.issuedTranches,
    eventInstances: debtFields.eventInstances,
    noteRetirements: debtFields.noteRetirements,
    projectCompletionDate: v.projectCompletionDate ?? null,
    projectCompletionGranularity: v.projectCompletionGranularity ?? null,
    cashAmount: v.cashAmount,
    projectName: v.projectName,
    eventStatus: v.eventStatus ?? "standing",
    // Classified separately, once per fired issuance fact, by Sonnet — see
    // the post-loop step in runAgentLoop. Null here is the pre-classification
    // default, not a final answer, except for every non-issuance trigger
    // (for which it stays null, correctly, forever).
    proceedsUse: null,
  };
}
