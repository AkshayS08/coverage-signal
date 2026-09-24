/**
 * SESSION 23 — v30 AGAINST EVERY SIGNED GOLDEN. $0, writes nothing.
 *
 * The declared result shape said the nine golden names re-extract
 * position-identical, and that ANY name whose position moves is a finding
 * that stops the stage rather than a number to accept. This is what checks
 * that claim, by name and by row, using the golden's own comparator so the
 * definition of "moved" is the one the signature was made under.
 *
 * Run: npx tsx lib/cache/s23goldendiff.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareGoldenFile, type GoldenFile } from "../events/golden";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");

(async () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"));
  console.log(`\n${"=".repeat(100)}`);
  console.log(`v${EXTRACTION_PROMPT_VERSION} AGAINST ${files.length} SIGNED GOLDEN(S) — the declared shape said all of them hold`);
  console.log("=".repeat(100));

  let moved = 0, identical = 0, notApplicable = 0;
  for (const f of files) {
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as GoldenFile;
    const result = await runAgentLoop(golden.state.company);
    const actual = deriveGoldenState(result, PINNED_AS_OF);
    const verdict = compareGoldenFile(golden, actual, EXTRACTION_PROMPT_VERSION);

    const head = `${golden.state.company}  (signed at v${golden.extractionVersion}, now v${EXTRACTION_PROMPT_VERSION})`;
    if (verdict.kind === "matches") {
      identical++;
      console.log(`\n  ✓ ${head}\n      position identical — ${actual.rows.length} rows`);
      continue;
    }
    if (verdict.kind === "not-applicable") {
      notApplicable++;
      // A MOVED FILING SET IS NOT A FAILURE (Rule 30). The pin describes a
      // corpus that no longer exists: stale, not wrong. Saying which it is
      // separates a real regression from an accounting one.
      console.log(`\n  ~ ${head}   NOT APPLICABLE — ${verdict.reason}`);
      for (const a of verdict.added) console.log(`      + ${a}`);
      for (const r of verdict.removed) console.log(`      − ${r}`);
      continue;
    }
    moved++;
    console.log(`\n  ✗ ${head}   DIVERGED — ${golden.state.rows.length} rows signed, ${actual.rows.length} now`);
    for (const d of verdict.divergences) console.log(`      ${d}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  // NOT-APPLICABLE IS NOT "HOLDS", AND THE COUNT MUST NOT SAY IT IS.
  //
  // The first version of this line printed "4 hold, 2 moved", folding three
  // names whose corpus had moved in with the one that actually reproduced.
  // That is the measured-vs-unreachable conflation this book has now hit
  // eight times (Rule 37, and the audit's standing item): a pin that COULD
  // NOT be compared is not a pin that passed, and reporting it as one
  // inflates the only number anyone reads.
  console.log(`  ${identical} reproduced identically.`);
  console.log(`  ${notApplicable} could NOT be compared — their filing set moved, so the pin describes a corpus that no longer exists (Rule 30). Not a pass and not a failure: unverifiable until re-signed.`);
  console.log(`  ${moved} DIVERGED.`);
  if (moved) console.log(`  Every diverged name is a finding to explain before any of them is re-signed.`);
  console.log("=".repeat(100));
})();
