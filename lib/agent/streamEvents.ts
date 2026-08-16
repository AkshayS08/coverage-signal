import type { CompanyResult } from "./loop";
import type { DraftedEventBriefing } from "../events/eventBriefing";

/**
 * NDJSON wire protocol between app/api/run/route.ts and the client: one
 * JSON object per line. "trace" lines feed the (collapsed-by-default)
 * agent reasoning toggle; "result" carries a finished company's full data
 * for event-building on the client, plus a Sonnet-drafted (or
 * loud-failure) briefing for each of that company's card-eligible events —
 * zero to several, keyed by event id. Session 15: the portfolio table is a
 * deterministic client-side renderer (lib/events/portfolioTable.ts) built
 * straight from `result` — there is no portfolio-summary model output to
 * carry over the wire any more.
 */
export type RunStreamEvent =
  | { type: "trace"; company: string; text: string }
  | {
      type: "result";
      result: CompanyResult;
      eventBriefings?: { eventId: string; briefing: DraftedEventBriefing }[];
    }
  | { type: "error"; company: string; message: string }
  | { type: "done" };
