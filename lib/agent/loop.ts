import { TRIGGERS, type TriggerDef } from "./triggers";
import { selectBaselineFilings } from "./selectFilings";
import { getRecentFilings, readFiling, searchNews } from "./tools";
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
  type ProceedsUse,
  type ScheduleSequenceEntry,
  type TriggerVerdict,
} from "./claude";
import { verifyTriggerQuote, verifyClaim } from "./verifyQuote";
import { verifyEventDate, type EventDateGuardResult } from "./factGuard";
import { classifyProceedsUse } from "./proceedsUse";
import { extractFactTokens, factTokensMatch, type FactToken } from "./factTokens";
import { assertBlobConfigured } from "../fetch/cache";
import { corpusFingerprint, cachedBaseClassification, cachedDigClassification, cachedProceedsUse } from "../cache/answerCache";
import { buildExtractionText, assertCompanyHasLocatableDebtNote, type DebtNoteFilingStatus } from "../fetch/debtNoteLocator";
import { computeScheduleCompleteness, type ScheduleCompletenessResult } from "../fetch/scheduleCompleteness";
import { checkMoneyScale, hasDeterminableMoneyScale, applyTableUnitToAmount, isSelfDescribingAmount, scaleWordFromDeclaration } from "./moneyScale";
import { detectDollarScaleAt } from "./scaleNormalize";
import { createTextLocator } from "./verifyQuote";
import { beginCompanyCostScope, currentCompanySpend, formatCompanyCostLine } from "./costMeter";

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
  describe: (entry: T) => string
): T[] {
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
    log(
      `  ⚠ WRONG-COLUMN ENTRY DROPPED for ${label} — "${describe(entry)}" reports amount ${JSON.stringify(entry.amount)} from column ${JSON.stringify(entry.periodColumn)}, but this filing's period of report is ${expectedReportDate}; a prior-column amount walks cleanly against a prior-column subtotal, so it is dropped rather than trusted`
    );
  }
  if (unbound > 0) {
    log(`  COLUMN BINDING for ${label} — ${unbound} entr${unbound === 1 ? "y" : "ies"} stated no period column; kept (a single-column table is real), not verifiable either way`);
  }
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
  citations: { form: string; date: string; url: string }[];
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
  /** Session 18 (post-v6) — "debt-maturity" ONLY. Which filing scheduleSequence was actually transcribed from — determined in code (lib/fetch/debtNoteLocator.ts) BEFORE the model was asked, not self-reported. Null when no filing had a locatable schedule (scheduleSequence is then also empty). Surfaced so the render layer can state which filing the ladder came from, and so a caller can tell "genuinely no schedule anywhere" apart from "schedule exists but wasn't reachable this run." Null for every other trigger. */
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
  /** Session 18 — "new-debt-issuance" ONLY. Verbatim description of what this issuance redeems/repays, or null. Null for every other trigger. */
  redeems: string | null;
  /** Session 18 — "new-debt-issuance" ONLY. The row(s) for the tranche(s) this issuance itself priced, verified the same way scheduleSequence rows are. Empty for every other trigger. */
  issuedTranches: VerifiedIssuedTranche[];
  /** Session 18 A3 — every trigger. The amount this event's OWN filing text states for it, or null — never a figure merely present nearby. Feeds gate restriction D2 (cashAmount: null never cards, any trigger except debt-maturity). */
  cashAmount: string | null;
  /** Session 18 A3 — every trigger. The discrete named project this event's filing calls out, or null when the amount is a period total with no named project. */
  projectName: string | null;
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

  const citationLookup = new Map(
    filingsResult.filings.map((f) => [f.primaryDocUrl, { form: f.form, date: f.filingDate }])
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
  const debtNoteStatusByFiling: { form: string; filingDate: string; reportDate: string; url: string; status: DebtNoteFilingStatus }[] = [];
  for (const filing of baseline) {
    const { text: fullText } = await readFiling(filing.primaryDocUrl);
    const extraction = buildExtractionText({ form: filing.form, url: filing.primaryDocUrl, fullText });
    corpus.push({ form: filing.form, filingDate: filing.filingDate, url: filing.primaryDocUrl, text: extraction.text });
    textByUrl.set(filing.primaryDocUrl, fullText);
    if (filing.form === "10-Q" || filing.form === "10-K") {
      debtNoteStatusByFiling.push({ form: filing.form, filingDate: filing.filingDate, reportDate: filing.reportDate, url: filing.primaryDocUrl, status: extraction.debtNoteStatus });
      log(
        `  debt-note locator: ${filing.form} ${filing.filingDate} → ${extraction.debtNoteStatus}` +
          (extraction.matchCount !== undefined ? ` (${extraction.matchCount} matches)` : "")
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
  const USABLE_DEBT_NOTE_STATUSES = new Set<DebtNoteFilingStatus>(["found", "under_cap"]);
  const usableDebtNoteFilings = debtNoteStatusByFiling
    .filter((f) => USABLE_DEBT_NOTE_STATUSES.has(f.status))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  // Reassigned by the search-order fallback below when the newest filing
  // turns out not to carry a real schedule — see that block for why the
  // decision cannot be made here, before extraction.
  let debtScheduleGuidance: DebtScheduleFilingGuidance = {
    base: usableDebtNoteFilings[0] ? { form: usableDebtNoteFilings[0].form, date: usableDebtNoteFilings[0].filingDate, reportDate: usableDebtNoteFilings[0].reportDate, url: usableDebtNoteFilings[0].url } : null,
    prior: usableDebtNoteFilings[1] ? { form: usableDebtNoteFilings[1].form, date: usableDebtNoteFilings[1].filingDate, reportDate: usableDebtNoteFilings[1].reportDate, url: usableDebtNoteFilings[1].url } : null,
  };
  log(
    debtScheduleGuidance.base
      ? `  debt-schedule base filing selected: ${debtScheduleGuidance.base.form} ${debtScheduleGuidance.base.date}` +
          (debtScheduleGuidance.prior ? `; prior: ${debtScheduleGuidance.prior.form} ${debtScheduleGuidance.prior.date}` : "; no prior filing available")
      : `  debt-schedule base filing: NONE — no 10-Q/10-K in this corpus has a locatable schedule`
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
  // debtNoteLocator.ts's doc comment: a SINGLE 10-Q genuinely not repeating
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
    const columnBound = {
      scheduleSequence: bindEntriesToPeriod(v.scheduleSequence, debtScheduleGuidance.base?.reportDate ?? null, log, label, (e) => e.label ?? e.kind),
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

    const scheduleSequence = verifySequenceEntries(unitScoped.scheduleSequence, v.citedUrls ?? [], textByUrl, log, label);
    const priorScheduleSequence = verifySequenceEntries(unitScoped.priorScheduleSequence, v.citedUrls ?? [], textByUrl, log, label);
    const issuedTranches = verifyIssuedTranches(v.issuedTranches, v.citedUrls ?? [], textByUrl, log, label);
    const balanceSheetDebtCaptions = verifyBalanceSheetCaptions(unitScoped.balanceSheetDebtCaptions, v.citedUrls ?? [], textByUrl, log, label);
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

    return finalize(
      trigger,
      citationLookup,
      vSanitized,
      result,
      dateGuard,
      textByUrl,
      { scheduleSequence, priorScheduleSequence, issuedTranches, balanceSheetDebtCaptions },
      debtScheduleGuidance.base,
      debtScheduleGuidance.prior,
      { rowsExtracted, rowsVerified },
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
  // Session 18 (post-v16) — LOCATOR SEARCH ORDER.
  //
  // The rule: try the newest 10-Q, then walk backwards in filing date through
  // the prior 10-Q and the 10-K, and take the FIRST filing that actually
  // yields a debt schedule. A filing that abbreviates its debt note is
  // ordinary — most 10-Qs do not reprint the full ladder every quarter — so an
  // abbreviated note is not an error and must not end the search. Cigna is the
  // general case made concrete: its table exists ONLY in the 10-K, and both
  // its 10-Qs genuinely have no schedule to find.
  //
  // WHY THE TEST IS POST-EXTRACTION. "Does this filing carry a real schedule"
  // would ideally be decided before spending a model call, and five separate
  // pre-extraction proxies were built and measured against all 30 real
  // filings. Every one was falsified: coupon-cluster density selects
  // interest-expense tables; cluster-median magnitude and document-p95 ratio
  // cannot separate HCA's correct table (0.049) from UHS's wrong one (0.013);
  // a "Total ..." caption count is zero for HCA, UHS, Encompass and CHS, all
  // of which carry real notes; and a period-range header test ("Three Months
  // Ended") fires on CHS, Centene, Cigna and Tenet's 10-K, whose notes are all
  // real — the 400-char pad pulls neighbouring narrative into the span.
  // Cluster MAX magnitude shipped and helps, but only reaches two of the four
  // known misses. So the only reliable test is the outcome itself: did any
  // entry actually survive transcription and verification. That is what this
  // uses.
  //
  // The two conditions this must satisfy, both structural:
  //   - It stops at the FIRST filing that yields a schedule, never the one
  //     that reconciles most tidily. There is deliberately no scoring across
  //     filings — preferring a better-looking older ladder is exactly the
  //     failure Check 2 exists to catch, and it would let the tool present a
  //     stale position because it was neater.
  //   - Whichever filing wins is recorded in debtScheduleSourceFiling, so an
  //     older-sourced ladder renders with its own form and date visible
  //     (lib/events/portfolioTable.ts) and can never be mistaken for current.
  //
  // Supersedes the earlier "prior-period context, never merged" handling: that
  // surfaced an older filing beside a failing base ladder as labelled context,
  // which was the timid version of this. Advancing the base filing outright is
  // the direct answer, and it is safe precisely because the search stops at
  // the first real schedule rather than shopping for the best one.
  //
  // Cost is bounded and only paid when it is earned: the retry fires solely
  // when the chosen filing yielded ZERO verified entries, and each attempt is
  // cached under its own key so a re-run never re-bills it.
  const debtIdx = results.findIndex((r) => r.triggerId === "debt-maturity");
  const debtTriggerDef = TRIGGERS.find((t) => t.id === "debt-maturity");
  if (debtIdx !== -1 && debtTriggerDef && results[debtIdx].fired && results[debtIdx].scheduleSequence.length === 0 && usableDebtNoteFilings.length > 1) {
    const label = debtTriggerDef.name.toLowerCase();
    for (let next = 1; next < usableDebtNoteFilings.length; next++) {
      const candidate = usableDebtNoteFilings[next];
      log(
        `  debt-schedule SEARCH ORDER: ${debtScheduleGuidance.base?.form} ${debtScheduleGuidance.base?.date} yielded no verified schedule entries — ` +
          `falling back to ${candidate.form} ${candidate.filingDate} (an abbreviated note is normal, not a failure)`
      );
      const after = usableDebtNoteFilings[next + 1];
      debtScheduleGuidance = {
        base: { form: candidate.form, date: candidate.filingDate, reportDate: candidate.reportDate, url: candidate.url },
        prior: after ? { form: after.form, date: after.filingDate, reportDate: after.reportDate, url: after.url } : null,
      };
      const { data: retryVerdicts, hit } = await cachedBaseClassification(
        filingsResult.cik,
        `${fingerprint}-base${next}`,
        () => classifyAllTriggers({ companyName: filingsResult.company, triggers: TRIGGERS, catalog, corpus, debtScheduleGuidance })
      );
      log(`  answer cache ${hit ? "HIT" : "MISS"} (search-order retry ${next}, base ${candidate.form} ${candidate.filingDate})`);
      const retryVerdict = retryVerdicts.find((x) => x.triggerId === "debt-maturity");
      if (!retryVerdict) continue;
      const retried = finalizeVerified(debtTriggerDef, withFieldDefaults(retryVerdict), label);
      if (retried.scheduleSequence.length > 0) {
        log(`  debt-schedule base filing RESOLVED to ${candidate.form} ${candidate.filingDate} — ${retried.scheduleSequence.length} verified entr(y/ies)`);
        results[debtIdx] = retried;
        break;
      }
    }
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
      const filingTexts = [...urls].map((url) => textByUrl.get(url)).filter((t): t is string => !!t);
      const { data: proceedsUse, hit: proceedsHit } = await cachedProceedsUse(filingsResult.cik, fingerprint, () =>
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
export function amountCorroborated(amount: string, sourceLine: string, filingText: string): boolean {
  const valueOf = (s: string) =>
    extractFactTokens(s)
      .filter((t) => t.kind === "money")
      .map((t) => t.moneyValue)
      .filter((v): v is number => v !== undefined);
  const claimed = valueOf(amount);
  if (claimed.length > 0) {
    const printed = valueOf(sourceLine);
    // Exact value equality — not a tolerance. Two figures that are merely
    // close are two different figures, and this is a fabrication check.
    if (claimed.some((c) => printed.some((p) => Math.abs(c) === Math.abs(p)))) return true;
  }
  return amountAppearsIn(amount, filingText);
}

function verifySourceLineAndScale<T extends { sourceLine: string; amount: string }>(
  entries: T[],
  citedUrls: string[],
  textByUrl: Map<string, string>,
  log: (line: string) => void,
  label: string,
  describe: (entry: T) => string
): (T & { citedUrl: string })[] {
  const orderedUrls = [...new Set([...citedUrls, ...textByUrl.keys()])];
  const out: (T & { citedUrl: string })[] = [];
  for (const entry of entries) {
    if (!entry.sourceLine || !entry.sourceLine.trim()) continue;
    const scaleCheck = checkMoneyScale(entry.amount);
    if (!scaleCheck.determinable) {
      log(`  ⚠ AMOUNT SCALE INDETERMINATE for ${label} — "${describe(entry)}: ${scaleCheck.raw}" has no determinable unit; dropped, not trusted for arithmetic`);
      continue;
    }
    let matched = false;
    let sourceLineFoundButAmountAbsent = false;
    for (const url of orderedUrls) {
      const text = textByUrl.get(url);
      if (!text) continue;
      if (!verifyClaim(entry.sourceLine, [text]).verified) continue;
      // The sourceLine is real in THIS filing. The amount riding along with
      // it must be too, or the pair is a real caption carrying a figure the
      // filing never printed — the CHS shape. Checked per-filing rather than
      // across the corpus, so a figure that is only real in some OTHER
      // company's filing can never rescue it.
      if (!amountCorroborated(entry.amount, entry.sourceLine, text)) {
        sourceLineFoundButAmountAbsent = true;
        continue; // another cited filing may legitimately carry both
      }
      matched = true;
      out.push({ ...entry, citedUrl: url });
      break;
    }
    if (!matched && sourceLineFoundButAmountAbsent) {
      log(
        `  ⚠ AMOUNT NOT IN FILING for ${label} — "${describe(entry)}" cites a sourceLine that IS in the filing, but its amount ${JSON.stringify(entry.amount)} appears nowhere in that filing's text; dropped as fabricated, not trusted`
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

function recoverStatedMonth<T extends { maturityDate: string | null; dateGranularity: DateGranularity | null; sourceLine: string }>(
  row: T,
  log: (line: string) => void,
  label: string,
  describe: (row: T) => string
): T {
  if (row.dateGranularity !== "year" || !row.maturityDate) return row;
  const m = row.sourceLine.match(MONTH_YEAR_RE);
  if (!m) return row;
  if (m[2] !== row.maturityDate.trim()) return row; // different year -> not this row's maturity; never override
  const month = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1;
  if (month < 1) return row;
  const recovered = `${m[2]}-${String(month).padStart(2, "0")}-01`;
  log(`  MATURITY MONTH RECOVERED for ${label} — "${describe(row)}" was bare year ${row.maturityDate}, but its own verified sourceLine prints "${m[0]}"; sharpened to ${recovered}`);
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
  label: string
): VerifiedSequenceEntry[] {
  const verified = verifySourceLineAndScale(entries, citedUrls, textByUrl, log, label, (e) => e.label ?? e.kind);
  return verified.map((entry) =>
    entry.kind === "row"
      ? withVerifiedMaturity(recoverStatedMonth(entry, log, label, (e) => e.label ?? "row"), log, label, (e) => e.label ?? "row")
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
function narrowCitationsToBackedFilings(verifiedText: string | null, citedUrls: string[], textByUrl: Map<string, string>): string[] {
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
  citationLookup: Map<string, { form: string; date: string }>,
  v: TriggerVerdict,
  verification: { verified: boolean; displayText: string | null; normalizedText: string | null; matchType: "literal" | "co-occurrence" | null },
  dateGuard: EventDateGuardResult,
  textByUrl: Map<string, string>,
  debtFields: {
    scheduleSequence: VerifiedSequenceEntry[];
    priorScheduleSequence: VerifiedSequenceEntry[];
    issuedTranches: VerifiedIssuedTranche[];
    balanceSheetDebtCaptions: VerifiedBalanceSheetCaption[];
  },
  debtScheduleBaseFiling: DebtScheduleFilingRef | null,
  debtSchedulePriorFiling: DebtScheduleFilingRef | null,
  rowAccounting: { rowsExtracted: number; rowsVerified: number },
  scheduleCompleteness: ScheduleCompletenessResult | null
): TriggerResult {
  const narrowedCitedUrls = narrowCitationsToBackedFilings(
    verification.verified ? verification.displayText : null,
    v.citedUrls ?? [],
    textByUrl
  );
  return {
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
      return { form: known?.form ?? "filing", date: known?.date ?? "", url };
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
    scheduleCompleteness,
    redeems: v.redeems,
    issuedTranches: debtFields.issuedTranches,
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
