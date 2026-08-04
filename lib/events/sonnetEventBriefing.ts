import Anthropic from "@anthropic-ai/sdk";
import type { FlashCard } from "./buildEvents";
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

const SYSTEM_PROMPT = `You write the body of one flash card for a bank relationship manager (RM), about ONE headline event at ONE company. A banker must grasp the call in 5 seconds, so you synthesize — you never list tranches, dates, or numbers one by one.

Write exactly three parts:
- what: what happened AND what it means, in plain English, anchored to its date. State the primary source date given (e.g. "In its Nov 18, 2025 8-K, Tenet..." or "In June 2026, DaVita..."), then explain the event's significance — not a list of every instrument/number. Example of the wrong way: "layered a $1B notes offering with a refreshed $2B term loan A, $1.5B revolver, $500M term loan B add-on" (an instrument list, no meaning). Example of the right way: "In June 2026, DaVita refinanced its capital structure, adding new notes and expanding its term loans and revolver — a sign of active liability management." Never omit the anchoring date; never enumerate every tranche.
- whyCall: why this is a banking opportunity NOW, in banker terms. This is the insight, not a restatement of "what" — explain the actual logic (e.g. "large cash proceeds need a home before they land elsewhere," or "maturity inside the refi window, they'll be shopping it soon"). Make it specific to this exact situation — a line that could apply to any company is wrong.
- angle: the specific conversation to open, tied to this company's specifics — not boilerplate like "explore treasury needs."

Hard rules:
- Exactly one sentence per part. "what" may run up to 30 words since it must carry a date; target 25. "whyCall" and "angle" target 20 words, 25-word ceiling. Before answering, count the words in each part and cut anything over its ceiling.
- Plain English a banker reads in seconds, not a filing summary.
- Use only the facts given — never invent numbers, dates, or details not present in the evidence.
- No greeting, no congratulations, no assumed rapport, no phrases like "Hi" or "I wanted to reach out" — this is an internal note between colleagues, not a message to the client.`;

function mostRecentCitation(citations: FlashCard["citations"]): FlashCard["citations"][number] | null {
  if (citations.length === 0) return null;
  return [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Drafts an RM-facing flash-card body — What / Why call / Angle, one
 * sentence each — for a card's single HEADLINE trigger only (never the
 * whole dedup cluster; other triggers in the same or a different cluster
 * are the card's separate "Also active" line, not part of this prompt).
 * Falls back to the deterministic template on any failure or timeout —
 * cost-bounded at exactly one Sonnet call per card-eligible company.
 */
export async function draftEventBriefing(card: FlashCard): Promise<DraftedEventBriefing> {
  try {
    const t = card.headlineTrigger;
    const primarySource = mostRecentCitation(card.citations);
    const context = [
      `- ${t.triggerName} (${t.needType}) → ${t.mappedNeed}`,
      `  Primary source date: ${primarySource ? `${primarySource.form} filed ${primarySource.date}` : "n/a — use only a relative date if the evidence gives one"}`,
      `  Evidence: ${t.evidence ?? "n/a"}`,
    ].join("\n");

    const response = await getClient().messages.create(
      {
        model: SONNET_MODEL,
        max_tokens: 450,
        thinking: { type: "disabled" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Company: ${card.company}\nOpportunity bucket: ${card.bucket}\n\nHeadline event:\n${context}`,
          },
        ],
        tools: [
          {
            name: "submit_card_body",
            description: "Submit the three-part flash card body.",
            input_schema: {
              type: "object",
              properties: {
                what: {
                  type: "string",
                  description:
                    "One sentence, target 25 words, never over 30: what happened AND what it means, anchored to the primary source date, not an instrument list",
                },
                whyCall: {
                  type: "string",
                  description: "One sentence, target 20 words, never over 25: the specific banking-opportunity insight, not generic",
                },
                angle: {
                  type: "string",
                  description: "One sentence, target 20 words, never over 25: the specific conversation to open",
                },
              },
              required: ["what", "whyCall", "angle"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_card_body" },
      },
      { timeout: TIMEOUT_MS }
    );

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(`Sonnet did not return a submit_card_body tool call (stop_reason: ${response.stop_reason})`);
    }
    const input = toolUse.input as { what?: string; whyCall?: string; angle?: string };
    if (!input.what || !input.whyCall || !input.angle) {
      throw new Error(
        `malformed card body response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
      );
    }

    // "what" gets headroom for its mandatory date (target 25/ceiling 30);
    // whyCall/angle target 20/ceiling 25. A few words over is a prompting
    // miss worth knowing about, not worth degrading to the (much less
    // readable) template fallback for — only a truly broken response (the
    // model ignoring the limit outright) does that.
    const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
    const counts = { what: wordCount(input.what), whyCall: wordCount(input.whyCall), angle: wordCount(input.angle) };
    if (counts.what > 30 || counts.whyCall > 25 || counts.angle > 25) {
      console.warn(`[eventBriefing] ${card.company} (${card.id}) over its word ceiling:`, counts);
    }
    if (counts.what > 50 || counts.whyCall > 45 || counts.angle > 45) {
      throw new Error(`card body ignored the sentence-length limit entirely: ${JSON.stringify(counts)}`);
    }

    return { what: input.what, whyCall: input.whyCall, angle: input.angle, source: "sonnet" };
  } catch (err) {
    console.error(`[eventBriefing] Sonnet call failed for ${card.company} (${card.id}), falling back to template:`, err);
    return templateEventBriefing(card);
  }
}
