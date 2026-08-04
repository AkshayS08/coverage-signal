import type { CompanyResult } from "./loop";
import type { DraftedEventBriefing } from "../events/eventBriefing";
import type { DraftedCompanySummary } from "../events/companySummary";

/**
 * NDJSON wire protocol between app/api/run/route.ts and the client: one
 * JSON object per line. "trace" lines feed the (collapsed-by-default)
 * agent reasoning toggle; "result" carries a finished company's full data
 * for event-building on the client, plus a Sonnet-drafted (or
 * template-fallback) briefing for each of that company's card-eligible
 * events — zero to several, keyed by event id — and, only when that
 * company has NO card-eligible event, a portfolio-table company summary
 * (a company that does have a card reuses that card's own summary
 * client-side instead, at no extra cost).
 */
export type RunStreamEvent =
  | { type: "trace"; company: string; text: string }
  | {
      type: "result";
      result: CompanyResult;
      eventBriefings?: { eventId: string; briefing: DraftedEventBriefing }[];
      companySummary?: DraftedCompanySummary;
    }
  | { type: "error"; company: string; message: string }
  | { type: "done" };
