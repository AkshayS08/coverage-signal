import Anthropic from "@anthropic-ai/sdk";
import type { ProceedsUse } from "./claude";

// SONNET, not Haiku — a single narrow classification task, not narration
// (see the ProceedsUse doc comment in claude.ts for why this moved here).
// Mirrors lib/events/sonnetEventBriefing.ts's calling pattern (model,
// thinking disabled, forced tool call, no temperature — Sonnet rejects it).
const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 12000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You classify exactly one thing: how a company used the proceeds from a debt or equity issuance. This is a single narrow classification, not a summary and not narration.

You are given the FULL TEXT of the filing(s) that cite this issuance, plus a short "evidence" pointer and a "quote" that only identify WHICH issuance you're classifying — the pointer/quote are often just the opening announcement sentence ("issued $X of Y% notes") and do NOT necessarily contain the use-of-proceeds language themselves. You must SEARCH THE FULL FILING TEXT for any sentence describing how proceeds were or will be used — it is frequently a few sentences after the announcement, sometimes in a different paragraph, an adjacent 8-K item, or a note elsewhere in a 10-Q/10-K. Do not classify "unstated" just because the short evidence/quote pointer alone doesn't mention it — check the whole filing text first.

First ask yourself: does the FULL FILING TEXT describe where the proceeds went, in any form, AT ALL, anywhere? If yes — even briefly, even if it's just "repay the revolver" — you MUST classify refinancing_only or partly_unapplied, never unstated. "unstated" is ONLY for when the full filing text is genuinely SILENT on use of proceeds — it does not mean "the description is short," "it also mentions fees," or "I'm not 100% sure how to categorize one clause." A real description of debt repayment is not disqualified by also mentioning the offering's own transaction costs.

Classify as exactly one of:
- "refinancing_only" — every stated use of the proceeds is redeeming or repaying existing debt/facilities. Ordinary issuance costs ("fees and expenses" of the offering itself) do NOT change this — they're the normal cost of raising the money, not a discretionary use of it, and do not make an otherwise-clean repayment description "unstated" or "partly_unapplied."
  Example: "proceeds used to redeem $400 million of existing notes, repay $100 million on the revolving credit facility, and pay fees and expenses" -> refinancing_only. (100% of the money's disclosed destination is debt repayment; the fee mention is transaction cost, not a separate use.)
- "partly_unapplied" — the text states proceeds went, wholly or partly, to something OTHER than debt/facility repayment — general corporate purposes, an acquisition, capex, or anything else not itself a repayment.
  Example: "net proceeds used to repay commercial paper borrowings and for general corporate purposes" -> partly_unapplied. (Commercial paper repayment IS debt repayment, but "general corporate purposes" is an explicit second, non-repayment use — that one phrase is enough to make this partly_unapplied, not refinancing_only and not unstated.)
- "unstated" — the text does NOT describe where the proceeds went. Nothing about repayment, general corporate purposes, or any other use is mentioned at all.
  Example: "the Company completed the issuance and sale of $500 million in aggregate principal amount of Notes" (with no further sentence about use of proceeds anywhere in the text given) -> unstated.

Read only what the text states. Never guess or infer beyond it — but do not under-read it either: a clear repayment description is refinancing_only or partly_unapplied, not unstated, even if it isn't exhaustively detailed.`;

const PROCEEDS_USE_TOOL = {
  name: "submit_proceeds_use",
  description: "Classify how the issuance's proceeds were used.",
  input_schema: {
    type: "object" as const,
    properties: {
      proceedsUse: { type: "string", enum: ["refinancing_only", "partly_unapplied", "unstated"] },
    },
    required: ["proceedsUse"],
  },
};

/**
 * One Sonnet call classifying a single fired "new debt issuance / notes
 * pricing" fact's proceedsUse — called at most once per company, only when
 * that trigger fired (see lib/agent/loop.ts). Reads the FULL text of the
 * filing(s) cited for this trigger — not just Haiku's evidence/quote —
 * because the use-of-proceeds sentence is frequently outside whatever
 * narrow excerpt Haiku happened to select as its "evidence"/"quote"
 * pointer (confirmed live: Encompass's and HCA's real 8-Ks both state use
 * of proceeds clearly, but in a run where Haiku's own evidence/quote
 * captured only the opening "issued $X" sentence, a classifier reading
 * ONLY that excerpt has no way to see it — this fetches no NEW filing,
 * it just reads the SAME already-fetched text the rest of the pipeline
 * has, instead of a narrower slice of it).
 */
export async function classifyProceedsUse(params: {
  companyName: string;
  evidence: string | null;
  quote: string | null;
  filingTexts: string[];
}): Promise<ProceedsUse> {
  const { companyName, evidence, quote, filingTexts } = params;

  const userContent = [
    `Company: ${companyName}`,
    ``,
    `Evidence (a POINTER to which issuance this is — may not itself contain the use-of-proceeds language; search the filing text below for that):`,
    evidence ?? "(none)",
    ...(quote ? [``, `Quote (also just a pointer, same caveat):`, quote] : []),
    ``,
    `## Full text of the filing(s) citing this issuance — search this for use-of-proceeds language`,
    ...filingTexts.map((text, i) => `--- filing ${i + 1} ---\n${text}`),
  ].join("\n");

  const response = await getClient().messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 200,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      tools: [PROCEEDS_USE_TOOL],
      tool_choice: { type: "tool", name: PROCEEDS_USE_TOOL.name },
    },
    { timeout: TIMEOUT_MS }
  );

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Sonnet did not return a submit_proceeds_use tool call (stop_reason: ${response.stop_reason})`);
  }
  const input = toolUse.input as { proceedsUse?: string };
  if (
    input.proceedsUse !== "refinancing_only" &&
    input.proceedsUse !== "partly_unapplied" &&
    input.proceedsUse !== "unstated"
  ) {
    throw new Error(`malformed proceedsUse response: ${JSON.stringify(input)}`);
  }
  return input.proceedsUse;
}
