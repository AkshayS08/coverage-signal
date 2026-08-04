import Anthropic from "@anthropic-ai/sdk";
import type { Bucket } from "./buckets";
import type { CompanyPortfolio } from "./buildEvents";
import { templateCompanySummary, type DraftedCompanySummary } from "./companySummary";

// Deliberately NOT re-exported from lib/events/index.ts — pulls in the
// Anthropic SDK, same isolation pattern as sonnetEventBriefing.ts. Only a
// server-only caller (app/api/run/route.ts) imports this by direct path.

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 10000;
const BUCKET_ORDER: Bucket[] = ["treasury", "new_debt", "refi", "hedging"];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Drafts the portfolio table's per-company synthesis, via a single Sonnet
 * call — but ONLY for companies with zero card-eligible events. A company
 * that has a flash card reuses that card's own already-drafted summary
 * instead (see page.tsx), so this never double-spends on a company that
 * already got a Sonnet call this run.
 */
export async function draftCompanySummary(portfolio: CompanyPortfolio): Promise<DraftedCompanySummary> {
  try {
    const bucketContext = BUCKET_ORDER.map((bucket) => {
      const events = portfolio.buckets[bucket];
      if (events.length === 0) return null;
      const lines = events
        .flatMap((e) => e.triggers)
        .map((t) => `${t.triggerName} — ${t.evidence ?? "n/a"}`)
        .join("; ");
      return `${bucket}: ${lines}`;
    })
      .filter((line): line is string => line !== null)
      .join("\n");

    if (!bucketContext) return templateCompanySummary(portfolio);

    const response = await getClient().messages.create(
      {
        model: SONNET_MODEL,
        max_tokens: 400,
        thinking: { type: "disabled" },
        system:
          "You write a short internal note (2-3 sentences) for a bank relationship manager, summarizing a company's current credit/treasury signal picture across four opportunity buckets (treasury/deposits, new debt, refi, FX/rate hedging) — for a company where NONE of the signals are dated or urgent enough to warrant a call this week. This is a factual 'nothing urgent, here's the state of things' note, not a sales pitch: no greeting, no congratulations, no assumed rapport. Use only the facts given — never invent numbers or dates not present in the evidence.",
        messages: [
          {
            role: "user",
            content: `Company: ${portfolio.company}\n\nSignals by bucket:\n${bucketContext}`,
          },
        ],
        tools: [
          {
            name: "submit_company_summary",
            description: "Submit the per-company portfolio summary.",
            input_schema: {
              type: "object",
              properties: {
                text: { type: "string", description: "2-3 factual sentences synthesizing the bucket picture" },
              },
              required: ["text"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "submit_company_summary" },
      },
      { timeout: TIMEOUT_MS }
    );

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(`Sonnet did not return a submit_company_summary tool call (stop_reason: ${response.stop_reason})`);
    }
    const input = toolUse.input as { text?: string };
    if (!input.text) {
      throw new Error(
        `malformed company summary response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
      );
    }

    return { text: input.text, source: "sonnet" };
  } catch (err) {
    console.error(`[companySummary] Sonnet call failed for ${portfolio.company}, falling back to template:`, err);
    return templateCompanySummary(portfolio);
  }
}
