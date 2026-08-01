import type { TriggerResult } from "../agent";

export interface DraftedBriefing {
  bullets: string[];
  angle: string;
  source: "sonnet" | "template";
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Deterministic fallback briefing — no model call. Built straight from the
 * top trigger's own evidence and mapped need so it degrades gracefully if
 * the Sonnet call fails.
 */
export function templateBriefing(triggers: TriggerResult[]): DraftedBriefing {
  const top = triggers[0];
  const bullets = [
    top.evidence ?? `${top.triggerName} flagged (${top.needType}).`,
    `Maps to a ${lowerFirst(top.mappedNeed)} conversation.`,
  ];
  return {
    bullets,
    angle: `Lead with ${lowerFirst(top.mappedNeed)}, referencing the ${lowerFirst(top.triggerName)} directly.`,
    source: "template",
  };
}
