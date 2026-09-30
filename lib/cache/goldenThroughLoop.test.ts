/**
 * THE PRIMARY GOLDEN VERIFICATION — EACH SIGNED NAME RE-DERIVED THROUGH THE
 * CURRENT LOOP, FROM ITS CACHED RAW ANSWERS.
 *
 * `golden.test.ts` re-derives each signed state from the `CompanyResult`
 * stored INSIDE the golden file. That is the right test for the DERIVATION
 * layer — position assembly, coverage, Tier 2 — and it is structurally unable
 * to see a change in `loop.ts`, because the stored result was captured AFTER
 * the loop ran. A filter added to extraction cannot reach those bytes.
 *
 * This session proved the gap is not theoretical. Rules 71–74 all live in the
 * loop, and every one of them would have shipped under a green
 * `golden.test.ts` reporting "five goldens reproduce" without executing a
 * single line of any of them. A check whose inputs make its answer
 * predetermined is this project's most-logged defect, and the suite trusted
 * to protect five signatures was one.
 *
 * So verification runs the PIPELINE:
 *
 *     cached raw answers  →  the current loop  →  deriveGoldenState  →  compare
 *
 * Nothing about a signed name is assumed. If a code change moves a signed
 * position, this fails by name, and the replay in `golden.test.ts` stays as
 * the secondary check on the derivation half.
 *
 * NOT OFFLINE, AND IT CANNOT BE. It reads the filing list and the answer
 * cache, which is exactly what makes it able to answer the question. It is
 * excluded from the offline runner by name and `golden.test.ts` prints a
 * standing reminder that it is the one that has to run.
 *
 * FREE BY ASSERTION, NOT BY HOPE (Rule 75). Every run is preflighted against
 * its own answer key first, so a lapsed filing-list TTL that has moved a
 * corpus fingerprint stops this suite rather than quietly re-extracting ten
 * companies. That happened, on an instruction that said no spend, for $0.5714.
 *
 * Run: npx tsx lib/cache/goldenThroughLoop.test.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, positionFilingSetOf, type GoldenFile } from "../events/golden";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { assertFree, spendTracker } from "./freeRun";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");

(async () => {
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];
  const goldens = files.map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as GoldenFile);
  const current = goldens.filter((g) => (g.extractionVersion ?? 0) === EXTRACTION_PROMPT_VERSION);

  console.log("=== [1] THERE IS SOMETHING TO VERIFY ===");
  assert(files.length > 0,
    `[1a] signed golden files exist (found ${files.length} in baselines/golden) — a verification over an empty directory cannot fail, so it is not a verification (Rule 44)`);
  assert(current.length > 0,
    `[1b] and ${current.length} of them are at the current extraction v${EXTRACTION_PROMPT_VERSION}, so the pins actually apply. A suite where every file is skipped as cross-version is green about nothing`);
  for (const g of goldens.filter((x) => (x.extractionVersion ?? 0) !== EXTRACTION_PROMPT_VERSION)) {
    console.log(`  — NOT COMPARED: ${g.state.company} was captured at v${g.extractionVersion ?? "(unrecorded)"} and the code is v${EXTRACTION_PROMPT_VERSION}. The pin does not apply across a schema change (Rule 30); re-sign it, do not compare it.`);
  }

  console.log("\n=== [2] THE RUN IS FREE BEFORE IT RUNS (Rule 75) ===");
  let preflighted = false;
  try {
    await assertFree(current.map((g) => ({ company: g.state.company })));
    preflighted = true;
  } catch (e) {
    console.error(`  ${(e as Error).message}`);
  }
  assert(preflighted,
    "[2a] every signed name's answer is reachable in cache, so this suite re-derives rather than re-extracts. A corpus whose fingerprint has moved STOPS this suite: re-extracting ten companies to check five signatures is a different act, and it is priced and authorised separately (Rule 13)");
  if (!preflighted) {
    console.error(`\n${passed} passed, ${failed} failed.`);
    console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("\n=== [3] EACH SIGNED NAME, RE-DERIVED THROUGH THE CURRENT LOOP ===");
  const spend = spendTracker();
  for (const g of current) {
    const name = g.state.company;
    delete process.env.CACHE_BUST;
    const result = await runAgentLoop(name);
    spend.record(name);
    const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
    const actual = deriveGoldenState(result, asOf);
    const verdict = compareToGolden(g.state, actual);
    assert(verdict.kind === "matches",
      `[3:${name}] REPRODUCES THROUGH THE LOOP${
        verdict.kind === "diverged" ? ` — DIVERGED:\n      ${verdict.divergences.join("\n      ")}`
        : verdict.kind === "not-applicable" ? ` — ${verdict.reason}`
        : ""
      }`);
    assert(positionFilingSetOf(result, asOf).join("|") === g.state.filingSet.join("|"),
      `[3id:${name}] and rests on the same documents it was signed against — the position identity, which is what makes the comparison meaningful at all (Rule 65)`);
  }

  console.log("\n=== [4] AND IT COST NOTHING ===");
  assert(spend.totalUsd === 0,
    `[4a] ${spend.line()}. A verification that re-extracts is measuring a new answer, not checking an old one`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
})();
