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

export interface TriggerVerdict {
  triggerId: string;
  fired: boolean;
  dataAvailable: boolean;
  evidence: string | null;
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
    confidence: { type: "number" },
    needsDig: { type: "boolean" },
    digHint: { type: ["string", "null"] },
    citedUrls: { type: "array", items: { type: "string" } },
  },
  required: ["triggerId", "fired", "dataAvailable", "confidence", "needsDig"],
};

const INSTRUCTIONS = `You are triaging a public company's SEC filings for a commercial bank relationship manager. For each of the 15 triggers listed, decide:
- fired: does the evidence show this trigger actually happened / is present?
- dataAvailable: could this realistically be assessed from what you were given? Set this to false only when the trigger is fundamentally the kind of thing public filings don't disclose (e.g. internal treasury/banking relationships) — not merely because you personally didn't spot it this quarter. If the trigger is marked PUBLIC and you simply see no evidence, that's fired=false, dataAvailable=true ("checked, no signal").
- evidence: a short quote or paraphrase of what you found, or null if nothing.
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
    max_tokens: 4096,
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
    max_tokens: 2048,
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
