/**
 * SESSION 27 (Nov 20): RECORD EVERY FAILED READ from the refresh builds on disk ($0): each refresh review card whose checks
 * failed (the trust rule's breakage panel) records its anchor as read and failed (baselines/failed_reads.json), so the
 * published card says so instead of "read at the next refresh" (failedReads.ts, releaseHeader.test).
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27failedReads.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { failedReadFromCard, recordFailedRead } from "../cards/failedReads";

const dir = join("sessions", "27", "refresh");
for (const f of readdirSync(dir).filter((x) => /^\d{10}_review_card\.json$/.test(x))) {
  const cik = f.slice(0, 10), inputPath = join(dir, `${cik}_input.json`);
  if (!existsSync(inputPath)) continue;
  const fr = failedReadFromCard(JSON.parse(readFileSync(join(dir, f), "utf-8")), JSON.parse(readFileSync(inputPath, "utf-8")));
  if (!fr) { console.log(`${cik}: checks held; nothing recorded`); continue; }
  recordFailedRead(fr);
  console.log(`${cik}: recorded ${fr.form} ${fr.filingDate} (period ${fr.periodEnd}) read and failed: gap $${Math.round(fr.gapUsd / 1e6)}MM (${fr.gapPct ?? "share not stated"})`);
}
