/**
 * SESSION 27 — capture each signed name's current 8-K/10-Q/10-K catalog
 * (metadata only, no text) into a committed fixture, so the read-set key
 * tests run offline over all six. $0: one cached filing-list read per name.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27catalogs.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getRecentFilings } from "../fetch";

(async () => {
  const goldens = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8"))).filter((g) => g.extractionVersion === 31);
  const out = [];
  for (const g of goldens) {
    const f = await getRecentFilings(g.state.company, ["8-K", "10-Q", "10-K"]);
    out.push({ cik: f.cik, company: f.company, capturedOn: new Date().toISOString().slice(0, 10), filings: f.filings });
    console.log(`${f.company}: ${f.filings.length} filings`);
  }
  mkdirSync("lib/cache/fixtures", { recursive: true });
  writeFileSync("lib/cache/fixtures/s27-catalogs.json", JSON.stringify(out, null, 1) + "\n", "utf-8");
})();
