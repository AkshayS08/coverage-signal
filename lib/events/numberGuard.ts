/**
 * Deterministic guard on the Sonnet-drafted card body: every dollar amount,
 * rate, and date it states must trace back to the trigger's own verified
 * quote (see lib/agent/verifyQuote.ts) — including when that quote is a
 * table-row fragment with bare, unlabeled figures rather than a "$"-tagged
 * sentence (e.g. "5.125 % due 2027 1,500"). Synthesis and judgment are
 * fine — a figure that doesn't appear in the quote, in any normalized or
 * scale-equivalent form, is not.
 */
import { extractFactTokens, factTokensMatch } from "../agent/factTokens";

export interface NumberGuardResult {
  ok: boolean;
  /** Human-readable tokens (money, percent, or date) that appeared in the card text but not in the quote(s). */
  unverifiedTokens: string[];
}

/**
 * Checks that every dollar amount, rate, and date in `cardText` is
 * traceable to `quotes` — normalized/scale-equivalent forms count ("$1.75B"
 * vs a bare table figure "1,750,000" vs "$1,750 million"; "Dec 31, 2026"
 * vs "December 31, 2026"; "5.125%" vs "5.125 %") — but the underlying fact
 * must actually be present.
 */
export function checkNumbersAgainstQuotes(cardText: string, quotes: string[]): NumberGuardResult {
  const quoteTokens = extractFactTokens(quotes.join(" \n "));
  const cardTokens = extractFactTokens(cardText);

  const unverifiedTokens = cardTokens
    .filter((token) => !quoteTokens.some((qt) => factTokensMatch(token, qt)))
    .map((token) => token.raw);

  return { ok: unverifiedTokens.length === 0, unverifiedTokens };
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
