/**
 * Session 14, Step 5 acceptance protocol, run as written:
 *   1. Book A (5 names), 3 runs — byte-identical.
 *   2. Book B (5 different names), 3 runs — byte-identical.
 *   3. Book A a 4th time, after book B — still identical to runs 1-3.
 *
 * Real-cost script (see determinism.test.ts's doc comment for why this is
 * kept separate from `npm test`). Prints cache hit/miss and cold-vs-warm
 * timing for every run, and a final pass/fail per requirement.
 *
 * Run: npx tsx lib/cache/acceptance.test.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runAgentLoop } from "../agent";
import { buildEvents, buildVerifiedFactBase, buildCompanyTableBlock } from "../events";
import { cachedDraftEventBriefing } from "./wordingCache";
import { cacheStats } from "./stats";

const BOOK_A = ["DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health"];
const BOOK_B = ["Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare"];

async function runBookOnce(companies: string[]): Promise<{ json: string; elapsedMs: number; hitSummary: string }> {
  cacheStats.reset();
  const t0 = Date.now();
  const outputs: unknown[] = [];
  for (const company of companies) {
    try {
      const result = await runAgentLoop(company);
      const { flashCardCandidates, portfolio } = buildEvents([result]);
      const factBase = buildVerifiedFactBase(result);

      const eventBriefings = [];
      for (const card of flashCardCandidates) {
        const briefing = await cachedDraftEventBriefing(card, factBase);
        eventBriefings.push({ eventId: card.id, briefing });
      }
      // Deterministic — included in the diffed output for full coverage,
      // though a pure function can't be the source of any drift.
      const table = buildCompanyTableBlock(result, portfolio[0], flashCardCandidates.length);

      outputs.push({ company, result, eventBriefings, table });
    } catch (err) {
      // Mirrors app/api/run/route.ts's per-company try/catch — one bad
      // name must not abort the rest of the book, in this test or in prod.
      outputs.push({ company, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const elapsedMs = Date.now() - t0;
  return { json: JSON.stringify(outputs, null, 2), elapsedMs, hitSummary: cacheStats.summary() };
}

function diffFirstLine(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i}:\n  a: ${al[i]}\n  b: ${bl[i]}`;
  }
  return "(no textual diff found — lengths differ?)";
}

async function runBookNTimes(label: string, companies: string[], n: number): Promise<string[]> {
  console.log(`\n=== ${label}: [${companies.join(", ")}] ===`);
  const jsons: string[] = [];
  for (let i = 1; i <= n; i++) {
    const { json, elapsedMs, hitSummary } = await runBookOnce(companies);
    jsons.push(json);
    console.log(`  run ${i}: ${elapsedMs}ms — ${hitSummary}`);
  }
  return jsons;
}

async function main() {
  const results: { name: string; pass: boolean }[] = [];

  const aRuns = await runBookNTimes("BOOK A, runs 1-3", BOOK_A, 3);
  const aIdentical = aRuns.every((j) => j === aRuns[0]);
  results.push({ name: "Book A: 3 runs byte-identical", pass: aIdentical });
  if (!aIdentical) {
    for (let i = 1; i < aRuns.length; i++) {
      if (aRuns[i] !== aRuns[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(aRuns[0], aRuns[i])}`);
    }
  }

  const bRuns = await runBookNTimes("BOOK B, runs 1-3", BOOK_B, 3);
  const bIdentical = bRuns.every((j) => j === bRuns[0]);
  results.push({ name: "Book B: 3 runs byte-identical", pass: bIdentical });
  if (!bIdentical) {
    for (let i = 1; i < bRuns.length; i++) {
      if (bRuns[i] !== bRuns[0]) console.log(`  ✗ run ${i + 1} vs run 1 — ${diffFirstLine(bRuns[0], bRuns[i])}`);
    }
  }

  console.log(`\n=== BOOK A, run 4 (after book B) ===`);
  const { json: a4, elapsedMs: a4ms, hitSummary: a4hit } = await runBookOnce(BOOK_A);
  console.log(`  run 4: ${a4ms}ms — ${a4hit}`);
  const a4Identical = a4 === aRuns[0];
  results.push({ name: "Book A: run 4 (post-book-B) still identical to runs 1-3", pass: a4Identical });
  if (!a4Identical) {
    console.log(`  ✗ run 4 vs run 1 — ${diffFirstLine(aRuns[0], a4)}`);
  }

  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    console.log(`  ${r.pass ? "✓ PASS" : "✗ FAIL"} — ${r.name}`);
  }

  if (results.every((r) => r.pass)) {
    console.log("\nACCEPTANCE PASSED");
  } else {
    console.log("\nACCEPTANCE FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
