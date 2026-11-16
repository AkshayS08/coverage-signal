/**
 * SESSION 27 (Akshay, Nov 14): THE FACTS A REBUILD USES. Production's adopted facts (lib/cards/inputs/facts/<cik>.json),
 * where they were read from this card input's own anchor; otherwise none, and the facts stage runs (its cache refusing
 * any unadopted answer: answerCache.cachedCardFacts). Pure: reads committed files only.
 *
 * Nov 16 (Akshay): "the same read set", not just the anchor. Adopted facts serve a build only when they were read over
 * that build's read set (factsValidity.factsValidFor); else the facts stage must run.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardFacts } from "../types";
import { factsValidFor } from "../factsValidity";

export function factsForBuild(input: { cik: string; result: { results: { triggerId: string; debtScheduleSourceFiling?: { url?: string } }[]; recordedReadSet?: { url: string; via: string }[] } }): { source: "adopted" | "none"; facts: CardFacts | null } {
  const anchor = input.result.results.find((r) => r.triggerId === "debt-maturity")?.debtScheduleSourceFiling?.url;
  const p = join("lib", "cards", "inputs", "facts", `${input.cik}.json`);
  if (!anchor || !existsSync(p)) return { source: "none", facts: null };
  const adopted = JSON.parse(readFileSync(p, "utf-8")) as CardFacts;
  return factsValidFor(adopted, input.result, anchor) ? { source: "adopted", facts: adopted } : { source: "none", facts: null };
}
