import type { FlashCard } from "./buildEvents";

export interface DraftedEventBriefing {
  /** What happened/is happening — one sentence, the essence, not every tranche/number. */
  what: string;
  /** Why this is a banking opportunity NOW, in banker terms — specific to this situation. */
  whyCall: string;
  /** The specific conversation to open, tied to this company's specifics. */
  angle: string;
  /** "quote" = even after a corrective retry, Sonnet's prose still stated a number/date the verified quote couldn't back — so the quote itself is shown instead of synthesized prose. */
  source: "sonnet" | "template" | "quote";
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

function mostRecentCitation(citations: FlashCard["citations"]): FlashCard["citations"][number] | null {
  if (citations.length === 0) return null;
  return [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Deterministic fallback briefing — no model call. Built from the headline
 * trigger's own verified quote when available (the literal filing text, not
 * a model paraphrase) — falling back to the Haiku evidence paraphrase only
 * if a quote genuinely isn't present — so it degrades gracefully if the
 * Sonnet call fails or times out. Unlike the Sonnet version this doesn't
 * synthesize (no model to do the synthesis), so it can run long — it's a
 * degraded-mode fallback, not the primary experience.
 */
export function templateEventBriefing(card: FlashCard): DraftedEventBriefing {
  const t = card.headlineTrigger;
  const primarySource = mostRecentCitation(card.citations);
  const datePrefix = primarySource ? `Per its ${primarySource.form} filed ${primarySource.date}: ` : "";
  return {
    what: `${datePrefix}${t.verifiedQuoteNormalized ?? t.verifiedQuote ?? t.evidence ?? `${t.triggerName} flagged (${t.needType}).`}`,
    whyCall: `Maps to a ${lowerFirst(t.mappedNeed)} conversation.`,
    angle: `Lead with ${lowerFirst(t.mappedNeed)}, referencing the ${lowerFirst(t.triggerName)} directly.`,
    source: "template",
  };
}

/**
 * Last-resort briefing when Sonnet's prose keeps stating a number/date the
 * verified quote can't back, even after one corrective retry (see
 * numberGuard.ts / sonnetEventBriefing.ts). Shows the filing's own words
 * verbatim instead of any synthesized claim — nothing here can be a
 * hallucinated figure because nothing here is generated.
 */
export function quoteFallbackBriefing(card: FlashCard): DraftedEventBriefing {
  const t = card.headlineTrigger;
  const primarySource = mostRecentCitation(card.citations);
  const datePrefix = primarySource ? `Per its ${primarySource.form} filed ${primarySource.date}: ` : "";
  return {
    what: `${datePrefix}${t.verifiedQuoteNormalized ?? t.verifiedQuote ?? t.evidence ?? `${t.triggerName} flagged (${t.needType}).`}`,
    whyCall: `Maps to a ${lowerFirst(t.mappedNeed)} conversation.`,
    angle: `Lead with ${lowerFirst(t.mappedNeed)}, referencing this filing detail directly.`,
    source: "quote",
  };
}
