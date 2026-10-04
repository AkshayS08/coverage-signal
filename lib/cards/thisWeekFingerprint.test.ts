/**
 * THIS-WEEK FILINGS NEVER MOVE THE EXTRACTION CACHE KEY.
 *
 * Reads the LIVE filing list for every signed name the way the card's "this
 * week" lines do, then asks preflight's own question again: would any signed
 * name re-extract? The answer must still be 0 of 6, with every fingerprint
 * unchanged. A card that bills because it looked at this week's filings has
 * broken the one promise a card makes (card_spec 1: building and viewing
 * cards bills nothing).
 *
 * NOT OFFLINE: it reads EDGAR and does one blob HEAD per name. Zero model
 * calls by construction — it imports nothing that can make one.
 *
 * Run: npx tsx lib/cards/thisWeekFingerprint.test.ts
 */
import { loadEnvQuietly } from "../cache/loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFree } from "../cache/freeRun";
import { liveFilingsBetween } from "../fetch/thisWeek";
import { EXTRACTION_PROMPT_VERSION } from "../cache/promptVersion";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

(async () => {
  const dir = join(process.cwd(), "baselines", "golden");
  const signed = readdirSync(dir)
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")))
    .filter((g) => g.extractionVersion === EXTRACTION_PROMPT_VERSION)
    .map((g) => ({ company: g.state.company as string, cik: g.state.cik as string }));

  console.log("=== [1] BEFORE: every signed name is cached ===");
  const before = new Map<string, string>();
  for (const s of signed) {
    const v = await checkFree(s.company);
    before.set(s.company, v.fingerprint);
    assert(v.cached, `[1:${s.company}] cached before the live read (fingerprint ${v.fingerprint.slice(0, 8)})`);
  }

  console.log("\n=== [2] READ THE LIVE FILING LIST, AS THE CARD DOES ===");
  for (const s of signed) {
    const live = await liveFilingsBetween(s.cik, "2000-01-01", "2099-12-31");
    assert(live.length > 0, `[2:${s.company}] the live list was read (${live.length} filings)`);
  }

  console.log("\n=== [3] AFTER: preflight still reads 0 of 6 would re-extract ===");
  let cold = 0;
  for (const s of signed) {
    const v = await checkFree(s.company);
    if (!v.cached) cold++;
    assert(v.fingerprint === before.get(s.company), `[3:${s.company}] fingerprint unchanged by the live read`);
  }
  assert(cold === 0, `[3z] ${cold} of ${signed.length} would re-extract after the live read`);
  assert(signed.length === 6, `[3y] the check covered all ${signed.length} signed names`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
})();
