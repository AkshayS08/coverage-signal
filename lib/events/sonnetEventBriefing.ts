import Anthropic from "@anthropic-ai/sdk";
import type { EventRecord } from "./buildEvents";
import { templateEventBriefing, type DraftedEventBriefing } from "./eventBriefing";

// Deliberately NOT re-exported from lib/events/index.ts — this file pulls
// in the Anthropic SDK, and the barrel is meant to be safe for the client
// bundle (mirrors lib/rank/sonnetBriefing.ts's split). Only server-only
// callers (a future API route, or the console test script) import this by
// direct path.

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 10000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Drafts an RM-facing internal briefing for one flash-card EVENT (not a
 * whole company) via a single Sonnet call: a short factual summary plus
 * one suggested angle. Falls back to the deterministic template on any
 * failure or timeout — cost-bounded at exactly one Sonnet call per
 * card-eligible event.
 */
export async function draftEventBriefing(event: EventRecord): Promise<DraftedEventBriefing> {
  try {
    const triggerContext = event.triggers
      .map((t) => `- ${t.triggerName} (${t.needType}) → ${t.mappedNeed}\n  Evidence: ${t.evidence ?? "n/a"}`)
      .join("\n");

    const response = await getClient().messages.create(
      {
        model: SONNET_MODEL,
        max_tokens: 500,
        thinking: { type: "disabled" },
        system:
          "You write a short internal briefing note for a bank relationship manager, prepared by an analyst ahead of a client call, about ONE specific event (not the whole company relationship). Write a short factual summary (1-2 sentences) of what happened and why it's a reason to call now, plus one short suggested angle for the conversation. Use only the facts given — never invent numbers, dates, or details not present in the evidence. This is an internal note between colleagues, not a message to the client: no greeting, no congratulations, no assumed rapport, no phrases like \"Hi\" or \"I wanted to reach out.\" Be terse and factual, like a sharp analyst's note, not a sales pitch.",
        messages: [
          {
            role: "user",
            content: `Company: ${event.company}\nOpportunity bucket: ${event.bucket}\n\nEvent (deduped from ${event.triggers.length} trigger${event.triggers.length > 1 ? "s" : ""}):\n${triggerContext}`,
          },
        ],
        tools: [
          {
            name: "submit_event_briefing",
            description: "Submit the internal briefing note for this event.",
            input_schema: {
              type: "object",
              properties: {
                summary: {
                  type: "string",
                  description: "1-2 factual sentences: what happened and why it's a reason to call now",
                },
                angle: {
                  type: "string",
                  description: "One short suggested angle for the call",
                },
              },
              required: ["summary", "angle"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_event_briefing" },
      },
      { timeout: TIMEOUT_MS }
    );

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(`Sonnet did not return a submit_event_briefing tool call (stop_reason: ${response.stop_reason})`);
    }
    const input = toolUse.input as { summary?: string; angle?: string };
    if (!input.summary || !input.angle) {
      throw new Error(
        `malformed event briefing response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
      );
    }

    return { summary: input.summary, angle: input.angle, source: "sonnet" };
  } catch (err) {
    console.error(`[eventBriefing] Sonnet call failed for ${event.company} (${event.id}), falling back to template:`, err);
    return templateEventBriefing(event);
  }
}
