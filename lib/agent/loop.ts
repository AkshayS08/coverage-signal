import { TRIGGERS, type TriggerDef } from "./triggers";
import { selectBaselineFilings } from "./selectFilings";
import { getRecentFilings, readFiling, searchNews } from "./tools";
import type { FilingEntry } from "../fetch";
import {
  classifyAllTriggers,
  classifyOneTrigger,
  type CorpusDoc,
  type DateGranularity,
  type EventStatus,
  type FilingCatalogEntry,
  type ProceedsUse,
  type TriggerVerdict,
} from "./claude";
import { verifyTriggerQuote } from "./verifyQuote";
import { verifyEventDate, type EventDateGuardResult } from "./factGuard";
import { classifyProceedsUse } from "./proceedsUse";

const MAX_DIG_STEPS = 5;

export type TraceHandler = (line: string) => void;

export interface TriggerResult {
  triggerId: string;
  triggerName: string;
  fired: boolean;
  dataAvailable: boolean;
  evidence: string | null;
  mappedNeed: string;
  needType: "credit" | "treasury" | "distress";
  confidence: number;
  citations: { form: string; date: string; url: string }[];
  /** Did the model's `quote` field appear verbatim in the filing text we actually fetched? */
  quoteVerified: boolean;
  /** The verbatim source sentence(s) backing this trigger — only set when quoteVerified is true. Always the raw filing text, never scale-adjusted (see verifiedQuoteNormalized). */
  verifiedQuote: string | null;
  /** Which pass verified the quote — "literal" (the model's quote is a genuine contiguous substring of the filing) or "co-occurrence" (verified via the table-row fallback instead). Null when unverified. See verifyQuote.ts's QuoteVerificationResult.matchType doc for why this distinction matters. */
  quoteMatchType: "literal" | "co-occurrence" | null;
  /** Model-reported: does verifiedQuote itself contain the fact's material figure, or is it a figure-less fallback (the most specific factual sentence available, with no single sentence found to carry a figure)? False whenever quote/verifiedQuote is null. See claude.ts's quote instruction. */
  quoteHasFigure: boolean;
  /** Same fact as verifiedQuote, but with any bare (unit-less) table figure replaced by its scale-normalized dollar form where a governing "dollar amounts... in millions/thousands" declaration was found (scaleNormalize.ts). Falls back to the raw text when no bare figures needed normalizing or none could be safely resolved. This — not verifiedQuote — is what card narration is built from. */
  verifiedQuoteNormalized: string | null;
  /** ISO date ("YYYY-MM-DD") or bare year ("YYYY") of the event this fact describes, fact-guarded against the cited filing text (factGuard.ts) — null if the model gave none, or if it claimed one that couldn't be verified in the filing. The card-eligibility gate's sole source of "when" (lib/events/eligibility.ts); never re-derived from evidence prose. */
  eventDate: string | null;
  /** Precision eventDate actually carries — "year" means eventDate is a bare 4-digit year with no month/day; display code must never render it as a specific date or a computed month count. Null exactly when eventDate is null. */
  dateGranularity: DateGranularity | null;
  /** Model-labeled status ("upcoming" / "just_announced" / "completed" / "standing") — the gate's sole source of "is this dated/live or a standing condition," replacing the old regex guesswork over evidence text. */
  eventStatus: EventStatus;
  /** Only meaningful for "new-debt-issuance" — null for every other trigger. Feeds the completed-issuance proceeds test (eligibility.ts). */
  proceedsUse: ProceedsUse | null;
}

export interface CompanyResult {
  company: string;
  cik: string;
  ticker: string;
  results: TriggerResult[];
  verdict: "CALL" | "NO ACTIONABLE TRIGGER";
  relationshipFlags: TriggerResult[];
}

const FORM_ORDER = ["10-Q", "10-K", "8-K"];

function pluralizeForm(form: string, count: number): string {
  return count > 1 ? `${form}s` : form;
}

/** e.g. "2 10-Qs, 10-K, 6 8-Ks" — for the plain-English "reading filings" line. */
function describeBaseline(baseline: FilingEntry[]): string {
  const counts = new Map<string, number>();
  for (const f of baseline) counts.set(f.form, (counts.get(f.form) ?? 0) + 1);
  return FORM_ORDER.filter((form) => counts.has(form))
    .map((form) => {
      const n = counts.get(form)!;
      return n > 1 ? `${n} ${pluralizeForm(form, n)}` : form;
    })
    .join(", ");
}

function shorten(text: string | null, maxLen = 100): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}...`;
}

/** Plain-English outcome phrase for a verdict, no "checking..." prefix. */
function describeVerdict(trigger: TriggerDef, v: TriggerVerdict): string {
  if (v.fired) return `FIRED — ${shorten(v.evidence)}`;
  if (v.dataAvailable) return "no signal found";
  return trigger.detectability === "INTERNAL"
    ? "no public signal (internal data only)"
    : "no public signal (not disclosed in these filings)";
}

export async function runAgentLoop(
  companyName: string,
  onTrace?: TraceHandler
): Promise<CompanyResult> {
  function log(line: string) {
    console.log(line);
    onTrace?.(line);
  }

  const filingsResult = await getRecentFilings(companyName, ["8-K", "10-Q", "10-K"]);

  const catalog: FilingCatalogEntry[] = filingsResult.filings.map((f) => ({
    form: f.form,
    filingDate: f.filingDate,
    items: f.items,
    url: f.primaryDocUrl,
  }));

  const citationLookup = new Map(
    filingsResult.filings.map((f) => [f.primaryDocUrl, { form: f.form, date: f.filingDate }])
  );

  const baseline = selectBaselineFilings(filingsResult.filings);
  const baselineUrls = new Set(baseline.map((f) => f.primaryDocUrl));

  log(`${companyName} → reading recent filings (${describeBaseline(baseline)})...`);

  const corpus: CorpusDoc[] = [];
  const textByUrl = new Map<string, string>();
  for (const filing of baseline) {
    const { text } = await readFiling(filing.primaryDocUrl);
    corpus.push({ form: filing.form, filingDate: filing.filingDate, url: filing.primaryDocUrl, text });
    textByUrl.set(filing.primaryDocUrl, text);
  }

  // News isn't wired up yet (later session) — call the stub but don't narrate an empty result.
  await searchNews(companyName);

  log(`checking all 15 triggers...`);
  const baseVerdicts = await classifyAllTriggers({
    companyName: filingsResult.company,
    triggers: TRIGGERS,
    catalog,
    corpus,
  });
  const verdictById = new Map(baseVerdicts.map((v) => [v.triggerId, v]));

  // Deterministic fact-check: a fired trigger's `quote` must either appear
  // literally in the filing text we actually fetched, or its key facts
  // (amount/rate/date — see factTokens.ts) must co-occur within a bounded
  // window, so a genuine table-row fact (a debt-schedule row is never an
  // English sentence) verifies too. A trigger whose quote can't be
  // verified either way never reaches a card (see buildEvents.ts); it
  // stays in the portfolio table, marked unverified, so nothing vanishes.
  function finalizeVerified(trigger: TriggerDef, v: TriggerVerdict, label: string): TriggerResult {
    const result = verifyTriggerQuote({
      fired: v.fired,
      quote: v.quote,
      citedUrls: v.citedUrls ?? [],
      textByUrl,
    });
    if (v.fired && !result.verified) {
      log(`  ⚠ QUOTE VERIFICATION FAILED for ${label} — model's quote not found in the fetched filing text; evidence discarded, excluded from cards`);
    }
    if (v.fired && result.verified && v.quoteHasFigure === false) {
      log(`  ⚠ QUOTE HAS NO FIGURE for ${label} — verified, but the model reported no single sentence carried the fact's material figure; verifiedQuote is a figure-less fallback`);
    }
    const dateGuard = verifyEventDate({
      eventDate: v.eventDate ?? null,
      eventDateGranularity: v.eventDateGranularity ?? null,
      anchorText: v.quote ?? v.evidence ?? null,
      citedUrls: v.citedUrls ?? [],
      textByUrl,
    });
    if (v.eventDate && !dateGuard.accepted) {
      log(
        `  ⚠ EVENT DATE REJECTED for ${companyName} — ${label}: claimed "${v.eventDate}" not found (or not anchored to this fact) in the fetched filing text; eventDate set to null`
      );
    }
    return finalize(trigger, citationLookup, v, result, dateGuard);
  }

  let digBudget = MAX_DIG_STEPS;
  const results: TriggerResult[] = [];

  for (const trigger of TRIGGERS) {
    const v = verdictById.get(trigger.id);
    const label = trigger.name.toLowerCase();

    if (!v) {
      log(`checking ${label}... couldn't be classified — treating as no public signal.`);
      results.push(
        finalizeVerified(
          trigger,
          {
            triggerId: trigger.id,
            fired: false,
            dataAvailable: false,
            evidence: null,
            quote: null,
            quoteHasFigure: false,
            eventDate: null,
            eventDateGranularity: null,
            eventStatus: "standing",
            confidence: 0,
            needsDig: false,
            digHint: null,
            citedUrls: [],
          },
          label
        )
      );
      continue;
    }

    if (v.needsDig && v.digHint && baselineUrls.has(v.digHint)) {
      log(`${label} unclear, but nothing new to check — ${describeVerdict(trigger, v)}.`);
      results.push(finalizeVerified(trigger, v, label));
      continue;
    }

    if (v.needsDig && digBudget > 0 && v.digHint) {
      const digFiling = filingsResult.filings.find((f) => f.primaryDocUrl === v.digHint);
      if (!digFiling) {
        log(`${label} unclear, but the follow-up filing wasn't found — ${describeVerdict(trigger, v)}.`);
        results.push(finalizeVerified(trigger, v, label));
        continue;
      }
      digBudget--;
      log(`${label} unclear → digging into the ${digFiling.form}...`);
      const { text } = await readFiling(digFiling.primaryDocUrl);
      textByUrl.set(digFiling.primaryDocUrl, text);
      const refined = await classifyOneTrigger({
        companyName: filingsResult.company,
        trigger,
        priorVerdict: v,
        extraDoc: {
          form: digFiling.form,
          filingDate: digFiling.filingDate,
          url: digFiling.primaryDocUrl,
          text,
        },
      });
      log(`${label} resolved — ${describeVerdict(trigger, refined)}.`);
      results.push(finalizeVerified(trigger, refined, label));
    } else if (v.needsDig && digBudget === 0) {
      log(`${label} unclear, but out of follow-up budget for this run — ${describeVerdict(trigger, v)}.`);
      results.push(finalizeVerified(trigger, v, label));
    } else {
      log(`checking ${label}... ${describeVerdict(trigger, v)}`);
      results.push(finalizeVerified(trigger, v, label));
    }
  }

  // proceedsUse: one Sonnet call, at most, per company — only when the
  // issuance trigger actually fired. Kept out of the main Haiku
  // classification (see the ProceedsUse doc comment in claude.ts for why).
  // Reads the FULL cited filing text (already fetched, in textByUrl) —
  // not just evidence/quote — since the use-of-proceeds sentence is
  // frequently outside whatever narrow excerpt Haiku's own evidence/quote
  // happened to select (see proceedsUse.ts's doc comment). Also always
  // includes the most recent 10-Q, regardless of whether Haiku happened to
  // cite it for THIS trigger: confirmed live that Haiku's own citation
  // choice for new-debt-issuance is itself non-deterministic — sometimes
  // it cites only the terse issuance 8-K (which frequently doesn't discuss
  // use of proceeds at all), sometimes the fuller 10-Q MD&A ("Liquidity
  // and Capital Resources," which routinely does). No new filing fetch —
  // the 10-Q is already in textByUrl from the main corpus read.
  const issuanceIdx = results.findIndex((r) => r.triggerId === "new-debt-issuance");
  if (issuanceIdx !== -1 && results[issuanceIdx].fired) {
    const issuance = results[issuanceIdx];
    try {
      const mostRecentTenQ = baseline
        .filter((f) => f.form === "10-Q")
        .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
      const urls = new Set([...issuance.citations.map((c) => c.url), ...(mostRecentTenQ ? [mostRecentTenQ.primaryDocUrl] : [])]);
      const filingTexts = [...urls].map((url) => textByUrl.get(url)).filter((t): t is string => !!t);
      const proceedsUse = await classifyProceedsUse({
        companyName,
        evidence: issuance.evidence,
        quote: issuance.verifiedQuote,
        filingTexts,
      });
      results[issuanceIdx] = { ...issuance, proceedsUse };
      log(`  proceeds-use classified (Sonnet): ${proceedsUse}`);
    } catch (err) {
      log(
        `  ⚠ PROCEEDS-USE CLASSIFICATION FAILED for ${companyName} — new-debt-issuance: ${err instanceof Error ? err.message : String(err)}; proceedsUse left null`
      );
    }
  }

  const callTriggers = results.filter(
    (r) => r.fired && (r.needType === "credit" || r.needType === "treasury")
  );
  const relationshipFlags = results.filter((r) => r.fired && r.needType === "distress");
  const verdict: CompanyResult["verdict"] = callTriggers.length > 0 ? "CALL" : "NO ACTIONABLE TRIGGER";

  log(`verdict: ${verdict}`);
  for (const t of callTriggers) {
    log(`→ ${t.triggerName} — ${t.mappedNeed}`);
  }
  for (const t of relationshipFlags) {
    log(`relationship flag, not a sell → ${t.triggerName}`);
  }

  return {
    company: filingsResult.company,
    cik: filingsResult.cik,
    ticker: filingsResult.ticker,
    results,
    verdict,
    relationshipFlags,
  };
}

function finalize(
  trigger: TriggerDef,
  citationLookup: Map<string, { form: string; date: string }>,
  v: TriggerVerdict,
  verification: { verified: boolean; displayText: string | null; normalizedText: string | null; matchType: "literal" | "co-occurrence" | null },
  dateGuard: EventDateGuardResult
): TriggerResult {
  return {
    triggerId: trigger.id,
    triggerName: trigger.name,
    fired: v.fired,
    dataAvailable: v.dataAvailable,
    evidence: v.evidence ?? null,
    mappedNeed: trigger.mappedNeed,
    needType: trigger.needType,
    confidence: v.confidence,
    citations: (v.citedUrls ?? []).map((url) => {
      const known = citationLookup.get(url);
      return { form: known?.form ?? "filing", date: known?.date ?? "", url };
    }),
    quoteVerified: verification.verified,
    verifiedQuote: verification.verified ? verification.displayText : null,
    verifiedQuoteNormalized: verification.verified ? (verification.normalizedText ?? verification.displayText) : null,
    quoteMatchType: verification.matchType,
    quoteHasFigure: verification.verified ? (v.quoteHasFigure ?? false) : false,
    eventDate: dateGuard.eventDate,
    dateGranularity: dateGuard.eventDateGranularity,
    eventStatus: v.eventStatus ?? "standing",
    // Classified separately, once per fired issuance fact, by Sonnet — see
    // the post-loop step in runAgentLoop. Null here is the pre-classification
    // default, not a final answer, except for every non-issuance trigger
    // (for which it stays null, correctly, forever).
    proceedsUse: null,
  };
}
