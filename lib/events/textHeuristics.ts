/**
 * Downstream text heuristics over a trigger's own `evidence` string.
 *
 * The 15-trigger classification never records structured fields like "is
 * this a new authorization" or "months to maturity" — evidence is free
 * text written by Haiku. These helpers interpret that text to answer the
 * spec's eligibility questions without touching classification itself.
 * They're deliberately conservative: ambiguous cases default to "not
 * fresh" / "not computable" (table-only), matching the spec's own
 * fallbacks ("cash jump uncomputable", "standing ... exposure").
 */

const FRESH_EVENT_RE =
  /\bnew(?:ly)?\b|\bfirst[- ]time\b|\bincreased?\b|\bentered into\b|\bissued\b|\bpriced\b|\bannounced\b|\bcompleted\b|\bformed\b|\bbegan\b|\bcommenced\b/i;

const STANDING_CONDITION_RE =
  /\bongoing\b|\bstanding\b|\bthroughout\b|\bcontinu(?:e|es|ing|ed)\b|\bexisting\b|\bmultiple periods\b|\bacross (?:multiple|several)\b/i;

/** Two or more distinct quarter/year mentions reads as a recurring, standing disclosure. */
const MULTI_PERIOD_RE = /\bQ[1-4]\s*20\d{2}\b/gi;

/**
 * Best-effort "is this a fresh, newly-dated event" check, used for the
 * bucket rules that hinge on new-vs-standing (buyback increase, new
 * floating-rate issuance, first-time foreign revenue disclosure).
 */
export function isFreshEvent(evidence: string | null): boolean {
  if (!evidence) return false;
  if (STANDING_CONDITION_RE.test(evidence)) return false;
  const periodMentions = evidence.match(MULTI_PERIOD_RE);
  if (periodMentions && new Set(periodMentions.map((p) => p.toUpperCase())).size >= 2) return false;
  return FRESH_EVENT_RE.test(evidence);
}

/**
 * Timing annotations from the "why now" prompt guidance, plus looser
 * phrasings Haiku uses in practice: "(~9 months out)", "~6 years away",
 * "within ~6 months", "roughly 2 years out", "mature within ~18 months
 * from June 2026 filing date" — with or without parens/tilde. The "from"
 * terminator matters: evidence sometimes anchors the window to a
 * reference date ("~18 months from [date]") rather than closing with
 * "out"/"away", and without it the whole window silently fails to parse —
 * exactly the failure that dropped Tenet's real, near-term debt-maturity
 * signal from headline eligibility even though the trigger fired correctly.
 */
const TIMING_ANNOTATION_RE =
  /(?:within\s+)?~?\s*(\d+(?:\.\d+)?)\s*(month|months|year|years)\s*(?:out\b|away\b|from\b)/gi;

const ALREADY_PAST_RE = /\balready past\b|\bhas matured\b|\bmatured in\b|\bpaid off\b|\bredeemed\b/i;

const PENDING_RE =
  /\bpending\b|\bsubject to\b|\bin escrow\b|\bawaiting\b|\bexpected to close\b|\banticipated closing\b|\bclosing pending\b/i;

export interface TimingInfo {
  /** Months from now to the nearest annotated future date, if any was parseable. */
  monthsToNearestFuture: number | null;
  /** Evidence explicitly describes the event/tranche as already past (e.g. already matured). */
  alreadyPast: boolean;
  /** Evidence describes a live/pending event with no fixed date (e.g. "closing pending"). */
  isPendingLive: boolean;
}

/**
 * Parses timing signals out of a trigger's evidence text. Two sources,
 * NOT treated as equally trustworthy: an absolute date ("matures February
 * 28, 2030") is a fact we can independently compute months-out from
 * ourselves; Haiku's own relative annotation ("~18 months out") is the
 * model doing that arithmetic itself, in its own words, and it can get it
 * wrong — observed directly: evidence reading "due June 1, 2030... within
 * ~18 months from Q1 2026" for a maturity that's actually ~46 months out.
 * Trusting the narrated "~18 months" there would have wrongly pulled a
 * 4-years-out maturity inside the 18-month refi window — the same class of
 * error this whole accuracy pass exists to catch, just in the timing
 * dimension instead of the amount/date dimension. So: whenever the
 * evidence contains at least one absolute future date, that computed value
 * is authoritative and relative annotations are ignored entirely; relative
 * annotations are trusted only as a fallback when no absolute date is
 * present at all to check them against.
 */
export function extractTimingInfo(evidence: string | null, now: Date = new Date()): TimingInfo {
  if (!evidence) {
    return { monthsToNearestFuture: null, alreadyPast: false, isPendingLive: false };
  }

  const absoluteMonths = extractNearestFutureAbsoluteMonths(evidence, now);

  let monthsToNearestFuture: number | null;
  if (absoluteMonths !== null) {
    monthsToNearestFuture = absoluteMonths;
  } else {
    const relativeMonths: number[] = [];
    for (const match of evidence.matchAll(TIMING_ANNOTATION_RE)) {
      const value = Number(match[1]);
      const unit = match[2].toLowerCase();
      relativeMonths.push(unit.startsWith("year") ? value * 12 : value);
    }
    monthsToNearestFuture = relativeMonths.length > 0 ? Math.min(...relativeMonths) : null;
  }

  return {
    monthsToNearestFuture,
    alreadyPast: ALREADY_PAST_RE.test(evidence),
    isPendingLive: PENDING_RE.test(evidence),
  };
}

const EVENT_DATE_MONTH_NAMES: Record<string, number> = {
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
const EVENT_DATE_MONTH_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?";
/** "On May 23, 2025, ..." / "May 23, 2025" / "5/23/2025" / "May 2025" — in that specificity order, whichever occurs FIRST in the text (evidence conventionally opens with the event's own date, per the classification prompt's "anchor to its date" instruction). */
const EVENT_DATE_RE = new RegExp(
  `\\b(?:(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})|(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{4}))\\b`,
  "i"
);

/**
 * The EVENT's own date — a closing date, an offering date, an amendment
 * date — as opposed to the date of whichever filing happens to mention it.
 * Used by the freshness gate so a 14-month-old transaction doesn't read as
 * "this week" just because a recent, unrelated filing cited it (see
 * buildEvents.ts's isRecentFiling). Returns the first absolute date found
 * (evidence is written "On [date], Company did X..." by convention), as
 * an ISO date string — day defaults to the 1st when only a month+year is
 * given, which is precise enough at the 90-day-window granularity this
 * feeds.
 */
export function extractEventDate(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(EVENT_DATE_RE);
  if (!m) return null;

  if (m[1] && m[2] && m[3]) {
    const month = EVENT_DATE_MONTH_NAMES[m[1].replace(/\./g, "").toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number.parseInt(m[2], 10)).padStart(2, "0")}`;
  }
  if (m[4] && m[5] && m[6]) {
    return `${m[6]}-${String(Number.parseInt(m[4], 10)).padStart(2, "0")}-${String(Number.parseInt(m[5], 10)).padStart(2, "0")}`;
  }
  if (m[7] && m[8]) {
    const month = EVENT_DATE_MONTH_NAMES[m[7].replace(/\./g, "").toLowerCase()];
    if (!month) return null;
    return `${m[8]}-${String(month).padStart(2, "0")}-01`;
  }
  return null;
}

const ALL_ABSOLUTE_DATES_RE = new RegExp(
  `\\b(?:(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})|(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{4}))\\b`,
  "gi"
);

function parseAbsoluteDateMatch(m: RegExpMatchArray): Date | null {
  if (m[1] && m[2] && m[3]) {
    const month = EVENT_DATE_MONTH_NAMES[m[1].replace(/\./g, "").toLowerCase()];
    if (!month) return null;
    return new Date(Number.parseInt(m[3], 10), month - 1, Number.parseInt(m[2], 10));
  }
  if (m[4] && m[5] && m[6]) {
    return new Date(Number.parseInt(m[6], 10), Number.parseInt(m[4], 10) - 1, Number.parseInt(m[5], 10));
  }
  if (m[7] && m[8]) {
    const month = EVENT_DATE_MONTH_NAMES[m[7].replace(/\./g, "").toLowerCase()];
    if (!month) return null;
    return new Date(Number.parseInt(m[8], 10), month - 1, 1);
  }
  return null;
}

const AVG_DAYS_PER_MONTH = 30.44;

/** A date immediately preceded by retirement language describes a tranche that's already gone, not a live obligation — "redeem $1.5B of notes due Feb 2027" cites Feb 2027 only as historical identification of which notes, not a future deadline. Checked in the ~40 chars before the date, which comfortably covers "redeemed $X of Y% notes due" without reaching into an unrelated, preceding clause. */
const RETIRED_TRANCHE_RE = /\b(?:redeem(?:ed|ing)?|repaid|repurchas(?:ed|ing)|retir(?:ed|ing)|paid off|tendered|repurchase(?:d)?)\b/i;
const RETIRED_LOOKBEHIND_CHARS = 40;

/**
 * The nearest FUTURE absolute date mentioned anywhere in evidence, as
 * months-from-`now` — the fallback extractTimingInfo uses when Haiku
 * states a maturity as a bare calendar date ("matures February 28, 2030")
 * without also writing a relative annotation. Scans every absolute date in
 * the text (not just the first), since evidence commonly lists several
 * tranches and only the nearest future one matters for timing — skipping
 * any date that's identifying an already-retired tranche rather than a
 * still-outstanding one.
 */
function extractNearestFutureAbsoluteMonths(evidence: string, now: Date): number | null {
  const monthsOut: number[] = [];
  for (const m of evidence.matchAll(ALL_ABSOLUTE_DATES_RE)) {
    const date = parseAbsoluteDateMatch(m);
    if (!date || Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) continue;
    const precedingText = evidence.slice(Math.max(0, (m.index ?? 0) - RETIRED_LOOKBEHIND_CHARS), m.index ?? 0);
    if (RETIRED_TRANCHE_RE.test(precedingText)) continue;
    monthsOut.push(Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * AVG_DAYS_PER_MONTH)));
  }
  return monthsOut.length > 0 ? Math.min(...monthsOut) : null;
}

/** "$1.2 billion", "$500 million", "$300M", "$45.6 thousand" -> a plain number of dollars. */
const DOLLAR_AMOUNT_RE = /\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|B|M|K)?\b/gi;

function toDollars(raw: string, unit: string | undefined): number {
  const value = Number(raw.replace(/,/g, ""));
  switch (unit?.toLowerCase()) {
    case "billion":
    case "b":
      return value * 1_000_000_000;
    case "million":
    case "m":
      return value * 1_000_000;
    case "thousand":
    case "k":
      return value * 1_000;
    default:
      return value;
  }
}

/**
 * Best-effort quarter-over-quarter cash increase, parsed from an "X to Y" /
 * "up from X to Y" style comparison in the evidence text. Returns null
 * (uncomputable) whenever the text doesn't clearly present two comparable
 * figures — the spec's explicit fallback for this case is table-only, so
 * an unparseable amount is never treated as a false positive.
 */
export function parseQoQIncreasePercent(evidence: string | null): number | null {
  if (!evidence) return null;
  const amounts = [...evidence.matchAll(DOLLAR_AMOUNT_RE)].map((m) => toDollars(m[1], m[2]));
  if (amounts.length < 2) return null;

  const [from, to] = amounts;
  if (from <= 0 || to <= from) return null;
  return ((to - from) / from) * 100;
}
