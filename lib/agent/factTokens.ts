/**
 * Shared fact-token extraction and matching, used by both layers of the
 * accuracy pipeline:
 *  - lib/agent/verifyQuote.ts: does a model-claimed quote's key facts
 *    (amount, rate, date) actually appear together in the fetched filing
 *    text — including when the source is a TABLE ROW, not a sentence?
 *  - lib/events/numberGuard.ts: does every figure in the Sonnet-drafted
 *    card text trace back to the trigger's verified quote/row?
 *
 * A "fact token" is a money amount, a percentage, or a date — the three
 * kinds of concrete, checkable claims a hallucination would misstate.
 * Everything else (instrument names, prose framing) is left alone; this
 * is deliberately narrow, matching the spec this was built against.
 */

export type FactTokenKind = "money" | "percent" | "date";

/**
 * kind "money" only — which KIND of dollar figure this is, not just that it
 * is one. Added because VerifiedFact.figures (factBase.ts) was showing a
 * per-share dividend rate ("$0.19") as if it were a buyback authorization
 * SIZE, and an unlabeled bare number ("3,938", no "$" anywhere near it) as
 * if it were a confident dollar amount — both real, both wrong-typed, not
 * wrong-valued. This field only ADDS information to the token; it changes
 * nothing about which tokens get extracted, matched, or verified (see
 * verifyQuote.ts/numberGuard.ts, which don't read it) — those consumers are
 * unaffected. Only downstream presentation code (factBase.ts) uses it, to
 * prefer "no figure disclosed" over a wrong-typed number.
 *  - "currency": a confident dollar TOTAL — either scale-suffixed ("$1.5
 *    billion"), a small unambiguous "$"-figure, or a bare comma-grouped
 *    number that DOES have its own "$" (scale-ambiguous, but a real dollar
 *    cell — the case verifyQuote.ts's scale normalization exists for).
 *  - "per-share": a dollar figure immediately followed by "per share" (or
 *    "/share") — a rate, never a total.
 *  - "count": a bare comma-grouped number with NO "$" anywhere in its own
 *    match — could be a share count, an index, or a table cell whose scale
 *    declaration lives outside this token's reach; not confidently a
 *    dollar amount at all.
 */
export type MoneyUnitType = "currency" | "per-share" | "count";

export interface DateValue {
  year: number;
  /** null when only a year is known (e.g. a bare "2027" in "due 2027"). */
  month: number | null;
  /** null when only a month+year is known. */
  day: number | null;
}

export interface FactToken {
  kind: FactTokenKind;
  raw: string;
  /** Character offset in the text it was extracted from. */
  index: number;
  /** kind "money", $/unit-suffixed form (e.g. "$1.75B" -> 1_750_000_000). */
  moneyValue?: number;
  /** kind "money", a bare comma-grouped table figure with unknown scale (e.g. "1,500") — see bareNumberMatchesDollars. */
  bareNumber?: number;
  /** kind "percent", the numeric rate (e.g. "5.125% " -> 5.125). */
  percentValue?: number;
  /** kind "date". */
  dateValue?: DateValue;
  /** kind "money" only — see MoneyUnitType. Undefined for non-money kinds. */
  moneyUnitType?: MoneyUnitType;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?";

function monthFromMatch(raw: string): number | null {
  return MONTH_NAMES[raw.replace(/\./g, "").toLowerCase()] ?? null;
}

function parseMoneyWithUnit(raw: string): number | null {
  const cleaned = raw.replace(/\$|\s/g, "");
  const match = cleaned.match(/^([\d,]*(?:\.\d+)?)([bBmMkK]|billion|million|thousand)?$/);
  if (!match) return null;
  const numPart = match[1].replace(/,/g, "");
  const num = Number.parseFloat(numPart);
  if (Number.isNaN(num)) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  const multiplier =
    suffix === "b" || suffix === "billion" ? 1_000_000_000 :
    suffix === "m" || suffix === "million" ? 1_000_000 :
    suffix === "k" || suffix === "thousand" ? 1_000 :
    1;
  return num * multiplier;
}

function extractFullDates(text: string): FactToken[] {
  const re = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const month = monthFromMatch(m[1]);
    if (!month) continue;
    out.push({
      kind: "date",
      raw: m[0],
      index: m.index,
      dateValue: { year: Number.parseInt(m[3], 10), month, day: Number.parseInt(m[2], 10) },
    });
  }
  return out;
}

function extractNumericDates(text: string): FactToken[] {
  const re = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      kind: "date",
      raw: m[0],
      index: m.index,
      dateValue: { year: Number.parseInt(m[3], 10), month: Number.parseInt(m[1], 10), day: Number.parseInt(m[2], 10) },
    });
  }
  return out;
}

function extractMonthYearDates(text: string): FactToken[] {
  const re = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi");
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const month = monthFromMatch(m[1]);
    if (!month) continue;
    out.push({ kind: "date", raw: m[0], index: m.index, dateValue: { year: Number.parseInt(m[2], 10), month, day: null } });
  }
  return out;
}

/** A scale-suffixed figure ("$1.5 billion") never uses the per-share convention in practice — a per-share rate is always small and stated in bare dollars, never in millions/billions — so this is always "currency". */
function extractMoneyUnitSuffixed(text: string): FactToken[] {
  const re = /\$?\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|thousand|[bBmMkK])\b/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = parseMoneyWithUnit(m[0]);
    if (value === null) continue;
    out.push({ kind: "money", raw: m[0], index: m.index, moneyValue: value, moneyUnitType: "currency" });
  }
  return out;
}

function extractPercent(text: string): FactToken[] {
  const re = /\b\d+(?:\.\d+)?\s?%/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ kind: "percent", raw: m[0], index: m.index, percentValue: Number.parseFloat(m[0]) });
  }
  return out;
}

/**
 * Comma-grouped figures with NO unit word — scale-ambiguous on purpose. SEC
 * tables routinely glue a bare "$" onto a thousands-scale row figure with
 * the actual "(in thousands)"/"(in millions)" scale note living only in a
 * caption several hundred characters away (outside any per-fact matching
 * window) — so a literal "$" here is NOT reliable proof of true face
 * value. Matched with or without a leading "$"; comparison later tries the
 * standard ×1/×1,000/×1,000,000 conventions (see bareNumberMatchesDollars).
 */
function extractMoneyCommaGrouped(text: string): FactToken[] {
  // "\s{0,4}" (not "\s?"): EDGAR's HTML-to-text conversion often puts a "$"
  // table cell on its own line, separated from the number cell by a
  // newline plus padding (e.g. "$ \n 3,890" — 3 whitespace chars) — real
  // case found this session (HCA's commercial-paper row) where a single-
  // optional-space cap left the "$" unconsumed, producing a doubled
  // "$ $3.89 billion" once the bare figure was scale-normalized and
  // prefixed with its own "$". Bounded (not "\s*") so this still can't
  // reach across a paragraph and glue an unrelated "$" onto a number.
  const re = /\$?\s{0,4}\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = Number.parseFloat(m[0].replace(/\$|,|\s/g, ""));
    if (Number.isNaN(value)) continue;
    // The optional leading "\s?" can make m[0] start with a space (e.g. a
    // table cell like " 1,500"); trimming raw without shifting index would
    // desync the two, corrupting any position-based text splice done from
    // {index, raw.length} downstream (see verifyQuote.ts's row-text
    // extraction/normalization).
    const leadingWs = m[0].length - m[0].trimStart().length;
    // Whether THIS token's own match includes a "$" is a real signal a
    // bare number lacks entirely — a share count, an index, or a table
    // cell whose scale note lives outside this window are all extracted
    // here too (deliberately — verifyQuote.ts still needs to match them
    // against filing text either way), but only the "$"-bearing ones are
    // confidently dollar amounts; see MoneyUnitType.
    const moneyUnitType: MoneyUnitType = m[0].includes("$") ? "currency" : "count";
    out.push({ kind: "money", raw: m[0].trim(), index: m.index + leadingWs, bareNumber: value, moneyUnitType });
  }
  return out;
}

/** Real symptom: EHC's "Dividends declared ($ 0.19 per share)" — the dollar figure itself is exactly this shape, and "per share" sits right after it. */
const PER_SHARE_TRAILING_RE = /^\s{0,3}(?:per\s+(?:common\s+)?share|\/\s?share)\b/i;

function isPerShareContext(text: string, matchEnd: number): boolean {
  return PER_SHARE_TRAILING_RE.test(text.slice(matchEnd, matchEnd + 30));
}

/** A small "$"-tagged figure with no commas and no unit word (e.g. a per-share amount like "$0.78") — precise enough on its own that scale-guessing would only invite false matches, so treated as definite face value. Tagged "per-share" instead of "currency" when the text right after it reads "per share"/"/share" — this is a RATE, never a total, and must never be shown as if it were one (see MoneyUnitType). */
function extractMoneySmallDollar(text: string): FactToken[] {
  const re = /\$\s{0,4}\d+(?:\.\d+)?\b/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = Number.parseFloat(m[0].replace(/\$|\s/g, ""));
    if (Number.isNaN(value)) continue;
    const moneyUnitType: MoneyUnitType = isPerShareContext(text, m.index + m[0].length) ? "per-share" : "currency";
    out.push({ kind: "money", raw: m[0], index: m.index, moneyValue: value, moneyUnitType });
  }
  return out;
}

/** A standalone year (e.g. "due 2027" with no month) — common in debt-schedule table cells. */
function extractBareYears(text: string): FactToken[] {
  const re = /\b(19|20)\d{2}\b/g;
  const out: FactToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ kind: "date", raw: m[0], index: m.index, dateValue: { year: Number.parseInt(m[0], 10), month: null, day: null } });
  }
  return out;
}

function overlapsAny(range: { start: number; end: number }, list: { start: number; end: number }[]): boolean {
  return list.some((r) => range.start < r.end && r.start < range.end);
}

/**
 * All money/percent/date tokens in `text`, most-specific match wins where
 * patterns could overlap (a full "May 23, 2025" is one date token, never
 * also a bare "2025" year token; "$1,750,000" is one money token, never
 * also a bare-number token).
 */
export function extractFactTokens(text: string): FactToken[] {
  const consumed: { start: number; end: number }[] = [];
  const result: FactToken[] = [];
  const priorityGroups = [
    extractFullDates(text),
    extractNumericDates(text),
    extractMonthYearDates(text),
    extractMoneyUnitSuffixed(text),
    extractPercent(text),
    extractMoneyCommaGrouped(text),
    extractMoneySmallDollar(text),
    extractBareYears(text),
  ];
  for (const group of priorityGroups) {
    for (const tok of group) {
      const range = { start: tok.index, end: tok.index + tok.raw.length };
      if (overlapsAny(range, consumed)) continue;
      consumed.push(range);
      result.push(tok);
    }
  }
  return result.sort((a, b) => a.index - b.index);
}

function moneyValuesMatch(a: number, b: number, toleranceRatio = 0.02): boolean {
  const tol = Math.max(Math.max(Math.abs(a), Math.abs(b)) * toleranceRatio, 1);
  return Math.abs(a - b) <= tol;
}

/** SEC tables conventionally present figures "(in thousands)" or "(in millions)" via a header note rather than per-cell — try the standard scale conventions rather than requiring one fixed rule. */
const TABLE_SCALES = [1, 1_000, 1_000_000];

function bareNumberMatchesDollars(bare: number, dollars: number, toleranceRatio = 0.02): boolean {
  return TABLE_SCALES.some((mult) => moneyValuesMatch(bare * mult, dollars, toleranceRatio));
}

/** True when two fact tokens assert the same underlying fact, in whatever normalized form each happens to use. */
export function factTokensMatch(a: FactToken, b: FactToken): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === "money") {
    if (a.moneyValue !== undefined && b.moneyValue !== undefined) return moneyValuesMatch(a.moneyValue, b.moneyValue);
    if (a.moneyValue !== undefined && b.bareNumber !== undefined) return bareNumberMatchesDollars(b.bareNumber, a.moneyValue);
    if (b.moneyValue !== undefined && a.bareNumber !== undefined) return bareNumberMatchesDollars(a.bareNumber, b.moneyValue);
    if (a.bareNumber !== undefined && b.bareNumber !== undefined) return moneyValuesMatch(a.bareNumber, b.bareNumber);
    return false;
  }

  if (a.kind === "percent") {
    return a.percentValue !== undefined && b.percentValue !== undefined && Math.abs(a.percentValue - b.percentValue) <= 0.01;
  }

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

const SALIENT_STOPWORDS = new Set([
  "the", "and", "due", "for", "with", "its", "that", "this", "from", "will", "would", "have", "has",
  "had", "were", "was", "are", "total", "approximately", "aggregate", "principal", "amount", "amounts",
  "annual", "share", "shares", "company", "companys", "corporation", "corp", "inc", "llc",
  "outstanding", "million", "billion", "thousand", "date", "dated", "rate", "rates", "value",
  "such", "into", "under", "also", "which", "these", "than", "over", "about", "each", "when", "where",
  // Generic debt-instrument vocabulary: too common across a company's OWN
  // filing to discriminate one schedule from another within it — a "Term
  // Loan" mention sits near practically every debt/hedging disclosure,
  // including an unrelated interest-rate-cap notional table that hedges
  // that very loan. The specific tranche code ("A-2", "B-2") is what
  // actually discriminates; see the identifier pattern below.
  "term", "loan", "loans", "note", "notes", "facility", "facilities", "credit", "senior",
  "secured", "unsecured", "revolving", "agreement", "line", "borrowings", "borrowing",
  // Month names: already checked by date-token matching itself (the date
  // token requires the same month/day/year) — treating the month name as
  // an ALSO-sufficient salient word would let it trivially satisfy the
  // check for free on every date-bearing claim, since it's literally part
  // of the date match, not independent corroborating context.
  "january", "february", "march", "april", "june", "july", "august", "september",
  "october", "november", "december",
]);

/**
 * Non-numeric, non-stopword words from a claim, PLUS alphanumeric tranche
 * identifiers ("A-2", "B-2") that generic words strip away — together, the
 * signal that would distinguish this claim's real table row from an
 * unrelated one with coincidentally similar numbers nearby.
 */
function extractSalientWords(text: string): string[] {
  const words = text
    .replace(/[^a-zA-Z\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4 && !SALIENT_STOPWORDS.has(w));
  const identifiers = (text.match(/\b[A-Za-z]-\d+\b/g) ?? []).map((s) => s.toLowerCase());
  return Array.from(new Set([...words, ...identifiers]));
}

/** True if any of `words` appears as a whole word within `text`. */
function anyWordAppearsIn(words: string[], text: string): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

function factTokenSignature(t: FactToken): string {
  if (t.kind === "money") return `money:${Math.round(t.moneyValue ?? t.bareNumber ?? 0)}`;
  if (t.kind === "percent") return `percent:${t.percentValue}`;
  if (t.kind === "date") return `date:${t.dateValue?.year}-${t.dateValue?.month}-${t.dateValue?.day}`;
  return "unknown";
}

/** Count of distinct underlying facts a claim asserts — repeats of the same value (e.g. "1,500 1,500" appearing twice) count once. */
function countDistinctFacts(tokens: FactToken[]): number {
  return new Set(tokens.map(factTokenSignature)).size;
}

const SALIENT_WORD_PAD_CHARS = 200;

/**
 * Does every one of `claimTokens` have a matching occurrence in
 * `sourceText`, all mutually within `windowChars` of each other? This is
 * what lets a claim verify against a TABLE ROW ("5.125% ... due 2027 ...
 * 1,500") instead of requiring a contiguous English sentence — the tokens
 * just have to genuinely co-occur, in whatever order and spacing the
 * table's cells produced after HTML stripping.
 *
 * Numeric co-occurrence alone is not sufficient: a filing can have more
 * than one schedule with similarly-shaped numbers nearby each other (a
 * debt-maturity table and an unrelated interest-rate-cap notional
 * schedule, say) — a claim's numbers matching ONE record doesn't mean
 * they're talking about the record the claim actually describes. So when
 * `claimText` yields any salient (non-numeric, non-stopword) word — an
 * instrument name, typically — at least one of those words must also
 * appear near the matched numeric window; a pure-numeric claim (no
 * extractable words at all) skips this check, since there's nothing to
 * verify beyond the numbers themselves.
 *
 * Returns the [start,end) span covering the matched occurrences (for
 * display as the source-text row) or null if no such window exists —
 * including when a claimed token has NO occurrence anywhere in the text at
 * all, which is exactly the fabricated-fact case this exists to catch.
 */
export function findCoOccurrenceWindow(
  claimText: string,
  claimTokens: FactToken[],
  sourceText: string,
  windowChars = 220
): { start: number; end: number } | null {
  if (claimTokens.length === 0) return null;
  const sourceTokens = extractFactTokens(sourceText);
  const salientWords = extractSalientWords(claimText);

  // A claim with no identifying words AND fewer than 3 distinct facts
  // (e.g. bare "$1.75B due Dec 2026" — just an amount and a date) is too
  // weakly anchored to trust via numeric co-occurrence alone: a large
  // filing can easily have an unrelated schedule (an interest-rate-cap
  // notional table, say) with a similarly-shaped amount+date nearby each
  // other by coincidence. A claim this thin needs either a salient word to
  // anchor it, or three co-occurring facts (rate+amount+date, as a real
  // debt-schedule row typically has) — not two numbers alone.
  if (salientWords.length === 0 && countDistinctFacts(claimTokens) < 3) return null;

  const perClaimMatches = claimTokens.map((ct) => sourceTokens.filter((st) => factTokensMatch(ct, st)));
  if (perClaimMatches.some((matches) => matches.length === 0)) return null;

  // Anchor on the claim token with the fewest candidate matches (cheapest, most selective).
  let anchorIdx = 0;
  for (let i = 1; i < perClaimMatches.length; i++) {
    if (perClaimMatches[i].length < perClaimMatches[anchorIdx].length) anchorIdx = i;
  }

  for (const anchor of perClaimMatches[anchorIdx]) {
    let start = anchor.index;
    let end = anchor.index + anchor.raw.length;
    let ok = true;
    for (let i = 0; i < perClaimMatches.length; i++) {
      if (i === anchorIdx) continue;
      const nearest = perClaimMatches[i].find((m) => Math.abs(m.index - anchor.index) <= windowChars);
      if (!nearest) {
        ok = false;
        break;
      }
      start = Math.min(start, nearest.index);
      end = Math.max(end, nearest.index + nearest.raw.length);
    }
    if (!ok) continue;

    if (salientWords.length > 0) {
      const nearbyText = sourceText.slice(
        Math.max(0, start - SALIENT_WORD_PAD_CHARS),
        Math.min(sourceText.length, end + SALIENT_WORD_PAD_CHARS)
      );
      if (!anyWordAppearsIn(salientWords, nearbyText)) continue;
    }

    return { start, end };
  }
  return null;
}
