/**
 * SESSION 27 (Akshay, Nov 20): ONE BRIEF DATE PER RELEASE, AND THE BUILD EACH CARD SERVES (releaseHeader.test).
 *
 * Every published card renders at the same brief date — the release date — with the same brief week and the same
 * 18-month window. Each card still serves its last build, and its header lists the filings since that build.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { factsReadSetOf } from "./factsValidity";

/** What makes a release's cards disagree on their brief: date, brief week or 18-month window. Empty when they agree. */
export function mixedBriefDates(cards: any[], briefDate: string): string[] {
  const out: string[] = [];
  const week = cards[0]?.v3?.header?.label, window = cards.find((c) => c?.v3?.call)?.v3?.call?.label;
  for (const c of cards) {
    if (c.briefDate !== briefDate) out.push(`${c.company}: brief date ${c.briefDate}, the release's is ${briefDate}`);
    if (c.v3?.header?.label !== week) out.push(`${c.company}: brief week "${c.v3?.header?.label}", not "${week}"`);
    if (c.v3?.call && c.v3.call.label !== window) out.push(`${c.company}: window "${c.v3.call.label}", not "${window}"`);
  }
  return out;
}

/**
 * The date of the build a card serves: its signed golden's read-set date where the card is built from that golden's
 * read set; else the latest build recorded for the name (baselines/builds.json) — e.g. CHS's Stage 2 refresh. A build
 * that failed its checks (Cigna's Nov 5 refresh) is not served, so it never moves this date.
 */
export function servedBuildDate(cik: string, input: { result: any }, root = process.cwd()): string | null {
  const g = join(root, "baselines", "golden", `${cik}.json`);
  if (existsSync(g)) {
    const golden = JSON.parse(readFileSync(g, "utf-8"));
    const asOf = golden.readSetAsOf ?? golden.state?.readSetAsOf ?? null;
    if (asOf && factsReadSetOf(golden.sourceResult) === factsReadSetOf(input.result)) return asOf;
  }
  const builds = (JSON.parse(readFileSync(join(root, "baselines", "builds.json"), "utf-8")).builds[cik] ?? []) as { readSetAsOf: string }[];
  const rsDates = (input.result.recordedReadSet ?? []).filter((r: any) => r.via === "base").map((r: any) => r.filingDate as string).sort();
  const newest = rsDates[rsDates.length - 1] ?? "";
  // The latest recorded build whose read set reaches the card's newest read document.
  return builds.map((b) => b.readSetAsOf).filter((d) => d >= newest).sort()[0] ?? null;
}
