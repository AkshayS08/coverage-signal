import Anthropic from "@anthropic-ai/sdk";
import type { TriggerDef } from "./triggers";

const HAIKU_MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface FilingCatalogEntry {
  form: string;
  filingDate: string;
  items: string;
  url: string;
}

export interface CorpusDoc {
  form: string;
  filingDate: string;
  url: string;
  text: string;
}

/**
 * upcoming — a stated future date (a maturity, a pending closing).
 * just_announced — announced or executed and still live/actionable.
 * completed — already settled (redeemed, paid off, closed) — nothing left
 *   to act on, UNLESS the completed-issuance proceeds test says otherwise
 *   (see lib/events/eligibility.ts).
 * standing — an ongoing condition with no specific date (annual capex,
 *   existing exposure, an unchanged buyback program).
 */
export type EventStatus = "upcoming" | "just_announced" | "completed" | "standing";

/**
 * How a debt/equity issuance's proceeds are used, per the filing's own
 * words — only meaningful for "new debt issuance / notes pricing"; null for
 * every other trigger. Feeds the completed-issuance proceeds test: a
 * completed raise only cards when there's a real balance left to compete
 * for (partly_unapplied) and it's recent — see eligibility.ts.
 *
 * Classified by SONNET, not Haiku (see lib/agent/proceedsUse.ts) — moved
 * there after this field proved genuinely ambiguous on real disclosures
 * (Encompass's "...redeem $400M, repay $100M, and pay fees and expenses"
 * read as fully-accounted refinancing by some readings and as leaving an
 * unaccounted sliver by others) and Haiku's own label for the IDENTICAL
 * real disclosure varied across otherwise-identical extraction runs. One
 * narrow, single-field call per fired issuance fact, not folded into the
 * 15-trigger classification.
 */
export type ProceedsUse = "refinancing_only" | "partly_unapplied" | "unstated";

/**
 * Precision the filing actually discloses for `eventDate` — "day" (a real
 * calendar date, "June 1, 2030"), "month" (month+year only, "November
 * 2027" — eventDate defaults to the 1st), or "year" (a bare year, "due
 * 2026", with NO month stated anywhere). Null exactly when eventDate is
 * null. This exists so a bare-year date is never silently upgraded to a
 * fabricated day: eventDate for "year" granularity is the bare 4-digit
 * year string itself ("2026"), never an invented "2026-12-31" — any
 * worst-case convention date for window arithmetic is computed separately
 * downstream (see lib/events/eventTiming.ts's windowDate) and must never
 * be read back as if the filing had stated it.
 */
export type DateGranularity = "year" | "month" | "day";

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateNormalizationResult {
  eventDate: string | null;
  eventDateGranularity: DateGranularity | null;
  /** True when a year-granularity claim carried a fabricated month/day and was corrected down to the bare year — the exact defect this exists for: Haiku's own prompt (above) explicitly forbids writing "2026-12-31" for a bare "2026," but the wording alone didn't stop it happening live. */
  wasNormalized: boolean;
  /** True when a day- or month-granularity claim lands exactly on 12-31 or 01-01 — the two values a model fabricates when it applies its own worst-case convention instead of reading a real date. Never auto-corrected (a real date can legitimately fall on either), only surfaced for review. Note: a genuine month-granularity January date ("January 2027" -> "2027-01-01") always matches the 01-01 pattern too, since day defaults to the 1st by convention for "month" granularity — an expected false positive, not a bug. */
  suspiciousRoundDate: boolean;
}

/**
 * Post-extraction validation for the eventDate/eventDateGranularity pair —
 * enforces in code what the prompt above only asks for in words. Real
 * case: Haiku returned {eventDate: "2026-12-31", eventDateGranularity:
 * "year"} for UHS's debt-maturity fact — the LITERAL forbidden example
 * from this file's own INSTRUCTIONS text, self-contradicting its own
 * granularity label. Never rejects the fact: a bare-year maturity is
 * legitimate and eventTiming.ts's windowDate convention already exists
 * specifically to handle it downstream.
 */
export function normalizeEventDate(eventDate: string | null, eventDateGranularity: DateGranularity | null): DateNormalizationResult {
  if (!eventDate || !eventDateGranularity) {
    return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate: false };
  }
  const full = eventDate.match(FULL_DATE_RE);
  if (!full) {
    return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate: false };
  }
  if (eventDateGranularity === "year") {
    return { eventDate: full[1], eventDateGranularity: "year", wasNormalized: true, suspiciousRoundDate: false };
  }
  const [, , month, day] = full;
  const suspiciousRoundDate = (month === "12" && day === "31") || (month === "01" && day === "01");
  return { eventDate, eventDateGranularity, wasNormalized: false, suspiciousRoundDate };
}

export interface TriggerVerdict {
  triggerId: string;
  fired: boolean;
  dataAvailable: boolean;
  evidence: string | null;
  quote: string | null;
  /** True when `quote` itself states the transaction's material figure(s) (amount, value, consideration, rate). False when quote is a fallback — the most specific factual sentence available, with no single sentence in the filing found to carry a figure — or when quote is null. Lets callers tell "verified AND useful" apart from "verified but figure-less" without re-parsing the quote text; see loop.ts's logging when false. */
  quoteHasFigure: boolean;
  /** ISO date (YYYY-MM-DD) when day/month granularity, or a bare 4-digit year ("2026") when only a year is stated — or null if the filing states none. See DateGranularity above and the INSTRUCTIONS prompt for the exact rules. Verified against the filing text downstream (lib/agent/factGuard.ts) before it's trusted for any card decision. */
  eventDate: string | null;
  eventDateGranularity: DateGranularity | null;
  eventStatus: EventStatus;
  confidence: number;
  needsDig: boolean;
  digHint: string | null;
  citedUrls: string[];
}

const VERDICT_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    triggerId: { type: "string" },
    fired: { type: "boolean" },
    dataAvailable: { type: "boolean" },
    evidence: { type: ["string", "null"] },
    quote: { type: ["string", "null"] },
    quoteHasFigure: { type: "boolean" },
    eventDate: { type: ["string", "null"] },
    eventDateGranularity: { type: ["string", "null"], enum: ["year", "month", "day", null] },
    eventStatus: { type: "string", enum: ["upcoming", "just_announced", "completed", "standing"] },
    confidence: { type: "number" },
    needsDig: { type: "boolean" },
    digHint: { type: ["string", "null"] },
    citedUrls: { type: "array", items: { type: "string" } },
  },
  required: ["triggerId", "fired", "dataAvailable", "eventStatus", "quoteHasFigure", "confidence", "needsDig"],
};

const INSTRUCTIONS = `You are triaging a public company's SEC filings for a commercial bank relationship manager. For each of the 15 triggers listed, decide:
- fired: does the evidence show this trigger actually happened / is present?
- Perspective check: every trigger is evaluated from the perspective of the SUBJECT COMPANY named at the top of this prompt (Company: ...) — the company whose filings you were given, not any counterparty mentioned in them. This matters most for M&A: first work out whether the subject company is the BUYER/acquirer or the SELLER/divestor in the transaction. "Acquisition announced" fires ONLY when the subject company is the one doing the acquiring. When the subject company is selling, divesting, or exiting a business or asset, that is "Asset sale / divestiture closing" — never "Acquisition announced" — even if the filing or a counterparty's press release frames the deal from the buyer's side.
- dataAvailable: could this realistically be assessed from what you were given? Set this to false only when the trigger is fundamentally the kind of thing public filings don't disclose (e.g. internal treasury/banking relationships) — not merely because you personally didn't spot it this quarter. If the trigger is marked PUBLIC and you simply see no evidence, that's fired=false, dataAvailable=true ("checked, no signal").
- evidence: a short quote or paraphrase of what you found, or null if nothing. State the DATES the filing gives (a maturity date, a pending closing date, an effective date) plainly in the evidence text — e.g. "5.250% notes due June 2026" or "divestiture closing pending". Do NOT compute or state how far away that date is ("~10 months out", "refi window open now") — that arithmetic is code's job now, done from the eventDate/eventStatus fields below, never from the model's own reading of a calendar. Only surface a date when the filing genuinely discloses it; never invent one. Always write evidence in plain English, as if briefing a human banker — never quote or include raw XBRL tags, machine element names, namespace prefixes (e.g. "us-gaap:...", "uhs:...", any "company-prefix:ElementName" form), or accession-number-style identifiers. If the only source for a fact is a tagged data element, describe what it means in words instead of naming the tag (e.g. write "foreign-exchange hedging contracts disclosed in fair-value measurements", not "DesignatedAsHedgingInstrumentMember"; write "UK revenue reported as a separate segment line", not "uhs:UKRevenueMember").
- eventDate: the date of the event THIS SPECIFIC fact describes — a maturity date, a closing date, an announcement date, an issuance date. Copy it from the same sentence(s) that support this fact's evidence, not from a different, unrelated sentence elsewhere in the passage — e.g. if this fact is about a note maturing "due 2026" and a nearby sentence separately mentions a hospital lease expiring in a different month, that lease date belongs to a DIFFERENT fact, not this one; do not borrow it. Match the precision to what's actually stated, and set eventDateGranularity to match:
  - A real calendar date ("June 1, 2030", "6/1/2030") -> eventDate "2030-06-01", eventDateGranularity "day".
  - Only a month and year ("November 2027") -> eventDate "2027-11-01" (the 1st, by convention), eventDateGranularity "month".
  - ONLY A BARE YEAR with no month anywhere ("due 2026", "matures in 2028") -> eventDate is the bare year itself, exactly four digits ("2026"), eventDateGranularity "year". Do NOT invent a month or day — never write "2026-12-31" or "2026-01-01" for a bare "2026"; that fabricates precision the filing never stated.
  - If the filing states no date for this specific fact — or you're not certain which date belongs to it — eventDate is null and eventDateGranularity is null. A null is correct and useful; a borrowed, guessed, or over-precise date is not. Only meaningful when fired is true; both null when fired is false.
- eventStatus: exactly one of "upcoming" (a stated future date — a maturity, a pending closing), "just_announced" (announced or executed and still live/actionable — proceeds not yet fully placed, a deal not yet closed), "completed" (already settled — redeemed, paid off, the transaction closed with nothing left to act on this week), or "standing" (an ongoing condition with no specific date — recurring/annual capex, an existing exposure, an unchanged buyback program). Label exactly what the filing's own words state, do not infer beyond them: "were redeemed" -> completed. "due November 2027" -> upcoming. "each year" / "actively pursue" / "ongoing" -> standing. Only meaningful when fired is true.
- quote: REQUIRED whenever fired is true and evidence states a specific number, date, rate, or other precise fact. Defined precisely, not as a preference: **quote is the ONE contiguous sentence from the filing text given above that STATES the transaction's material figures — the amount, value, consideration, or rate.** Not the sentence that introduces the transaction. Not the sentence that names the parties. The sentence with the number in it. Copy it VERBATIM — character-for-character, copy-pasted, not paraphrased, not corrected, not reconstructed from memory. This is the only place numbers and dates are allowed to come from downstream.
  - quoteHasFigure: set this to true when the quote you wrote actually contains the material figure. Set it to false ONLY when you searched and no single sentence anywhere in the filing text contains one — in that case, quote instead the single most specific factual sentence available (whatever best identifies the fact, even without a number), and quoteHasFigure stays false. Do not set quoteHasFigure true because the quote is "close enough" or mentions a different, smaller number — it means the quote you wrote literally contains the fact's own headline figure.
  - NEVER assemble a quote by joining text from two different locations in the filing into what looks like one contiguous span, even when both pieces are individually true and even when the join reads naturally. If it is not one real, unbroken, back-to-back span of the source text, it does not belong in this field. This is the single most important rule here: a spliced quote is not a paraphrase, it is a fabrication of contiguity that didn't happen, and downstream verification exists specifically to catch it. An opening sentence that introduces the deal ("On [date], Company entered into an agreement...") is almost never the right quote by itself if a later sentence states the figure — go find that later sentence and quote it alone instead of the opener.
  - If you cannot find any single contiguous sentence that reflects the fact at all, do not write one — set quote to null and quoteHasFigure to false; a missing quote is far better than a spliced or misremembered one. Also set quote to null (and quoteHasFigure to false) if fired is false, or if the evidence is a general statement with no specific figure to verify (e.g. "no signal found").
- confidence: 0-1.
- needsDig: true only if the evidence is genuinely ambiguous (e.g. an event is mentioned but a key detail like amount or maturity is missing) AND a specific other filing in the catalog (not already in the excerpts below) looks likely to resolve it.
- digHint: if needsDig, the exact url from the filing catalog you want read next. Otherwise null.
- citedUrls: the filing url(s) you actually drew evidence from, from the excerpts or catalog below.

Return a result for every one of the 15 triggers, even ones with no signal at all.`;

function formatTriggers(triggers: TriggerDef[]): string {
  return triggers
    .map(
      (t) =>
        `- id: ${t.id}\n  name: ${t.name}\n  signal: ${t.signal}\n  needType: ${t.needType}\n  detectability: ${t.detectability}`
    )
    .join("\n");
}

function formatCatalog(catalog: FilingCatalogEntry[]): string {
  return catalog
    .map((f) => `${f.form} | ${f.filingDate} | items=${f.items || "-"} | ${f.url}`)
    .join("\n");
}

function formatCorpus(docs: CorpusDoc[]): string {
  return docs
    .map((d) => `--- ${d.form} filed ${d.filingDate} (${d.url}) ---\n${d.text}`)
    .join("\n\n");
}

/** One Haiku call classifying all 15 triggers against the assembled corpus. */
export async function classifyAllTriggers(params: {
  companyName: string;
  triggers: TriggerDef[];
  catalog: FilingCatalogEntry[];
  corpus: CorpusDoc[];
}): Promise<TriggerVerdict[]> {
  const { companyName, triggers, catalog, corpus } = params;

  const userContent = [
    `Company: ${companyName}`,
    ``,
    `## The 15 triggers`,
    formatTriggers(triggers),
    ``,
    `## Full filing catalog (available for digging; not all are excerpted below)`,
    formatCatalog(catalog),
    ``,
    `## Filing excerpts`,
    formatCorpus(corpus),
  ].join("\n");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 6144,
    temperature: 0,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: userContent }],
    tools: [
      {
        name: "submit_triage",
        description: "Submit the triage verdict for all 15 triggers.",
        input_schema: {
          type: "object",
          properties: {
            results: { type: "array", items: VERDICT_ITEM_SCHEMA },
          },
          required: ["results"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_triage" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Haiku did not return a submit_triage tool call");
  }
  const input = toolUse.input as { results: TriggerVerdict[] };
  return input.results;
}

/** Follow-up call for a single ambiguous trigger, given one additional filing's text. */
export async function classifyOneTrigger(params: {
  companyName: string;
  trigger: TriggerDef;
  priorVerdict: TriggerVerdict;
  extraDoc: CorpusDoc;
}): Promise<TriggerVerdict> {
  const { companyName, trigger, priorVerdict, extraDoc } = params;

  const userContent = [
    `Company: ${companyName}`,
    ``,
    `## Trigger to resolve`,
    `- id: ${trigger.id}`,
    `  name: ${trigger.name}`,
    `  signal: ${trigger.signal}`,
    `  needType: ${trigger.needType}`,
    `  detectability: ${trigger.detectability}`,
    ``,
    `## Prior (ambiguous) verdict`,
    JSON.stringify(priorVerdict),
    ``,
    `## Newly fetched filing (the one you asked to dig into)`,
    `--- ${extraDoc.form} filed ${extraDoc.filingDate} (${extraDoc.url}) ---`,
    extraDoc.text,
    ``,
    `Re-evaluate this one trigger with the new evidence and submit a final verdict. Set needsDig to false regardless — no further digs are available for this trigger.`,
  ].join("\n");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 3072,
    temperature: 0,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: userContent }],
    tools: [
      {
        name: "submit_trigger_verdict",
        description: "Submit the final verdict for this one trigger.",
        input_schema: VERDICT_ITEM_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_trigger_verdict" },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Haiku did not return a submit_trigger_verdict tool call");
  }
  return toolUse.input as TriggerVerdict;
}
