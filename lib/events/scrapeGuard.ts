/**
 * Deterministic reject for scrape-shaped text reaching a prose display slot
 * (a card's What/Why/Angle line, the portfolio summary, or a quote used AS
 * prose in a fallback briefing) — a run of numerals/labels that never
 * resolved into a sentence. Real case: Concentra's Session 10 card showed
 * ", 2025 ASSETS Current assets: Cash $158.04 million $79.9 million" as a
 * What line. Every figure in it was real, so the fact-accuracy audit
 * (numberGuard.ts) passed it — this catches what that audit structurally
 * cannot: the text has no verb, no sentence, just table cells stitched
 * together by whitespace.
 *
 * Deliberately NOT applied to the dedicated "Source text" quote expander —
 * that surface exists specifically to show the filing's own raw words,
 * table row and all, for verification; this guards prose slots only.
 */

const COMMON_VERBS = [
  "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had",
  "matures", "mature", "maturing", "expires", "expire", "expiring",
  "closes", "closed", "closing",
  "announced", "announces", "announcing",
  "completed", "completes", "completing",
  "entered", "enters", "entering",
  "issued", "issues", "issuing",
  "priced", "prices", "pricing",
  "redeemed", "redeems", "redeeming",
  "repaid", "repays", "repaying",
  "raised", "raises", "raising",
  "increased", "increases", "increasing",
  "decreased", "decreases", "decreasing",
  "rose", "rises", "rising",
  "fell", "falls", "falling",
  "grew", "grows", "growing",
  "declined", "declines", "declining",
  "paid", "pays", "paying",
  "received", "receives", "receiving",
  "reported", "reports", "reporting",
  "disclosed", "discloses", "disclosing",
  "filed", "files", "filing",
  "plans", "planning", "planned",
  "will", "expects", "expected", "expecting",
  "agreed", "agrees", "agreeing",
  "acquired", "acquires", "acquiring",
  "sold", "sells", "selling",
  "divested", "divests", "divesting",
  "refinanced", "refinances", "refinancing",
  "amended", "amends", "amending",
  "extended", "extends", "extending",
  "drew", "draws", "drawing",
  "borrowed", "borrows", "borrowing",
  "repurchased", "repurchases", "repurchasing",
  "authorized", "authorizes", "authorizing",
  "declared", "declares", "declaring",
  "opened", "opens", "opening",
  "launched", "launches", "launching",
  "secured", "secures", "securing",
  "obtained", "obtains", "obtaining",
  "upsized", "upsizes", "upsizing",
  "reduced", "reduces", "reducing",
  "means", "meant", "needs", "needed",
  "suggests", "suggested", "signals", "signaled",
  "reflects", "reflected", "shows", "showed",
  "comes", "came", "brings", "brought",
  "gives", "gave", "lets", "let",
  "makes", "made", "marks", "marked",
  "represents", "represented", "stands", "stood",
  "remains", "remained", "stays", "stayed",
  "sits", "sat", "totals", "totaled", "totaling",
];
const VERB_RE = new RegExp(`\\b(${COMMON_VERBS.join("|")})\\b`, "i");

/** Money/percent/year-shaped numeric runs — deliberately loose, this only needs to COUNT numerals, not classify them precisely. */
const NUMERIC_TOKEN_RE = /\$?\d[\d,.]*\s*(?:%|percent|billion|million|thousand|bn|mm|k)?|\b(?:19|20)\d{2}\b/gi;

const MIN_NUMERIC_TOKENS_TO_SUSPECT = 2;

/**
 * True when `text` looks like a table/label fragment rather than a
 * sentence: two or more numeric tokens and not a single common verb
 * anywhere. A genuine sentence with two numbers ("Cash rose from $80
 * million to $158 million") always has a verb; a scraped table cell never
 * does.
 */
export function isScrapeShapedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const numericMatches = trimmed.match(NUMERIC_TOKEN_RE) ?? [];
  if (numericMatches.length < MIN_NUMERIC_TOKENS_TO_SUSPECT) return false;
  return !VERB_RE.test(trimmed);
}
