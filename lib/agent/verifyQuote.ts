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
/**
 * Session 18 (post-v16) — CURRENCY SYMBOLS ARE FORMATTING, NOT CONTENT.
 *
 * An accounting table prints "$" on the FIRST row of a section and omits it
 * on every row beneath, so Tenet's note reads:
 *     6.125 % due 2028 $ 1,750
 *     5.125 % due 2027   1,500
 * The model, reasonably, renders every row the same way and returns
 * "5.125 % due 2027 $ 1,500". Measured against the real filing, that single
 * inserted "$ " was the ENTIRE reason 12 of Tenet's 24 entries failed
 * literal verification and fell back to co-occurrence — the cells are
 * contiguous, 17 characters apart, nothing else differs.
 *
 * The same class showed up in the variance runs: Encompass's only drift
 * between two identical runs was "( 35.9 ) million" vs "( $ 35.9 million )".
 *
 * Dropping the symbol is structural, not a vocabulary guard, and belongs in
 * exactly the same list as the curly quotes and en/em dashes already folded
 * here: a currency glyph carries no identifying information that the digits
 * and words beside it do not already carry. Matching is never left to rest
 * on it — every caller pairs this with the figure itself, and amounts are
 * separately corroborated against the filing (loop.ts's amountCorroborated).
 *
 * Applied identically in normalizeWithMap below, which MUST stay
 * character-aligned with this function or createTextLocator's raw offsets
 * silently skew.
 */
/**
 * Session 18 (post-stage-1) — A VULGAR FRACTION AND ITS DECIMAL ARE THE
 * SAME NUMBER.
 *
 * Older indentures print coupons as fractions, and the filings carry that
 * typography verbatim: CHS's 10-Q prints "4 ¾% Senior Secured Notes due
 * 2031 689" while its 10-K carries 161 fraction glyphs across the same
 * instruments. The model normalizes to decimals — "4.750% Senior Secured
 * Notes due 2031 689" — so the row's sourceLine never matches literally,
 * and the row drops carrying an amount that is exactly right. Same class as
 * the currency glyph above: notation, not content.
 *
 * Both halves of the equivalence are needed, and neither alone is enough:
 *
 *   1. The GLYPH expands to its decimal, absorbing the space that separates
 *      it from its integer part ("4 ¾" is one number, not two tokens) —
 *      otherwise the filing side reads "4 .75".
 *   2. TRAILING ZEROS after a decimal point are trimmed on BOTH sides —
 *      otherwise the filing's "4.75" still misses the model's "4.750".
 *
 * Rule 2 is what makes this a real equivalence rather than a fit to the
 * three-decimal convention this particular model happens to use today. All
 * three spellings — "4 ¾", "4.75", "4.750" — converge on one canonical
 * form, so the match holds whichever side prints which.
 *
 * Only fractions with a TERMINATING decimal are folded. A third or a sixth
 * would have to be rounded, and rounding invents precision the document
 * never stated; those glyphs are left alone (they do not occur in coupon
 * rates, and leaving them is exactly today's behaviour, so no regression).
 */
const VULGAR_FRACTIONS: Record<string, string> = {
  "½": ".5",
  "¼": ".25",
  "¾": ".75",
  "⅕": ".2",
  "⅖": ".4",
  "⅗": ".6",
  "⅘": ".8",
  "⅛": ".125",
  "⅜": ".375",
  "⅝": ".625",
  "⅞": ".875",
  "⅒": ".1",
};

function isSpaceOrCurrency(code: number): boolean {
  // space, tab, LF, CR, FF, VT, NBSP, and the currency glyphs
  return (
    code === 32 || (code >= 9 && code <= 13) || code === 160 ||
    code === 36 /* $ */ || code === 163 /* £ */ || code === 8364 /* € */ || code === 165 /* ¥ */
  );
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 160;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isDashCode(code: number): boolean {
  return code === 45 || (code >= 0x2010 && code <= 0x2015);
}

/** A run of dashes at `i` that is bounded by whitespace/currency (or the string edge) on the far side — a nil table cell, not a hyphen or a minus sign. */
function isStandaloneDashAt(s: string, i: number): boolean {
  if (i >= s.length || !isDashCode(s.charCodeAt(i))) return false;
  let j = i;
  while (j < s.length && isDashCode(s.charCodeAt(j))) j++;
  return j >= s.length || isSpaceOrCurrency(s.charCodeAt(j));
}

/**
 * THE single normalization. Previously this existed twice — once as a chain
 * of regex replaces for the needle, once as a character walker for the
 * haystack — with a doc comment warning that the two MUST stay
 * character-aligned or createTextLocator silently returns wrong offsets.
 * The fraction rule expands one character into three and deletes others,
 * which is precisely the kind of rewrite that breaks a hand-maintained
 * pairing, so the pairing is gone: there is one walker, and the map is
 * simply not built when the caller doesn't need it. The two functions can
 * no longer disagree because there is only one.
 */
function normalizeCore(s: string, wantMap: boolean): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  const emit = (chars: string, at: number) => {
    normalized += chars;
    if (wantMap) for (let k = 0; k < chars.length; k++) map.push(at);
  };

  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];

    if (ch === "“" || ch === "”") { emit('"', i); i++; continue; }
    if (ch === "‘" || ch === "’") { emit("'", i); i++; continue; }
    if (ch === "–" || ch === "—") { emit("-", i); i++; continue; }

    const fraction = VULGAR_FRACTIONS[ch];
    if (fraction !== undefined) { emit(fraction, i); i++; continue; }

    // Whitespace and currency glyphs are consumed as ONE run, emitting a
    // single space if the run contained any whitespace and nothing if it was
    // glyphs alone — currency symbols are stripped BEFORE whitespace
    // collapses, so "a $ b" must become "a b", not "a  b".
    if (isSpaceOrCurrency(s.charCodeAt(i))) {
      const runStart = i;
      let sawWhitespace = false;
      while (i < n && isSpaceOrCurrency(s.charCodeAt(i))) {
        if (isWhitespaceCode(s.charCodeAt(i))) sawWhitespace = true;
        i++;
      }
      if (!sawWhitespace) continue;
      // A run sitting between a digit and a vulgar fraction is INSIDE a
      // number ("4 ¾%"), not a gap between tokens — emit nothing, so the
      // fraction binds to its own integer part.
      if (i < n && VULGAR_FRACTIONS[s[i]] !== undefined && isDigitCode(normalized.charCodeAt(normalized.length - 1))) continue;
      // C1, second face — A NIL CELL IS NOT CONTENT.
      //
      // Quest's note prints "3.45 % Senior Note due June 2026 $ — $ 501": the
      // current column is nil and the prior column carries the balance. The
      // model transcribes the row without the dash, and that single omitted
      // cell is the whole reason the row fails literal verification. Same
      // class as the currency glyph — a dash standing alone between cells
      // carries no identifying content, and it is dropped from BOTH sides, so
      // a quote that includes it and one that omits it agree.
      //
      // Bounded to a dash that is whitespace-delimited on both sides, so a
      // hyphen inside a word ("Long-term"), a minus sign against digits, and
      // an ISO date's separators are all untouched.
      if (isStandaloneDashAt(s, i)) {
        while (i < n && isDashCode(s.charCodeAt(i))) i++;
        continue; // stay in the run: the whitespace after it folds in too
      }
      emit(" ", runStart);
      continue;
    }

    // A numeric token, canonicalized: the integer part verbatim, the
    // fractional part with trailing zeros removed (and the decimal point
    // itself removed when nothing but zeros followed it). Scoped to a
    // maximal digit/comma run so a bare year ("2030") or a grouped amount
    // ("1,500") — neither of which carries a decimal point — is emitted
    // exactly as printed and can never be altered by this branch.
    if (isDigitCode(s.charCodeAt(i))) {
      let j = i;
      while (j < n && (isDigitCode(s.charCodeAt(j)) || s[j] === ",")) j++;
      const intEnd = j;
      let fracStart = -1;
      let fracEnd = -1;
      if (j < n && s[j] === "." && j + 1 < n && isDigitCode(s.charCodeAt(j + 1))) {
        fracStart = j + 1;
        j = fracStart;
        while (j < n && isDigitCode(s.charCodeAt(j))) j++;
        fracEnd = j;
      }
      for (let k = i; k < intEnd; k++) emit(s[k], k);
      if (fracStart >= 0) {
        let end = fracEnd;
        while (end > fracStart && s[end - 1] === "0") end--;
        if (end > fracStart) {
          emit(".", fracStart - 1);
          for (let k = fracStart; k < end; k++) emit(s[k], k);
        }
      }
      i = j;
      continue;
    }

    emit(ch, i);
    i++;
  }

  // .trim() equivalent, applied to both halves together so the map stays aligned.
  let from = 0;
  let to = normalized.length;
  while (from < to && normalized[from] === " ") from++;
  while (to > from && normalized[to - 1] === " ") to--;
  return {
    normalized: normalized.slice(from, to),
    map: wantMap ? map.slice(from, to) : map,
  };
}

function normalizeForMatch(s: string): string {
  return normalizeCore(s, false).normalized;
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
  return normalizeCore(s, true);
}

/**
 * Locates a literal (whitespace/glyph-normalized) match's span in RAW
 * `sourceText` coordinates, or null if it genuinely isn't there.
 *
 * OCCURRENCE-AWARE (Session 18 A1). A filing prints the same caption more
 * than once — "Total $ 3,769" appears in the debt note and again on the
 * balance sheet, "Long-term debt $ 16,030" in the note and again in MD&A —
 * and taking the FIRST occurrence resolves a correctly-transcribed note row
 * to a position outside the note, where A1 then rejects it as not being a
 * schedule row. lib/fetch/scheduleCompleteness.ts hit this exact bug and
 * solved it the same way; `preferWithin` is that fix applied here.
 *
 * Preference, never a filter: when no occurrence falls inside the preferred
 * range the first one is still returned, so this can only ever move a match
 * to a better position, never invent or destroy one.
 */
function findLiteralMatchSpan(quote: string, sourceText: string, preferWithin?: { start: number; end: number } | null): { start: number; end: number } | null {
  const normalizedQuote = normalizeForMatch(quote);
  if (!normalizedQuote) return null;
  const { normalized, map } = normalizeWithMap(sourceText);
  const spanAt = (idx: number) => {
    const start = map[idx];
    const lastNormIdx = idx + normalizedQuote.length - 1;
    const end = lastNormIdx + 1 < map.length ? map[lastNormIdx + 1] : sourceText.length;
    return { start, end };
  };
  const first = normalized.indexOf(normalizedQuote);
  if (first === -1) return null;
  if (!preferWithin) return spanAt(first);
  for (let idx = first; idx !== -1; idx = normalized.indexOf(normalizedQuote, idx + 1)) {
    const span = spanAt(idx);
    if (span.start >= preferWithin.start && span.start <= preferWithin.end) return span;
  }
  return spanAt(first);
}

/**
 * Session 18 (post-v16) — THE ANCHOR MISMATCH.
 *
 * Two different notions of "is this text in the filing" had grown up in this
 * pipeline, and they disagreed. Verification matches through
 * normalizeForMatch (whitespace runs collapsed, curly quotes and en/em
 * dashes folded), while every scale lookup located its anchor with a RAW
 * `String.indexOf`. So a sourceLine could verify as `matchType: "literal"`
 * and still be unfindable by the code that needed its position — `indexOf`
 * returns -1, no declaration is read, and the amount is dropped as
 * scale-indeterminate despite the filing declaring its scale plainly.
 *
 * Measured cost before the fix: Molina lost four base-ladder rows this way
 * ("$ 650", "$ 850", "$ 750", "$ 750") on a filing that declares millions,
 * while three sibling rows in the same table resolved — the difference was
 * nothing but whitespace. DaVita lost four cashAmounts to the same cause,
 * where the one that survived sat 1,014 characters from its declaration and
 * the four that didn't had no locatable position at all.
 *
 * This exposes the fix as a LOCATOR OBJECT rather than a bare function on
 * purpose. normalizeWithMap is O(n) over the whole filing — up to ~600k
 * characters — and a debt note has dozens of entries to place. Building it
 * once per filing and reusing it across every entry keeps that cost linear
 * instead of quadratic.
 *
 * Returns the RAW start offset (what detectDollarScaleAt needs), or null
 * when the text genuinely is not present under normalization either — a real
 * absence, still never guessed at.
 */
export interface TextLocator {
  find(needle: string): number | null;
}

export function createTextLocator(sourceText: string): TextLocator {
  const { normalized, map } = normalizeWithMap(sourceText);
  return {
    find(needle: string): number | null {
      const normalizedNeedle = normalizeForMatch(needle);
      if (!normalizedNeedle) return null;
      const idx = normalized.indexOf(normalizedNeedle);
      return idx === -1 ? null : map[idx];
    },
  };
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
  /**
   * Where in the candidate text the claim was actually matched, in RAW
   * offsets. Session 18 A1 needs this: an amount is corroborated near the row
   * it is claimed for, and "near" is meaningless without the row's position.
   * Null when unverified, or on the rare literal match whose span can't be
   * relocated.
   */
  sourceSpan: { start: number; end: number } | null;
  /** Which candidate text (by index) the claim matched — so a caller checking positions knows WHICH document those offsets belong to. */
  sourceIndex: number | null;
}

/**
 * A2 (Session 18, post-stage-2) — CO-OCCURRENCE MUST NOT PASS ON THE CAPTION
 * ALONE.
 *
 * `extractFactTokens` does not read a trailing bare table figure as money, so
 * a debt-schedule row like "6.875% Junior-Priority Secured Notes due 2029
 * 350" tokenizes to a RATE and a YEAR and nothing else. Co-occurrence then
 * asks only that a 6.875% and a 2029 sit near each other beside one of the
 * claim's own words — which every real mention of that instrument satisfies,
 * anywhere in the filing. The amount riding along was never checked by this
 * pass at all.
 *
 * Measured live on CHS: two rows verified exactly this way against the 10-K,
 * claiming $350M and $400M against real balances of $1,244M and $1,227M, and
 * both are on the rendered ladder. A fabricated row and a real one are
 * indistinguishable to a test that never looks at the number.
 *
 * So when the caller knows what amount the claim carries, the amount must be
 * printed inside the same bounded region as the identity. Checked on the
 * DIGIT GROUP rather than a parsed money token, precisely because the bare
 * table figure this is guarding is not tokenizable as money.
 */
const AMOUNT_IN_WINDOW_PAD_CHARS = 160;
const MIN_DISCRIMINATING_DIGITS = 3;

/** The digit groups in `amount` long enough to identify anything. Two-digit groups occur in every filing and prove nothing. */
export function discriminatingDigitGroups(amount: string): string[] {
  return (amount.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).filter((g) => g.replace(/\D/g, "").length >= MIN_DISCRIMINATING_DIGITS);
}

function amountPrintedNear(amount: string, text: string, start: number, end: number): boolean {
  const groups = discriminatingDigitGroups(amount);
  if (groups.length === 0) return true; // nothing discriminating to test — abstain rather than fabricate a failure
  const region = text.slice(Math.max(0, start - AMOUNT_IN_WINDOW_PAD_CHARS), Math.min(text.length, end + AMOUNT_IN_WINDOW_PAD_CHARS));
  return groups.some((g) => region.includes(g));
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

/**
 * Checks one quote against a list of candidate texts, literal match first,
 * then table-aware co-occurrence. Exported (Session 18) so
 * lib/agent/loop.ts can verify a debtSchedule row's `sourceLine` against a
 * SPECIFIC single filing's text (to learn which filing it actually came
 * from, for LadderRow.citedUrl) — the same verification this file already
 * does for `quote`, just called per-candidate instead of over the whole
 * list at once.
 */
export function verifyClaim(
  quote: string,
  candidateTexts: string[],
  options?: {
    /**
     * A2. The amount this claim carries. When given, a CO-OCCURRENCE match
     * must also print this amount inside the matched region — identity plus
     * amount, never identity alone. Literal matches are unaffected: a literal
     * match already contains the row verbatim, figure included.
     */
    requireAmount?: string;
    /**
     * A1. Where the debt note sits in each candidate text. Used only to
     * disambiguate WHICH occurrence of a repeated caption is meant — see
     * findLiteralMatchSpan. Never used to reject a match.
     */
    preferWithin?: ({ start: number; end: number } | null)[];
  }
): QuoteVerificationResult {
  const trimmed = quote.trim();
  const unverified: QuoteVerificationResult = { verified: false, displayText: null, normalizedText: null, matchType: null, sourceSpan: null, sourceIndex: null };
  if (!trimmed) return unverified;

  for (let i = 0; i < candidateTexts.length; i++) {
    const text = candidateTexts[i];
    if (quoteAppearsIn(trimmed, text)) {
      return {
        verified: true,
        displayText: trimmed,
        normalizedText: normalizeLiteralMatchText(trimmed, text),
        matchType: "literal",
        sourceSpan: findLiteralMatchSpan(trimmed, text, options?.preferWithin?.[i] ?? null),
        sourceIndex: i,
      };
    }
  }

  const claimTokens = extractFactTokens(trimmed);
  if (claimTokens.length === 0) return unverified;

  for (let i = 0; i < candidateTexts.length; i++) {
    const text = candidateTexts[i];
    const window = findCoOccurrenceWindow(trimmed, claimTokens, text, CO_OCCURRENCE_WINDOW_CHARS);
    if (!window) continue;
    // A2 — the caption is not enough on its own.
    if (options?.requireAmount !== undefined && !amountPrintedNear(options.requireAmount, text, window.start, window.end)) continue;
    return {
      verified: true,
      displayText: extractRowDisplayText(text, window.start, window.end),
      normalizedText: extractNormalizedRowText(text, window.start, window.end),
      matchType: "co-occurrence",
      sourceSpan: window,
      sourceIndex: i,
    };
  }

  return unverified;
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
  if (!fired) return { verified: true, displayText: null, normalizedText: null, matchType: null, sourceSpan: null, sourceIndex: null }; // nothing asserted, nothing to verify
  if (!quote || !quote.trim()) return { verified: false, displayText: null, normalizedText: null, matchType: null, sourceSpan: null, sourceIndex: null }; // fired but no verifiable quote given

  const citedTexts = citedUrls.map((url) => textByUrl.get(url)).filter((t): t is string => !!t);
  const citedResult = verifyClaim(quote, citedTexts);
  if (citedResult.verified) return citedResult;

  return verifyClaim(quote, Array.from(textByUrl.values()));
}
