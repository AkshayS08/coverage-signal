import type { CompanyResult } from "./loop";
import type { DraftedEventBriefing } from "../events/eventBriefing";
import type { DraftedPortfolioSummary } from "../events/sonnetPortfolioSummary";

/**
 * NDJSON wire protocol between app/api/run/route.ts and the client: one
 * JSON object per line. "trace" lines feed the (collapsed-by-default)
 * agent reasoning toggle; "result" carries a finished company's full data
 * for event-building on the client, plus a Sonnet-drafted (or
 * loud-failure) briefing for each of that company's card-eligible events —
 * zero to several, keyed by event id — and a Sonnet-drafted (or
 * loud-failure) portfolio-table summary for the company as a whole
 * (Session 12 Part B — the old deterministic, client-side companySummary.ts
 * bullet line is retired; this now requires a server-side model call, so
 * it has a wire representation like the card briefings do).
 */
export type RunStreamEvent =
  | { type: "trace"; company: string; text: string }
  | {
      type: "result";
      result: CompanyResult;
      eventBriefings?: { eventId: string; briefing: DraftedEventBriefing }[];
      portfolioSummary?: DraftedPortfolioSummary;
    }
  | { type: "error"; company: string; message: string }
  | { type: "done" };
