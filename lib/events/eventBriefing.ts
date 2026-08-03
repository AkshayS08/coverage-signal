import type { EventRecord } from "./buildEvents";

export interface DraftedEventBriefing {
  /** One short paragraph — narrower scope than the old per-company multi-bullet briefing, since an event is usually 1-2 triggers. */
  summary: string;
  angle: string;
  source: "sonnet" | "template";
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Deterministic fallback briefing — no model call. Built straight from the
 * event's own trigger evidence so it degrades gracefully if the Sonnet
 * call fails or times out.
 */
export function templateEventBriefing(event: EventRecord): DraftedEventBriefing {
  const top = event.triggers[0];
  const summary =
    top.evidence ?? `${top.triggerName} flagged (${top.needType}), mapping to a ${lowerFirst(top.mappedNeed)} conversation.`;
  return {
    summary,
    angle: `Lead with ${lowerFirst(top.mappedNeed)}, referencing the ${lowerFirst(top.triggerName)} directly.`,
    source: "template",
  };
}
