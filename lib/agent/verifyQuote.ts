import { extractFactTokens, findCoOccurrenceWindow } from "./factTokens";
import { detectDollarScaleAt, formatScaledDollars } from "./scaleNormalize";

/**
 * Deterministic fact-verification, in two passes:
 *
 * 1. Literal match: is the model's `quote` a contiguous substring of the
 *    filing text (whitespace/quote-glyph normalized)? Covers prose facts
 *    and the (common) case where the model reconstructs a table row
 *    verbatim.
 * 2. Table-aware fallback: do the quote's key facts (amount, rate, date —
 *    see factTokens.ts) all co-occur within a bounded window of the filing
 *    text, even without forming an English sentence? This is what lets a
 *    debt-schedule row verify a maturity claim — "5.125% ... due 2027 ...
 *    1,500" is never a sentence, but it's a real, checkable fact.
 *
 * Both passes are strict about CONTENT — a fact whose tokens don't
 * genuinely appear together anywhere in the fetched text fails, full stop.
 * This is what catches a hallucinated number/date before it ever reaches a
 * card.
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `quote` appears verbatim (whitespace/quote-glyph differences aside) inside `sourceText`. */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return false;
  return normalizeForMatch(sourceText).includes(normalizedQuote);
}

const CO_OCCURRENCE_WINDOW_CHARS = 220;
/** Padding added around a matched table-row window so the displayed source text reads as a whole row, not a bare token cluster. */
const ROW_DISPLAY_PAD_CHARS = 30;

function windowBounds(sourceText: string, start: number, end: number): { from: number; to: number } {
  return {
    from: Math.max(0, start - ROW_DISPLAY_PAD_CHARS),
    to: Math.min(sourceText.length, end + ROW_DISPLAY_PAD_CHARS),
  };
}

function extractRowDisplayText(sourceText: string, start: number, end: number): string {
  const { from, to } = windowBounds(sourceText, start, end);
  return sourceText.slice(from, to).replace(/\s+/g, " ").trim();
}

/**
 * The same row window, but with each bare (unit-less) table figure
 * replaced by its scale-normalized dollar form when — and only when — a
 * dollar-specific scale declaration governs that exact position in the
 * source document (see scaleNormalize.ts). A figure with no determinable
 * scale is left exactly as it was: never guessed. This is what Sonnet is
 * given as "the stateable figure," so it can write "$1.5 billion" instead
 * of refusing to touch a bare "1,500" it has no way to safely interpret.
 */
/**
 * Maps a whitespace/quote-glyph-normalized string back to raw source
 * offsets. `map[i]` is the raw index in `s` where normalized character `i`
 * originates (a run of whitespace collapses to one normalized space,
 * pointing at the run's first raw character). Lets `findLiteralMatchSpan`
 * locate a normalized-quote match in RAW source coordinates, so the
 * existing table-normalization logic (which needs real offsets to look up
 * scale declarations) can run on a literal-matched quote too.
 */
function normalizeWithMap(s: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "“" || ch === "”") {
      normalized += '"';
      map.push(i);
      i++;
      continue;
    }
    if (ch === "‘" || ch === "’") {
      normalized += "'";
      map.push(i);
      i++;
      continue;
    }
    if (ch === "–" || ch === "—") {
      normalized += "-";
      map.push(i);
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      const runStart = i;
      while (i < n && /\s/.test(s[i])) i++;
      normalized += " ";
      map.push(runStart);
      continue;
    }
    normalized += ch;
    map.push(i);
    i++;
  }
  return { normalized, map };
}

/** Locates a literal (whitespace/glyph-normalized) match's span in RAW `sourceText` coordinates, or null if it genuinely isn't there. */
function findLiteralMatchSpan(quote: string, sourceText: string): { start: number; end: number } | null {
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return null;
  const { normalized, map } = normalizeWithMap(sourceText);
  const idx = normalized.indexOf(normalizedQuote);
  if (idx === -1) return null;
  const start = map[idx];
  const lastNormIdx = idx + normalizedQuote.length - 1;
  const end = lastNormIdx + 1 < map.length ? map[lastNormIdx + 1] : sourceText.length;
  return { start, end };
}

function extractNormalizedRowText(sourceText: string, start: number, end: number): string {
  const { from, to } = windowBounds(sourceText, start, end);
  const slice = sourceText.slice(from, to);

  const bareMoneyTokens = extractFactTokens(slice).filter((t) => t.kind === "money" && t.bareNumber !== undefined);
  if (bareMoneyTokens.length === 0) return slice.replace(/\s+/g, " ").trim();

  let result = slice;
  for (const token of [...bareMoneyTokens].sort((a, b) => b.index - a.index)) {
    const absolutePosition = from + token.index;
    const scale = detectDollarScaleAt(sourceText, absolutePosition);
    if (!scale) continue; // scale genuinely undeterminable here -- leave the raw figure as-is, never guess
    const normalized = formatScaledDollars(token.bareNumber!, scale);
    result = result.slice(0, token.index) + normalized + result.slice(token.index + token.raw.length);
  }
  return result.replace(/\s+/g, " ").trim();
}

export interface QuoteVerificationResult {
  verified: boolean;
  /** What to show the user as the source text: the quote itself for a prose match, or the extracted table-row snippet for a token-co-occurrence match. Always the RAW filing text — never scale-adjusted — so the source-text expander stays a literal, trustworthy transcript. */
  displayText: string | null;
  /** What Sonnet is given as the stateable figure — the same text as displayText, but with any bare table figure replaced by its scale-normalized dollar form where a governing scale declaration was found. Falls back to displayText verbatim when no bare figures needed normalizing (the prose-match case) or none could be safely resolved. */
  normalizedText: string | null;
  /** Which pass verified the quote — "literal" means the model's quote is a genuine contiguous substring of the filing; "co-occurrence" means it verified via the table-row fallback (the quote's key facts co-occur nearby without forming one exact span). Null when unverified. Exists so callers/tests can tell "verified because it's real prose" apart from "verified because a table row happened to contain the same tokens" — the two are not equally strong evidence that the quote reads as intended. */
  matchType: "literal" | "co-occurrence" | null;
}

/**
 * A literal match means the model's `quote` is a contiguous substring of
 * the filing — but that substring can itself be a verbatim table-row
 * fragment (a debt schedule reproduced exactly, bare figures and all), not
 * just prose. Prose already states its own units in every case observed;
 * a reproduced table row does not. So: if the matched text contains no
 * bare (unit-less) money token, it needs no normalization and is returned
 * unchanged (the common, cheap path). Otherwise, locate the quote's own
 * span in the source text and run it through the same scale-resolution
 * logic the co-occurrence path uses, so a verbatim-quoted table row reads
 * as "$1.5 billion" instead of a bare "1,500" nobody can safely interpret.
 */
function normalizeLiteralMatchText(trimmedQuote: string, sourceText: string): string {
  const hasBareMoney = extractFactTokens(trimmedQuote).some((t) => t.kind === "money" && t.bareNumber !== undefined);
  if (!hasBareMoney) return trimmedQuote;
  const span = findLiteralMatchSpan(trimmedQuote, sourceText);
  if (!span) return trimmedQuote; // shouldn't happen since the caller already confirmed the match, but never guess
  return extractNormalizedRowText(sourceText, span.start, span.end);
}

/** Checks one quote against a list of candidate texts, literal match first, then table-aware co-occurrence. */
function verifyClaim(quote: string, candidateTexts: string[]): QuoteVerificationResult {
  const trimmed = quote.trim();
  if (!trimmed) return { verified: false, displayText: null, normalizedText: null, matchType: null };

  for (const text of candidateTexts) {
    if (quoteAppearsIn(trimmed, text)) {
      return {
        verified: true,
        displayText: trimmed,
        normalizedText: normalizeLiteralMatchText(trimmed, text),
        matchType: "literal",
      };
    }
  }

  const claimTokens = extractFactTokens(trimmed);
  if (claimTokens.length === 0) return { verified: false, displayText: null, normalizedText: null, matchType: null };

  for (const text of candidateTexts) {
    const window = findCoOccurrenceWindow(trimmed, claimTokens, text, CO_OCCURRENCE_WINDOW_CHARS);
    if (window) {
      return {
        verified: true,
        displayText: extractRowDisplayText(text, window.start, window.end),
        normalizedText: extractNormalizedRowText(text, window.start, window.end),
        matchType: "co-occurrence",
      };
    }
  }

  return { verified: false, displayText: null, normalizedText: null, matchType: null };
}

/**
 * A trigger's quote is verified against the text of the filing(s) it cited.
 * Falls back to checking every filing fetched this run (not just the cited
 * ones) so a mislabeled citedUrl can't turn a genuine, verifiable quote
 * into a false failure — the point is to catch fabricated facts, not to
 * penalize an imprecise citedUrls list.
 */
export function verifyTriggerQuote(params: {
  fired: boolean;
  quote: string | null;
  citedUrls: string[];
  textByUrl: Map<string, string>;
}): QuoteVerificationResult {
  const { fired, quote, citedUrls, textByUrl } = params;
  if (!fired) return { verified: true, displayText: null, normalizedText: null, matchType: null }; // nothing asserted, nothing to verify
  if (!quote || !quote.trim()) return { verified: false, displayText: null, normalizedText: null, matchType: null }; // fired but no verifiable quote given

  const citedTexts = citedUrls.map((url) => textByUrl.get(url)).filter((t): t is string => !!t);
  const citedResult = verifyClaim(quote, citedTexts);
  if (citedResult.verified) return citedResult;

  return verifyClaim(quote, Array.from(textByUrl.values()));
}
