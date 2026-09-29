/**
 * WOULD A POSITION-ONLY FILING SET ACTUALLY BE STABLE? $0.
 *
 * The redefinition is only worth making if the fields it keys on hold across
 * runs. Otherwise it moves the instability rather than removing it, and the
 * next session finds a golden that still cannot be compared — with one more
 * layer of indirection in the way.
 *
 * So the candidate definition is measured BEFORE it is built. A position
 * document is one of:
 *   - a LADDER ROW's own citedUrl
 *   - the ANCHOR the schedule was read from
 *   - a citation of the DEBT-MATURITY trigger itself, which is what extracts
 *     the facilities; facility figures carry a sentence and no URL, so this
 *     is the only recorded answer to "which document states this figure"
 *
 * Printed per run, for both held names, next to the full fifteen-trigger union
 * so the difference between the two definitions is visible rather than
 * asserted.
 *
 * Run: npx tsx lib/cache/s24posset.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { positionFilingSetOf } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import type { CompanyResult } from "../agent";

const BUST_TAG = "s23-sign";
const NAMES = ["DaVita", "Community Health Systems", "Tenet Healthcare", "Encompass Health", "Molina Healthcare"];

async function runFor(company: string, run: number | null): Promise<CompanyResult> {
  if (run === null) delete process.env.CACHE_BUST;
  else process.env.CACHE_BUST = `${BUST_TAG}-${company.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${run}`;
  const r = await runAgentLoop(company);
  delete process.env.CACHE_BUST;
  return r;
}

const short = (u: string) => u.split("/").pop() ?? u;

function unionAll(r: CompanyResult): string[] {
  const s = new Set<string>();
  for (const t of r.results) for (const c of t.citations) if (c.url) s.add(c.url);
  return [...s].sort();
}

/**
 * THE REAL FUNCTION, not a copy of it. This began as a local re-implementation
 * so the definition could be measured before being built — and once built, a
 * local copy measures the copy. It now calls what ships, so the numbers below
 * are about the code that runs.
 */
function positionOnly(r: CompanyResult): string[] {
  return positionFilingSetOf(r, PINNED_AS_OF);
}

(async () => {
  let spend = 0;
  for (const company of NAMES) {
    const runs: { label: string; all: string[]; pos: string[] }[] = [];
    for (const run of [null, 1, 2] as const) {
      const r = await runFor(company, run);
      spend += currentCompanySpend().totalUsd;
      runs.push({ label: run === null ? "run 1 (canonical)" : `run ${run + 1}`, all: unionAll(r), pos: positionOnly(r) });
    }
    const allStable = new Set(runs.map((x) => x.all.join("|"))).size === 1;
    const posStable = new Set(runs.map((x) => x.pos.join("|"))).size === 1;

    console.log(`\n${"=".repeat(104)}`);
    console.log(`${company}`);
    console.log("=".repeat(104));
    for (const x of runs) {
      console.log(`  ${x.label.padEnd(20)} all-trigger union ${String(x.all.length).padStart(2)}   position-only ${String(x.pos.length).padStart(2)}   [${x.pos.map(short).join(", ")}]`);
    }
    console.log(`\n  all-trigger union across runs: ${allStable ? "STABLE" : "MOVES — this is what a golden is pinned to today"}`);
    console.log(`  position-only set across runs:  ${posStable ? "STABLE" : "MOVES — the redefinition would NOT fix this name"}`);
    if (!posStable) {
      for (const x of runs) console.log(`      ${x.label}: ${x.pos.map(short).join(", ")}`);
    }
  }
  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
  console.log("=".repeat(104));
})();
