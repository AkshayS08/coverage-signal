/**
 * Deterministic scale normalization for bare table figures.
 *
 * SEC tables routinely present a figure like "1,500" with the dollar scale
 * declared once — as a caption ("Dollars in Millions"), a document-wide
 * sentence ("dollar amounts... are expressed in millions"), or a
 * parenthetical ("(in thousands)") — rather than per cell. Verified
 * against a real filing (Tenet Healthcare's 10-Q): the NEAREST parenthetical
 * to a debt-schedule table was "(in thousands)" — but that one governs
 * SHARE counts on the cover page and per-share footnotes, not dollars. The
 * actual governing rule ("dollar amounts... are expressed in millions")
 * sat over 25,000 characters earlier. Blindly trusting proximity would
 * have produced a confident, wrong-by-1000x figure — worse than showing
 * the raw number. So this ONLY trusts a declaration that explicitly
 * anchors on "dollar(s)" (never a bare "(in thousands)" that could just as
 * easily be about share counts), and never guesses when none exists.
 */

export interface ScaleInfo {
  multiplier: number;
  scaleWord: "thousands" | "millions";
  declarationText: string;
  declarationIndex: number;
}

// Requires the word "dollar"/"dollars" to anchor the match — this is what
// excludes "80,519 shares (in thousands)" and "Weighted average shares...
// (in thousands)" from ever being mistaken for a dollar-amount scale.
// {0,150} is generous on purpose: the real governing sentence in practice
// read "dollar amounts presented in our Condensed Consolidated Financial
// Statements and these accompanying notes are expressed in millions" — 89
// characters between "dollar" and "in millions".
const DOLLAR_SCALE_RE = /\bdollars?\b[^.]{0,150}?\bin\s+(thousands|millions)\b/gi;

function findDollarScaleDeclarations(text: string): ScaleInfo[] {
  const out: ScaleInfo[] = [];
  for (const m of text.matchAll(DOLLAR_SCALE_RE)) {
    const scaleWord = m[1].toLowerCase() as "thousands" | "millions";
    out.push({
      multiplier: scaleWord === "millions" ? 1_000_000 : 1_000,
      scaleWord,
      declarationText: m[0].replace(/\s+/g, " ").trim(),
      declarationIndex: m.index ?? 0,
    });
  }
  return out;
}

// The other SEC convention: a primary financial-statement heading
// ("Condensed Consolidated Statements of Cash Flows", "Balance Sheets", ...)
// immediately followed by a BARE "(In thousands)" caption with no "dollar"
// word at all — confirmed directly against Acadia Healthcare's real 10-Q,
// where "Statements of Cash Flows (Unaudited) ... (In thousands) Operating
// activities..." governs a capex line-item figure a page later, and the
// caption itself never says "dollars". Unlike the dollar-anchored pattern
// above, this one is intentionally SHORT-RANGE and heading-anchored — it
// isn't a document-wide rule, it's a specific caption belonging to a
// specific statement, so it only counts when the caption sits right after
// the heading that owns it. This is what distinguishes it from Tenet's
// share-count "(in thousands)" false positive (a cover-page/footnote
// parenthetical with no statement heading anywhere near it) — that case
// still correctly finds nothing here and falls through to "don't guess".
const STATEMENT_HEADING_RE =
  /\b(?:condensed\s+)?(?:consolidated\s+)?(?:balance\s+sheets?|statements?\s+of\s+(?:cash\s+flows|operations|income|comprehensive\s+income|equity|stockholders.?\s+equity|changes\s+in\s+(?:stockholders.?\s+)?equity))\b/gi;
const BARE_SCALE_CAPTION_RE = /\(\s*in\s+(thousands|millions)\b[^)]*\)/gi;
const HEADING_TO_CAPTION_MAX_CHARS = 400;

function findStatementCaptionScaleDeclarations(text: string): ScaleInfo[] {
  const captions = Array.from(text.matchAll(BARE_SCALE_CAPTION_RE));
  const out: ScaleInfo[] = [];
  for (const heading of text.matchAll(STATEMENT_HEADING_RE)) {
    const headingEnd = (heading.index ?? 0) + heading[0].length;
    const caption = captions.find(
      (c) => (c.index ?? 0) >= headingEnd && (c.index ?? 0) - headingEnd <= HEADING_TO_CAPTION_MAX_CHARS
    );
    if (!caption) continue;
    const scaleWord = caption[1].toLowerCase() as "thousands" | "millions";
    out.push({
      multiplier: scaleWord === "millions" ? 1_000_000 : 1_000,
      scaleWord,
      declarationText: `${heading[0].replace(/\s+/g, " ").trim()} ${caption[0].replace(/\s+/g, " ").trim()}`,
      declarationIndex: caption.index ?? 0,
    });
  }
  return out;
}

/**
 * The nearest scale declaration at or before `position` in `text` — null if
 * none exists anywhere before it. Two independent patterns are checked (a
 * document-wide "dollar amounts... in millions" sentence, and a primary
 * financial-statement heading immediately followed by a bare "(In
 * thousands)" caption); whichever declaration is nearest-preceding wins,
 * regardless of which pattern found it. No distance cap on the dollar-
 * anchored pattern: real governing declarations can sit tens of thousands
 * of characters before the table they govern (confirmed directly against
 * Tenet's actual 10-Q), so a bounded lookback would silently reproduce the
 * exact failure this module exists to prevent. "Nearest preceding,
 * unambiguously dollar-scoped only" is the safety property, not proximity.
 */
export function detectDollarScaleAt(text: string, position: number): ScaleInfo | null {
  let best: ScaleInfo | null = null;
  for (const d of [...findDollarScaleDeclarations(text), ...findStatementCaptionScaleDeclarations(text)]) {
    if (d.declarationIndex <= position && (best === null || d.declarationIndex > best.declarationIndex)) {
      best = d;
    }
  }
  return best;
}

function roundTrim(n: number): string {
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** "1,500" at "millions" scale -> "$1.5 billion". */
export function formatScaledDollars(bareNumber: number, scale: ScaleInfo): string {
  const dollars = bareNumber * scale.multiplier;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000_000) return `$${roundTrim(dollars / 1_000_000_000)} billion`;
  if (abs >= 1_000_000) return `$${roundTrim(dollars / 1_000_000)} million`;
  if (abs >= 1_000) return `$${roundTrim(dollars / 1_000)} thousand`;
  return `$${dollars.toLocaleString()}`;
}
