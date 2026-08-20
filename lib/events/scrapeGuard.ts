/**
 * Deterministic reject for scrape-shaped text reaching a prose display slot
 * (a card's What/Why/Angle line, the portfolio summary, or a quote used AS
 * prose in a fallback briefing) — a run of numerals/labels that never
 * resolved into a sentence. Real case: Concentra's Session 10 card showed
 * ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million" as a
 * What line. Every figure in it was real, so the fact-accuracy audit
 * (numberGuard.ts) passed it — this catches what that audit structurally
 * cannot: the text never resolved into a sentence.
 *
 * Deliberately NOT applied to the dedicated "Source text" quote expander —
 * that surface exists specifically to show the filing's own raw words,
 * table row and all, for verification; this guards prose slots only.
 *
 * v2 (this file originally used a verb allowlist — false-positived on
 * SGRY's genuine, figure-bearing asset-sale sentence because "values" and
 * "providing" weren't enumerated; a verb list fails open on any real verb
 * it doesn't happen to list). Replaced with two STRUCTURAL signals that
 * don't require recognizing individual words: does the text end the way a
 * sentence ends, and how numerically dense is it relative to its word
 * count. Validated against every real verified quote in the current
 * fixture (see narrationIntegrity.test.ts) — every genuine prose sentence
 * ends with terminal punctuation and has low numeric density; every real
 * scraped table/label fragment in the book has neither.
 */

/** Money/percent/year-shaped numeric runs — deliberately loose, this only needs to COUNT numerals, not classify them precisely. */
const NUMERIC_TOKEN_RE = /\$?\d[\d,.]*\s*(?:%|percent|billion|million|thousand|bn|mm|k)?|\b(?:19|20)\d{2}\b/gi;

const MIN_NUMERIC_TOKENS_TO_SUSPECT = 2;

/** A table/label fragment almost never ends the way a written sentence does — a real sentence ends in ./!/?, optionally followed by a closing quote or parenthesis. */
const SENTENCE_END_RE = /[.!?]["'’”)]?$/;

/** Even a punctuated fragment is suspect if numerals/symbols dominate the text rather than connecting prose — a genuine sentence describing 2-3 figures is still mostly words. */
const MAX_NUMERIC_WORD_RATIO = 0.3;

/**
 * Session 17 Item 17: keyPoints bullets are DELIBERATELY terser and more
 * figure-dense than a callAbout/whyNow sentence — "one fact + its own
 * figure/date per bullet, plain register the portfolio table uses" (the
 * table's own condensed lines are this dense routinely). A single real,
 * well-formed, single-fact bullet can legitimately describe a two-tranche
 * event ("$1.5 billion of 5.500% notes due 2032 and $750 million of
 * 6.000% notes due 2033") and land well past 0.3 on pure numeral density
 * despite being a completely genuine sentence — confirmed live on Tenet's
 * real new-debt-issuance bullet, ratio 0.33. The "ends like a sentence"
 * signal (still required, unchanged) is what actually catches an
 * unresolved table/label fragment; the ratio check is defense in depth
 * against a stray period on a genuine dump, so a bullet gets a looser
 * ratio allowance rather than losing the check entirely.
 */
const MAX_NUMERIC_WORD_RATIO_BULLET = 0.5;

/**
 * True when `text` looks like a table/label fragment rather than a
 * sentence. Two independent structural signals, either one enough to
 * reject: (1) it doesn't end the way a sentence ends, or (2) numerals make
 * up too much of its word count even though it happens to end in
 * punctuation (defense in depth against a stray period). Below the
 * numeric-token floor, text is never suspected at all — a single number in
 * an otherwise normal sentence is not scrape-shaped. `context` selects the
 * numeric-ratio threshold — "sentence" (default) for callAbout/whyNow,
 * "bullet" for keyPoints, which is legitimately denser by design.
 */
export function isScrapeShapedText(text: string | null | undefined, context: "sentence" | "bullet" = "sentence"): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const numericMatches = trimmed.match(NUMERIC_TOKEN_RE) ?? [];
  if (numericMatches.length < MIN_NUMERIC_TOKENS_TO_SUSPECT) return false;

  if (!SENTENCE_END_RE.test(trimmed)) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  const numericRatio = words.length > 0 ? numericMatches.length / words.length : 0;
  const maxRatio = context === "bullet" ? MAX_NUMERIC_WORD_RATIO_BULLET : MAX_NUMERIC_WORD_RATIO;
  return numericRatio > maxRatio;
}
