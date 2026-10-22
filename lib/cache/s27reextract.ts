/**
 * SESSION 27, STAGE 1, STEPS 5-6 — RE-EXTRACT THE SIX UNDER THE READ-SET KEY.
 * BILLS. Not to be run without Akshay's written approval of the declaration
 * in sessions/27/stage1_checkpoint1.md.
 *
 * Re-keying orphans every answer once: under v32 and the read-set key no
 * signed name has a cached base answer, and the proceeds-use answers (keyed
 * on the fingerprint) are orphaned with them. Cigna's referenced-note
 * transcription is keyed on its document and its own version, so the
 * canonical run reads it from cache; a re-taste busts it, as 9b requires.
 *
 * THE RECONCILIATION GATE (checked, not described):
 *   before  the forced misses are EXACTLY the declared names: every declared
 *           name would re-bill, under the canonical key and each re-taste key;
 *   during  every run bills non-zero (a $0 "re-extraction" was served from
 *           somewhere it should not have been), stays under its per-name
 *           ceiling, and leaves its answer at the key checkFree names; the
 *           running total never passes the declared total;
 *   after   all six canonical keys are cached, so the next run is $0.
 * Any breach stops the run before the next call.
 *
 * Phases: "canonical" (step 5's re-key) and "retaste" (step 6's two 9b
 * re-tastes per name). Run the first, then the second:
 *   S27_APPROVED=canonical npx tsx lib/cache/s27reextract.ts canonical
 *   S27_APPROVED=retaste   npx tsx lib/cache/s27reextract.ts retaste
 * Results are written to baselines/s27-<phase>.json for step 6's diffs.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { checkFree, spendTracker } from "./freeRun";

/** Per name, from the ledger: the last v31 extraction (Haiku base + Sonnet proceeds-use), Sept 24-30. */
export const DECLARED: { company: string; usd: number; retasteExtra: number }[] = [
  { company: "TENET HEALTHCARE CORP", usd: 0.2246, retasteExtra: 0 },
  { company: "Encompass Health Corp", usd: 0.1949, retasteExtra: 0 },
  { company: "DAVITA INC.", usd: 0.1923, retasteExtra: 0 },
  { company: "COMMUNITY HEALTH SYSTEMS INC", usd: 0.1428, retasteExtra: 0 },
  { company: "MOLINA HEALTHCARE, INC.", usd: 0.2063, retasteExtra: 0 },
  // A re-taste busts the referenced-note transcription too ($0.0188 at rn-v1, Sept 29).
  { company: "Cigna Group", usd: 0.2001, retasteExtra: 0.0188 },
];
const PER_NAME_CEILING = 1.5;
const BUSTS = ["s27-retaste-1", "s27-retaste-2"];

(async () => {
  const phase = process.argv[2];
  if (phase !== "canonical" && phase !== "retaste") { console.error("usage: s27reextract.ts canonical | retaste"); process.exit(1); }
  if (process.env.S27_APPROVED !== phase) { console.error(`REFUSING: this phase bills. Set S27_APPROVED=${phase} only after Akshay's written approval.`); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("REFUSING: no API key, so nothing could be extracted; a run without one only proves the gate."); process.exit(1); }

  const runs = DECLARED.flatMap((d) => (phase === "canonical" ? [{ ...d, bust: null as string | null, ceiling: d.usd }] : BUSTS.map((b) => ({ ...d, bust: b, ceiling: d.usd + d.retasteExtra }))));
  const declaredTotal = runs.reduce((a, r) => a + r.ceiling, 0);

  // BEFORE: the forced misses are exactly the declared runs.
  const before = await Promise.all(runs.map((r) => checkFree(r.company, r.bust)));
  const cached = before.filter((v) => v.cached);
  if (cached.length) { console.error(`REFUSING: ${cached.length} declared run(s) are already cached, so the forced misses do not equal the declared names:\n${cached.map((v) => `  ${v.company} ${v.key}`).join("\n")}`); process.exit(1); }
  console.log(`GATE before: ${runs.length} forced miss(es), exactly the declared runs. Declared total $${declaredTotal.toFixed(4)}.`);

  const spend = spendTracker();
  const results: { company: string; bust: string | null; usd: number; key: string; result: unknown }[] = [];
  for (const [n, r] of runs.entries()) {
    if (r.bust) process.env.CACHE_BUST = r.bust; else delete process.env.CACHE_BUST;
    const result = await runAgentLoop(r.company);
    const usd = spend.record(`${r.company}${r.bust ? ` (${r.bust})` : ""}`);
    delete process.env.CACHE_BUST;
    const after = await checkFree(r.company, r.bust);
    console.log(`  ${r.company}${r.bust ? ` [${r.bust}]` : ""}: $${usd.toFixed(4)} (declared $${r.ceiling.toFixed(4)}), answer ${after.cached ? "written" : "MISSING"} at ${after.key}`);
    results.push({ company: r.company, bust: r.bust, usd, key: after.key, result });
    const breach =
      usd === 0 ? "billed $0: the answer came from somewhere other than this extraction" :
      usd > r.ceiling * PER_NAME_CEILING ? `billed $${usd.toFixed(4)}, over ${PER_NAME_CEILING}x its declared $${r.ceiling.toFixed(4)}` :
      !after.cached ? "no answer at the key checkFree names" :
      spend.totalUsd > declaredTotal && n < runs.length - 1 ? `running total $${spend.totalUsd.toFixed(4)} passed the declared $${declaredTotal.toFixed(4)}` : null;
    if (breach) { writeFileSync(`baselines/s27-${phase}.json`, JSON.stringify({ stoppedAt: r.company, breach, results }, null, 1) + "\n"); console.error(`STOPPED: ${r.company}: ${breach}. ${spend.line()}`); process.exit(1); }
  }

  // AFTER: the canonical keys are cached, so the next run of each is $0.
  if (phase === "canonical") {
    const post = await Promise.all(DECLARED.map((d) => checkFree(d.company)));
    const cold = post.filter((v) => !v.cached);
    if (cold.length) { console.error(`GATE after FAILED: ${cold.map((v) => v.company).join(", ")} not cached`); process.exit(1); }
    console.log(`GATE after: all ${post.length} canonical keys cached; the next run of each is $0.`);
  }
  writeFileSync(`baselines/s27-${phase}.json`, JSON.stringify({ declaredTotal, spentTotal: spend.totalUsd, results }, null, 1) + "\n");
  console.log(spend.line());
})().catch((e) => { console.error(e); process.exit(1); });
