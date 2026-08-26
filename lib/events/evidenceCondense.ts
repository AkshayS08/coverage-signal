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
 * Session 18: "debt-maturity" no longer goes through this file at all.
 * Its old shape here (Rule 1, condenseDebtMaturity) reconstructed a fake
 * ladder by picking one clause out of a run-on evidence sentence and
 * appending "+N more tranches to YYYY" — an approximation of what
 * lib/events/position.ts now knows structurally, from a real transcribed
 * debtSchedule. Deleted, not bypassed: debt-maturity facts never reach
 * condenseEvidenceDescription below, and the refi bucket renders directly
 * from the assembled position (lib/events/portfolioTable.ts).
 *
 * What remains here:
 *  1. new-debt-issuance — every tranche in the evidence belongs to ONE
 *     event, so the whole first sentence (which is where Haiku states the
 *     pricing) is used as-is, never split apart. See condenseFirstSentence.
 *  2. everything else, including explicit multi-period comparisons
 *     (revolver utilization, cash balance) — take the most recent "as of"
 *     period only when two or more are present; otherwise the first
 *     sentence. See condenseFirstSentence / mostRecentPeriodSentence.
 */

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Session 17 Item 13: 260 was cutting real, single-sentence facts that
 * were only barely over it — DaVita's new-debt-issuance evidence is 261
 * chars (1 over) and lost its own $986 million net-proceeds figure to the
 * cut; Molina's covenant-amendment sentence is 318 chars and lost its
 * ratio step-up schedule. Measured every real condensed line across both
 * fixture books before choosing a new value (see the session transcript):
 * the longest real single-sentence line found is 318 chars, comfortably
 * under 400 — raised here with real margin, not raised away entirely,
 * since a genuinely pathological run-on sentence should still get a safety
 * cap somewhere.
 */
const MAX_LINE_CHARS = 400;

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

/**
 * E8 (Session 18, post-stage-2) — CUT AT A SENTENCE BOUNDARY, OR DO NOT CUT.
 *
 * Mid-word truncation kept coming back. Each fix tuned the cap or added
 * another boundary heuristic — a clause comma, a word break, a dangling-word
 * stripper, an absolute floor measured against one company's real evidence —
 * and each held until the corpus moved. The output this session still carried
 * "...Medical Center) to" and "effective Janua".
 *
 * The reason is structural: every one of those rules cuts INSIDE a sentence
 * and then tries to make the cut look deliberate. A cap calibrated against a
 * measurement will keep breaking, because the next filing writes a longer
 * sentence.
 *
 * So the cap now selects WHOLE SENTENCES and stops. If not even the first
 * sentence fits, the line is not cut at all — a long sentence rendered in
 * full is honest, and a sentence cut mid-word is not. That makes the cap a
 * preference rather than a guarantee, which is the correct trade: this line
 * is evidence an RM is going to read, and an unreadable fragment saves
 * nothing.
 *
 * splitSentences below is already decimal-safe and abbreviation-safe (it has
 * to be — "5.125%", "Alan B. Miller", "U.K." all defeat a naive split), so
 * the boundary this relies on is one the file already trusts.
 */
function truncate(text: string, maxLen = MAX_LINE_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;

  const sentences = splitSentences(trimmed);
  let kept = "";
  for (const sentence of sentences) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > maxLen) break;
    kept = next;
  }
  if (!kept) return trimmed; // one sentence, longer than the cap — rendered whole
  return kept.length < trimmed.length ? `${kept} …` : kept;
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
export function dateTokenMatchesEventDate(tok: FactToken, eventDate: string, granularity: DateGranularity): boolean {
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

/**
 * Session 17 Item 14: a third period-marker shape — "the first six months
 * of <year>" / "six months ended <full date>" — an interim-period
 * phrasing distinct from both of the above, real on DaVita's capex
 * evidence ("$271.8 million in the first six months of 2026 and $264.3
 * million in the first six months of 2025") and HCA's asset-sale/capex
 * evidence ("during the six months ended June 30, 2026... during the
 * quarter ended March 31, 2026..."). Captures either a bare year (no exact
 * day — ordering-only, proxied to that half's end) or a full date.
 */
const MONTHS_PERIOD_RE =
  /\b(?:the\s+)?(?:first|second|third|fourth)?\s*(?:three|six|nine|twelve)\s+months\s+(?:of|ended)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4})\b/gi;

function parseLooseDate(raw: string): number {
  const d = new Date(raw.replace(",", ""));
  return Number.isNaN(d.getTime()) ? -Infinity : d.getTime();
}

/** The last day of quarter `q` of `year`, as a comparable timestamp — quarter phrasing has no exact day, but ordering by quarter-end is all Rule 3 needs (which sentence is MORE recent). */
function quarterEndTimestamp(year: number, quarter: number): number {
  return Date.UTC(year, quarter * 3, 0);
}

/** A bare-year "N months of <year>" reading has no exact day — June 30 of that year is an ordering-only proxy (a first-half period), never displayed. A full date parses directly. */
function monthsPeriodTimestamp(raw: string): number {
  return /^\d{4}$/.test(raw) ? Date.UTC(Number(raw), 5, 30) : parseLooseDate(raw);
}

type PeriodFamily = "as-of" | "quarter" | "months";

interface PeriodMatch {
  index: number;
  end: number;
  t: number;
  family: PeriodFamily;
}

/**
 * Every period-shape match in `text` — as-of dates, quarter-word, and
 * N-months — each tagged with its own FAMILY (not just a timestamp), and
 * its position (for clause extraction). The family tag exists because a
 * genuine before/after comparison, in every real case observed this
 * session, always restates the SAME phrasing twice ("As of X... As of
 * Y...", "first quarter of X... third quarter of Y...", "first N months
 * of X... first N months of Y...") — comparing ACROSS families produced a
 * real false positive live: HCA's dividend-buyback evidence has one
 * sentence stating buyback capacity "as of June 30, 2026" and a separate
 * sentence stating shares repurchased for the "six months ended June 30,
 * 2026" — the SAME period-end, two different metrics, not a temporal
 * progression of one thing — and comparing them cross-family picked the
 * wrong sentence and silently dropped the dividend figure entirely.
 * Shared by both the across-sentences check (mostRecentPeriodSentence,
 * Rule 3) and the within-one-sentence check (collapseSamePeriodClause,
 * Item 14).
 */
function findPeriodMatches(text: string): PeriodMatch[] {
  const matches: PeriodMatch[] = [];
  let m: RegExpExecArray | null;

  AS_OF_RE.lastIndex = 0;
  while ((m = AS_OF_RE.exec(text))) {
    const t = parseLooseDate(m[1]);
    if (t !== -Infinity) matches.push({ index: m.index, end: m.index + m[0].length, t, family: "as-of" });
  }

  QUARTER_WORD_RE.lastIndex = 0;
  while ((m = QUARTER_WORD_RE.exec(text))) {
    const t = quarterEndTimestamp(Number(m[2]), QUARTER_NAME_TO_NUM[m[1].toLowerCase()]);
    matches.push({ index: m.index, end: m.index + m[0].length, t, family: "quarter" });
  }

  MONTHS_PERIOD_RE.lastIndex = 0;
  while ((m = MONTHS_PERIOD_RE.exec(text))) {
    matches.push({ index: m.index, end: m.index + m[0].length, t: monthsPeriodTimestamp(m[1]), family: "months" });
  }

  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Rule 3: when evidence states 2+ dated periods IN THE SAME PHRASING
 * FAMILY — either "as of <date>" (DaVita's revolver: "As of June 30... As
 * of March 31...") or "<word> quarter of <year>" (Molina's buyback: "first
 * quarter of 2025... third quarter of 2025...") or "N months of/ended
 * <date>" (DaVita's capex) — keep only the sentence for the MOST RECENT
 * period within that family. Never render the comparison unless the
 * fact's own gate status depends on the change (debt-maturity and
 * new-debt-issuance, which never reach this function, are the cases where
 * a stated change genuinely matters; a utilization/balance/buyback
 * snapshot does not care that it changed, only what it currently is).
 * Cross-family matches (an "as-of" sentence and a "months" sentence, say)
 * are never compared against each other — see findPeriodMatches' doc
 * comment for the real false positive that requires this.
 *
 * Session 17 follow-up: a single sentence can itself contain 2+ same-family
 * matches (UHS's total-assets sentence: "...$1.531 billion as of December
 * 31, 2025 and $1.358 billion as of December 31, 2024." has two "as of"
 * hits in one sentence). That is Item 14's within-one-sentence case
 * (collapseSamePeriodClause's job, applied after a sentence is chosen), not
 * a genuine ACROSS-sentence progression — counting it here let that single
 * sentence outrank the money-bearing revenue-growth sentence purely for
 * having a recognized period phrase, even though the revenue sentence
 * ("$1.001 billion in 2025 and $880 million in 2024") is the one this
 * trigger is actually about. So each sentence contributes at most ONE
 * occurrence per family (its own latest), and only 2+ DISTINCT sentences
 * count as a real comparison.
 */
function mostRecentPeriodSentence(evidence: string): string | null {
  const sentences = splitSentences(evidence);
  const byFamily = new Map<PeriodFamily, { s: string; t: number }[]>();
  for (const s of sentences) {
    const matches = findPeriodMatches(s);
    if (matches.length === 0) continue;
    const latestPerFamily = new Map<PeriodFamily, number>();
    for (const m of matches) {
      const cur = latestPerFamily.get(m.family);
      if (cur === undefined || m.t > cur) latestPerFamily.set(m.family, m.t);
    }
    for (const [family, t] of latestPerFamily) {
      const arr = byFamily.get(family) ?? [];
      arr.push({ s, t });
      byFamily.set(family, arr);
    }
  }

  let best: { s: string; t: number } | null = null;
  for (const occurrences of byFamily.values()) {
    if (occurrences.length < 2) continue; // a lone sentence isn't a cross-sentence comparison
    const localBest = occurrences.reduce((latest, cur) => (cur.t > latest.t ? cur : latest));
    if (!best || localBest.t > best.t) best = localBest;
  }
  return best ? best.s : null;
}

/**
 * Session 17 Item 14: Rule 3's sentence-level check (above) misses a
 * period comparison stated WITHIN one sentence — real case: DaVita's
 * capex evidence is a single sentence ("...$271.8 million in the first six
 * months of 2026 and $264.3 million in the first six months of 2025,
 * reflecting...") that never splits into two, so mostRecentPeriodSentence
 * never even runs its comparison. When a chosen candidate sentence itself
 * contains 2+ period matches, keep only the clause around the MOST RECENT
 * one — reusing the same clause-boundary logic (semicolon/sentence-end/
 * tranche-"and") the debt-maturity condenser uses, since DaVita's own
 * boundary between the two periods is exactly a tranche-"and" ("2026
 * and $264.3 million..."). A trailing generic clause after the dropped
 * period (if any) is not reattached — matching Rule 3's existing "never
 * render the comparison" outcome, not a comparison plus a partial one.
 * Family-aware for the same reason mostRecentPeriodSentence is (see that
 * function's doc comment): only 2+ SAME-FAMILY matches within the
 * sentence count as a genuine comparison to collapse.
 */
function collapseSamePeriodClause(sentence: string): string {
  const matches = findPeriodMatches(sentence);
  const byFamily = new Map<PeriodFamily, PeriodMatch[]>();
  for (const m of matches) {
    const arr = byFamily.get(m.family) ?? [];
    arr.push(m);
    byFamily.set(m.family, arr);
  }
  let mostRecent: PeriodMatch | null = null;
  for (const occurrences of byFamily.values()) {
    if (occurrences.length < 2) continue;
    const localBest = occurrences.reduce((latest, cur) => (cur.t > latest.t ? cur : latest));
    if (!mostRecent || localBest.t > mostRecent.t) mostRecent = localBest;
  }
  if (!mostRecent) return sentence;

  const start = boundaryBefore(sentence, mostRecent.index);
  const end = boundaryAfter(sentence, mostRecent.index);
  const clause = sentence
    .slice(start, end)
    .trim()
    .replace(/^[,;.]\s*/, "")
    .replace(/[,;]\s*$/, "");
  return clause || sentence;
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
 *
 * Whatever sentence is chosen then passes through collapseSamePeriodClause
 * (Item 14) — Rule 3's sentence-level check can't catch a multi-period
 * comparison stated within a SINGLE sentence (DaVita's capex line), so
 * every candidate gets this second, narrower pass regardless of which
 * branch selected it.
 */
export function condenseFirstSentence(f: VerifiedFact): string {
  // Empty, not the bare label — an empty string is what lets
  // condenseEvidenceDescription's fallback produce an explained
  // "no figure disclosed" line instead of a silently bare one.
  if (!f.evidence) return "";

  const recentPeriod = mostRecentPeriodSentence(f.evidence);
  if (recentPeriod) return truncate(collapseSamePeriodClause(recentPeriod));

  const sentences = splitSentences(f.evidence);
  if (sentences.length === 0) return truncate(collapseSamePeriodClause(f.evidence));

  const withMoney = sentences.find((s) => extractFactTokens(s).some((t) => t.kind === "money"));
  if (withMoney) return truncate(collapseSamePeriodClause(withMoney));

  const withDate = sentences.find((s) => extractFactTokens(s).some((t) => t.kind === "date"));
  if (withDate) return truncate(collapseSamePeriodClause(withDate));

  return truncate(collapseSamePeriodClause(sentences[0]));
}

/** No bound figure, no evidence, or a condenser producing an empty string all collapse to this — the honesty rule stays: never guess, always say why the line is thin. */
export function bareLineFallback(f: VerifiedFact): string {
  return `${shortTriggerLabel(f.linkedTriggerId, f.fact)} — no figure disclosed`;
}

/**
 * Top-level dispatch (Rules 1/2 above). Session 18: no longer branches on
 * "debt-maturity" — that trigger's facts never reach this function (see
 * this file's own top doc comment); every fact condenses the same way now.
 */
/**
 * E11.2 (Session 18, post-stage-2) — A MULTI-PERIOD COMPARISON COLLAPSES TO
 * THE MOST RECENT PERIOD.
 *
 * The item-14 rule already does this for standing facts phrased "as of X...
 * as of Y", by picking the most recent SENTENCE. It regressed on a different
 * shape, where both periods live in ONE sentence joined by "and":
 *
 *   "capital expenditures of $252 million for the six months ended June 30,
 *    2026 and $225 million for the same period in 2025"
 *
 * A line that states two figures for two periods makes the reader work out
 * which one is current, and the prior-year figure is not what a financing
 * conversation is about.
 *
 * Deliberately narrow, because this is sentence surgery on text an RM reads:
 * the trailing "and ..." segment is dropped ONLY when it carries a date whose
 * YEAR is strictly older than a year in the segment before it. A comparison
 * within one year ("...and $1,119 million for Q1 2026") is left alone —
 * "Q1 2026" against "six months ended June 30, 2026" is not a comparison this
 * rule can order without inventing precision, and a wrong cut here is worse
 * than an uncut line.
 */
function yearsIn(text: string): number[] {
  return extractFactTokens(text)
    .filter((tok) => tok.kind === "date" && tok.dateValue !== undefined)
    .map((tok) => tok.dateValue!.year);
}

export function collapseToMostRecentPeriod(description: string): string {
  const at = description.lastIndexOf(" and ");
  if (at < 0) return description;
  const head = description.slice(0, at);
  const tail = description.slice(at + " and ".length);
  const headYears = yearsIn(head);
  const tailYears = yearsIn(tail);
  if (headYears.length === 0 || tailYears.length === 0) return description;
  if (Math.max(...tailYears) >= Math.min(...headYears)) return description;
  // The tail is an older period. Keep the head, restoring its terminator.
  const trimmed = head.trim().replace(/[,;]$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function condenseEvidenceDescription(f: VerifiedFact): string {
  const description = collapseToMostRecentPeriod(condenseFirstSentence(f));
  return description.trim() || bareLineFallback(f);
}
