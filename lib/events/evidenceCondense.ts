import type { DateGranularity } from "../agent/claude";
import type { VerifiedFact } from "./factBase";
import { extractFactTokens, type FactToken } from "../agent/factTokens";
import { shortTriggerLabel } from "./labels";

/**
 * Session 15b: deterministic evidence condensing — one line per verified
 * trigger, built from the trigger's OWN evidence prose (Haiku's already-
 * cached plain-English paraphrase), never from figure+status alone. No
 * model call anywhere in this file.
 *
 * Step 0 of this session dumped every verified trigger's raw evidence for
 * both acceptance books before any of this was written (see the session
 * transcript) — three real shapes came out of that, and this file has one
 * condenser per shape, dispatched by trigger family:
 *
 *  1. debt-maturity — evidence frequently lists MANY tranches in one
 *     semicolon/"and"-joined run of text (Tenet: 10 tranches in one
 *     string). The eligible/timed tranche is whichever one matches the
 *     trigger's own fact-guarded eventDate — never positional (first-
 *     listed is not reliably the relevant one). See condenseDebtMaturity.
 *  2. new-debt-issuance — every tranche in the evidence belongs to ONE
 *     event, so the whole first sentence (which is where Haiku states the
 *     pricing) is used as-is, never split apart. See condenseFirstSentence.
 *  3. everything else, including explicit multi-period comparisons
 *     (revolver utilization, cash balance) — take the most recent "as of"
 *     period only when two or more are present; otherwise the first
 *     sentence. See condenseFirstSentence / mostRecentPeriodSentence.
 */

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MAX_LINE_CHARS = 260;

/**
 * Session 16 Fix B3: a plain word-boundary cut can still land right before
 * a dangling conjunction/preposition, reading as a mid-phrase break even
 * though it split at a space — confirmed live: DaVita's new-debt-issuance
 * line cut to "...revolving credit facility borrowings and…", the "and"
 * left hanging with nothing after it. Cut at the nearest real clause
 * boundary (comma/semicolon) when one exists reasonably close to the
 * limit; otherwise fall back to the word boundary, but strip a trailing
 * connector word first so the ellipsis never follows one.
 */
const DANGLING_TRAILING_WORDS = new Set([
  "and", "or", "with", "for", "to", "of", "in", "on", "at", "by",
  "the", "a", "an", "into", "under", "from", "as", "that",
]);

function stripTrailingDanglingWords(text: string): string {
  const words = text.split(" ");
  while (words.length > 1 && DANGLING_TRAILING_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * A minimum, not a proportion of maxLen — verified live against DaVita's
 * real 261-char new-debt-issuance evidence, whose only comma-shaped clause
 * boundary (right after "...on May 23, 2025", before "with net proceeds
 * of...") sits at char 125, a hair under half of the 260 cap. A
 * proportional threshold (e.g. "> maxLen * 0.5") rejects that real,
 * perfectly good boundary and falls through to a mid-word cut anyway; an
 * absolute floor accepts it while still refusing a boundary so early it
 * would throw away most of the line.
 */
const MIN_CLAUSE_BOUNDARY_CHARS = 100;

/** Word-boundary-safe truncation — never cuts a figure or date in half, prefers a real clause boundary (comma/semicolon) over an arbitrary word break, and never leaves a dangling conjunction/preposition right before the ellipsis. */
function truncate(text: string, maxLen = MAX_LINE_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);

  const lastComma = cut.lastIndexOf(",");
  const lastSemi = cut.lastIndexOf(";");
  const lastClauseBoundary = Math.max(lastComma, lastSemi);
  if (lastClauseBoundary >= MIN_CLAUSE_BOUNDARY_CHARS) {
    return `${stripTrailingDanglingWords(cut.slice(0, lastClauseBoundary))}…`;
  }

  const lastSpace = cut.lastIndexOf(" ");
  const wordCut = cut.slice(0, lastSpace > 0 ? lastSpace : maxLen);
  return `${stripTrailingDanglingWords(wordCut)}…`;
}

/**
 * Common short abbreviations whose period is never a sentence end —
 * verified live against real evidence: "Alan B. Miller Medical Center"
 * and "its U.K. operations" both split mid-name/mid-abbreviation under a
 * naive decimal-only guard, producing "Alan B." and "...its U.K." as
 * complete, truncated "sentences."
 */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "jr", "sr", "st", "inc", "corp", "ltd", "co", "vs", "etc", "no"]);

/**
 * Decimal-safe, abbreviation-safe sentence split. Two guards on every
 * candidate "[.!?] " boundary: (1) never split right after a digit (a
 * rate like "5.125%"), (2) never split right after a single uppercase
 * letter (a middle initial, or the second letter of "U.K.") or a known
 * short abbreviation.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  const re = /[.!?](?!\d)\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    if (/\b[A-Z]$/.test(before)) continue; // single-letter abbreviation ("B.", the "K" in "U.K.")
    const wordMatch = before.match(/([A-Za-z]+)$/);
    if (wordMatch && ABBREVIATIONS.has(wordMatch[1].toLowerCase())) continue;
    out.push(text.slice(cursor, m.index + 1).trim());
    cursor = re.lastIndex;
  }
  const rest = text.slice(cursor).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Formats an ISO eventDate at its own granularity — never inventing precision the filing didn't state. Shared by the debt-maturity condenser's "no matching clause" fallback and (as formatAnnouncedDate) Fix C's "announced <date>" status suffix in portfolioTable.ts. */
export function formatDueDate(eventDate: string, granularity: DateGranularity): string {
  if (granularity === "year") return eventDate; // bare 4-digit year, never invent a month
  const [y, m, d] = eventDate.split("-").map(Number);
  const month = MONTH_ABBR[m] ?? "";
  return granularity === "month" ? `${month} ${y}` : `${month} ${d}, ${y}`;
}

export { formatDueDate as formatAnnouncedDate };

/** True when this date TOKEN is the fact's own due-date, at the fact's own granularity — never a coincidentally same-year "as of" balance date (see UHS's real trap: a bare "2026" due-year token sitting a sentence away from an unrelated "June 30, 2026" balance-sheet date). */
function dateTokenMatchesEventDate(tok: FactToken, eventDate: string, granularity: DateGranularity): boolean {
  if (!tok.dateValue) return false;
  if (granularity === "year") return tok.dateValue.month === null && tok.dateValue.year === Number(eventDate);
  const [y, m, d] = eventDate.split("-").map(Number);
  if (tok.dateValue.year !== y || tok.dateValue.month !== m) return false;
  if (granularity === "day" && tok.dateValue.day !== null) return tok.dateValue.day === d;
  return true;
}

const SENTENCE_END_RE = /[.!?](?!\d)/g;
/** "and $500 million..." / "and 4.20% Notes..." — a tranche-list conjunction, not generic prose "and". */
const TRANCHE_AND_RE = /\s+and\s+(?=\$|\d)/gi;

/** Nearest clause boundary at or before `pos` — a semicolon, a real sentence end, or a tranche-list "and". */
function boundaryBefore(text: string, pos: number): number {
  let latest = 0;
  const semi = text.lastIndexOf(";", pos - 1);
  if (semi !== -1) latest = Math.max(latest, semi + 1);
  for (const re of [SENTENCE_END_RE, TRANCHE_AND_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      if (end <= pos) latest = Math.max(latest, end);
      else break;
    }
  }
  return latest;
}

/** Nearest clause boundary at or after `pos`. */
function boundaryAfter(text: string, pos: number): number {
  let earliest = text.length;
  const semi = text.indexOf(";", pos);
  if (semi !== -1) earliest = Math.min(earliest, semi);
  SENTENCE_END_RE.lastIndex = pos;
  const sm = SENTENCE_END_RE.exec(text);
  if (sm) earliest = Math.min(earliest, sm.index + 1);
  TRANCHE_AND_RE.lastIndex = pos;
  const am = TRANCHE_AND_RE.exec(text);
  if (am) earliest = Math.min(earliest, am.index);
  return earliest;
}

const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;

/**
 * Session 16 Fix B1: within `[start, matchedIndex)`, the start of the LAST
 * percent-rate mention (e.g. "4.60%") — a debt tranche's own rate reliably
 * marks where ITS clause actually begins, tighter than the generic
 * semicolon/sentence/tranche-"and" boundary alone. Confirmed live: Quest's
 * evidence has no semicolon or sentence break before its December-2027
 * tranche, so the wide boundary swept in an unrelated lead-in ("current
 * portion of long-term debt was $10 million, with...") ahead of the tranche
 * that actually matters; the rate anchor isolates just "4.60% Senior Notes
 * due December 2027 ($400 million)". A no-op (returns `start` unchanged)
 * when no percent appears in the gap — every other observed debt-maturity
 * evidence already has its own rate at, or immediately after, the existing
 * boundary, so this never widens or otherwise disturbs an already-correct
 * clause.
 */
function tightenClauseStart(text: string, start: number, matchedIndex: number): number {
  const region = text.slice(start, matchedIndex);
  const matches = [...region.matchAll(PERCENT_RE)];
  if (matches.length === 0) return start;
  return start + matches[matches.length - 1].index!;
}

/** The single clause containing position `pos` — bounded by the nearest semicolon/sentence-end/tranche-"and" on each side, tightened forward to the nearest percent-rate anchor when one falls inside that wider span (see tightenClauseStart). */
function extractClause(text: string, pos: number): string {
  const start = tightenClauseStart(text, boundaryBefore(text, pos), pos);
  const end = boundaryAfter(text, pos);
  return text
    .slice(start, end)
    .trim()
    .replace(/^[,;.]\s*/, "")
    .replace(/[,;]\s*$/, "");
}

/**
 * Rule 1 (debt-maturity): select the clause matching the trigger's own
 * eventDate. Never position-based. No match -> a date-only line, never a
 * guess and never the first clause — "a missing amount is fine; a wrong
 * tranche is not."
 */
export function condenseDebtMaturity(f: VerifiedFact): string {
  // Empty, not the bare label — condenseEvidenceDescription's caller falls
  // through to bareLineFallback for an empty result, which is what turns
  // "capex financing" (unexplained) into "capex financing — no figure
  // disclosed" (honest). Returning the label directly here would silently
  // skip that fallback, since a non-empty label reads as "already handled."
  if (!f.evidence || !f.eventDate || !f.dateGranularity) return "";

  const dateTokens = extractFactTokens(f.evidence).filter((t) => t.kind === "date");
  const matched = dateTokens.find((t) => dateTokenMatchesEventDate(t, f.eventDate!, f.dateGranularity!));
  if (!matched) {
    return formatDueDate(f.eventDate, f.dateGranularity) === f.eventDate
      ? `notes due ${f.eventDate}`
      : `notes due ${formatDueDate(f.eventDate, f.dateGranularity)}`;
  }

  const clauseStart = boundaryBefore(f.evidence, matched.index);
  const clauseEnd = boundaryAfter(f.evidence, matched.index);
  const clause = extractClause(f.evidence, matched.index);

  // "+N more tranches" must count only OTHER genuine due-dates, never an
  // "as of <date>" balance-sheet mention or a redemption date that
  // happens to share the evidence with a real maturity list — verified
  // live against Centene ("As of June 30, 2026..." + two redemption
  // dates, none of them another tranche) and Community Health (an "as of"
  // long-term-debt total). Requires the word "due" within a short window
  // before the date token — every real multi-tranche debt-maturity
  // evidence observed uses "...notes due <date>" for each one.
  const DUE_PROXIMITY_CHARS = 20;
  const otherDates = dateTokens.filter((t) => {
    if (t === matched) return false;
    if (t.index >= clauseStart && t.index < clauseEnd) return false;
    const before = f.evidence!.slice(Math.max(0, t.index - DUE_PROXIMITY_CHARS), t.index);
    return /\bdue\b/i.test(before);
  });
  if (otherDates.length === 0) return truncate(clause);

  const maxYear = Math.max(...otherDates.map((t) => t.dateValue!.year));
  return truncate(`${clause} (+${otherDates.length} more tranche${otherDates.length === 1 ? "" : "s"} to ${maxYear})`);
}

/** "as of DATE" period markers, decimal-safe — used to find the most-recent-period sentence for multi-period comparisons (Rule 3). */
const AS_OF_RE = /\bas of\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/gi;

/**
 * Session 16 Fix B4: a second period-marker shape, decimal-safe — "In the
 * first quarter of 2025..." / "In the third quarter of 2025..." — that Rule
 * 3 previously had no way to compare, since it only recognized "as of
 * <date>" phrasing. Confirmed live: Molina's dividend-buyback evidence
 * states TWO distinct quarters this way (Q1 2025 and Q3 2025, the more
 * recent one) and the old first-sentence-with-money fallback picked the
 * stale Q1 one, since neither sentence matched AS_OF_RE at all.
 */
const QUARTER_WORD_RE = /\b(first|second|third|fourth)\s+quarter\s+of\s+(\d{4})\b/gi;
const QUARTER_NAME_TO_NUM: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

function parseLooseDate(raw: string): number {
  const d = new Date(raw.replace(",", ""));
  return Number.isNaN(d.getTime()) ? -Infinity : d.getTime();
}

/** The last day of quarter `q` of `year`, as a comparable timestamp — quarter phrasing has no exact day, but ordering by quarter-end is all Rule 3 needs (which sentence is MORE recent). */
function quarterEndTimestamp(year: number, quarter: number): number {
  return Date.UTC(year, quarter * 3, 0);
}

/** Latest period timestamp mentioned anywhere in `s` — "as of <date>" and/or "<word> quarter of <year>" — or null if neither shape appears. Takes the LATEST within a single sentence too, in case one sentence states more than one period. */
function periodTimestamp(s: string): number | null {
  let latest: number | null = null;

  AS_OF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AS_OF_RE.exec(s))) {
    const t = parseLooseDate(m[1]);
    if (t !== -Infinity && (latest === null || t > latest)) latest = t;
  }

  QUARTER_WORD_RE.lastIndex = 0;
  while ((m = QUARTER_WORD_RE.exec(s))) {
    const t = quarterEndTimestamp(Number(m[2]), QUARTER_NAME_TO_NUM[m[1].toLowerCase()]);
    if (latest === null || t > latest) latest = t;
  }

  return latest;
}

/**
 * Rule 3: when evidence states 2+ dated periods — either "as of <date>"
 * (DaVita's revolver: "As of June 30... As of March 31...") or "<word>
 * quarter of <year>" (Molina's buyback: "first quarter of 2025... third
 * quarter of 2025...") — keep only the sentence for the MOST RECENT period.
 * Never render the comparison unless the fact's own gate status depends on
 * the change (debt-maturity and new-debt-issuance, which never reach this
 * function, are the cases where a stated change genuinely matters; a
 * utilization/balance/buyback snapshot does not care that it changed, only
 * what it currently is).
 */
function mostRecentPeriodSentence(evidence: string): string | null {
  const sentences = splitSentences(evidence);
  const dated = sentences
    .map((s) => {
      const t = periodTimestamp(s);
      return t !== null ? { s, t } : null;
    })
    .filter((d): d is { s: string; t: number } => d !== null);
  if (dated.length < 2) return null;
  return dated.reduce((latest, cur) => (cur.t > latest.t ? cur : latest)).s;
}

/**
 * Rule 2 (new-debt-issuance) and the generic fallback (Rule 3's non-
 * multi-period case, and every trigger with no dedicated condenser): the
 * evidence's own first sentence — Haiku's extraction prompt already
 * produces self-contained, properly-scaled sentences, so re-deriving a
 * summary risks fabricating structure the filing didn't state.
 *
 * "First" sentence literally, verified live, is sometimes the wrong one:
 * Haiku frequently opens with a generic scene-setter carrying no figure
 * at all ("Quarterly cash dividends are being paid." before the sentence
 * that actually states "$1.56 per share"; "HCA continues to acquire
 * hospitals..." before the sentence with the $386 million). So: prefer
 * the first sentence containing a money figure: that is the amount this
 * whole exercise exists to surface. Only when NO sentence has one, prefer
 * the first with a date. Only when neither exists, true first sentence.
 */
export function condenseFirstSentence(f: VerifiedFact): string {
  // Empty, not the bare label — see condenseDebtMaturity's identical
  // early-return for why: an empty string is what lets
  // condenseEvidenceDescription's fallback produce an explained
  // "no figure disclosed" line instead of a silently bare one.
  if (!f.evidence) return "";

  const recentPeriod = mostRecentPeriodSentence(f.evidence);
  if (recentPeriod) return truncate(recentPeriod);

  const sentences = splitSentences(f.evidence);
  if (sentences.length === 0) return truncate(f.evidence);

  const withMoney = sentences.find((s) => extractFactTokens(s).some((t) => t.kind === "money"));
  if (withMoney) return truncate(withMoney);

  const withDate = sentences.find((s) => extractFactTokens(s).some((t) => t.kind === "date"));
  if (withDate) return truncate(withDate);

  return truncate(sentences[0]);
}

/** No bound figure, no evidence, or a condenser producing an empty string all collapse to this — the honesty rule stays: never guess, always say why the line is thin. */
export function bareLineFallback(f: VerifiedFact): string {
  return `${shortTriggerLabel(f.linkedTriggerId, f.fact)} — no figure disclosed`;
}

/** Top-level dispatch by trigger family (Rules 1/2/3). */
export function condenseEvidenceDescription(f: VerifiedFact): string {
  let description: string;
  if (f.linkedTriggerId === "debt-maturity") {
    description = condenseDebtMaturity(f);
  } else {
    description = condenseFirstSentence(f);
  }
  return description.trim() || bareLineFallback(f);
}
