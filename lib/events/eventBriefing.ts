import type { FlashCard } from "./buildEvents";
import { isScrapeShapedText } from "./scrapeGuard";

export interface DraftedEventBriefing {
  /** What happened/is happening — one sentence, the essence, not every tranche/number. Empty when source is "failed" — the UI shows the failure banner in its place, never blank-but-styled-as-normal prose. */
  what: string;
  /** Why this is a banking opportunity NOW, in banker terms — specific to this situation. */
  whyCall: string;
  /** The specific conversation to open, tied to this company's specifics. */
  angle: string;
  /**
   * "quote" = even after a corrective retry, Sonnet's prose still stated a
   * number/date the verified quote couldn't back — so the quote itself is
   * shown instead of synthesized prose. "failed" = narration could not
   * safely produce ANY prose for this card (the Sonnet call itself failed,
   * or every available fallback text was scrape-shaped) — the UI must
   * render the loud-failure banner, never blend silently into a normal
   * card. See failureReason.
   */
  source: "sonnet" | "template" | "quote" | "failed";
  /** Present only when source is "failed" — the stage/reason a caller should log and a banner should display. */
  failureReason?: string;
}

/**
 * The loud-failure result: no synthesized or template prose, just a
 * clearly-flagged failure the UI renders as a banner in place of the card
 * body. Exists because this project has now silently degraded to template
 * output three separate times (max_tokens truncation, a deprecated
 * temperature param, and the Session 10 template fallback on HCA/Concentra
 * cards going unnoticed) — three occurrences is a design flaw, not bad
 * luck. Never call this a "fallback" in logs; it is a failure.
 */
export function failedEventBriefing(card: FlashCard, reason: string): DraftedEventBriefing {
  console.error(`[eventBriefing] NARRATION FAILURE — company=${card.company} card=${card.id} reason=${reason}`);
  return { what: "", whyCall: "", angle: "", source: "failed", failureReason: reason };
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
  const quoteText = t.verifiedQuoteNormalized ?? t.verifiedQuote ?? t.evidence ?? `${t.triggerName} flagged (${t.needType}).`;
  if (isScrapeShapedText(quoteText)) {
    return failedEventBriefing(
      card,
      `verified text for ${t.triggerName} is scrape-shaped (numbers/labels with no sentence structure) — refusing to show it as prose`
    );
  }
  const primarySource = mostRecentCitation(card.citations);
  const datePrefix = primarySource ? `Per its ${primarySource.form} filed ${primarySource.date}: ` : "";
  return {
    what: `${datePrefix}${quoteText}`,
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
  const quoteText = t.verifiedQuoteNormalized ?? t.verifiedQuote ?? t.evidence ?? `${t.triggerName} flagged (${t.needType}).`;
  if (isScrapeShapedText(quoteText)) {
    return failedEventBriefing(
      card,
      `Sonnet's prose kept stating unverifiable figures, and the verified quote to fall back to is itself scrape-shaped (numbers/labels with no sentence structure) for ${t.triggerName}`
    );
  }
  const primarySource = mostRecentCitation(card.citations);
  const datePrefix = primarySource ? `Per its ${primarySource.form} filed ${primarySource.date}: ` : "";
  return {
    what: `${datePrefix}${quoteText}`,
    whyCall: `Maps to a ${lowerFirst(t.mappedNeed)} conversation.`,
    angle: `Lead with ${lowerFirst(t.mappedNeed)}, referencing this filing detail directly.`,
    source: "quote",
  };
}
