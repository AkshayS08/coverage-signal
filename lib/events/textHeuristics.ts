import type { DateGranularity } from "../agent/claude";

/**
 * Downstream text heuristics over a trigger's own `evidence` string.
 *
 * As of Session 11, timing (when, and is it still live) comes from the
 * structured eventDate/eventStatus fields on TriggerResult (see
 * lib/agent/claude.ts's extraction schema and lib/events/eventTiming.ts's
 * pure date arithmetic) — NOT from regex-scanning evidence prose anymore.
 * The regex-based timing extractor that used to live here
 * (extractTimingInfo) is retired; it's what let a redeemed note's former
 * due date, or an unrelated sentence's date, get mistaken for the fact's
 * own timing. What's left here are the heuristics that genuinely have no
 * structured-field replacement yet: "is this fresh vs. standing" wording
 * (isFreshEvent — used for buckets where eventStatus alone isn't
 * specific enough to distinguish "newly increased" from "unchanged"), a
 * text-based date fallback (extractEventDate — used only when a trigger's
 * own eventDate is null), and a QoQ dollar-comparison parser
 * (parseQoQIncreasePercent). All three are deliberately conservative:
 * ambiguous cases default to "not fresh" / "not computable" (table-only).
 */

const FRESH_EVENT_RE =
  /\bnew(?:ly)?\b|\bfirst[- ]time\b|\bincreased?\b|\bentered into\b|\bissued\b|\bpriced\b|\bannounced\b|\bcompleted\b|\bformed\b|\bbegan\b|\bcommenced\b/i;

const STANDING_CONDITION_RE =
  /\bongoing\b|\bstanding\b|\bthroughout\b|\bcontinu(?:e|es|ing|ed)\b|\bexisting\b|\bmultiple periods\b|\bacross (?:multiple|several)\b/i;

/** Two or more distinct quarter/year mentions reads as a recurring, standing disclosure. */
const MULTI_PERIOD_RE = /\bQ[1-4]\s*20\d{2}\b/gi;

/**
 * Best-effort "is this a fresh, newly-dated event" check, used for the
 * bucket rules that hinge on new-vs-standing (buyback increase, new capex
 * program, new floating-rate issuance, first-time foreign revenue
 * disclosure).
 */
export function isFreshEvent(evidence: string | null): boolean {
  if (!evidence) return false;
  if (STANDING_CONDITION_RE.test(evidence)) return false;
  const periodMentions = evidence.match(MULTI_PERIOD_RE);
  if (periodMentions && new Set(periodMentions.map((p) => p.toUpperCase())).size >= 2) return false;
  return FRESH_EVENT_RE.test(evidence);
}

export interface TimingInfo {
  /** Months from now to the nearest future date, if any was computable — for a year-granularity fact, computed from the windowDate convention (see eventTiming.ts), NEVER the filing's own stated precision. Decision/sort use only. */
  monthsToNearestFuture: number | null;
  /** The event/tranche is already past (e.g. already matured/redeemed). */
  alreadyPast: boolean;
  /** A live/pending event with no fixed date (e.g. "closing pending"). */
  isPendingLive: boolean;
  /** Precision the filing actually discloses ("year"/"month"/"day"), or null when there's no dated fact at all. When "year", monthsToNearestFuture was computed from a code-chosen worst-case convention date (windowDate), NOT a real disclosed date — display code MUST branch on this and never render a month count or "Dec <year>" for it; see eligibility.ts's debt-maturity case and buildEvents.ts's describeFreshness. */
  dateGranularity: DateGranularity | null;
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
/** "On May 23, 2025, ..." / "May 23, 2025" / "5/23/2025" / "May 2025" — in that specificity order, whichever occurs FIRST in the text. */
const EVENT_DATE_RE = new RegExp(
  `\\b(?:(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})|(${EVENT_DATE_MONTH_PATTERN})\\s+(\\d{4}))\\b`,
  "i"
);

/**
 * Text-based fallback for a trigger's own event date, used ONLY when the
 * structured eventDate field (Step 2) is null — e.g. a trigger classified
 * before the schema existed, or one where extraction genuinely couldn't
 * pin a date. Returns the FIRST absolute date found in the given text, as
 * an ISO date string — day defaults to the 1st when only a month+year is
 * given. Callers should always prefer the structured eventDate first; this
 * exists as a safety net, not the primary source of truth anymore.
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
