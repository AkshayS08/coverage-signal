/**
 * Regenerates the golden-test fixture (Session 11, Step 4) by running the
 * real extraction pipeline (Haiku, with the eventDate/eventStatus/
 * proceedsUse schema) against the full 8-company book and caching the
 * result to __fixtures__/session11-facts.json. eligibility.test.ts loads
 * that fixture and runs entirely offline afterward, at zero API cost —
 * this script is the one-time real cost that (re)produces it.
 *
 * Re-run this only when the fixture genuinely needs refreshing (e.g. the
 * companies' filings have moved on enough that the golden facts no longer
 * reflect anything real) — not as part of normal `npm test` runs.
 *
 * Run: npx tsx lib/events/buildFixture.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";

const COMPANIES = [
  "DaVita",
  "HCA Healthcare",
  "Tenet Healthcare",
  "Universal Health Services",
  "Encompass Health",
  "Acadia Healthcare",
  "Concentra Group Holdings",
  "Surgery Partners",
];

async function main() {
  const companies = [];
  for (const name of COMPANIES) {
    console.log(`\n=== ${name} ===`);
    const result = await runAgentLoop(name);
    companies.push(result);
  }

  const fixture = {
    generatedAt: new Date().toISOString(),
    companies,
  };

  const outPath = join(__dirname, "__fixtures__/session11-facts.json");
  writeFileSync(outPath, JSON.stringify(fixture, null, 2));
  console.log(`\nFixture written: ${outPath} (generatedAt=${fixture.generatedAt})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
