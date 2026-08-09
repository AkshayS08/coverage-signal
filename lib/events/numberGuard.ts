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

function strictFactTokensMatch(a: FactToken, b: FactToken): boolean {
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
