import { extractFactTokens, factTokensMatch, type FactToken } from "./factTokens";
import type { DateGranularity } from "./claude";

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BARE_YEAR_RE = /^(\d{4})$/;

/** Accepts either a full "YYYY-MM-DD" or a bare "YYYY" (year-only granularity — see DateGranularity in claude.ts) — never fabricates a month/day for the bare-year case. */
function claimedDateToToken(dateStr: string): FactToken | null {
  const full = dateStr.match(FULL_DATE_RE);
  if (full) {
    return {
      kind: "date",
      raw: dateStr,
      index: 0,
      dateValue: { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) },
    };
  }
  const yearOnly = dateStr.match(BARE_YEAR_RE);
  if (yearOnly) {
    return { kind: "date", raw: dateStr, index: 0, dateValue: { year: Number(yearOnly[1]), month: null, day: null } };
  }
  return null;
}

// Deliberately separate from factTokens.ts's own stopword list: that one is
// tuned for DOLLAR-figure co-occurrence (excludes generic debt vocabulary
// like "term"/"loan"). Dates need their own exclusions — a debt-maturity
// trigger's evidence ALWAYS contains "mature"/"maturity"/"current", making
// those words completely non-discriminating for THIS purpose even though
// they're perfectly fine, specific words elsewhere. Keeping the two lists
// independent avoids tuning one verification path in a way that silently
// weakens the other.
const DATE_ANCHOR_STOPWORDS = new Set([
  "the", "and", "due", "for", "with", "its", "that", "this", "from", "will", "would", "have", "has",
  "had", "were", "was", "are", "total", "approximately", "aggregate", "principal", "amount", "amounts",
  "annual", "share", "shares", "company", "companys", "corporation", "corp", "inc", "llc",
  "outstanding", "million", "billion", "thousand", "date", "dated", "rate", "rates", "value",
  "such", "into", "under", "also", "which", "these", "than", "over", "about", "each", "when", "where",
  "term", "loan", "loans", "note", "notes", "facility", "facilities", "credit", "senior",
  "secured", "unsecured", "revolving", "agreement", "line", "borrowings", "borrowing",
  "mature", "matures", "maturity", "maturities", "current", "quarter", "quarterly", "commencing",
  "january", "february", "march", "april", "june", "july", "august", "september",
  "october", "november", "december",
]);

function extractDateAnchorWords(text: string): string[] {
  const words = text
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4 && !DATE_ANCHOR_STOPWORDS.has(w));
  return Array.from(new Set(words));
}

const DATE_ANCHOR_WINDOW_CHARS = 200;

export interface EventDateGuardResult {
  accepted: boolean;
  /** The verified date (full "YYYY-MM-DD" or bare "YYYY"), or null if rejected (unparseable, not found, or not anchored to this fact). */
  eventDate: string | null;
  /** Passed through from the claim on acceptance; null on rejection (nothing verified, so no known precision). */
  eventDateGranularity: DateGranularity | null;
}

/**
 * Fact guard for Step 2's structured `eventDate` field: a claimed date is
 * only trusted if it genuinely appears in the cited filing text (reusing
 * factTokens.ts's date-token extraction/matching, so partial-specificity
 * dates — a bare "November 2027" matching a claimed "2027-11-01", a bare
 * "2026" matching a claimed year-only "2026" — are handled correctly) AND
 * it's anchored near words specific to THIS fact, not just present
 * somewhere in the document.
 *
 * The anchoring matters MORE for bare-year claims than day-precise ones —
 * a lone 4-digit year is a weak, common signal likely to appear many times
 * in a 10-Q/10-K for entirely unrelated reasons. Confirmed live building
 * this fixture: UHS's "1.650% Senior Secured Notes due 2026" (a bare year,
 * no day stated anywhere in any filing) matched a claimed fabricated
 * "2026-12-31" purely because that exact string coincidentally appears
 * elsewhere in the same 10-Q, describing a completely unrelated quarterly
 * payment schedule ("$15.0 million per quarter commencing on December 31,
 * 2026"). Anchoring on salient words from the trigger's own evidence/quote
 * closes that gap — the same anchoring principle verifyQuote.ts already
 * uses for dollar-figure co-occurrence, applied here to dates.
 */
export function verifyEventDate(params: {
  eventDate: string | null;
  eventDateGranularity: DateGranularity | null;
  /** The trigger's own quote (preferred) or evidence — used only to derive anchor words, never matched for its own tokens. */
  anchorText: string | null;
  citedUrls: string[];
  textByUrl: Map<string, string>;
}): EventDateGuardResult {
  const { eventDate, eventDateGranularity, anchorText, citedUrls, textByUrl } = params;
  if (!eventDate) return { accepted: true, eventDate: null, eventDateGranularity: null };

  const target = claimedDateToToken(eventDate);
  if (!target) return { accepted: false, eventDate: null, eventDateGranularity: null };

  const anchorWords = anchorText ? extractDateAnchorWords(anchorText) : [];

  const citedTexts = citedUrls.map((u) => textByUrl.get(u)).filter((t): t is string => !!t);
  const candidateTexts = citedTexts.length > 0 ? citedTexts : Array.from(textByUrl.values());

  for (const text of candidateTexts) {
    const dateTokens = extractFactTokens(text).filter((t) => t.kind === "date");
    for (const dt of dateTokens) {
      if (!factTokensMatch(target, dt)) continue;
      // No anchor words to check against (e.g. very short evidence) — accept on the date match alone, nothing more precise is possible.
      if (anchorWords.length === 0) return { accepted: true, eventDate, eventDateGranularity };
      const from = Math.max(0, dt.index - DATE_ANCHOR_WINDOW_CHARS);
      const to = Math.min(text.length, dt.index + dt.raw.length + DATE_ANCHOR_WINDOW_CHARS);
      const nearby = text.slice(from, to).toLowerCase();
      if (anchorWords.some((w) => new RegExp(`\\b${w}\\b`).test(nearby))) {
        return { accepted: true, eventDate, eventDateGranularity };
      }
    }
  }
  return { accepted: false, eventDate: null, eventDateGranularity: null };
}
