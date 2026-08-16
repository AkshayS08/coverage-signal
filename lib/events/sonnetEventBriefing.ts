import Anthropic from "@anthropic-ai/sdk";
import type { FlashCard } from "./buildEvents";
import type { VerifiedFact } from "./factBase";
import { quoteFallbackBriefing, failedEventBriefing, type DraftedEventBriefing } from "./eventBriefing";
import { checkNumbersAgainstQuotes } from "./numberGuard";
import { isScrapeShapedText } from "./scrapeGuard";
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

// Exported so lib/cache/wordingCache.ts can hash EXACTLY what Sonnet will
// see when building the wording-cache key — no logic here changes.
export function buildContext(card: FlashCard, factBase: VerifiedFact[]): string {
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

/** Session 13 Part A: this word ceiling used to be a hard throw inside callSonnet, bypassing the accuracy/shape retry entirely — diagnosed as a long-tail problem (word counts observed 26-58 across repeated real drafts of the same card, not "reliably near the ceiling"), so it's now folded into the SAME retry pipeline as numberGuard/scrapeGuard (see bodyPassesGuard below) instead of throwing on its own. */
const HARD_WORD_LIMIT = 45;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export interface WordCounts {
  what: number;
  whyCall: number;
  angle: number;
}

export function wordCounts(body: RawCardBody): WordCounts {
  return { what: wordCount(body.what), whyCall: wordCount(body.whyCall), angle: wordCount(body.angle) };
}

/** True when any part ignored the sentence-length limit entirely (not the soft 30-word target — this is the hard failure threshold). */
export function overWordCeiling(counts: WordCounts): boolean {
  return counts.what > HARD_WORD_LIMIT || counts.whyCall > HARD_WORD_LIMIT || counts.angle > HARD_WORD_LIMIT;
}

export interface GuardFailure {
  unverifiedTokens: string[];
  scrapeShaped: boolean;
  overCeiling: boolean;
  counts: WordCounts;
}

/**
 * Composes the ONE retry's correction instruction from whichever check(s)
 * failed — never assumes it was a numbers problem (the old hardcoded
 * message always said "stated a number... not found," even when the real
 * issue was purely length). Real diagnosed pattern this fixes: every
 * observed retry came out LONGER than the first attempt, because the old
 * correction note never mentioned length at all when only the accuracy
 * check had failed — length regressions went uncorrected by construction.
 */
export function buildCorrectionInstruction(guard: GuardFailure): string {
  const parts: string[] = [];
  if (guard.unverifiedTokens.length > 0) {
    parts.push(
      `it stated a number, rate, or date not found in any of the facts given (${guard.unverifiedTokens.join(", ")}) — rewrite using ONLY figures and dates literally present in the facts, even if that makes a sentence less specific`
    );
  }
  if (guard.scrapeShaped) {
    parts.push(`one or more parts read as raw data (numbers/labels with no sentence structure) rather than a written sentence — write full, grammatical sentences`);
  }
  if (guard.overCeiling) {
    parts.push(
      `it ran over the ${HARD_WORD_LIMIT}-word hard limit (what=${guard.counts.what}, whyCall=${guard.counts.whyCall}, angle=${guard.counts.angle}) — rewrite ALL THREE parts to fit the 25-30 word target, cutting supporting detail first, never the sentence's one anchor date`
    );
  }
  return parts.join("; also, ");
}

async function callSonnet(card: FlashCard, factBase: VerifiedFact[], correctionInstruction?: string): Promise<RawCardBody> {
  const context = buildContext(card, factBase);
  const userContent = correctionInstruction ? `${context}\n\nYour previous attempt had a problem: ${correctionInstruction}` : context;

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

  // Target 25 words per part, hard outer limit 30. Only warns at the outer
  // limit — never trims or rejects a clear-but-longer line here. The HARD
  // ceiling (45) is checked and retried by the caller (bodyPassesGuard),
  // not here — this function never throws for length, only for a
  // genuinely malformed response.
  const counts = wordCounts({ what: input.what, whyCall: input.whyCall, angle: input.angle });
  if (counts.what > 30 || counts.whyCall > 30 || counts.angle > 30) {
    console.warn(`[eventBriefing] ${card.company} (${card.id}) over its word ceiling:`, counts);
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
 * After drafting, a deterministic guard (bodyPassesGuard) checks three
 * things: every $-amount/rate/date across What/Why/Angle AND the
 * also-active line traces to the full fact base (numberGuard.ts); no part
 * reads as scrape-shaped raw data (scrapeGuard.ts); no part is over the
 * 45-word hard ceiling (Session 13 Part A — folded in here rather than
 * thrown as its own error, after diagnosing the failure as high run-to-run
 * variance in draft length, not a systematically-too-tight ceiling). A
 * first miss on any of the three gets ONE corrective retry whose
 * instruction addresses whichever check(s) actually failed
 * (buildCorrectionInstruction) — a second miss falls back to
 * quoteFallbackBriefing (the headline's own verified quote, a real
 * passing card, never truncated, never template prose). An outright API
 * failure (timeout, malformed response) is a loud failure
 * (failedEventBriefing), never a silent template degrade. Cost-bounded at
 * one or two Sonnet calls per card-eligible company.
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

  // Combined accuracy + shape gate: a body only passes if every figure
  // traces to a verified fact AND none of its three parts is scrape-shaped
  // text (numbers/labels with no sentence structure — see scrapeGuard.ts).
  // Sonnet is instructed to always write full sentences, so the second
  // check is defensive, not the primary path — but "ANY string bound for
  // display" (Part C's own scope) includes Sonnet's own output, not just
  // the fallbacks.
  const bodyPassesGuard = (body: RawCardBody): { ok: boolean; unverifiedTokens: string[]; scrapeShaped: boolean; overCeiling: boolean; counts: WordCounts } => {
    const numberGuard = checkNumbersAgainstQuotes(auditText(body), factTexts);
    const scrapeShaped = isScrapeShapedText(body.what) || isScrapeShapedText(body.whyCall) || isScrapeShapedText(body.angle);
    const counts = wordCounts(body);
    const overCeiling = overWordCeiling(counts);
    return { ok: numberGuard.ok && !scrapeShaped && !overCeiling, unverifiedTokens: numberGuard.unverifiedTokens, scrapeShaped, overCeiling, counts };
  };

  try {
    let body = await callSonnet(card, factBase);
    let guard = bodyPassesGuard(body);

    if (!guard.ok) {
      const instruction = buildCorrectionInstruction(guard);
      console.warn(`[eventBriefing] ${card.company} (${card.id}) retrying once: ${instruction}`);
      body = await callSonnet(card, factBase, instruction);
      guard = bodyPassesGuard(body);
    }

    if (!guard.ok) {
      console.error(
        `[eventBriefing] ${card.company} (${card.id}) still failed after retry (${guard.overCeiling ? "over the word ceiling" : "accuracy/shape"}), falling back to the strongest single fact:`,
        guard.overCeiling ? guard.counts : guard.unverifiedTokens
      );
      return quoteFallbackBriefing(card);
    }

    return { ...body, source: "sonnet" };
  } catch (err) {
    // This is the exact failure mode this project has hit three times now
    // (max_tokens truncation, a deprecated temperature param, and the
    // Session 10 template fallback on HCA/Concentra cards going unnoticed)
    // — it must never again be a silent degrade. Loud failure only.
    return failedEventBriefing(card, err instanceof Error ? err.message : String(err));
  }
}
