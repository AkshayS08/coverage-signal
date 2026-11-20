/**
 * THIS WEEK'S FILINGS, PER BRIEF — the only card input that changes weekly.
 *
 * Reads each signed name's live EDGAR filing list as metadata (form, date,
 * 8-K items, URL), without touching the corpus cache (lib/fetch/thisWeek.ts),
 * for the window since that name's previous logged brief. Written to
 * lib/cards/inputs/week/<briefDate>.json. A new filing reaches a card only
 * through this file, so it can only change the This-week lines.
 *
 * Run: npx tsx lib/cards/capture/week.ts [briefDate]
 */
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveFilingsBetween } from "../../fetch/thisWeek";
import { previousBrief, readBriefLog } from "../briefLog";
import { briefDateArg, briefWeek } from "../briefDate";
import { servedBuildDate } from "../releaseBrief";

const ROOT = process.cwd();
const BRIEF = briefDateArg(); // Session 27: today's date in New York unless one is given

(async () => {
  const dir = join(ROOT, "lib", "cards", "inputs");
  const log = readBriefLog();
  const names: Record<string, { previousBrief: string | null; from: string; sinceBuild: string | null; filings: unknown[] }> = {};
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) {
    const input = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    const { cik, company } = input;
    const prev = previousBrief(log, cik, BRIEF);
    // Nov 20 (Akshay): each card serves its last build, and its header lists the filings since that build — from the
    // day after it where that is before the brief week (Cigna serves its Oct 15 build; its Nov 5 10-Q is listed).
    const sinceBuild = servedBuildDate(cik, input);
    const weekFrom = briefWeek(BRIEF, prev).from;
    const after = sinceBuild ? new Date(Date.parse(`${sinceBuild}T00:00:00Z`) + 864e5).toISOString().slice(0, 10) : weekFrom;
    const from = after < weekFrom ? after : weekFrom;
    names[cik] = { previousBrief: prev, from, sinceBuild, filings: await liveFilingsBetween(cik, from, BRIEF) };
    console.log(`${company}: ${(names[cik].filings as unknown[]).length} filing(s) ${from} to ${BRIEF}`);
  }
  mkdirSync(join(dir, "week"), { recursive: true });
  writeFileSync(join(dir, "week", `${BRIEF}.json`), JSON.stringify({ briefDate: BRIEF, capturedOn: new Date().toISOString().slice(0, 10), names }, null, 1) + "\n", "utf-8");
})();
