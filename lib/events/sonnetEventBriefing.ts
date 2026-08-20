import Anthropic from "@anthropic-ai/sdk";
import { dedupeCitations, type FlashCard } from "./buildEvents";
import type { VerifiedFact } from "./factBase";
import { failedEventBriefing, type DraftedEventBriefing } from "./eventBriefing";
import { checkNumbersAgainstQuotes, countDistinctFactsReferenced, factsReferencedIn, isFullyExplainedByOneFact } from "./numberGuard";
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
// action, the synthesis for why now, and the supporting facts. It never
// picks the headline, never invents a bucket, and never states a figure
// that isn't already in the fact list handed to it.
// ============================================================================

const SONNET_MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 12000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You write ONE flash card for a bank relationship manager (RM) — a weekly briefing on who to call and why. The card leads with the CALL, not a description of what happened: an RM reading it in 5 seconds must know what to DO, not just what occurred. This is banker judgment applied to a fixed set of facts, not fact-finding — the headline event, its bucket, and its timing are ALREADY DECIDED by the system before you're called; your job is to write the call well, never to pick a different one.

You will be given:
- The HEADLINE EVENT — the one fact this card is about. Shown as both a verified quote and its own evidence sentence (a plain-English paraphrase, already properly scaled — "$1.5 billion," never a bare unscaled number). The specific amounts and dates you need are usually easiest to read off the evidence sentence.
- OTHER VERIFIED FACTS about the same company — everything else confirmed true about them right now, each with its own evidence sentence too. Weave one in ONLY when it is what makes the headline live THIS WEEK — never because it's merely available.

Write exactly three fields:

- callAbout: the ACTION, one imperative line, and it MUST name the amount or the date of the thing being called about — a call with neither is not specific enough. "Refinance the $1.5 billion notes due November 2027." — not "debt maturity approaching" and not just "refinance the notes." If the headline fact genuinely has no verifiable dollar amount (never guess one), name the date instead — a date alone is enough, but never neither. Describe timing in plain terms the person on the other end of the call would recognize — "15 months out," never "inside the 15-month refi window" or any other named threshold. The 18-month refi cutoff is this system's own internal rule for what's worth a card at all; it is not a market term, and stating it as one implies a convention that doesn't exist. Write it as a complete sentence, ending in a period, exactly like whyNow and every keyPoints bullet — an imperative line is still a sentence.

- whyNow: the synthesis — what makes THIS WEEK the moment, not just what happened. One sentence; a second short sentence is allowed only to keep two distinct facts clean, never as extra room for detail. MUST connect the headline event to at least one OTHER given fact that explains why it's live now (a related disclosure, a stated market condition, a second dated event) — a sentence that only restates the headline event, however detailed, is description, not synthesis, and description is exactly what this format replaces. If nothing in the other verified facts genuinely explains why now, do not invent a connection or pad with unrelated detail — write the truest version you can with what you have; a structural check downstream decides whether it qualifies, that is not your call to route around.

- keyPoints: 2 to 4 bullets, plain facts in the same register the portfolio table uses — one fact and its own figure or date per bullet, nothing more. The FIRST bullet must be the fact that triggered this card (the headline event itself — the maturity, the announced deal, the proceeds). The rest are supporting facts, each still standing on its own. A bullet states what IS true; it never explains what one fact means for another. Do not write "which gives them a window to," "so the same approach can be," "before it competes with," or any other sentence connecting two facts together — that connective work belongs in whyNow, and only there. If you find yourself writing "so," "which means," "giving them," or "before" to link two bullets' worth of information into one, you have written a whyNow sentence by accident; split it back into two separate, unconnected facts instead.

THE FACTUAL SOURCE — read before writing anything:
- Every number, date, rate, and dollar amount you state must appear, verbatim or in an obviously equivalent form, in the HEADLINE EVENT or the OTHER VERIFIED FACTS you were given — their quotes OR their evidence sentences, either is a valid source. Nothing from general knowledge, nothing computed, nothing rounded to a different figure than given, nothing carried over from a different company.
- State figures EXACTLY as a given fact states them — never add two stated figures together, never round one, never state a total the fact itself doesn't state, even when it feels like it would describe "the full picture" better. This comes up most often when a fact describes a balance that changed in steps (e.g. paid down in two pieces) and also states what's left: use ONLY the stated remaining/outstanding figure, never a sum of the pieces that came before it. Concrete example — a fact reading "...$1.0 billion redeemed, then $500 million redeemed; $568.7 million remains outstanding" must be described as "$568.7 million," never as "$1.5 billion," "$2.0 billion," or any other total you arrive at by adding. A figure you calculate, even from real numbers actually in the facts, is not a figure you were given — if you catch yourself doing arithmetic to produce a number, stop and use the one figure the fact already states instead.
- If a fact's own date is a duration without a calendar date, describe it using the duration and whatever date IS given — never calculate a derived calendar date yourself.

Hard rules:
- Do NOT contradict the bucket or timing you were told is already decided — write the call, don't second-guess the decision.
- Plain English a banker — and a newcomer reading over their shoulder — would understand in seconds. No filing-summary phrasing, no unexplained jargon (banned unless explained: "liability management," "amend-and-extend," "term loan B add-on," and similar insider phrasing).
- Never enumerate every tranche/instrument in one bullet — one bullet per fact, describe the pattern, not the list.
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
          "One imperative line, written as a complete sentence ending in a period: the action to take, never a description of an event. Must name the verified amount or date of the thing being called about — a date alone is fine when no figure is verifiable, but never neither. State timing in plain terms ('N months out'), never as a named 'window' or threshold.",
      },
      whyNow: {
        type: "string",
        description:
          "One sentence (two only if needed to keep two distinct facts clean): the synthesis connecting the headline event to at least one other given fact that makes it live this week.",
      },
      keyPoints: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
        description:
          '2 to 4 plain-fact bullets, one fact with its own figure/date per bullet. The first bullet must be the headline fact itself. No bullet may connect two facts together (no \'which gives them\', \'so the same approach\', \'before it competes with\') — that belongs in whyNow only. MUST be a genuine JSON array of plain strings — exactly like callAbout and whyNow are plain strings, each array ELEMENT is one plain string, e.g. ["First fact and its figure.", "Second fact and its figure."] — never a single string, never XML or any other markup.',
      },
    },
    required: ["callAbout", "whyNow", "keyPoints"],
  },
};

export interface RawCardBody {
  callAbout: string;
  whyNow: string;
  keyPoints: string[];
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
    `HEADLINE EVENT (the card's subject — CALL ABOUT and WHY NOW must be built around this, and it must be keyPoints' first bullet):`,
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
  const input = toolUse.input as { callAbout?: string; whyNow?: string; keyPoints?: unknown };
  const keyPoints = parseKeyPoints(input.keyPoints);
  if (!input.callAbout || !input.whyNow || keyPoints.length === 0) {
    throw new Error(
      `malformed card body response (stop_reason: ${response.stop_reason}, output_tokens: ${response.usage.output_tokens}): ${JSON.stringify(input)}`
    );
  }

  return { callAbout: input.callAbout, whyNow: input.whyNow, keyPoints };
}

/**
 * Session 17 Item 17: despite the schema declaring keyPoints as a JSON
 * array of strings, Sonnet occasionally returns it as a single string
 * with pseudo-XML item tags instead — observed live, verbatim, on Tenet's
 * and Quest's real cards this session: `"\n<item>...</item>\n<item>...
 * </item>\n</keyPoints>\n"`. The CONTENT inside each tag is still
 * genuinely Sonnet's own authored bullet — only the envelope is wrong —
 * so this extracts it rather than discarding a correct answer over a
 * formatting slip. This is not a content fallback (nothing here writes
 * or guesses any text): every extracted bullet still passes through the
 * exact same checkCardStructure guard as a normal array response, so a
 * malformed envelope can never bypass verification, it just isn't
 * wastefully thrown away either. Anything that isn't a genuine array and
 * doesn't match this one observed shape still returns [], which still
 * fails loudly via the empty-keyPoints check above.
 */
export function parseKeyPoints(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  }
  if (typeof raw === "string") {
    const items = [...raw.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1].trim()).filter(Boolean);
    return items;
  }
  return [];
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
 * Session 17 Item 17 adds three more checks for keyPoints, all structural
 * in the same spirit — never a scan for connective WORDS ("so," "which
 * gives them"), since Standing Rule 2 explicitly warns that catches the
 * wrong sentences. Instead: (a) 2-4 bullets, each non-empty, (b) each
 * bullet references AT MOST ONE distinct fact — the exact inverse of
 * whyNow's "at least 2" requirement below, and the same
 * countDistinctFactsReferenced machinery; a bullet whose tokens match two
 * different facts is, structurally, connecting them, which is exactly
 * what a bullet must never do, (c) the first bullet's tokens trace back to
 * the HEADLINE fact specifically (factsReferencedIn, Item 4's fix) — not
 * just any fact.
 */
export function checkCardStructure(body: RawCardBody, factBase: VerifiedFact[], headlineTriggerId?: string): StructuralGuardResult {
  const reasons: string[] = [];

  if (!body.callAbout.trim()) reasons.push("callAbout is empty");
  if (!body.whyNow.trim()) reasons.push("whyNow is empty");
  const keyPoints = body.keyPoints.map((k) => k.trim()).filter(Boolean);
  if (keyPoints.length === 0) reasons.push("keyPoints is empty");
  else if (keyPoints.length < 2) reasons.push(`keyPoints has only ${keyPoints.length} bullet — needs 2 to 4`);
  else if (keyPoints.length > 4) reasons.push(`keyPoints has ${keyPoints.length} bullets — needs 2 to 4`);

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
  const auditText = `${body.callAbout} ${body.whyNow} ${keyPoints.join(" ")}`;
  const numberGuard = checkNumbersAgainstQuotes(auditText, accuracyCorpus);
  if (!numberGuard.ok) {
    reasons.push(`stated a number, rate, or date not found in any given fact (${numberGuard.unverifiedTokens.join(", ")})`);
  }

  if (isScrapeShapedText(body.callAbout) || isScrapeShapedText(body.whyNow) || keyPoints.some((k) => isScrapeShapedText(k, "bullet"))) {
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

  // Session 17 Item 17: no keyPoints bullet may assert a relationship
  // between two facts. NOT plain token-overlap counting (countDistinct-
  // FactsReferenced) — a company's own RELATED facts routinely restate
  // the same figures from a different angle (confirmed live: Tenet's
  // debt-maturity evidence lists its own tranche ladder, which happens to
  // include the exact "$1.5 billion due 2032"/"$750 million due 2033"
  // figures new-debt-issuance's evidence also states, since they're the
  // same notes described two ways) — so a bullet naming only ONE fact's
  // own figures can still token-overlap a SECOND, unrelated fact by
  // coincidence. The real question is whether some SINGLE fact fully
  // accounts for the bullet (isFullyExplainedByOneFact, Item 17's fix) —
  // only a bullet no single fact can fully explain is genuinely combining
  // two.
  const multiFactBullets = keyPoints.filter((k) => !isFullyExplainedByOneFact(k, factBase));
  if (multiFactBullets.length > 0) {
    reasons.push(`${multiFactBullets.length} keyPoints bullet(s) are not fully explained by any single fact — a bullet states one fact, it never connects two`);
  }

  // Session 17 Item 17: the FIRST bullet must be the fact that triggered
  // the card — checked by tracing its tokens back to the headline fact
  // specifically (factsReferencedIn, Item 4's own fix), not just any fact
  // in the base.
  if (headlineTriggerId && keyPoints.length > 0) {
    const firstBulletFacts = factsReferencedIn(keyPoints[0], factBase);
    if (!firstBulletFacts.some((f) => f.linkedTriggerId === headlineTriggerId)) {
      reasons.push("the first keyPoints bullet does not reference the headline fact — it must lead with the fact that triggered this card");
    }
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
 * Drafts an RM-facing flash-card body — CALL ABOUT / WHY NOW / KEY POINTS.
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
    let guard = checkCardStructure(body, factBase, card.headlineTrigger.triggerId);

    if (!guard.ok) {
      const instruction = buildCorrectionInstruction(guard);
      console.warn(`[eventBriefing] ${card.company} (${card.id}) retrying once: ${instruction}`);
      body = await callSonnet(card, factBase, instruction);
      guard = checkCardStructure(body, factBase, card.headlineTrigger.triggerId);
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

    // Session 17 Item 4: the card's citation set is the union of citations
    // across every VERIFIED FACT the drafted text actually draws a number/
    // date/rate from — never just the headline trigger's own citations,
    // and never a dedup-cluster union either (debt-maturity facts routinely
    // have no 8-K citation of their own, so they can never cluster with the
    // new-debt-issuance fact WHY NOW might legitimately reference — a
    // cluster-based union would still have missed exactly the case this
    // was written for). The headline fact's own citations are always
    // included regardless, since callAbout is required to name one of its
    // own figures/dates.
    const cardText = `${body.callAbout} ${body.whyNow} ${body.keyPoints.join(" ")}`;
    const referencedFacts = factsReferencedIn(cardText, factBase);
    const citations = dedupeCitations([...headlineFact.citations, ...referencedFacts.flatMap((f) => f.citations)]);

    return { ...body, source: "sonnet", citations };
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
