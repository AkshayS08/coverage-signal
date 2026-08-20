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
 * Session 17 Item 4: which VERIFIED FACTS a drafted card body actually
 * draws a number/date/rate from — the source of truth for a card's own
 * citation set, computed from the text Sonnet actually wrote rather than
 * a pre-narration guess. Real bug this fixes: Quest's card cited only its
 * headline fact's own filing (a 10-Q) while WHY NOW asserted a May 2026
 * notes-pricing event stated only in an 8-K from a DIFFERENT dedup
 * cluster (debt-maturity has no 8-K citation of its own, so it can never
 * cluster with anything on citation-sharing grounds — a cluster-based
 * union would not have covered this case either). Checking which facts'
 * own text (normalizedText + verifiedText + evidence) actually shares a
 * token with the card text, using the same scale-exact match the rest of
 * this file uses, is what makes "every date/figure in the card traces to
 * a cited filing" true by construction instead of by convention.
 */
export function factsReferencedIn(text: string, factBase: VerifiedFact[]): VerifiedFact[] {
  const textTokens = extractFactTokens(text);
  if (textTokens.length === 0) return [];
  return factBase.filter((f) => {
    const factTokens = extractFactTokens(`${f.normalizedText} ${f.verifiedText} ${f.evidence ?? ""}`);
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
    const factTokens = extractFactTokens(`${f.normalizedText} ${f.verifiedText} ${f.evidence ?? ""}`);
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
