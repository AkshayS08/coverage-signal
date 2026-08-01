import Anthropic from "@anthropic-ai/sdk";
import type { TriggerResult } from "../agent";
import { templateBriefing, type DraftedBriefing } from "./briefing";

// Deliberately NOT re-exported from lib/rank/index.ts — this file pulls in
// the Anthropic SDK, and the barrel is imported by the client ("use client"
// page.tsx). Keeping it a direct-path import (only app/api/run/route.ts
// imports it) means the client bundle never sees this module at all.

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 10000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Drafts an RM-facing internal briefing (2-4 factual bullets + one
 * suggested angle) for a company's top fired trigger(s) via a single
 * Sonnet call. Falls back to the deterministic template on any failure
 * or timeout — cost-bounded at exactly one Sonnet call per CALL company.
 */
export async function draftBriefing(
  company: string,
  triggers: TriggerResult[]
): Promise<DraftedBriefing> {
  try {
    const triggerContext = triggers
      .slice(0, 3)
      .map(
        (t) =>
          `- ${t.triggerName} (${t.needType}) → ${t.mappedNeed}\n  Evidence: ${t.evidence ?? "n/a"}`
      )
      .join("\n");

    const response = await getClient().messages.create(
      {
        model: SONNET_MODEL,
        max_tokens: 800,
        thinking: { type: "disabled" },
        system:
          'You write a short internal briefing note for a bank relationship manager, prepared by an analyst ahead of a client call. Summarize the fired trigger(s) as 2-4 factual bullet points covering what happened and why it\'s a reason to call, plus one short suggested angle for the conversation. Keep each bullet to a single sentence. Use only the facts given — never invent numbers, dates, or details not present in the evidence. This is an internal note between colleagues, not a message to the client: no greeting, no congratulations, no assumed rapport, no phrases like "Hi" or "I wanted to reach out." Be terse and factual, like a sharp analyst\'s note, not a sales pitch.',
        messages: [
          {
            role: "user",
            content: `Company: ${company}\n\nFired triggers (highest priority first):\n${triggerContext}`,
          },
        ],
        tools: [
          {
            name: "submit_briefing",
            description: "Submit the internal briefing note.",
            input_schema: {
              type: "object",
              properties: {
                bullets: {
                  type: "array",
                  items: { type: "string" },
                  description: "2-4 factual bullet points, no greeting or pitch language",
                },
                angle: {
                  type: "string",
                  description: "One short suggested angle for the call",
                },
              },
              required: ["bullets", "angle"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_briefing" },
      },
      { timeout: TIMEOUT_MS }
    );

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(`Sonnet did not return a submit_briefing tool call (stop_reason: ${response.stop_reason})`);
    }
    const input = toolUse.input as { bullets?: string[]; angle?: string };
    if (!input.bullets || input.bullets.length === 0 || !input.angle) {
      throw new Error(
        `malformed briefing response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
      );
    }

    return { bullets: input.bullets, angle: input.angle, source: "sonnet" };
  } catch (err) {
    console.error(`[briefing] Sonnet call failed for ${company}, falling back to template:`, err);
    return templateBriefing(triggers);
  }
}
