import type { FlashCard } from "./buildEvents";

/**
 * Session 15: the flash-card body is now three fields, action first — see
 * sonnetEventBriefing.ts's SYSTEM_PROMPT for the exact contract each one
 * must satisfy.
 */
export interface DraftedEventBriefing {
  /** The action, one imperative line — never a description of an event. Empty when source is "failed". */
  callAbout: string;
  /** The synthesis: what makes THIS WEEK the moment. At most 2 sentences, must connect at least 2 gated facts. Empty when source is "failed". */
  whyNow: string;
  /** One sentence the RM could actually say on the phone. Empty when source is "failed". */
  openWith: string;
  /**
   * "sonnet" = drafted and passed the structural guard. "failed" =
   * narration could not safely produce a valid card body (the Sonnet call
   * itself failed, the structural guard rejected both the first attempt
   * and the one retry, or WHY NOW couldn't honestly connect two facts) —
   * the UI must render the loud-failure banner. There is no other source:
   * Session 15 removes the deterministic template/quote fallback entirely
   * — the verified quote is no longer a display fallback (see the deleted
   * templateEventBriefing/quoteFallbackBriefing). See failureReason.
   */
  source: "sonnet" | "failed";
  /** Present only when source is "failed" — the stage/reason a caller should log and a banner should display. */
  failureReason?: string;
}

/**
 * The loud-failure result: no synthesized or template prose, just a
 * clearly-flagged failure the UI renders as a banner in place of the card
 * body. This project has silently degraded to template output three times
 * before Session 14 (max_tokens truncation, a deprecated temperature
 * param, the Session 10 template fallback) — three occurrences is a design
 * flaw, not bad luck. Session 15 removes the LAST silent-degrade path
 * (the quote fallback) — this is now the ONLY non-success outcome. Never
 * call this a "fallback" in logs; it is a failure.
 */
export function failedEventBriefing(card: FlashCard, reason: string): DraftedEventBriefing {
  console.error(`[eventBriefing] NARRATION FAILURE — company=${card.company} card=${card.id} reason=${reason}`);
  return { callAbout: "", whyNow: "", openWith: "", source: "failed", failureReason: reason };
}
