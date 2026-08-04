import type { FlashCard } from "./buildEvents";

export interface DraftedEventBriefing {
  /** What happened/is happening — one sentence, the essence, not every tranche/number. */
  what: string;
  /** Why this is a banking opportunity NOW, in banker terms — specific to this situation. */
  whyCall: string;
  /** The specific conversation to open, tied to this company's specifics. */
  angle: string;
  source: "sonnet" | "template";
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Deterministic fallback briefing — no model call. Built straight from the
 * headline trigger's own evidence so it degrades gracefully if the Sonnet
 * call fails or times out. Unlike the Sonnet version this doesn't
 * synthesize (no model to do the synthesis), so it can run long — it's a
 * degraded-mode fallback, not the primary experience.
 */
export function templateEventBriefing(card: FlashCard): DraftedEventBriefing {
  const t = card.headlineTrigger;
  return {
    what: t.evidence ?? `${t.triggerName} flagged (${t.needType}).`,
    whyCall: `Maps to a ${lowerFirst(t.mappedNeed)} conversation.`,
    angle: `Lead with ${lowerFirst(t.mappedNeed)}, referencing the ${lowerFirst(t.triggerName)} directly.`,
    source: "template",
  };
}
