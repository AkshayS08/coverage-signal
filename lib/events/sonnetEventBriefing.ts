import Anthropic from "@anthropic-ai/sdk";
import type { FlashCard } from "./buildEvents";
import type { Bucket } from "./buckets";
import type { VerifiedFact } from "./factBase";
import { failedEventBriefing, type DraftedEventBriefing } from "./eventBriefing";
import { checkNumbersAgainstQuotes, countDistinctFactsReferenced } from "./numberGuard";
import { isScrapeShapedText } from "./scrapeGuard";
import { compactLabelWithTiming } from "./labels";
import { BUCKET_LABELS } from "./buckets";
import { extractFactTokens } from "../agent/factTokens";

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
// verified fact list (both already decided), it writes the CALL: the
// action, the synthesis for why now, and the opening line. It never picks
// the headline, never invents a bucket, and never states a figure that
// isn't already in the fact list handed to it.
// ============================================================================

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 12000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Session 15 Part A: bucket-specific guidance for OPEN WITH, so the phone
 * line an RM would actually say is grounded in what THIS bucket's
 * opportunity is really about — a refi conversation starts with sequencing,
 * a treasury conversation starts with where the money lands, a new-debt
 * conversation starts with facility structure, a hedging conversation
 * starts with the exposure itself.
 */
const BUCKET_ANGLE_GUIDANCE: Record<Bucket, string> = {
  refi: "This is a REFI card. OPEN WITH should focus on sequencing and timing — how this maturity fits the company's broader calendar (what comes before or after it, when to start talking), not a generic financing line.",
  treasury: "This is a TREASURY card. OPEN WITH should focus on where the proceeds or cash land — proposing a specific home for the money (an operating account, a sweep arrangement, a deposit relationship), not a generic congratulations line.",
  new_debt: "This is a NEW DEBT card. OPEN WITH should focus on structure — the specific facility type the RM is proposing (a term loan, a revolver, a bridge), not a generic 'let us help finance this' line.",
  hedging: "This is a HEDGING card. OPEN WITH should focus on the exposure just created — naming the specific new rate/FX/commodity exposure and proposing to discuss hedging it, not a generic risk-management line.",
};

const SYSTEM_PROMPT = `You write ONE flash card for a bank relationship manager (RM) — a weekly briefing on who to call and why. The card leads with the CALL, not a description of what happened: an RM reading it in 5 seconds must know what to DO, not just what occurred. This is banker judgment applied to a fixed set of facts, not fact-finding — the headline event, its bucket, and its timing are ALREADY DECIDED by the system before you're called; your job is to write the call well, never to pick a different one.

You will be given:
- The HEADLINE EVENT — the one fact this card is about. Shown as both a verified quote and its own evidence sentence (a plain-English paraphrase, already properly scaled — "$1.5 billion," never a bare unscaled number). The specific amounts and dates you need are usually easiest to read off the evidence sentence.
- Bucket-specific guidance for what OPEN WITH should focus on.
- OTHER VERIFIED FACTS about the same company — everything else confirmed true about them right now, each with its own evidence sentence too. Weave one in ONLY when it is what makes the headline live THIS WEEK — never because it's merely available.

Write exactly three fields:

- callAbout: the ACTION, one imperative line, and it MUST name the amount or the date of the thing being called about — a call with neither is not specific enough. "Refinance the $1.5 billion notes due November 2027" — not "debt maturity approaching" and not just "refinance the notes." If the headline fact genuinely has no verifiable dollar amount (never guess one), name the date instead — a date alone is enough, but never neither.

- whyNow: the synthesis — what makes THIS WEEK the moment, not just what happened. One sentence; a second short sentence is allowed only to keep two distinct facts clean, never as extra room for detail. MUST connect the headline event to at least one OTHER given fact that explains why it's live now (a related disclosure, a stated market condition, a second dated event) — a sentence that only restates the headline event, however detailed, is description, not synthesis, and description is exactly what this format replaces. If nothing in the other verified facts genuinely explains why now, do not invent a connection or pad with unrelated detail — write the truest version you can with what you have; a structural check downstream decides whether it qualifies, that is not your call to route around.

- openWith: one sentence the RM could actually say out loud on the phone, tied to this company's own specifics — never boilerplate. Follow the bucket-specific guidance you're given for what to focus on.

THE FACTUAL SOURCE — read before writing anything:
- Every number, date, rate, and dollar amount you state must appear, verbatim or in an obviously equivalent form, in the HEADLINE EVENT or the OTHER VERIFIED FACTS you were given — their quotes OR their evidence sentences, either is a valid source. Nothing from general knowledge, nothing computed, nothing rounded to a different figure than given, nothing carried over from a different company.
- State figures EXACTLY as a given fact states them — never add two stated figures together, never round one, never state a total the fact itself doesn't state, even when it feels like it would describe "the full picture" better. This comes up most often when a fact describes a balance that changed in steps (e.g. paid down in two pieces) and also states what's left: use ONLY the stated remaining/outstanding figure, never a sum of the pieces that came before it. Concrete example — a fact reading "...$1.0 billion redeemed, then $500 million redeemed; $568.7 million remains outstanding" must be described as "$568.7 million," never as "$1.5 billion," "$2.0 billion," or any other total you arrive at by adding. A figure you calculate, even from real numbers actually in the facts, is not a figure you were given — if you catch yourself doing arithmetic to produce a number, stop and use the one figure the fact already states instead.
- If a fact's own date is a duration without a calendar date, describe it using the duration and whatever date IS given — never calculate a derived calendar date yourself.

Hard rules:
- Do NOT contradict the bucket or timing you were told is already decided — write the call, don't second-guess the decision.
- Plain English a banker — and a newcomer reading over their shoulder — would understand in seconds. No filing-summary phrasing, no unexplained jargon (banned unless explained: "liability management," "amend-and-extend," "term loan B add-on," and similar insider phrasing).
- Never enumerate every tranche/instrument — describe the pattern, not the list.
- No greeting, no congratulations, no assumed rapport, no "Hi" or "I wanted to reach out" — this is an internal note between colleagues, not a message to the client.`;

const CARD_BODY_TOOL = {
  name: "submit_card_body",
  description: "Submit the three-field flash card body.",
  input_schema: {
    type: "object" as const,
    properties: {
      callAbout: {
        type: "string",
        description:
          "One imperative line: the action to take, never a description of an event. Must name the verified amount or date of the thing being called about — a date alone is fine when no figure is verifiable, but never neither.",
      },
      whyNow: {
        type: "string",
        description:
          "One sentence (two only if needed to keep two distinct facts clean): the synthesis connecting the headline event to at least one other given fact that makes it live this week.",
      },
      openWith: {
        type: "string",
        description: "One sentence the RM could say on the phone, tied to this company's own specifics, following the bucket-specific guidance given.",
      },
    },
    required: ["callAbout", "whyNow", "openWith"],
  },
};

export interface RawCardBody {
  callAbout: string;
  whyNow: string;
  openWith: string;
}

/**
 * Session 15b: includes the fact's own evidence sentence alongside the
 * verified quote — the quote is often a raw filing fragment (sometimes a
 * table row with no real sentence structure), while evidence is Haiku's
 * own plain-English paraphrase, already properly $-scaled, and is where
 * the specific amounts/dates actually live in readable form. Both are
 * shown so Sonnet can draw a stated figure/date from either; the
 * structural guard's accuracy corpus is expanded to match (see
 * checkCardStructure) so a figure sourced from evidence is never
 * incorrectly rejected as "unverified."
 */
function formatFact(f: VerifiedFact): string {
  const sourceStr = f.sourceFiling ? `${f.sourceFiling.form} filed ${f.sourceFiling.date}` : "n/a";
  const evidenceLine = f.evidence ? `\n  evidence: "${f.evidence}"` : "";
  return `- ${f.fact}: "${f.normalizedText}" (source: ${sourceStr})${evidenceLine}`;
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
    `Bucket/tag (already decided — do not contradict it): ${tagLabel}`,
    `Timing (already decided): ${timingLabel}`,
    ``,
    `OPEN WITH guidance for this bucket: ${BUCKET_ANGLE_GUIDANCE[card.bucket]}`,
    ``,
    `HEADLINE EVENT (the card's subject — CALL ABOUT and WHY NOW must be built around this):`,
    headlineFact
      ? formatFact(headlineFact)
      : `- ${card.headlineTrigger.triggerName}: "${card.headlineTrigger.verifiedQuoteNormalized ?? card.headlineTrigger.verifiedQuote ?? "n/a"}"`,
  ];

  if (otherFacts.length > 0) {
    lines.push(
      ``,
      `OTHER VERIFIED FACTS about this company (weave one into WHY NOW ONLY if it explains why the headline is live now — otherwise ignore, they surface elsewhere):`,
      ...otherFacts.map(formatFact)
    );
  }

  return lines.join("\n");
}

async function callSonnet(card: FlashCard, factBase: VerifiedFact[], correctionInstruction?: string): Promise<RawCardBody> {
  const context = buildContext(card, factBase);
  const userContent = correctionInstruction ? `${context}\n\nYour previous attempt had a problem: ${correctionInstruction}` : context;

  const response = await getClient().messages.create(
    {
      model: SONNET_MODEL,
      max_tokens: 400,
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
  const input = toolUse.input as { callAbout?: string; whyNow?: string; openWith?: string };
  if (!input.callAbout || !input.whyNow || !input.openWith) {
    throw new Error(
      `malformed card body response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
    );
  }

  return { callAbout: input.callAbout, whyNow: input.whyNow, openWith: input.openWith };
}

function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export interface StructuralGuardResult {
  ok: boolean;
  reasons: string[];
  factsReferenced: number;
}

/**
 * Session 15 Part A: replaces the old word-ceiling guard and its retry
 * loop with a HARD STRUCTURAL check — Session 12's standing rule ("a guard
 * that scans vocabulary rather than claims will reject the sentences that
 * say the opposite of what it fears") applies here too: no word list, no
 * lexical banned-phrase scan, just verifiable structural properties.
 *
 * Six checks, all structural: (1) no field is empty, (2) whyNow is at
 * most 2 sentences, (3) every number/date/rate traces to a given fact
 * (numberGuard.ts, unchanged), (4) whyNow's own tokens trace to at least 2
 * DISTINCT facts (countDistinctFactsReferenced — the mechanical proxy for
 * "is this a synthesis or a restatement"), (5) no field reads as raw
 * scrape-shaped data rather than a written sentence (scrapeGuard.ts,
 * unchanged), and (6, Session 15b Part B) callAbout names at least one
 * verified figure or date — a call with neither is exactly the
 * description-not-action pattern this format exists to kill.
 */
export function checkCardStructure(body: RawCardBody, factBase: VerifiedFact[]): StructuralGuardResult {
  const reasons: string[] = [];

  if (!body.callAbout.trim()) reasons.push("callAbout is empty");
  if (!body.whyNow.trim()) reasons.push("whyNow is empty");
  if (!body.openWith.trim()) reasons.push("openWith is empty");

  const whyNowSentences = body.whyNow.trim() ? sentenceCount(body.whyNow) : 0;
  if (whyNowSentences > 2) reasons.push(`whyNow is ${whyNowSentences} sentences — over the 2-sentence limit`);

  // Session 15b: the accuracy corpus now also includes each fact's own
  // evidence sentence, not just verifiedText/normalizedText — the quote
  // is frequently a raw filing fragment with no real sentence structure,
  // while evidence is Haiku's already-scaled paraphrase and is where a
  // stated figure/date most often actually appears in citable form (this
  // is the fix for UHS's debt-maturity card, whose own quote is a bare,
  // unscaled table cell — see Part C / draftEventBriefing's doc comment).
  const accuracyCorpus = factBase.flatMap((f) => [f.normalizedText, f.verifiedText, f.evidence ?? ""]);
  const auditText = `${body.callAbout} ${body.whyNow} ${body.openWith}`;
  const numberGuard = checkNumbersAgainstQuotes(auditText, accuracyCorpus);
  if (!numberGuard.ok) {
    reasons.push(`stated a number, rate, or date not found in any given fact (${numberGuard.unverifiedTokens.join(", ")})`);
  }

  if (isScrapeShapedText(body.callAbout) || isScrapeShapedText(body.whyNow) || isScrapeShapedText(body.openWith)) {
    reasons.push("one or more fields read as raw data (numbers/labels with no sentence structure), not a written sentence");
  }

  // ONE text per fact (normalizedText only) for the distinctness check —
  // pooling normalized+raw+evidence here would double- or triple-count a
  // single fact, since all three describe the same underlying fact.
  const distinctnessCorpus = factBase.map((f) => f.normalizedText);
  const factsReferenced = body.whyNow.trim() ? countDistinctFactsReferenced(body.whyNow, distinctnessCorpus) : 0;
  if (factsReferenced < 2) {
    reasons.push(`whyNow references only ${factsReferenced} distinct fact(s) — must connect at least 2 to count as synthesis, not description`);
  }

  // Session 15b Part B: callAbout must name the amount OR the date of
  // what it's calling about — never neither. A verified figure/date
  // already present ANYWHERE in callAbout satisfies this (checked against
  // the same accuracy corpus, so an unverified number here is caught
  // twice: once by the accuracy check above, once here as "doesn't count").
  const callAboutTokens = body.callAbout.trim() ? extractFactTokens(body.callAbout) : [];
  const callAboutHasVerifiedFigureOrDate = callAboutTokens.some(
    (tok) => (tok.kind === "money" || tok.kind === "date") && countDistinctFactsReferenced(tok.raw, accuracyCorpus) > 0
  );
  if (body.callAbout.trim() && !callAboutHasVerifiedFigureOrDate) {
    reasons.push("callAbout names no verified amount or date — every call must name what it's about, even a date alone");
  }

  return { ok: reasons.length === 0, reasons, factsReferenced };
}

export function buildCorrectionInstruction(guard: StructuralGuardResult): string {
  return guard.reasons.join("; also, ");
}

/**
 * Drafts an RM-facing flash-card body — CALL ABOUT / WHY NOW / OPEN WITH.
 * The headline, tag, timing, and also-active routing are ALL decided
 * before this function is ever called (buildEvents.ts); this only
 * narrates. Sonnet receives the company's full verified fact base
 * (factBase.ts) — not just the headline's own quote — so it can
 * genuinely synthesize (weave in a directly relevant second fact) rather
 * than merely describe the headline.
 *
 * A first miss on the structural guard gets ONE corrective retry; a
 * second miss is a loud failure (failedEventBriefing) — there is no
 * deterministic fallback of any kind. An outright API failure (timeout,
 * malformed response) is the same loud failure. Cost-bounded at one or
 * two Sonnet calls per card-eligible company.
 */
export async function draftEventBriefing(card: FlashCard, factBase: VerifiedFact[]): Promise<DraftedEventBriefing> {
  const headlineFact = factBase.find((f) => f.linkedTriggerId === card.headlineTrigger.triggerId);
  if (!headlineFact) {
    // Should be unreachable — a card's headline is only ever built from a
    // quote-verified trigger (see buildEvents.ts), which is exactly what
    // populates the fact base.
    return failedEventBriefing(card, `no matching verified fact for headline trigger ${card.headlineTrigger.triggerId}`);
  }

  try {
    let body = await callSonnet(card, factBase);
    let guard = checkCardStructure(body, factBase);

    if (!guard.ok) {
      const instruction = buildCorrectionInstruction(guard);
      console.warn(`[eventBriefing] ${card.company} (${card.id}) retrying once: ${instruction}`);
      body = await callSonnet(card, factBase, instruction);
      guard = checkCardStructure(body, factBase);
    }

    if (!guard.ok) {
      // The STORED/displayed reason is deliberately a fixed, generic
      // string, never the live guard.reasons detail — a persistently-
      // failing card (this fact combination genuinely can't pass the
      // guard) can fail a DIFFERENT specific way on every uncached retry
      // (observed live: unverifiable figures one run, insufficient
      // synthesis the next, scrape-shaped the one after that, for the
      // exact same card). Embedding that live detail in the cached-or-not
      // failureReason broke run-to-run byte-identity — determinism is the
      // point of this whole architecture, so the specific-but-unstable
      // detail goes to the log only, never into what gets displayed/cached.
      console.error(`[eventBriefing] ${card.company} (${card.id}) structural check failed after retry — detail: ${guard.reasons.join("; ")}`);
      return failedEventBriefing(card, "structural check failed after one retry");
    }

    return { ...body, source: "sonnet" };
  } catch (err) {
    // This is the exact failure mode this project has hit repeatedly
    // (max_tokens truncation, a deprecated temperature param, the Session
    // 10 template fallback) — it must never again be a silent degrade.
    // Loud failure only. Same determinism reasoning as above: the live
    // error message (which can embed timing/token counts that vary run to
    // run) is logged in full, but the stored reason is generic and stable.
    console.error(`[eventBriefing] ${card.company} (${card.id}) API call failed — detail: ${err instanceof Error ? err.message : String(err)}`);
    return failedEventBriefing(card, "narration API call failed");
  }
}
