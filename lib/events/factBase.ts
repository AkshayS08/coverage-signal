import type { CompanyResult, TriggerResult } from "../agent";
import { extractFactTokens, type FactToken } from "../agent/factTokens";

/**
 * Figure-binding — deciding WHICH single currency figure (if any) actually
 * represents a fact's dollar value, not just "the first money token found
 * nearby." Three real mis-bindings this exists to prevent, found in this
 * project's own output:
 *  1. A figure missing its scale word reads as a wildly wrong value ("$17.9"
 *     shown for what the filing actually states as "$17.9 million") —
 *     dropped rather than guessed (see hasDeterminableScale). The root
 *     cause (a whitespace-tolerance gap) is fixed in factTokens.ts; this is
 *     a defense-in-depth backstop for any similar gap not yet found.
 *  2. "Increased from $4.0 billion to $8.0 billion" binding the FIRST
 *     (pre-change) figure instead of the second (post-change, the actual
 *     current state) — see looksLikeChangeDescription.
 *  3. A padded co-occurrence display window pulling in an unrelated nearby
 *     line item's figure (DaVita's fx-exposure fact binding "net income"
 *     instead of "foreign currency translation") — see
 *     TRIGGER_SUBJECT_KEYWORDS/labelBefore.
 */

const SCALE_WORD_RE = /\b(billion|million|thousand)\b/i;

/**
 * A currency token with no scale word, no comma grouping, and a magnitude
 * >= 1000 looks exactly like a scale word that got separated from its
 * number and lost (see extractMoneyUnitSuffixed's whitespace-tolerance
 * fix) — better to drop it than display a number that reads as literal
 * dollars when the filing meant millions or billions. A genuinely small,
 * complete figure (a per-share price, a small fee) needs no scale word and
 * is left alone; a comma-grouped figure is already precise as written.
 */
export function hasDeterminableScale(raw: string): boolean {
  if (SCALE_WORD_RE.test(raw)) return true;
  const digits = raw.replace(/[$\s]/g, "");
  if (digits.includes(",")) return true;
  const num = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(num)) return true;
  return num < 1000;
}

/**
 * Real, observed risk: a co-occurrence match's display window is padded
 * with neighboring text for readability (verifyQuote.ts), which can pull
 * an unrelated line item's figure into the same fact's token list. Only
 * defined for triggers where this has actually been observed — the
 * "hedging" bucket's rate/exposure triggers, which typically sit inside
 * dense multi-line-item financial-statement tables. Deliberately NOT
 * defined for every trigger: guessing keywords for a trigger with no
 * observed mis-binding risks rejecting a currently-correct figure just
 * because its surrounding filing prose doesn't happen to echo the
 * trigger's own taxonomy name (real case checked: Encompass's asset-sale
 * text says "sell," never "asset sale" or "divestiture").
 */
const TRIGGER_SUBJECT_KEYWORDS: Partial<Record<string, string[]>> = {
  "fx-exposure": ["foreign currency", "foreign exchange", "exchange rate", "translation"],
  "commodity-exposure": ["commodity", "commodities", "input cost", "raw material", "tariff", "import"],
};

/** The text between the end of the previous token (of any kind) and the start of this one — its "label," e.g. "Unrealized gains on foreign currency translation" for the figure that follows it in a table-row dump. */
function labelBefore(text: string, allTokens: FactToken[], idx: number): string {
  const token = allTokens[idx];
  const prevEnd = idx > 0 ? allTokens[idx - 1].index + allTokens[idx - 1].raw.length : 0;
  return text.slice(prevEnd, token.index).toLowerCase();
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
 * value, or null for "no figure disclosed." Pipeline: currency-typed
 * tokens only (callers pass those pre-filtered) -> scale-determinable ->
 * subject-matched (only for triggers with a defined keyword set) ->
 * from/to phrasing among whatever survives (post-change value wins).
 */
function selectDisplayFigure(text: string, allTokens: FactToken[], triggerId: string): string | null {
  const currencyTokens = allTokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind === "money" && t.moneyUnitType === "currency" && hasDeterminableScale(t.raw));

  const keywords = TRIGGER_SUBJECT_KEYWORDS[triggerId];

  // A "same sentence" requirement is only meaningful when the text HAS
  // sentence structure at all. DaVita's fx-exposure fact's display text is
  // a padded table-row dump with no terminal punctuation anywhere ("to net
  // income $2.88 million ... Unrealized gains on foreign currency
  // translation $27.79 million ... Other comprehensive income") — there is
  // no sentence boundary to check a candidate against, so a label-keyword
  // match alone isn't trusted as sufficient for these known-risky triggers
  // when more than one competing figure is present; conservatively no
  // figure at all rather than a heuristic best guess.
  // A period between two digits ("1.51 million") is a decimal point, never
  // a sentence end — excluded so a figure-dense table dump doesn't get
  // mistaken for prose just because its own numbers have decimals.
  const hasSentenceStructure = /(?<!\d)\.(?!\d)|[!?]/.test(text);
  if (keywords && currencyTokens.length > 1 && !hasSentenceStructure) return null;

  const candidates = keywords
    ? currencyTokens.filter(({ i }) => keywords.some((kw) => labelBefore(text, allTokens, i).includes(kw)))
    : currencyTokens;

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].t.raw;

  const [first, second] = candidates;
  return looksLikeChangeDescription(text, first.t, second.t) ? second.t.raw : first.t.raw;
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
  /** The literal verified text backing this fact — a prose quote or a table-row snippet, exactly as shown in the UI's source-text expander. Raw, unscaled — for verification/audit, never altered. */
  verifiedText: string;
  /** Same fact as verifiedText, but with any bare table figure resolved to its scale-normalized dollar form where a governing scale declaration was found (lib/agent/scaleNormalize.ts) — this is what Sonnet is given as the stateable value, so a table cell "1,500" under a "dollars in millions" declaration reads as "$1.5 billion," not a bare number nobody can safely interpret. Identical to verifiedText when no bare figures needed normalizing. */
  normalizedText: string;
  /**
   * At most ONE bound currency figure, as a raw string (e.g. "$1.5
   * billion") — empty when no figure qualifies. Selected by
   * selectDisplayFigure (above), not just "the first money token nearby":
   * excludes percent/per-share/count-typed tokens, drops a figure with no
   * determinable scale, requires a subject-matching label for triggers
   * known to sit in dense multi-line-item tables (fx-exposure,
   * commodity-exposure), and prefers the POST-change value when the text
   * reads as "increased from X to Y." Only
   * lib/events/sonnetPortfolioSummary.ts currently reads this field, and
   * its own rule is: an empty array means "no figure disclosed" — never
   * guess a wrong figure instead.
   */
  figures: string[];
  /** Date tokens found in verifiedText, as raw strings (e.g. "November 18, 2025"). */
  dates: string[];
  /** Most recent citation backing this fact, if any — EDGAR metadata, not model output. */
  sourceFiling: { form: string; date: string; url: string } | null;
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
    const normalizedText = t.verifiedQuoteNormalized ?? t.verifiedQuote;
    const tokens = extractFactTokens(normalizedText);
    const selected = selectDisplayFigure(normalizedText, tokens, t.triggerId);
    facts.push({
      linkedTriggerId: t.triggerId,
      fact: t.triggerName,
      verifiedText: t.verifiedQuote,
      normalizedText,
      figures: selected ? [selected] : [],
      dates: tokens.filter((tok) => tok.kind === "date").map((tok) => tok.raw),
      sourceFiling: mostRecentCitation(t.citations),
    });
  }
  return facts;
}
