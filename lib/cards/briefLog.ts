/**
 * THE BRIEF LOG — one committed line per brief per company.
 *
 * "Since last week" means since the previous brief for that name (card_spec
 * 2.2). That date has to come from somewhere a reader can inspect, so it is a
 * committed, append-only file rather than a timestamp in a cache: a name's
 * first brief has no previous entry and uses the trailing seven days.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const BRIEF_LOG = join(process.cwd(), "baselines", "briefs.jsonl");

export interface BriefEntry { cik: string; company: string; briefDate: string }

export function readBriefLog(path = BRIEF_LOG): BriefEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as BriefEntry);
}

/** The latest brief for this name strictly before `briefDate`, or null for a first brief. */
export function previousBrief(entries: BriefEntry[], cik: string, briefDate: string): string | null {
  const prior = entries.filter((e) => e.cik === cik && e.briefDate < briefDate).map((e) => e.briefDate).sort();
  return prior.length ? prior[prior.length - 1] : null;
}

/** Records this brief once. Re-generating the same brief date adds nothing. */
export function recordBrief(entry: BriefEntry, path = BRIEF_LOG): void {
  const all = readBriefLog(path);
  if (all.some((e) => e.cik === entry.cik && e.briefDate === entry.briefDate)) return;
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}
