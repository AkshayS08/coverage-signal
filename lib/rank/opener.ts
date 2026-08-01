import type { TriggerResult } from "../agent";

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * A simple deterministic one-liner — no model call. Sonnet-drafted openers
 * are a later polish pass; this just needs to be a plausible first line.
 */
export function templateOpener(trigger: TriggerResult): string {
  return `Saw ${lowerFirst(trigger.triggerName)} in your recent filings — worth a conversation about ${lowerFirst(
    trigger.mappedNeed
  )}?`;
}
