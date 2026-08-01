import type { CompanyResult } from "./loop";
import type { DraftedOpener } from "../rank/sonnetOpener";

/**
 * NDJSON wire protocol between app/api/run/route.ts and the client: one
 * JSON object per line. "trace" lines feed the Agent trace panel; "result"
 * carries a finished company's full data for ranking into the Call sheet,
 * plus its Sonnet-drafted (or template-fallback) opener when it's a CALL.
 */
export type RunStreamEvent =
  | { type: "trace"; company: string; text: string }
  | { type: "result"; result: CompanyResult; opener?: DraftedOpener }
  | { type: "error"; company: string; message: string }
  | { type: "done" };
