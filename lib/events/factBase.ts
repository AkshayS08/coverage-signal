import type { CompanyResult, TriggerResult } from "../agent";
import { extractFactTokens, type FactToken } from "../agent/factTokens";

/**
 * Figure-binding — deciding WHICH single currency figure (if any) actually
 * represents a fact's dollar value, and what text is safe to hand Sonnet as
 * narration context. Session 13 Part B rewrite, after a live run surfaced
 * three real defects the fixture-based testing never exercised:
 *  1. A bare, scale-less table cell ("$ 771,910") let Sonnet GUESS a scale
 *     ("$771.9 million") that passed the old tolerant audit — while the
 *     portfolio summary's own deterministic scaling read the same bare
 *     number completely differently ("$771.91 thousand"). Same fact, two
 *     contradictory numbers on the same page.
 *  2. A truncated quote (Haiku's own `quote` field cutting off right before
 *     "million," despite its `evidence` field having the word) produced a
 *     figure with literally no unit at all ("$107.7").
 *  3. A padded display window pulled an unrelated adjacent line item's
 *     figure into a fact's token list (DaVita's debt-maturity binding its
 *     revolver's $65 million draw instead of its own $2.75 billion notes) —
 *     Session 12 only guarded this for two keyword-allowlisted triggers;
 *     this proved the risk is general.
 *
 * The fix for all three is ONE unified rule, applied identically to both
 * consumers (card narration via normalizedText, and the portfolio summary
 * via figures[]) so the two can never disagree: a bare figure with no scale
 * word is trusted ONLY when its source reads as a complete sentence (a
 * genuinely spelled-out full number, e.g. "...by $2,000,000,000 in
 * additional repurchasing authority." — never a table cell or a truncated
 * fragment, both of which are indistinguishable from each other without
 * that structural signal). And when a non-sentence (table-shaped) fact has
 * more than one qualifying candidate, there is no reliable way to tell
 * which one is genuinely this fact's own subject — "no figure disclosed"
 * instead of a guess, for any trigger, not a per-trigger keyword allowlist.
 */

const SCALE_WORD_RE = /\b(billion|million|thousand)\b/i;

/**
 * Does genuine sentence-ending punctuation appear ANYWHERE in this text —
 * not "does the text end with one." A display window is often a padded
 * multi-sentence fragment (verifyQuote.ts's ±30-char padding) that runs off
 * the END mid-word while a complete, real sentence earlier in the SAME
 * window is what actually matters (real case: DaVita's dividend-buyback
 * fact reads "...by $2,000,000,000 in additional repurchasing authority
 * (the "New Authorization"). The amount of shares of commo" — genuinely
 * complete where the dollar figure is, cut off afterward; checking only
 * the tail end would have wrongly called this a table dump). A period
 * between two digits ("1.51 million") is a decimal point, never a sentence
 * end — excluded so a figure-dense table dump doesn't get mistaken for
 * prose just because its own numbers have decimals. A decimal point ALWAYS
 * has a digit immediately after it ("1.51"); a genuine sentence-ending
 * period never does (it's followed by whitespace, a quote/paren, or the
 * end of the string) — even when a digit comes right BEFORE it, as in a
 * sentence that ends on a year or figure ("...maturity date of February
 * 28, 2030."). Checking only what follows the mark, not what precedes it,
 * is what correctly tells these apart.
 */
function hasSentenceStructure(text: string): boolean {
  return /[.!?](?!\d)/.test(text);
}

/**
 * A money token is safe to display only when its OWN scale is unambiguous.
 * An explicit scale word settles it regardless of context. Without one, a
 * bare number — whether a small "$107.7"-shaped fragment or a large
 * "771,910"-shaped table cell — is trusted ONLY when its fact's source
 * has real sentence structure somewhere: a genuinely spelled-out full
 * figure. A truncated quote and an externally-scaled table cell are
 * otherwise indistinguishable from each other in isolation.
 */
function tokenHasDeterminableScale(token: FactToken, sourceHasSentenceStructure: boolean): boolean {
  if (token.kind !== "money") return false;
  if (token.moneyUnitType !== "currency") return false; // "count" (no $ at all) and "per-share" are never a fact's headline dollar value
  if (SCALE_WORD_RE.test(token.raw)) return true;
  return sourceHasSentenceStructure;
}

/**
 * Standalone, context-free version of the same rule — for defensive,
 * after-the-fact checks (e.g. a book-wide "no displayed figure lacks a
 * unit" assertion) where the original sentence-structure context isn't
 * available. A comma-grouped figure with no scale word is trusted here
 * (it can only have reached this point via tokenHasDeterminableScale's own
 * sentence-structure gate already having passed it once); a small bare
 * figure with neither is not — there is no exemption for magnitude alone,
 * since a genuinely small complete figure and a truncated fragment of a
 * much larger one are the same shape.
 */
export function hasDeterminableScale(raw: string): boolean {
  if (SCALE_WORD_RE.test(raw)) return true;
  const digits = raw.replace(/[$\s]/g, "");
  return digits.includes(",");
}

const CHANGE_LOOKBACK_CHARS = 150;

/**
 * "Increased from $4.0 billion...to $8.0 billion" (HCA's revolver): a
 * signal word ("from"/"prior"/"previously"/"was") before the first
 * candidate, followed by a second signal word ("to"/"current"/"now")
 * between the first and second candidates, means the SECOND figure is the
 * post-change value — the one that actually describes the current state.
 * Deliberately two separate word groups in two separate positions, not one
 * bare "to" check anywhere in between — "to" alone is too common a word to
 * safely use as the only signal (e.g. "paid $50M to acquire X... $30M to
 * shareholders" is two unrelated figures, not a from/to change).
 */
function looksLikeChangeDescription(text: string, first: FactToken, second: FactToken): boolean {
  const lookback = text.slice(Math.max(0, first.index - CHANGE_LOOKBACK_CHARS), first.index);
  const between = text.slice(first.index + first.raw.length, second.index);
  const hasFromSignal = /\bfrom\b|\bprior\b|\bpreviously\b|\bwas\b/i.test(lookback);
  const hasToSignal = /\bto\b|\bcurrent(?:ly)?\b|\bnow\b/i.test(between);
  return hasFromSignal && hasToSignal;
}

/**
 * Selects the single figure that should represent this fact's dollar
 * value, or null for "no figure disclosed." A fact whose text has genuine
 * sentence structure has no adjacency risk — every candidate in it is, by
 * construction, part of real prose, not a table dump — so multiple
 * candidates there are resolved via from/to phrasing (or the first,
 * chronologically earliest one). A fact whose text has NO sentence
 * structure anywhere (a table or label dump) is only safe with EXACTLY ONE
 * qualifying candidate — the "only line item present" case; two or more
 * competing figures with nothing but table-cell adjacency to go on means
 * there is no reliable way to attribute one to this fact's own subject
 * (real case: DaVita's debt-maturity fact — $65 million, $2.75 billion
 * (x2), $2.65 billion, none of them in a sentence — used to bind the
 * $65 million revolver draw instead of the $2.75 billion notes that are
 * actually this fact's subject), so none is shown.
 */
function selectDisplayFigure(text: string, allTokens: FactToken[]): string | null {
  const hasStructure = hasSentenceStructure(text);
  const candidates = allTokens.filter((t) => tokenHasDeterminableScale(t, hasStructure));

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].raw;
  if (!hasStructure) return null;

  const [first, second] = candidates;
  return looksLikeChangeDescription(text, first, second) ? second.raw : first.raw;
}

const REDACTED_FIGURE_PLACEHOLDER = "[amount undisclosed — scale unknown]";

/**
 * The card-narration counterpart to selectDisplayFigure: strips any money
 * token that fails the SAME tokenHasDeterminableScale rule out of the text
 * Sonnet is given, so it can never see (and therefore never guess a scale
 * for) a figure the portfolio-summary path would also refuse to show.
 * Applied ONLY to normalizedText (what Sonnet reads as context) — never to
 * verifiedText, which stays the untouched, literal filing quote for the
 * UI's own source-text expander.
 */
function redactUndeterminedFigures(text: string, allTokens: FactToken[]): string {
  const hasStructure = hasSentenceStructure(text);
  const toRedact = allTokens.filter((t) => t.kind === "money" && !tokenHasDeterminableScale(t, hasStructure));
  if (toRedact.length === 0) return text;
  let result = text;
  for (const token of [...toRedact].sort((a, b) => b.index - a.index)) {
    result = result.slice(0, token.index) + REDACTED_FIGURE_PLACEHOLDER + result.slice(token.index + token.raw.length);
  }
  return result;
}

/**
 * One verified fact about a company — built ONLY from triggers whose quote
 * passed verification (lib/agent/verifyQuote.ts). This is the entire
 * factual universe Sonnet is allowed to draw numbers/dates/rates from when
 * narrating a card (see sonnetEventBriefing.ts) — a fact that isn't in
 * this list cannot legitimately appear in any card text, and the
 * deterministic audit (numberGuard.ts) checks exactly that.
 */
export interface VerifiedFact {
  /** Which trigger this fact came from — lets the caller find "the headline's own fact" in the list. */
  linkedTriggerId: string;
  /** Short label for the fact, e.g. the trigger name — for prompt readability, not itself a source of truth. */
  fact: string;
  /** The literal verified text backing this fact — a prose quote or a table-row snippet, exactly as shown in the UI's source-text expander. Raw, unscaled, UNREDACTED — for verification/audit and the raw source-text display, never altered. */
  verifiedText: string;
  /**
   * Same fact as verifiedText, but (a) any bare table figure resolved to
   * its scale-normalized dollar form where a governing scale declaration
   * was found (lib/agent/scaleNormalize.ts), and (b) any REMAINING money
   * figure with no determinable scale (tokenHasDeterminableScale) replaced
   * with a neutral placeholder — this is what Sonnet is given as
   * narration context, so it can state "$1.5 billion" where the filing's
   * own scale declaration made that safely determinable, but can never see
   * (and therefore never guess a scale for) a figure this same rule would
   * also exclude from figures[] below. Identical to verifiedText when
   * nothing needed normalizing or redacting.
   */
  normalizedText: string;
  /**
   * At most ONE bound currency figure, as a raw string (e.g. "$1.5
   * billion") — empty when no figure qualifies. Selected by
   * selectDisplayFigure (above): excludes percent/per-share/count-typed
   * tokens, drops any figure with no determinable scale, requires a
   * SENTENCE-structured source (not a table/label dump) before trusting
   * more than one competing candidate, and prefers the POST-change value
   * when the text reads as "increased from X to Y." Only
   * lib/events/sonnetPortfolioSummary.ts currently reads this field, and
   * its own rule is: an empty array means "no figure disclosed" — never
   * guess a wrong figure instead. Uses the exact same rule as
   * normalizedText's redaction, so the two consumers can never disagree
   * about the same fact.
   */
  figures: string[];
  /** Date tokens found in verifiedText, as raw strings (e.g. "November 18, 2025"). */
  dates: string[];
  /** Most recent citation backing this fact, if any — EDGAR metadata, not model output. */
  sourceFiling: { form: string; date: string; url: string } | null;
  /** ALL citations for this fact, not just the most recent — Session 15b: the table and cards must show every source link, not one. */
  citations: TriggerResult["citations"];
  /**
   * Session 15b: Haiku's own plain-English evidence paraphrase for this
   * fact — already cached (the answer cache), produced by the same
   * extraction call whose quote WAS verified for this trigger, though the
   * evidence sentence itself isn't independently re-verified the way
   * verifiedText is. The table renderer (evidenceCondense.ts) and card
   * narration now read this as their primary "what happened, with the
   * amount" source, because Haiku's extraction prompt requires proper
   * $-scale phrasing in evidence ("$1.5 billion"), unlike verifiedText,
   * which is sometimes a raw filing table fragment with an unscaled bare
   * number. Null only when the trigger somehow fired with no evidence
   * text at all (unreachable in practice — evidence is required whenever
   * fired is true).
   */
  evidence: string | null;
  /** Fact-guarded date fields, passed through unchanged, for evidenceCondense.ts's clause-matching (debt-maturity) and status-suffix (new-debt-issuance) logic. */
  eventDate: TriggerResult["eventDate"];
  dateGranularity: TriggerResult["dateGranularity"];
  eventStatus: TriggerResult["eventStatus"];
}

function mostRecentCitation(citations: TriggerResult["citations"]): TriggerResult["citations"][number] | null {
  if (citations.length === 0) return null;
  return [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Every verified fact about one company — the full factual universe for
 * that company's card narrative, not just the headline's own fact. A
 * trigger that fired but whose quote failed verification (see
 * verifyQuote.ts) NEVER produces a fact here, regardless of how urgent or
 * plausible it looks — this is the gate that keeps a fabricated claim
 * (e.g. DaVita's "$1.75B due Dec 31, 2026") from ever reaching Sonnet, in
 * any card, for any company, under any framing.
 */
export function buildVerifiedFactBase(result: CompanyResult): VerifiedFact[] {
  const facts: VerifiedFact[] = [];
  for (const t of result.results) {
    if (!t.fired || !t.quoteVerified || !t.verifiedQuote) continue;
    const rawNormalizedText = t.verifiedQuoteNormalized ?? t.verifiedQuote;
    const tokens = extractFactTokens(rawNormalizedText);
    const selected = selectDisplayFigure(rawNormalizedText, tokens);
    const normalizedText = redactUndeterminedFigures(rawNormalizedText, tokens);
    facts.push({
      linkedTriggerId: t.triggerId,
      fact: t.triggerName,
      verifiedText: t.verifiedQuote,
      normalizedText,
      figures: selected ? [selected] : [],
      dates: tokens.filter((tok) => tok.kind === "date").map((tok) => tok.raw),
      sourceFiling: mostRecentCitation(t.citations),
      citations: t.citations,
      evidence: t.evidence,
      eventDate: t.eventDate,
      dateGranularity: t.dateGranularity,
      eventStatus: t.eventStatus,
    });
  }
  return facts;
}
