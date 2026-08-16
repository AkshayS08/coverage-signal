/**
 * Session 14 — the permanent tripwire for the whole point of this session:
 * the same book, run twice, must produce byte-identical output. This is a
 * real-cost script (calls Haiku/Sonnet on the FIRST run of any given
 * company; every run after that — including the 2nd and 3rd runs in this
 * same invocation — must hit the answer/wording cache and cost nothing),
 * not an offline fixture replay — deliberately: Session 13 shipped 31/31
 * passing offline tests and a broken live screen because nothing ever
 * asserted this specific property. It is kept separate from `npm test`
 * (same reasoning as buildFixture.ts) so ordinary offline runs stay free;
 * run it explicitly before shipping any change to the caching layer.
 *
 * Run: npx tsx lib/cache/determinism.test.ts "DaVita,HCA Healthcare" 3
 *   arg1 = comma-separated company book (default: DaVita)
 *   arg2 = number of runs (default: 3)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runAgentLoop } from "../agent";
import { buildEvents, buildVerifiedFactBase } from "../events";
import { cachedDraftEventBriefing, cachedDraftPortfolioSummary } from "./wordingCache";
import { cacheStats } from "./stats";

const COMPANIES = (process.argv[2] || "DaVita").split(",").map((s) => s.trim());
const RUNS = Number(process.argv[3] || 3);

async function runBookOnce(companies: string[]): Promise<unknown[]> {
  const outputs: unknown[] = [];
  for (const company of companies) {
    const result = await runAgentLoop(company);
    const { flashCardCandidates, portfolio } = buildEvents([result]);
    const factBase = buildVerifiedFactBase(result);

    const eventBriefings = [];
    for (const card of flashCardCandidates) {
      const briefing = await cachedDraftEventBriefing(card, factBase);
      eventBriefings.push({ eventId: card.id, briefing });
    }
    const portfolioSummary = await cachedDraftPortfolioSummary(portfolio[0], factBase);

    outputs.push({ company, result, eventBriefings, portfolioSummary });
  }
  return outputs;
}

async function main() {
  console.log(`=== Session 14 run-to-run identity test ===`);
  console.log(`book: [${COMPANIES.join(", ")}]  runs: ${RUNS}\n`);

  const jsonPerRun: string[] = [];
  const timings: number[] = [];

  for (let i = 1; i <= RUNS; i++) {
    cacheStats.reset();
    const t0 = Date.now();
    const output = await runBookOnce(COMPANIES);
    const elapsed = Date.now() - t0;
    timings.push(elapsed);
    jsonPerRun.push(JSON.stringify(output, null, 2));
    console.log(`run ${i}: ${elapsed}ms — ${cacheStats.summary()}`);
  }

  let allIdentical = true;
  for (let i = 1; i < jsonPerRun.length; i++) {
    if (jsonPerRun[i] !== jsonPerRun[0]) {
      allIdentical = false;
      console.log(`\n✗ FAIL — run ${i + 1} differs from run 1`);
      const a = jsonPerRun[0].split("\n");
      const b = jsonPerRun[i].split("\n");
      for (let line = 0; line < Math.max(a.length, b.length); line++) {
        if (a[line] !== b[line]) {
          console.log(`  first differing line (${line}):`);
          console.log(`    run 1: ${a[line]}`);
          console.log(`    run ${i + 1}: ${b[line]}`);
          break;
        }
      }
    }
  }

  console.log(`\ncold run: ${timings[0]}ms   warm run(s): ${timings.slice(1).join("ms, ")}ms`);

  if (allIdentical) {
    console.log(`\n✓ PASS — all ${RUNS} runs of [${COMPANIES.join(", ")}] produced byte-identical output`);
    console.log("\nALL DETERMINISM TESTS PASSED");
  } else {
    console.log("\nSOME DETERMINISM TESTS FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
