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
 * "within ~6 months", "roughly 2 years out" — with or without parens/tilde.
 */
const TIMING_ANNOTATION_RE =
  /(?:within\s+)?~?\s*(\d+(?:\.\d+)?)\s*(month|months|year|years)\s*(?:out|away)\b/gi;

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
 * Parses timing signals out of a trigger's evidence text. Reused for both
 * eligibility (debt-maturity's <18mo test) and flash-card ordering
 * (nearest future date).
 */
export function extractTimingInfo(evidence: string | null): TimingInfo {
  if (!evidence) {
    return { monthsToNearestFuture: null, alreadyPast: false, isPendingLive: false };
  }

  const months: number[] = [];
  for (const match of evidence.matchAll(TIMING_ANNOTATION_RE)) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    months.push(unit.startsWith("year") ? value * 12 : value);
  }

  return {
    monthsToNearestFuture: months.length > 0 ? Math.min(...months) : null,
    alreadyPast: ALREADY_PAST_RE.test(evidence),
    isPendingLive: PENDING_RE.test(evidence),
  };
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
