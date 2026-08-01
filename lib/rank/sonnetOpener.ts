import Anthropic from "@anthropic-ai/sdk";
import type { TriggerResult } from "../agent";
import { templateOpener } from "./opener";

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

export interface DraftedOpener {
  text: string;
  source: "sonnet" | "template";
}

/**
 * Drafts a warm, specific one-line opener for a company's top fired
 * trigger via a single Sonnet call. Falls back to the deterministic
 * template on any failure or timeout so a flaky call never blocks the
 * call sheet — cost-bounded at exactly one Sonnet call per CALL company.
 */
export async function draftOpener(company: string, trigger: TriggerResult): Promise<DraftedOpener> {
  try {
    const response = await getClient().messages.create(
      {
        model: SONNET_MODEL,
        max_tokens: 200,
        thinking: { type: "disabled" },
        system:
          "Output ONLY the single opening sentence a relationship manager would say aloud when calling this client — warm, specific, referencing the actual trigger and evidence. Do not add headings, alternative options, quotation marks, or an explanation of why it works. Do not include any text before or after the sentence. Your entire response is inserted verbatim into a UI, so it must be exactly one plain sentence and nothing else.",
        messages: [
          {
            role: "user",
            content: `Company: ${company}\nTrigger: ${trigger.triggerName}\nBanking need: ${trigger.mappedNeed}\nEvidence: ${trigger.evidence ?? "n/a"}`,
          },
        ],
      },
      { timeout: TIMEOUT_MS }
    );

    const block = response.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text.trim() : "";
    if (!text) throw new Error("empty Sonnet response");

    return { text, source: "sonnet" };
  } catch (err) {
    console.error(`[opener] Sonnet call failed for ${company}, falling back to template:`, err);
    return { text: templateOpener(trigger), source: "template" };
  }
}
