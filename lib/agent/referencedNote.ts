/**
 * SESSION 24 — ONE DOCUMENT PER CALL, FOR A CROSS-REFERENCED NOTE.
 *
 * When the anchor locates no debt note and directs the reader to another
 * filing, that filing's note is transcribed HERE — in its own call, where it
 * is the anchor of the ask rather than a referenced aside inside a prompt
 * about a different document.
 *
 * WHY THE SHAPE OF THE ASK AND NOT ITS WORDING. The model already does this
 * correctly when it is the whole question: the cache holds 38 entries,
 * reproducible across thirteen prompt versions, in which a 10-K table WAS the
 * anchor of the ask and was transcribed in full. The decline happens only
 * inside the combined call. v31's fix 1 rewrote the not-located block to route
 * rather than prohibit and Cigna returned zero entries anyway; Session 23 then
 * proved from Cigna's own data that the field was PRESENT on the schema and
 * declined. A fourth rewrite of the same instruction is not a different
 * strategy.
 *
 * WHAT THIS IS NOT ALLOWED TO DO. It produces a PRIOR-PERIOD BASE. Every row
 * carries the transcribed filing's own period, and nothing here may become a
 * row in the current ladder — that is fix 5 and Rule 66, and it is enforced by
 * the caller, which never merges these into `scheduleSequence`.
 *
 * ITS OWN VERSION, ITS OWN CACHE KEY. The combined call's prompt is untouched,
 * so no existing answer is orphaned by this existing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./costMeter";
import { locateDebtNoteSection, narrowToDebtDisclosure } from "../fetch/noteLocation";

/** Bump when this prompt changes. Independent of EXTRACTION_PROMPT_VERSION by design. */
export const REFERENCED_NOTE_PROMPT_VERSION = 1;

const HAIKU_MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface ReferencedNoteRow {
  /** The instrument as the note names it, verbatim. */
  instrument: string;
  /** The amount as the note prints it, with the unit it prints. */
  amount: string;
  /** "row" for an instrument, "subtotal" for a stated total, "adjustment" for a discount/premium line. */
  kind: "row" | "subtotal" | "adjustment";
  /** The line of the note this came from, verbatim, INCLUDING the amount. */
  sourceLine: string;
  maturityDate: string | null;
  rate: string | null;
  /**
   * The cell resolved to MILLIONS by the caption governing it, added in
   * `loop.ts` where the filing text is in scope (Rule 67). Null where nothing
   * governs the cell — never a bare-dollars fallback, which is the 1000x
   * error. Optional so answers cached before this field still parse.
   */
  amountMillions?: number | null;
}

export interface ReferencedNoteResult {
  filingUrl: string;
  /** The period this note states — its own, never the anchor's. */
  periodOfReport: string;
  rows: ReferencedNoteRow[];
  /**
   * Every total the note prints, verbatim label and figure. This is what the
   * base tie is checked against.
   *
   * `amountMillions` is added by `loop.ts` where the filing text is in scope
   * (Rule 67) — null where no caption governs the cell. The verbatim `amount`
   * is never overwritten: verify as printed, display normalized.
   */
  statedSubtotals: { label: string; amount: string; amountMillions?: number | null }[];
  noteLocated: boolean;
  noteChars: number;
}

const SCHEMA = {
  type: "object" as const,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instrument: { type: "string" },
          amount: { type: "string" },
          kind: { type: "string", enum: ["row", "subtotal", "adjustment"] },
          sourceLine: { type: "string" },
          maturityDate: { type: ["string", "null"] },
          rate: { type: ["string", "null"] },
        },
        required: ["instrument", "amount", "kind", "sourceLine"],
      },
    },
    statedSubtotals: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, amount: { type: "string" } },
        required: ["label", "amount"],
      },
    },
  },
  required: ["rows", "statedSubtotals"],
};

const SYSTEM = [
  "You transcribe one debt note from one SEC filing. That filing is the subject of this request; there is no other document in play and nothing here is about any other period.",
  "",
  "TRANSCRIBE, DO NOT SELECT. Every line of the note's debt table becomes an entry: instruments, stated subtotals, and adjustment lines such as discounts, premiums, unamortized issuance costs and current-portion reclassifications. A note that prints twenty lines yields twenty entries.",
  "",
  "COPY WHAT IS PRINTED. Each amount carries the unit the filing prints for it. Where the table declares its scale once in a caption, copy the figure as the cell prints it and do not convert it. Never re-express a figure in a different scale than the one printed.",
  "",
  "sourceLine is the line of the table this entry came from, verbatim, AND IT MUST CONTAIN THE ENTRY'S OWN AMOUNT. A label with the amount cut off is not the evidence for that amount.",
  "",
  "statedSubtotals is every total the note itself prints, with its label verbatim — 'Total short-term debt', 'Total long-term debt'. These are what the transcription is reconciled against, so copy them exactly and copy all of them.",
  "",
  "If the note states a maturity date or a rate for an entry, include it. If it does not, use null. Never infer either.",
].join("\n");

/**
 * Transcribe one filing's debt note. BILLS — one Haiku call.
 *
 * The caller is responsible for the gate (Rule 66) and for keeping the result
 * out of the current ladder.
 */
export async function transcribeReferencedNote(params: {
  companyName: string;
  filingUrl: string;
  filingForm: string;
  periodOfReport: string;
  filingText: string;
  xbrlTotalForScale?: number | null;
}): Promise<ReferencedNoteResult> {
  const { filingText } = params;
  const loc = locateDebtNoteSection(filingText);
  if (loc.status !== "found") {
    return { filingUrl: params.filingUrl, periodOfReport: params.periodOfReport, rows: [], statedSubtotals: [], noteLocated: false, noteChars: 0 };
  }
  // The same narrowing the combined path uses, so the note handed over here is
  // the note — not the note plus whatever table followed it.
  const narrowed = narrowToDebtDisclosure(filingText, { start: loc.start, end: loc.end }, params.xbrlTotalForScale ?? null);
  const note = filingText.slice(loc.start, narrowed.end);

  const user = [
    `Company: ${params.companyName}`,
    `Filing: ${params.filingForm}, period of report ${params.periodOfReport}`,
    `Source: ${params.filingUrl}`,
    ``,
    `This filing's debt note follows. Transcribe it.`,
    ``,
    `--- begin note ---`,
    note,
    `--- end note ---`,
  ].join("\n");

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 12000,
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    tools: [{ name: "submit_note", description: "Submit the transcribed debt note.", input_schema: SCHEMA }],
    tool_choice: { type: "tool", name: "submit_note" },
  });
  recordUsage(HAIKU_MODEL, response.usage);
  if (response.stop_reason === "max_tokens") {
    throw new Error(`TRUNCATED RESPONSE transcribing ${params.filingUrl} — raise max_tokens; this is not an accuracy problem`);
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("no submit_note tool call returned");
  const out = toolUse.input as { rows?: ReferencedNoteRow[]; statedSubtotals?: { label: string; amount: string }[] };

  return {
    filingUrl: params.filingUrl,
    periodOfReport: params.periodOfReport,
    rows: out.rows ?? [],
    statedSubtotals: out.statedSubtotals ?? [],
    noteLocated: true,
    noteChars: note.length,
  };
}
