/**
 * Deterministic guard on the Sonnet-drafted card body: every dollar amount,
 * rate, and date it states must trace back to the trigger's own verified
 * quote (see lib/agent/verifyQuote.ts) — including when that quote is a
 * table-row fragment with bare, unlabeled figures rather than a "$"-tagged
 * sentence (e.g. "5.125 % due 2027 1,500"). Synthesis and judgment are
 * fine — a figure that doesn't appear in the quote, in any normalized or
 * scale-equivalent form, is not.
 */
import { extractFactTokens, moneyValuesMatch, type FactToken } from "../agent/factTokens";
import type { VerifiedFact } from "./factBase";

export interface NumberGuardResult {
  ok: boolean;
  /** Human-readable tokens (money, percent, or date) that appeared in the card text but not in the quote(s). */
  unverifiedTokens: string[];
}

/**
 * Percent/date matching is unchanged (no scale ambiguity there). Money
 * matching is intentionally STRICTER than lib/agent/factTokens.ts's shared
 * factTokensMatch — that function's cross-scale tolerance (a card's
 * moneyValue matching a quote's bareNumber at x1/x1000/x1,000,000) exists
 * for the GATE's table-row co-occurrence verification, where it's needed
 * and safe. Reusing it here let Sonnet's own GUESSED scale ("$771.9
 * million" for a bare, unresolved "$ 771,910" table cell) pass this audit
 * — a real live-run defect: the card said "$771.9 million," the portfolio
 * summary's own deterministic scaling read the same bare number as
 * "$771.91 thousand," and neither was verified against a scale the filing
 * actually stated. A card figure only passes here when it matches the
 * quote in the SAME representation — moneyValue to moneyValue, or
 * bareNumber to bareNumber — never one guessed across the other. This is
 * local to numberGuard.ts only; lib/agent/factTokens.ts's own
 * factTokensMatch (used by the gate) is untouched.
 */
function strictMoneyMatch(a: FactToken, b: FactToken): boolean {
  if (a.moneyValue !== undefined && b.moneyValue !== undefined) return moneyValuesMatch(a.moneyValue, b.moneyValue);
  if (a.bareNumber !== undefined && b.bareNumber !== undefined) return moneyValuesMatch(a.bareNumber, b.bareNumber);
  return false;
}

/** Exported so the card-narration structural guard (sonnetEventBriefing.ts) can reuse the SAME matching rule to check which individual facts a span of text actually draws from — see countDistinctFactsReferenced below. */
export function strictFactTokensMatch(a: FactToken, b: FactToken): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "money") return strictMoneyMatch(a, b);
  if (a.kind === "percent") return a.percentValue !== undefined && b.percentValue !== undefined && Math.abs(a.percentValue - b.percentValue) <= 0.01;
  if (a.kind === "date") {
    if (!a.dateValue || !b.dateValue) return false;
    if (a.dateValue.year !== b.dateValue.year) return false;
    if (a.dateValue.month !== null && b.dateValue.month !== null) {
      if (a.dateValue.month !== b.dateValue.month) return false;
      if (a.dateValue.day !== null && b.dateValue.day !== null && a.dateValue.day !== b.dateValue.day) return false;
    }
    return true;
  }
  return false;
}

/**
 * Checks that every dollar amount, rate, and date in `cardText` is
 * traceable to `quotes` at the SAME scale as the source states it (see
 * strictFactTokensMatch) — a figure whose source has no determinable scale
 * fails this guard rather than passing on a guess.
 */
export function checkNumbersAgainstQuotes(cardText: string, quotes: string[]): NumberGuardResult {
  const quoteTokens = extractFactTokens(quotes.join(" \n "));
  const cardTokens = extractFactTokens(cardText);

  const unverifiedTokens = cardTokens
    .filter((token) => !quoteTokens.some((qt) => strictFactTokensMatch(token, qt)))
    .map((token) => token.raw);

  return { ok: unverifiedTokens.length === 0, unverifiedTokens };
}

/**
 * Session 15 Part A: a mechanical, structural proxy for "WHY NOW connects
 * at least two facts" — the new card shape's hard requirement that the
 * synthesis not be a restatement of the headline event alone. Counts how
 * many of the given fact texts have at least one money/percent/date token
 * (via strictFactTokensMatch — the SAME scale-exact rule numberGuard uses,
 * so a figure only counts as "referencing" a fact when it genuinely
 * matches that fact's own stated scale) in common with `text`. A card
 * whose WHY NOW only draws tokens from ONE fact (typically just the
 * headline) is, by construction, not a synthesis of two things — it's a
 * description of one, which is exactly the "here's a thing that happened"
 * pattern this session kills. Structural (token overlap), never lexical
 * (no keyword/phrase matching) — Session 12's standing rule.
 */
export function countDistinctFactsReferenced(text: string, factTexts: string[]): number {
  const textTokens = extractFactTokens(text);
  if (textTokens.length === 0) return 0;
  let count = 0;
  for (const factText of factTexts) {
    const factTokens = extractFactTokens(factText);
    if (textTokens.some((tt) => factTokens.some((ft) => strictFactTokensMatch(tt, ft)))) count++;
  }
  return count;
}

/**
 * Session 17 Item 4 kept this file's shared answer to "what text does this
 * fact consist of", because several checks here have to agree on it: which
 * facts a drafted card draws from (factsReferencedIn, which computes the
 * card's citation set), whether a bullet is covered by a single fact, and
 * what the accuracy audit compares against. Session 18 grew the list twice.
 * Session 19 stopped it being a list — see below.
 */
/**
 * Session 19, item 1a. The excluded keys, each with the reason it is out.
 * The DEFAULT IS INCLUSION: a field absent from this set is in the corpus,
 * so adding a field to VerifiedFact adds it to the guard with no second
 * edit anywhere.
 */
const EXCLUDED_FROM_GUARD_CORPUS = new Set<string>([
  // Filing METADATA, not content. "10-Q filed 2026-07-29" is a fact about
  // the document, not a claim the document makes, and narration is shown it
  // as provenance. If these dates entered the corpus, a card could state a
  // FILING date as though it were a disclosed event date and the accuracy
  // guard would wave it through. Excluded on purpose, and the only fields
  // formatFact shows that this corpus deliberately does not cover.
  "sourceFiling",
  "citations",
  // Internal routing identifiers, never quotable content. Harmless to
  // include and excluded only to keep the corpus to things a filing said.
  "linkedTriggerId",
  // Enum-valued classification, not a figure or a date the model may state.
  "dateGranularity",
  "eventStatus",
]);

/**
 * THE GUARD CORPUS IS DERIVED, NOT ENUMERATED (Session 19, item 1a).
 *
 * This function used to be a hand-maintained list of seven field names, and
 * that list is what broke Centene: E4 added `outstandingAmount` to the
 * PROMPT and the list did not gain it, so the model was told to state a
 * figure the guard could not see, and the guard rejected the card for saying
 * what it was told to say. Rule 6 is the record of the same defect in the
 * other direction, where it blanked three cards.
 *
 * Extending the list would have fixed Centene and left the next field to
 * find the same hole. So the list is DELETED. The corpus now walks the fact
 * object itself: every string-valued field, and every array of strings, is
 * in unless it is named in EXCLUDED_FROM_GUARD_CORPUS above with a reason.
 *
 * What this buys, structurally rather than procedurally: `formatFact` builds
 * the model's view by reading fields off this same object, so any field it
 * can show is a field this walk already collected. "Do not add a field the
 * guards cannot see" stops being a thing to remember and becomes a thing
 * that cannot happen — and `guardCorpusCoversFormatFact` in
 * narrationIntegrity.test.ts asserts it, per-field, with sentinels.
 */
export function factOwnText(f: VerifiedFact): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(f)) {
    if (EXCLUDED_FROM_GUARD_CORPUS.has(key)) continue;
    if (typeof value === "string") {
      parts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") parts.push(item);
    }
  }
  return parts.join(" ");
}

/**
 * THE PRECISION BOUNDARY — VERIFICATION MATCHES LOOSELY, RENDER SURFACES
 * MATCH EXACTLY.
 *
 * strictFactTokensMatch deliberately treats a bare year as matching any
 * date inside it, because for VERIFICATION the question is "could this fact
 * be the one the filing states", and a filing that prints "due 2027" must
 * not fail against a claim of "due December 2027". Being permissive there
 * is correct and stays.
 *
 * On a RENDER SURFACE the question is the opposite one — "does this line add
 * anything the line above it didn't" — and permissiveness inverts: two lines
 * about genuinely different things get called the same. Found live on a
 * bucket where a line whose only token was "January 2026" was reported as
 * restating a line that says "the first half of 2026", because a bare year
 * matches every month in it.
 *
 * So: any comparison that decides whether to SHOW something requires an
 * exact-precision match. A year matches only a year, a month only the same
 * month, a day only the same day. Verification keeps the loose rule; the
 * renderer gets this one.
 */
export function sameFactForDisplay(a: FactToken, b: FactToken): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "date") {
    if (!a.dateValue || !b.dateValue) return false;
    // Equal precision, or they are not the same stated thing.
    if ((a.dateValue.month === null) !== (b.dateValue.month === null)) return false;
    if ((a.dateValue.day === null) !== (b.dateValue.day === null)) return false;
    return a.dateValue.year === b.dateValue.year && a.dateValue.month === b.dateValue.month && a.dateValue.day === b.dateValue.day;
  }
  return strictFactTokensMatch(a, b);
}

/**
 * Item 1 (Session 18, stage-2 review) — A CARD MAY NOT STATE A PERIOD THE
 * FILINGS IT CITES COULD NOT HAVE REPORTED.
 *
 * The class, seen live: a card cited a 10-K filed 2026-02-26 and stated a
 * cash balance "as of June 30, 2026". A filing cannot report a period that
 * ends after it was filed, so a reader following the link finds nothing.
 *
 * Why the previous version of this check could not fire, all three
 * independently (diagnosed against real Cigna data before this rewrite):
 *
 *   1. It was never called outside its own test file — dead code that read
 *      as a shipped guard.
 *   2. It filtered candidate facts to the card's OWN trigger, and the
 *      offending fact was a large-cash-balance fact on a debt-maturity
 *      card. The very cross-trigger bullet that causes this class was the
 *      one thing the filter excluded.
 *   3. It compared VerifiedFact.eventDate, and the offending fact's
 *      eventDate is null — "June 30, 2026" exists only inside the fact's
 *      prose. A structured-date check cannot see a date that was never
 *      structured.
 *
 * So this reads the DATES THE CARD ACTUALLY STATES, out of the text the
 * model actually wrote, and compares them against the citation set that
 * card actually carries. Text in, citations in — no third source of truth
 * that can drift from what renders.
 *
 * Exempt, deliberately:
 *   - Future dates. A maturity is not something a filing "reported late".
 *   - Bare years. A 10-K filed in February 2026 legitimately states facts
 *     "in 2026", and there is no precision available to tell those from a
 *     December 2026 period-end. Flagging them would fire on correct cards.
 *   - Month precision compares against the FIRST of that month, so a filing
 *     dated mid-May can state "May 2026" without being flagged.
 */
export interface CitationDateGap {
  /** The date exactly as the line states it. */
  stated: string;
  /** That date resolved to ISO, for the comparison actually made. */
  statedIso: string;
  /** Filing date of the newest filing the line cites. */
  newestCitation: string;
}

export function citationDateGaps(
  text: string,
  citations: { form: string; date: string; reportDate: string }[],
  today: string
): CitationDateGap[] {
  // THE BOUND IS THE FILING DATE, not the period of report. Both were
  // measured against the live book before choosing:
  //
  //   filing date  — 3 fires: 2 real defects, 1 over-fire
  //   period of report — 6 fires: the same 2 real defects, 4 over-fires
  //
  // The period-of-report bound flags every SUBSEQUENT EVENT, which is a
  // normal and correct thing for a filing to disclose: a 10-Q for the June
  // quarter, filed in July, legitimately reports a dividend declared on
  // July 22. A filing date bounds the only genuinely impossible thing —
  // a filing stating a fact about a day that had not happened when it was
  // submitted.
  const filed = citations.map((c) => c.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (filed.length === 0) return [];
  const newest = filed[filed.length - 1];

  const gaps: CitationDateGap[] = [];
  for (const token of extractFactTokens(text)) {
    if (token.kind !== "date" || !token.dateValue) continue;
    const { year, month, day } = token.dateValue;
    // A bare year carries no precision this comparison can use: a 10-K for
    // FY2025 legitimately states facts "in 2025", and nothing distinguishes
    // that from a December 2025 period-end.
    if (month === null) continue;
    // Month precision compares against the FIRST of the month, so a filing
    // dated mid-May can state "May 2026".
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day ?? 1).padStart(2, "0")}`;
    // Still in the future: a maturity, or a scheduled event that has not
    // happened yet. Neither is a period anything is asked to have reported.
    if (iso > today) continue;
    if (iso > newest) gaps.push({ stated: token.raw, statedIso: iso, newestCitation: newest });
  }
  return gaps;
}

/**
 * KNOWN AND ACCEPTED OVER-FIRE, stated here rather than tuned away: a filing
 * may announce a date that had not yet arrived when it was filed — an 8-K
 * declaring in February a dividend payable on April 20. That line states a
 * date after every filing it cites and is nonetheless correct. One such line
 * exists in the current book (of fifty), against two genuine defects, and
 * nothing structural separates "a scheduled future date" from "a period this
 * filing could not have reported" — both are simply dates after the filing.
 *
 * So the flagged line still RENDERS, with what is true about it stated: it
 * states this date, and it cites nothing filed on or after it. That sentence
 * is accurate for the over-fire too, and an RM can see in one glance which
 * kind they are looking at. Suppressing the line, or quietly narrowing the
 * rule until the count reached zero, would both hide the two real ones.
 */

export function factsReferencedIn(text: string, factBase: VerifiedFact[]): VerifiedFact[] {
  const textTokens = extractFactTokens(text);
  if (textTokens.length === 0) return [];
  return factBase.filter((f) => {
    const factTokens = extractFactTokens(factOwnText(f));
    return textTokens.some((tt) => factTokens.some((ft) => strictFactTokensMatch(tt, ft)));
  });
}

/**
 * Session 17 Item 17: is `text` fully accounted for by a SINGLE fact — is
 * there at least one fact in factBase whose own text contains a match for
 * EVERY token in `text`? This is deliberately a different (stricter,
 * set-cover) question than factsReferencedIn's "which facts overlap at
 * all" — a company's own RELATED facts routinely restate the same
 * underlying figures from a different angle (confirmed live: Tenet's
 * debt-maturity evidence lists its own tranche ladder, which happens to
 * include the exact "$1.5 billion due 2032" / "$750 million due 2033"
 * figures that new-debt-issuance's evidence ALSO states, since they're
 * the same notes described two ways), so a bullet naming only
 * new-debt-issuance's own figures still "overlaps" debt-maturity's
 * evidence too under plain token-overlap counting — a false positive for
 * "this bullet connects two facts," since one fact (new-debt-issuance)
 * already fully explains every token in it. A bullet only genuinely
 * connects two facts when NO single fact's own text covers everything it
 * states.
 */
export function isFullyExplainedByOneFact(text: string, factBase: VerifiedFact[]): boolean {
  const textTokens = extractFactTokens(text);
  if (textTokens.length === 0) return true;
  return factBase.some((f) => {
    const factTokens = extractFactTokens(factOwnText(f));
    return textTokens.every((tt) => factTokens.some((ft) => strictFactTokensMatch(tt, ft)));
  });
}

// Backward-compatible named exports for callers that want typed money/date
// tokens directly (lib/events/test.ts's reporting output).
export interface MoneyToken {
  raw: string;
  value: number;
}

export interface DateToken {
  raw: string;
  year: number;
  month: number;
  day: number | null;
}

export function extractMoneyTokens(text: string): MoneyToken[] {
  const out: MoneyToken[] = [];
  for (const t of extractFactTokens(text)) {
    if (t.kind !== "money") continue;
    const value = t.moneyValue ?? t.bareNumber;
    if (value === undefined) continue;
    out.push({ raw: t.raw, value });
  }
  return out;
}

export function extractDateTokens(text: string): DateToken[] {
  const out: DateToken[] = [];
  for (const t of extractFactTokens(text)) {
    if (t.kind !== "date" || !t.dateValue || t.dateValue.month === null) continue;
    out.push({ raw: t.raw, year: t.dateValue.year, month: t.dateValue.month, day: t.dateValue.day });
  }
  return out;
}
