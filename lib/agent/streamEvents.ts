import type { CompanyResult } from "./loop";
import type { DraftedEventBriefing } from "../events/eventBriefing";

/**
 * NDJSON wire protocol between app/api/run/route.ts and the client: one
 * JSON object per line. "trace" lines feed the (collapsed-by-default)
 * agent reasoning toggle; "result" carries a finished company's full data
 * for event-building on the client, plus a Sonnet-drafted (or
 * template-fallback) briefing for each of that company's card-eligible
 * events — zero to several, keyed by event id. The portfolio table's
 * per-company summary is fully deterministic and computed client-side
 * (lib/events/companySummary.ts), so it has no wire representation here.
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
