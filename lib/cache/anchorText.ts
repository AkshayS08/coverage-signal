/**
 * SESSION 27 (Nov 13): THE ANCHOR'S OWN TEXT, for a surface that decides a roll outside the card build (the golden
 * replay, signing). The roll reads its cash-flow statement for exact figures and stated causes; without the text it
 * fails closed. Read from the cached filing text: $0, and the same words the card reads (paragraph breaks aside).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFilingText } from "../fetch/filingText";

export async function anchorTextOf(result: { results: readonly { triggerId: string; debtScheduleSourceFiling?: { url?: string } | null }[] }): Promise<string | null> {
  const url = result.results.find((r) => r.triggerId === "debt-maturity")?.debtScheduleSourceFiling?.url;
  return url ? (await getFilingText(url)).text : null;
}

/**
 * The same, read from the committed card input (lib/cards/inputs/<cik>.json) — for an offline check that derives a
 * signed state without the network. Null where the input does not hold the anchor's text.
 */
export function anchorTextCommitted(result: { cik?: string; results: readonly { triggerId: string; debtScheduleSourceFiling?: { url?: string } | null }[] }): string | null {
  const url = result.results.find((r) => r.triggerId === "debt-maturity")?.debtScheduleSourceFiling?.url;
  if (!url || !result.cik) return null;
  try { return JSON.parse(readFileSync(join("lib", "cards", "inputs", `${String(result.cik).padStart(10, "0")}.json`), "utf-8")).docs?.[url]?.text ?? null; } catch { return null; }
}
