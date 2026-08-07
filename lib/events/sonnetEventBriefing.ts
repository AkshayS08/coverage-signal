import Anthropic from "@anthropic-ai/sdk";
import type { FlashCard } from "./buildEvents";
import type { VerifiedFact } from "./factBase";
import { templateEventBriefing, quoteFallbackBriefing, type DraftedEventBriefing } from "./eventBriefing";
import { checkNumbersAgainstQuotes } from "./numberGuard";
import { compactLabelWithTiming } from "./labels";
import { BUCKET_LABELS } from "./buckets";

// Deliberately NOT re-exported from lib/events/index.ts — this file pulls
// in the Anthropic SDK, and the barrel is meant to be safe for the client
// bundle (mirrors lib/rank/sonnetBriefing.ts's split). Only server-only
// callers (app/api/run/route.ts, the console test script) import this by
// direct path.

// ============================================================================
// DIVISION OF LABOR (the architecture this file is built around):
//
// DETERMINISTIC CODE DECIDES — none of this is Sonnet's call, and nothing
// below asks Sonnet to make these decisions:
//   - which trigger is the headline (buildEvents.ts's urgency sort)
//   - the card's bucket/secondaryBucket tag
//   - card eligibility and the freshness gate
//   - which OTHER events route to "also active" vs. the portfolio table
//   - which facts are VERIFIED at all (lib/agent/verifyQuote.ts + factBase.ts)
//
// SONNET NARRATES — given the headline event and the company's full
// verified fact list (both already decided), it sequences the story,
// judges which other facts are directly relevant context, and writes the
// prose. It never picks the headline, never invents a bucket, and never
// states a figure that isn't already in the fact list handed to it.
// ============================================================================

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 12000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You write the body of one flash card for a bank relationship manager (RM) — a weekly briefing on who to call and why. A banker must grasp the call in 5 seconds, so you synthesize — you never list tranches, dates, or numbers one by one. This is banker judgment applied to a fixed set of facts, not fact-finding: the headline event, the tag, and the timing are ALREADY DECIDED by the system before you're called — your job is to narrate that decision well, not to pick a different one.

You will be given:
- The HEADLINE EVENT — the one fact this card is about. What must open with it.
- OTHER VERIFIED FACTS about the same company — everything else confirmed true about them right now. Most of these are NOT part of this card's story. Weave one in only when it's directly, narratively relevant to the headline (a prior redemption that explains why this maturity is the next one to clear; a related amendment to the same facility) — never because it's merely available. An unrelated fact (a buyback, an unconnected acquisition) does not belong here even if it's true; it surfaces elsewhere in the product.

Write exactly three parts:
- what: opens with the headline event, in plain English a non-banker could follow, anchored to its date. State the primary source date given, then explain what happened and what it means. If a directly relevant other fact adds real context (why this is the next domino, what was already resolved), weave it in as one clause — don't bolt on an unrelated fact just to sound fuller. Never use unexplained jargon — banned: "liability management," "layered [a facility]," "amend-and-extend," "term loan B add-on," and similar insider phrasing; explain any technical term you can't avoid. Never enumerate every tranche/instrument — describe the pattern, not the list.
- whyCall: the banking-opportunity insight, grounded in this company's own facts (the headline event, plus relevant context if it strengthens the logic) — never a generic statement that could apply to any company. This is judgment, not restatement: explain WHY the story you just told means it's time to call.
- angle: the specific conversation to open, tied to this company's specifics — never boilerplate like "explore treasury needs." Should reference the actual event/number/timing so the line could only be said about this company.

THE FACTUAL SOURCE — read this before writing anything:
- Every number, date, rate, and dollar amount you state must appear, verbatim or in an obviously equivalent form, somewhere in the HEADLINE EVENT or the OTHER VERIFIED FACTS you were given. Nothing from general knowledge, nothing computed, nothing rounded to a different figure than what's given, nothing carried over from a different company.
- Synthesis, framing, sequencing, and judgment are exactly what you're here for — none of that requires inventing a new number or date, only connecting and interpreting the ones you were given.
- If a fact's own date is a duration without a calendar date, describe it using the duration and whatever date IS given — never calculate a derived calendar date yourself.

Date anchoring — applies to every part:
- The ONE fact each sentence is actually about must be anchored to its own exact date (as given), never a bare relative window. Wrong: "matures in under a year." Right: "matures March 2027 (under a year out)."
- A synthesized pattern across facts needs at most ONE anchor date — the one the sentence is actually built around — not a date for every fact folded in.
- Never comma-splice two distinct dated facts into one clause. If a part genuinely needs two distinct dated facts and neither can be dropped, use two short sentences, one fact each — but prefer the single most decision-relevant date over stretching to fit both.

Hard rules:
- One sentence per part by default; a second short sentence is allowed only to keep two distinct dated facts clean — never as extra room for more detail. Target 25 words, hard outer limit 30 — a genuinely necessary second dated fact may push a part to the ceiling, that's expected, not a defect. Before answering, count the words; if over the limit, cut supporting detail first, never cut the sentence's one anchor date.
- Do NOT contradict the bucket/tag or timing you were told is already decided — narrate them, don't second-guess them.
- Plain English a banker — and a newcomer reading over their shoulder — would understand in seconds. No filing-summary phrasing, no jargon.
- No greeting, no congratulations, no assumed rapport, no phrases like "Hi" or "I wanted to reach out" — this is an internal note between colleagues, not a message to the client.`;

const CARD_BODY_TOOL = {
  name: "submit_card_body",
  description: "Submit the three-part flash card body.",
  input_schema: {
    type: "object" as const,
    properties: {
      what: {
        type: "string",
        description:
          "One sentence (two only if needed to keep two distinct dated facts from being comma-spliced), target 25 words, hard outer limit 30: opens with the headline event in plain English, no unexplained jargon, weaving in directly-relevant other facts only — every number/date traceable to the facts given, never an itemized list of each instrument/amendment",
      },
      whyCall: {
        type: "string",
        description:
          "One sentence, target 20-25 words, hard outer limit 30: the specific banking-opportunity insight — why THIS story means call now — naming this company's own facts and exact dates from what was given, never phrasing generic enough to fit another company",
      },
      angle: {
        type: "string",
        description:
          "One sentence, target 20-25 words, hard outer limit 30: the specific conversation to open, naming this company's own facts from what was given, never phrasing generic enough to fit another company",
      },
    },
    required: ["what", "whyCall", "angle"],
  },
};

interface RawCardBody {
  what: string;
  whyCall: string;
  angle: string;
}

// normalizedText, not verifiedText: a table-sourced fact's bare figures
// ("1,500") are already resolved to their scale-normalized dollar form
// ("$1.5 billion") wherever the filing's own scale declaration made that
// safely determinable (scaleNormalize.ts) — this is "the stateable
// figure" Sonnet is meant to write, not a number it would have to guess
// the units of.
function formatFact(f: VerifiedFact): string {
  const sourceStr = f.sourceFiling ? `${f.sourceFiling.form} filed ${f.sourceFiling.date}` : "n/a";
  return `- ${f.fact}: "${f.normalizedText}" (source: ${sourceStr})`;
}

function buildContext(card: FlashCard, factBase: VerifiedFact[]): string {
  const headlineFact = factBase.find((f) => f.linkedTriggerId === card.headlineTrigger.triggerId);
  const otherFacts = factBase.filter((f) => f !== headlineFact);

  const tagLabel = [BUCKET_LABELS[card.bucket], card.secondaryBucket ? BUCKET_LABELS[card.secondaryBucket] : null]
    .filter(Boolean)
    .join(" + ");
  const timingLabel = compactLabelWithTiming(card.headlineTrigger.triggerId, card.headlineTrigger.triggerName, card.timing);

  const lines = [
    `Company: ${card.company}`,
    `Bucket/tag (already decided — narrate it, do not contradict it): ${tagLabel}`,
    `Timing (already decided): ${timingLabel}`,
    ``,
    `HEADLINE EVENT (the card's subject — "what" must open with this):`,
    headlineFact
      ? formatFact(headlineFact)
      : `- ${card.headlineTrigger.triggerName}: "${card.headlineTrigger.verifiedQuoteNormalized ?? card.headlineTrigger.verifiedQuote ?? "n/a"}"`,
  ];

  if (otherFacts.length > 0) {
    lines.push(
      ``,
      `OTHER VERIFIED FACTS about this company (weave in ONLY if directly relevant context to the headline — otherwise ignore, they surface elsewhere):`,
      ...otherFacts.map(formatFact)
    );
  }

  return lines.join("\n");
}

async function callSonnet(card: FlashCard, factBase: VerifiedFact[], correctionNote?: string): Promise<RawCardBody> {
  const context = buildContext(card, factBase);
  const userContent = correctionNote
    ? `${context}\n\nYour previous attempt stated a number, rate, or date not found in any of the facts above: ${correctionNote}. Rewrite all three parts using ONLY figures and dates that are literally present in the facts given — drop anything you can't source from them, even if that makes a sentence less specific.`
    : context;

  const response = await getClient().messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 500,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      tools: [CARD_BODY_TOOL],
      tool_choice: { type: "tool", name: CARD_BODY_TOOL.name },
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

  // Target 25 words per part, hard outer limit 30 across all three. Only
  // warns at the outer limit — never trims or rejects a clear-but-longer
  // line. Only a truly broken response (the model ignoring the limit
  // outright) is rejected here; the fact-accuracy audit (checked by the
  // caller, against the full fact base) is a separate, factual check.
  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const counts = { what: wordCount(input.what), whyCall: wordCount(input.whyCall), angle: wordCount(input.angle) };
  if (counts.what > 30 || counts.whyCall > 30 || counts.angle > 30) {
    console.warn(`[eventBriefing] ${card.company} (${card.id}) over its word ceiling:`, counts);
  }
  if (counts.what > 45 || counts.whyCall > 45 || counts.angle > 45) {
    throw new Error(`card body ignored the sentence-length limit entirely: ${JSON.stringify(counts)}`);
  }

  return { what: input.what, whyCall: input.whyCall, angle: input.angle };
}

/** Deterministic text for the card's "also active" line — same rendering the UI uses (labels.ts) — included in the audit alongside What/Why/Angle even though it's never model-generated, per the spec's "audit the entire card text" requirement. */
function alsoActiveAuditText(card: FlashCard): string {
  return card.alsoActive
    .map((item) => compactLabelWithTiming(item.trigger.triggerId, item.trigger.triggerName, item.timing))
    .join(" · ");
}

/**
 * Drafts an RM-facing flash-card body — What / Why call / Angle, one
 * sentence each. The headline, tag, timing, and also-active routing are
 * ALL decided before this function is ever called (buildEvents.ts); this
 * only narrates. Sonnet receives the company's full verified fact base
 * (factBase.ts) — not just the headline's own quote — so it can weave in
 * directly relevant context (a prior redemption, a related amendment) the
 * way a banker would tell the story, while still being unable to state
 * any figure that isn't a verified fact for this company.
 *
 * After drafting, a deterministic audit (numberGuard.ts) checks every
 * $-amount, rate, and date across What/Why/Angle AND the also-active line
 * against the full fact base; a first miss gets one corrective retry, a
 * second miss falls back to a card built from the headline's own single
 * verified fact only (the strongest single fact, not a synthesized
 * narrative). Falls back further to the deterministic template on any API
 * failure or timeout. Cost-bounded at one, two, or three Sonnet calls per
 * card-eligible company (draft, optional retry — the template fallback
 * makes no call).
 */
export async function draftEventBriefing(card: FlashCard, factBase: VerifiedFact[]): Promise<DraftedEventBriefing> {
  const headlineFact = factBase.find((f) => f.linkedTriggerId === card.headlineTrigger.triggerId);
  if (!headlineFact) {
    // Should be unreachable — a card's headline is only ever built from a
    // quote-verified trigger (see buildEvents.ts), which is exactly what
    // populates the fact base — but never draft prose with nothing
    // verified to ground it.
    console.error(`[eventBriefing] ${card.company} (${card.id}) has no matching fact in the verified fact base; using quote fallback`);
    return quoteFallbackBriefing(card);
  }

  // Both forms, unioned: normalizedText is what Sonnet was prompted with
  // (so this is the primary match path), but verifiedText (raw) stays in
  // the mix too — the audit's own scale-flexible matching (numberGuard.ts)
  // already accepts a normalized figure against a raw one or vice versa,
  // so this is redundancy for robustness, not a requirement.
  const factTexts = factBase.flatMap((f) => [f.normalizedText, f.verifiedText]);
  const auditText = (body: RawCardBody) => `${body.what} ${body.whyCall} ${body.angle} ${alsoActiveAuditText(card)}`;

  try {
    let body = await callSonnet(card, factBase);
    let guard = checkNumbersAgainstQuotes(auditText(body), factTexts);

    if (!guard.ok) {
      console.warn(
        `[eventBriefing] ${card.company} (${card.id}) stated figures not in the verified fact base, retrying once:`,
        guard.unverifiedTokens
      );
      body = await callSonnet(card, factBase, guard.unverifiedTokens.join(", "));
      guard = checkNumbersAgainstQuotes(auditText(body), factTexts);
    }

    if (!guard.ok) {
      console.error(
        `[eventBriefing] ${card.company} (${card.id}) still stated unverifiable figures after retry, falling back to the strongest single fact:`,
        guard.unverifiedTokens
      );
      return quoteFallbackBriefing(card);
    }

    return { ...body, source: "sonnet" };
  } catch (err) {
    console.error(`[eventBriefing] Sonnet call failed for ${card.company} (${card.id}), falling back to template:`, err);
    return templateEventBriefing(card);
  }
}
