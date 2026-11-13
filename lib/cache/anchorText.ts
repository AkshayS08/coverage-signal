/**
 * SESSION 27 (Nov 13): THE ANCHOR'S OWN TEXT, for a surface that decides a roll outside the card build (the golden
 * replay, signing). The roll reads its cash-flow statement for exact figures and stated causes; without the text it
 * fails closed. Read from the cached filing text: $0, and the same words the card reads (paragraph breaks aside).
 */
import { getFilingText } from "../fetch/filingText";

export async function anchorTextOf(result: { results: readonly { triggerId: string; debtScheduleSourceFiling?: { url?: string } | null }[] }): Promise<string | null> {
  const url = result.results.find((r) => r.triggerId === "debt-maturity")?.debtScheduleSourceFiling?.url;
  return url ? (await getFilingText(url)).text : null;
}
