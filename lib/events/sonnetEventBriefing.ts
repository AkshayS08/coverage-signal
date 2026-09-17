import Anthropic from "@anthropic-ai/sdk";
import { dedupeCitations, type FlashCard } from "./buildEvents";
import type { VerifiedFact } from "./factBase";
import { failedEventBriefing, type DraftedEventBriefing } from "./eventBriefing";
import { checkNumbersAgainstQuotes, citationDateGaps, countDistinctFactsReferenced, factOwnText, factsReferencedIn, isFullyExplainedByOneFact } from "./numberGuard";
import { isScrapeShapedText } from "./scrapeGuard";
import { compactLabelWithTiming } from "./labels";
import { BUCKET_LABELS } from "./buckets";
import { extractFactTokens } from "../agent/factTokens";
import { recordUsage } from "../agent/costMeter";

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
/**
 * Raised from 400 (Session 18 stage 2, Group E). E4 and E5 both add content
 * the card is REQUIRED to state — the outstanding balance as distinct from
 * the instrument's name, and a KEY POINTS bullet per carried tranche — and
 * 400 was sized before either existed. Tenet's card came back well-formed and
 * was truncated mid-structure at exactly 400 output tokens; the code
 * correctly reported a malformed body rather than accepting half a card. The
 * fix for a max_tokens stop is the token budget, never the guard that noticed
 * it.
 */
const CARD_MAX_OUTPUT_TOKENS = 700;
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

- callAbout: the ACTION, one imperative line, and it MUST name the amount or the date of the thing being called about — a call with neither is not specific enough. "Refinance the $1.5 billion notes due November 2027." — not "debt maturity approaching" and not just "refinance the notes." If the headline fact genuinely has no verifiable dollar amount (never guess one), name the date instead — a date alone is enough, but never neither. Describe timing in plain terms the person on the other end of the call would recognize — "15 months out," never "inside the 15-month refi window" or any other named threshold. STATE ONLY THE PRECISION THE FILING STATES. When the Timing line reads "matures <year>" rather than "~Nmo", the filing prints only a year and you must say the year — "due in 2027" — and must NOT compute or state a month count. Only December of that year is 16 months out, the filing says nothing about which month, and a month count there is precision no one disclosed. The 18-month refi cutoff is this system's own internal rule for what's worth a card at all; it is not a market term, and stating it as one implies a convention that doesn't exist. Write it as a complete sentence, ending in a period, exactly like whyNow and every keyPoints bullet — an imperative line is still a sentence. If the headline fact has a stated seniority (a "seniority:" line), work it in naturally — "Refinance the $1.5 billion senior secured first lien notes due November 2027" — a banker names the tranche precisely, not generically as "notes."

- whyNow: the synthesis — what makes THIS WEEK the moment, not just what happened. One sentence; a second short sentence is allowed only to keep two distinct facts clean, never as extra room for detail. MUST connect the headline event to at least one OTHER given fact that explains why it's live now (a related disclosure, a stated market condition, a second dated event) — a sentence that only restates the headline event, however detailed, is description, not synthesis, and description is exactly what this format replaces. If nothing in the other verified facts genuinely explains why now, do not invent a connection or pad with unrelated detail — write the truest version you can with what you have; a structural check downstream decides whether it qualifies, that is not your call to route around. STATE FACTS AND THEIR RELATION; DO NOT ADVISE. whyNow may say what is true and how two filed facts bear on each other — "the August revolver draw lands three months before the March maturity" — and it must stop there. It must NOT say what the company is able to do, well placed to do, or ought to do: no "ample liquidity to prefund or opportunistically refinance," no "well-positioned to address this maturity," no "gives them room to," no "should be able to." The RM reading this card is the one who forms that judgement, and a card that forms it for them is stating an opinion as though the filings contained it. The relation between two filed facts is allowed; a recommendation, a capability claim, or an evaluation is not. THIS INCLUDES AVAILABILITY. Do not say a market "is open", an option "is available", or that one event shows "the same playbook" can be run again: "showing the market is open for exactly this kind of deal" and "showing the same playbook is available to address the December 2027 notes" are both the tool telling the RM what their options are, which is the judgement the RM is paid to form. Say what happened and when, and let the RM draw that conclusion: "Quest issued $500 million of 5.00% notes in May 2026 to repay a June 2026 maturity, and $400 million comes due in December 2027" states both facts and their relation without claiming anything about what is possible now. A BALANCE IS NEVER THE WHY-NOW. A cash balance, a drawn revolver balance, or any other position figure describes the company's condition, not something that happened to the instrument this card is about — and a condition has no date, so it cannot make this week the moment. "Cash and cash equivalents grew to $24.2 billion" is the wrong reason to call: for an insurer that figure is largely regulatory float, the RM knows it, and a card built on it reads as a tool that does not understand the balance sheet it is quoting. The same applies to a drawn revolver: a revolver is borrowed and repaid in the ordinary course, and a draw is operations, not a refinancing signal. THE RIGHT REASON IS AN EVENT ON THIS TRANCHE. When the headline fact carries an "EVENT ON THIS TRANCHE" line, that line IS the why-now and you must use it — it is a repurchase, a partial redemption or a pricing that the filing states about this exact instrument. "Centene repurchased $118 million of these notes in the quarter and $1,147 million over the six months, against $1,067 million still outstanding" is a why-now; "Centene's cash grew to $24.2 billion" is not. Where a sentence states two periods, say which figure belongs to which period, and never present one period's figure as the other's. AND WHERE THERE IS NO EVENT ON THIS TRANCHE, SAY SO. A card whose instrument has no stated event writes the honest version — "nothing in these filings states an event on this tranche; it is the stated maturity that makes it live" — and does NOT reach for a balance to fill the sentence. An absent reason stated plainly is worth more than a present-sounding one that is about something else.

- keyPoints: 2 to 4 bullets, plain facts in the same register the portfolio table uses — one fact and its own figure or date per bullet, nothing more. The FIRST bullet must be the fact that triggered this card (the headline event itself — the maturity, the announced deal, the proceeds). The rest are supporting facts, each still standing on its own. A bullet states what IS true; it never explains what one fact means for another. Do not write "which gives them a window to," "so the same approach can be," "before it competes with," or any other sentence connecting two facts together — that connective work belongs in whyNow, and only there. If you find yourself writing "so," "which means," "giving them," or "before" to link two bullets' worth of information into one, you have written a whyNow sentence by accident; split it back into two separate, unconnected facts instead. ONE INSTRUMENT PER BULLET. A bullet names at most ONE interest rate, because a rate is what identifies an instrument, and naming two instruments is stating two facts however the source filing punctuated it. A filing will happily put four in one sentence — "issued $1.5 billion of 5.500% first lien notes due 2032 and $750 million of 6.000% senior notes due 2033, redeeming $1.5 billion of 6.250% second lien notes due 2027 and partially redeeming $750 million of 6.125% senior notes due 2028" — and that is four bullets' worth of fact, not one. Split it; never copy a multi-instrument sentence across whole. Stating two AMOUNTS for the SAME instrument is fine and often required ("$1.1 billion outstanding on the 4.25% Senior Notes due December 15, 2027, against an original issue size of $2.5 billion") — one instrument, one rate, one fact. If a given fact you're describing has a "redeemed:" line, state that redemption as its own bullet — "On November 18, 2025, Tenet redeemed $1.5 billion of its 6.250% second lien notes due February 2027." — copied from the field, one filed fact about one instrument, never phrased as explaining why a DIFFERENT tranche (the headline or any other fact) is live now — that would be asserting a relationship between two facts, which a bullet never does.

  BULLETS MUST SERVE THE CALL. On a refi card, a supporting bullet relates to the tranche the card is about, to another tranche on the same ladder, or to the money that would repay it — cash on hand, a recent issuance, revolver capacity. A share repurchase authorization and a dividend increase are real facts about the company and neither is a reason to make THIS call; do not reach for them to fill a fourth bullet. Where the company has a ladder, another tranche on it is always the stronger bullet. Two well-chosen bullets beat four with filler.

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
/** The fact a card is actually about: row-exact for a debt-maturity card (which one of a company's tranches), trigger-matched otherwise. */
function findHeadlineFact(factBase: VerifiedFact[], card: FlashCard): VerifiedFact | undefined {
  if (card.headlineRowId) {
    const exact = factBase.find((f) => f.ladderRowId === card.headlineRowId);
    // No silent fallback to "some other tranche" — a card with a row id whose
    // fact is missing must fail loudly, not narrate a different debt.
    if (exact) return exact;
    return undefined;
  }
  return factBase.find((f) => f.linkedTriggerId === card.headlineTrigger.triggerId);
}

/**
 * E10 — the grammar of advice. Two closed classes, both small and both about
 * SENTENCE MODE rather than subject matter:
 *   - modality: a claim about ability, permission or obligation rather than
 *     about what is the case;
 *   - evaluation: an adjective scoring the company's position rather than
 *     describing it.
 * Deliberately does not include ordinary financial vocabulary — "refinance",
 * "liquidity", "prefund" are all perfectly good facts. It is "ample liquidity
 * TO prefund" and "WELL-POSITIONED to address" that cross the line, and it is
 * the modal/evaluative frame that puts them there.
 */
// "may" and "might" are deliberately NOT here, and the reason is measured
// rather than theoretical: Quest's card was rejected twice on a bare "may".
// They are the weakest modals in the set — "may" carries permission about as
// often as capability — and "May" is also a MONTH, so a case-insensitive test
// on it fires on every card about a tranche due May. A guard that trips on
// "due May 2027" is not testing modality.
const ADVISORY_MODALS = /\b(?:can|could|should|ought to|able to|unable to|has room to|have room to|gives? (?:them|it) room|allowing (?:them|it) to|positions? (?:them|it) to|enabl(?:es?|ing) (?:them|it) to)\b/gi;
const ADVISORY_EVALUATIONS = /\b(?:well[- ]positioned|well[- ]placed|comfortabl[ey]|ample|healthy|strong(?:ly)? positioned|favou?rabl[ey] positioned|opportunistic(?:ally)?|prudent(?:ly)?|attractive(?:ly)?)\b/gi;
/**
 * ITEM 16 (stage-2 review) — AVAILABILITY IS A CAPABILITY CLAIM.
 *
 * The modal and evaluation lists caught "well-positioned to address this
 * maturity" and "ample liquidity", and let through two sentences that make
 * exactly the same move without a modal or an evaluative adjective:
 *
 *   "showing the same playbook is available to address the December 2027
 *    notes ahead of maturity"
 *   "showing the market is open for exactly this kind of deal"
 *
 * Neither is in any filing. Both tell the RM what their options are, which
 * is the judgement the RM is paid to form and the one thing the card must
 * not pre-empt.
 *
 * The rule, structurally: whyNow may state facts and their temporal or
 * arithmetic relation. It may not characterise what is POSSIBLE, ADVISABLE,
 * or AVAILABLE. This is the availability half — a predicate asserting that
 * a course of action exists, rather than that an event occurred. Still a
 * grammatical frame and not a subject-matter list: "the market" and "a
 * playbook" are perfectly good subjects of a filed fact ("Quest tapped the
 * market in May 2026"), and only become a claim when the predicate says
 * they are open, available, or there to be used.
 */
const ADVISORY_AVAILABILITY =
  /\b(?:is|are|was|were|remains?|stays?)\s+(?:still\s+|clearly\s+|widely\s+)?(?:available|open|accessible|receptive)\b|\bshowing\s+(?:that\s+)?(?:the|a|an|its|their|same)\b|\bdemonstrat(?:es?|ing)\s+(?:that\s+)?(?:it|they|the)\b/gi;

export function advisoryPhrasesIn(text: string): string[] {
  const found = new Set<string>();
  for (const re of [ADVISORY_MODALS, ADVISORY_EVALUATIONS, ADVISORY_AVAILABILITY]) {
    const scan = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = scan.exec(text))) found.add(m[0].toLowerCase());
  }
  return [...found];
}

/** Exported for the guard-coverage assertion in narrationIntegrity.test.ts (Session 19, item 1a): the test needs the model's actual view of a fact to prove the derived corpus covers every field this shows. */
export function formatFact(f: VerifiedFact): string {
  const sourceStr = f.sourceFiling ? `${f.sourceFiling.form} filed ${f.sourceFiling.date}` : "n/a";
  const evidenceLine = f.evidence ? `\n  evidence: "${f.evidence}"` : "";
  // Session 18 F2: a debt-maturity row's seniority (from the debt note's
  // own section header) surfaced as its own line — the row's sourceLine
  // (the table row itself) frequently doesn't repeat the header text, so
  // without this Sonnet has no way to state it even though it's a real,
  // filed fact.
  const seniorityLine = f.seniority ? `\n  seniority: "${f.seniority}"` : "";
  // Session 18 E1: what this issuance redeemed, copied verbatim from the
  // field — available so Sonnet can state it as a KEY POINT when
  // describing the issuance, never as an inference about which live
  // tranche it explains.
  const redeemsLine = f.redeemsInfo ? `\n  redeemed: "${f.redeemsInfo}"` : "";
  // SESSION 22, STAGE 5 — THE EVENT ON THIS TRANCHE, which is the only thing
  // that can honestly answer "why now" about it. Labelled as such in the
  // context so the instruction below has something to point at by name.
  const trancheEventLine = f.trancheEvent
    ? `\n  EVENT ON THIS TRANCHE (the why-now, when one exists): "${f.trancheEvent.evidence}"`
    : "";
  // E4: the ONE figure a refi conversation is about, given as its own field
  // so there is nothing left to choose between. The instrument's NAME carries
  // its ORIGINAL ISSUE SIZE, and the two diverge the moment any of the
  // tranche is repurchased — Cigna's 4.500% due 2030 is named "$1,000
  // million" and has $993M outstanding. Naming the issue size explicitly is
  // what makes it safe to appear at all.
  const outstandingLine = f.outstandingAmount ? `\n  OUTSTANDING NOW (state THIS amount): ${f.outstandingAmount}` : "";
  const issueSizeLine = f.issueSizeInLabel
    ? `\n  original issue size, taken from the instrument's own name — NOT the current balance (statable only if you label it as the original issue size): ${f.issueSizeInLabel}`
    : "";
  return `- ${f.fact}: "${f.normalizedText}" (source: ${sourceStr})${outstandingLine}${issueSizeLine}${evidenceLine}${seniorityLine}${trancheEventLine}${redeemsLine}`;
}

// Exported so lib/cache/wordingCache.ts can hash EXACTLY what Sonnet will
// see when building the wording-cache key — no logic here changes.
export function buildContext(card: FlashCard, factBase: VerifiedFact[]): string {
  // Session 18 (post-v16): row-EXACT when the card is about one ladder row.
  // A plain triggerId match returns the company's first tranche for every
  // one of its refi cards — see VerifiedFact.ladderRowId for the live case
  // where three Cigna cards all narrated the wrong debt.
  const headlineFact = findHeadlineFact(factBase, card);
  // E5: the other cardable tranches on the SAME ladder, collapsed onto this
  // card. They are not "other facts about the company" — they are the rest of
  // one conversation, and they belong in KEY POINTS rather than being weighed
  // for relevance to WHY NOW.
  const carriedIds = new Set(card.alsoMaturingRowIds);
  const carriedFacts = factBase.filter((f) => f !== headlineFact && f.ladderRowId !== null && carriedIds.has(f.ladderRowId));
  const carried = new Set(carriedFacts);
  const otherFacts = factBase.filter((f) => f !== headlineFact && !carried.has(f));

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

  if (carriedFacts.length > 0) {
    lines.push(
      ``,
      `ALSO MATURING ON THIS SAME LADDER (${carriedFacts.length} more tranche${carriedFacts.length === 1 ? "" : "s"}) — this company gets ONE refi card and these are part of the same conversation. State each as its own KEY POINTS bullet, with its outstanding amount and its maturity. Do NOT total them, rank them, or draw a conclusion from them:`,
      ...carriedFacts.map(formatFact)
    );
  }

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
      max_tokens: CARD_MAX_OUTPUT_TOKENS,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      tools: [CARD_BODY_TOOL],
      tool_choice: { type: "tool", name: CARD_BODY_TOOL.name },
    },
    { timeout: TIMEOUT_MS }
  );
  recordUsage(SONNET_MODEL, response.usage);

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
export function checkCardStructure(
  body: RawCardBody,
  factBase: VerifiedFact[],
  headlineTriggerId?: string,
  /**
   * Item 1 (stage-2 review): the headline fact's own citations, so the guard
   * can build the SAME citation set draftEventBriefing will attach to the
   * card and check the card's stated periods against it. Optional only so
   * the offline structural suites can exercise the other checks without
   * constructing a citation set; production always passes it, and the
   * period check is the one thing that cannot run without it.
   */
  citationContext?: { headlineCitations: { form: string; date: string; reportDate: string }[]; today?: string }
): StructuralGuardResult {
  const reasons: string[] = [];

  if (!body.callAbout.trim()) reasons.push("callAbout is empty");
  if (!body.whyNow.trim()) reasons.push("whyNow is empty");
  const keyPoints = body.keyPoints.map((k) => k.trim()).filter(Boolean);
  if (keyPoints.length === 0) reasons.push("keyPoints is empty");
  else if (keyPoints.length < 2) reasons.push(`keyPoints has only ${keyPoints.length} bullet — needs 2 to 4`);
  else if (keyPoints.length > 4) reasons.push(`keyPoints has ${keyPoints.length} bullets — needs 2 to 4`);

  const whyNowSentences = body.whyNow.trim() ? sentenceCount(body.whyNow) : 0;
  if (whyNowSentences > 2) reasons.push(`whyNow is ${whyNowSentences} sentences — over the 2-sentence limit`);

  // E10 (Session 18, post-stage-2) — WHY NOW STATES FACTS AND THEIR RELATION,
  // AND DOES NOT ADVISE.
  //
  // Live output carried "ample liquidity to prefund or opportunistically
  // refinance" and "well-positioned to address this maturity". Neither is in
  // any filing. Both read as the tool's own view of the company's options,
  // which is exactly the judgement the RM is paid to form and the one thing
  // this card must not pre-empt.
  //
  // Checked in CODE and not left to the prompt, for the reason this project
  // has re-learned repeatedly: an instruction holds until the model phrases
  // it differently. This is a closed-class test on MODALITY and EVALUATION —
  // the grammar of advice, not its vocabulary — the same shape scrapeGuard.ts
  // already uses for function words. A factual relation uses neither: "the
  // draw lands three months before the maturity" contains no modal and makes
  // no evaluation.
  const advisory = advisoryPhrasesIn(body.whyNow);
  if (advisory.length > 0) {
    reasons.push(`whyNow advises rather than stating facts and their relation (${advisory.join(", ")}) — say what is true and how the facts bear on each other, never what the company can, should, or is well placed to do`);
  }

  // Session 15b: the accuracy corpus now also includes each fact's own
  // evidence sentence, not just verifiedText/normalizedText — the quote
  // is frequently a raw filing fragment with no real sentence structure,
  // while evidence is Haiku's already-scaled paraphrase and is where a
  // stated figure/date most often actually appears in citable form (this
  // is the fix for UHS's debt-maturity card, whose own quote is a bare,
  // unscaled table cell — see Part C / draftEventBriefing's doc comment).
  // Session 18: seniority (F2) and redeemsInfo (E1) added too — a bullet
  // correctly stating a redemption's own rate/date, copied straight from
  // redeemsInfo, must not fail this check for want of its source being
  // included here.
  //
  // Item 1 (stage-2 review): this list is now factOwnText, the SAME builder
  // numberGuard's own set-cover checks use, rather than a hand-maintained
  // copy of it. It had already drifted — factOwnText carries E4's
  // outstandingAmount and issueSizeInLabel and this list did not — and that
  // exact divergence, in the other direction, is what blanked three cards
  // during Group E (see factOwnText's comment). Two lists of "what a fact
  // says" is one list too many.
  const accuracyCorpus = factBase.map(factOwnText);
  const auditText = `${body.callAbout} ${body.whyNow} ${keyPoints.join(" ")}`;

  // Item 1 (stage-2 review) — the card's stated periods against the filings
  // it will actually cite. Built here from the SAME two inputs
  // draftEventBriefing uses for the citation set itself, so the guard can
  // never be checking a different set than the one that renders.
  if (citationContext) {
    const referenced = factsReferencedIn(auditText, factBase);
    const cited = [...citationContext.headlineCitations, ...referenced.flatMap((f) => f.citations)];
    const gaps = citationDateGaps(auditText, cited, citationContext.today ?? new Date().toISOString().slice(0, 10));
    // One reason per DATE, not per mention — the same period restated in
    // whyNow and again in a bullet is one problem, and repeating it in the
    // correction instruction just makes the retry prompt noisier.
    const seen = new Set<string>();
    for (const g of gaps) {
      if (seen.has(g.statedIso)) continue;
      seen.add(g.statedIso);
      reasons.push(
        `states "${g.stated}" but the newest filing this card cites was filed ${g.newestCitation} — a filing cannot state a fact about a day that had not happened when it was submitted`
      );
    }
  }
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
  //
  // SESSION 22, v10 — A TRANCHE EVENT IS ITS OWN FACT, and must count.
  //
  // The instruction now tells the model that an event on the card's own
  // tranche IS the why-now. This check counted only `normalizedText`, so a
  // why-now that did exactly that referenced the headline row and nothing
  // else, scored 1, and was rejected as description — and the two cards the
  // change was made FOR, Encompass's and Centene's, were the only two that
  // failed. A guard and the instruction it enforces are one change; v13's own
  // note in promptVersion.ts records that lesson and this is it recurring.
  //
  // It counts because it genuinely is a second fact, not as an exemption: the
  // row comes from the debt note's TABLE and the event from the note's PROSE.
  // Two disclosures, two sentences, and the relation between them — "$1,067
  // million still outstanding after $118 million was repurchased in the
  // quarter" — is synthesis in exactly the sense this check exists to require.
  const distinctnessCorpus = [
    ...factBase.map((f) => f.normalizedText),
    ...factBase.map((f) => f.trancheEvent?.evidence).filter((e): e is string => !!e),
  ];
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

  // ITEM 13 (stage-2 review) — ONE INSTRUMENT PER BULLET.
  //
  // isFullyExplainedByOneFact above asks whether some single FACT covers the
  // bullet, and a bullet can pass that while still stating four things,
  // because the source filing states all four in one sentence and the whole
  // sentence is one fact's evidence. Seen live:
  //
  //   "On November 18, 2025, Tenet issued $1.5 billion of 5.500% senior
  //    secured first lien notes due 2032 and $750 million of 6.000% senior
  //    notes due 2033, redeeming $1.5 billion of 6.250% second lien notes
  //    due 2027 and partially redeeming $750 million of 6.125% senior notes
  //    due 2028."
  //
  // Four instruments, four amounts, four maturities, one bullet. It passes
  // the set-cover test and is still four facts on a line meant to carry one.
  //
  // A RATE identifies an instrument, which makes the count structural: two
  // distinct rates in a bullet is two instruments, and two instruments is
  // two facts. Checked against the live book, every well-formed bullet
  // names at most one rate — including E4's required "$1.1 billion
  // outstanding on the 4.25% Senior Notes ... against an original issue size
  // of $2.5 billion", which states two AMOUNTS for one instrument and so
  // could never be caught by counting money. The offending bullet names
  // four. Counting rates separates them with nothing in between.
  const ratesIn = (text: string) => new Set(extractFactTokens(text).filter((t) => t.kind === "percent" && t.percentValue !== undefined).map((t) => t.percentValue!.toFixed(3)));
  const multiInstrumentBullets = keyPoints.filter((k) => ratesIn(k).size > 1);
  if (multiInstrumentBullets.length > 0) {
    reasons.push(
      `${multiInstrumentBullets.length} keyPoints bullet(s) name more than one interest rate — a rate identifies an instrument, so a bullet naming two names two facts; split the source sentence rather than copying it`
    );
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
  // Session 18 (post-v16): row-EXACT when the card is about one ladder row.
  // A plain triggerId match returns the company's first tranche for every
  // one of its refi cards — see VerifiedFact.ladderRowId for the live case
  // where three Cigna cards all narrated the wrong debt.
  const headlineFact = findHeadlineFact(factBase, card);
  if (!headlineFact) {
    // Should be unreachable — a card's headline is only ever built from a
    // quote-verified trigger (see buildEvents.ts), which is exactly what
    // populates the fact base.
    return failedEventBriefing(card, `no matching verified fact for headline trigger ${card.headlineTrigger.triggerId}`);
  }

  try {
    // Item 1 (stage-2 review): the period check needs the headline fact's
    // own citations, and gets them here rather than being reconstructed
    // later from the finished card — the guard and the rendered citation
    // set are built from one pair of inputs, so they cannot disagree.
    const citationContext = { headlineCitations: headlineFact.citations };

    let body = await callSonnet(card, factBase);
    let guard = checkCardStructure(body, factBase, card.headlineTrigger.triggerId, citationContext);

    if (!guard.ok) {
      const instruction = buildCorrectionInstruction(guard);
      console.warn(`[eventBriefing] ${card.company} (${card.id}) retrying once: ${instruction}`);
      body = await callSonnet(card, factBase, instruction);
      guard = checkCardStructure(body, factBase, card.headlineTrigger.triggerId, citationContext);
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
