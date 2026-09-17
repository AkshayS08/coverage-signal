/**
 * SESSION 22, STAGE 3 — THE LIQUIDITY / CAPITAL-RESOURCES SPAN.
 *
 * WHY A SECOND REGION EXISTS AT ALL. An undrawn facility has no balance, so
 * it has no row in the debt table, so it is never in the debt note — it
 * lives in the liquidity discussion and nowhere else. Quest is the measured
 * case: a $750M revolver and a $600M receivables facility, both undrawn,
 * $1.3B available, and the card says "the anchor filing states no revolving
 * facility." No prompt wording repairs that, because the sentences were
 * never in the text the model was given. This is a SPAN problem and it has
 * a span fix.
 *
 * RULE 24 GOVERNS THE BOUNDARY, AND ITS COROLLARY GOVERNS THE CONSEQUENCE.
 * A region here narrows what text is CALLED the liquidity discussion; it
 * removes nothing from the corpus. Text outside it stays ordinary filing
 * text, as it always was.
 *
 * AND THE MARKER DESCRIBES PROVENANCE, NEVER IDENTITY (Rule 14). It says
 * this region matched a liquidity-section locator and names the out — if it
 * is not one, state no facilities from it. Asserting a wrong locator result
 * turns an honest miss into a confident wrong answer, which is the UHS
 * interest-expense-table lesson and is strictly worse than saying nothing.
 */

/**
 * Headings a 10-Q or 10-K actually uses for this section. Ordered by how
 * specifically each names the thing; the first that matches wins.
 *
 * "Capital Resources" alone is included because several filers split the
 * heading across two lines and the crawl only sees the second.
 */
const HEADINGS: RegExp[] = [
  /\bLiquidity\s+and\s+Capital\s+Resources\b/i,
  /\bLiquidity,\s*Capital\s+Resources\b/i,
  /\bCapital\s+Resources\s+and\s+Liquidity\b/i,
  /\bLiquidity\s+and\s+Financial\s+Condition\b/i,
  /\bCapital\s+Resources\b/i,
  /\bLiquidity\b/i,
];

/**
 * Where the section ends. MD&A's liquidity discussion runs until the next
 * top-level heading; these are the ones that actually follow it.
 */
const TERMINATORS: RegExp[] = [
  /\bQuantitative\s+and\s+Qualitative\s+Disclosures?\s+About\s+Market\s+Risk\b/i,
  /\bCritical\s+Accounting\b/i,
  /\bControls\s+and\s+Procedures\b/i,
  /\bItem\s+3\b/i,
  /\bItem\s+4\b/i,
  /\bPART\s+II\b/,
  /\bLegal\s+Proceedings\b/i,
];

/** A section shorter than this is a table-of-contents entry, not the discussion. */
const MIN_CHARS = 1200;
/** And one longer than this has run past its terminator into the rest of the filing. */
const MAX_CHARS = 60000;

export interface LiquidityLocation {
  status: "found" | "not_found";
  start: number;
  end: number;
  /** Which heading matched — recorded so a wrong region can be diagnosed rather than guessed at. */
  via: string | null;
}

export function locateLiquiditySection(text: string): LiquidityLocation {
  for (const re of HEADINGS) {
    // LAST OCCURRENCE, NOT FIRST. The first is almost always the table of
    // contents, whose entry is a few characters long and carries no
    // sentences at all; the discussion itself is later in the document.
    let start = -1;
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      const candidate = m.index ?? -1;
      if (candidate < 0) continue;
      // A heading whose following 1,200 characters hold no sentence-ending
      // punctuation is a contents line or a running header.
      const lookahead = text.slice(candidate, candidate + MIN_CHARS);
      if ((lookahead.match(/\./g) ?? []).length < 5) continue;
      start = candidate;
    }
    if (start < 0) continue;

    let end = text.length;
    for (const t of TERMINATORS) {
      const m = new RegExp(t.source, "i").exec(text.slice(start + 200));
      if (m && m.index !== undefined) end = Math.min(end, start + 200 + m.index);
    }
    end = Math.min(end, start + MAX_CHARS);
    if (end - start < MIN_CHARS) continue;
    return { status: "found", start, end, via: re.source };
  }
  return { status: "not_found", start: -1, end: -1, via: null };
}

export const LIQUIDITY_OPEN = (at: number) =>
  `[... the region below matched a liquidity / capital-resources locator at character offset ${at} of the full filing; it may not be one. Credit facilities are commonly described here and nowhere else, because an undrawn facility has no balance sheet row. If this region is not a liquidity discussion, state no facilities from it rather than composing them ...]`;
export const LIQUIDITY_CLOSE = "[... end of the region that matched the liquidity / capital-resources locator ...]";
