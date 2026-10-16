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
import { addDays } from "../format";

const ROOT = process.cwd();
const BRIEF = process.argv[2] ?? "2026-10-15";

(async () => {
  const dir = join(ROOT, "lib", "cards", "inputs");
  const log = readBriefLog();
  const names: Record<string, { previousBrief: string | null; from: string; filings: unknown[] }> = {};
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) {
    const { cik, company } = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    const prev = previousBrief(log, cik, BRIEF);
    const from = prev ? addDays(prev, 1) : addDays(BRIEF, -6);
    names[cik] = { previousBrief: prev, from, filings: await liveFilingsBetween(cik, from, BRIEF) };
    console.log(`${company}: ${(names[cik].filings as unknown[]).length} filing(s) ${from} to ${BRIEF}`);
  }
  mkdirSync(join(dir, "week"), { recursive: true });
  writeFileSync(join(dir, "week", `${BRIEF}.json`), JSON.stringify({ briefDate: BRIEF, capturedOn: new Date().toISOString().slice(0, 10), names }, null, 1) + "\n", "utf-8");
})();
