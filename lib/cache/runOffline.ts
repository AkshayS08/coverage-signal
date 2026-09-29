/**
 * EVERY OFFLINE SUITE, DISCOVERED RATHER THAN LISTED.
 *
 * `test:offline` was a hand-maintained chain of 37 paths. Thirteen suites had
 * drifted off it, three of them shipped in this session's own pass — so a
 * green "all offline tests pass" was a true statement about a list and a
 * false one about the repo.
 *
 * Same defect class the log keeps finding: a check whose inputs make its
 * answer predetermined (Rules 42, 43, 52). A runner that can only run what
 * someone remembered to add cannot fail for the suite nobody added.
 *
 * So the list is gone. This walks lib/ for *.test.ts and runs all of them.
 * The only exclusions are suites that are NOT offline — they call the network
 * or bill — and each is named with the reason, because an exclusion nobody
 * can see is how the list got wrong in the first place.
 *
 * Run: npm run test:offline
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

/** NOT offline. Named individually — a pattern here would quietly swallow the next one. */
const NOT_OFFLINE: Record<string, string> = {
  "lib/cache/acceptance.test.ts": "determinism run — reads the live blob cache and replays both books",
  "lib/cache/liveAcceptance.test.ts": "hits the deployed site",
  "lib/cache/liveMarkerScan.test.ts": "hits the deployed site",
  // SESSION 24 — golden.test.ts IS NO LONGER EXCLUDED, and its removal from
  // this list is the point.
  //
  // THE AUDIT SPINE DID NOT COVER THE SIGNATURES. Every "47 of 47 suites,
  // 1,109 assertions" reported across Sessions 22, 23 and 24 excluded the one
  // suite that checks whether the signed goldens still reproduce. Green never
  // meant the pins held. It was reported alongside three fresh signatures as
  // though it did — and when fix 1's narrowing broke nine assertions about
  // those very files, the runner said 47 of 47 and the failures were only
  // visible by running the suite by hand.
  //
  // The exclusion reason was legitimate: it reads the blob cache. The
  // consequence was not: a golden could rot indefinitely without the routine
  // command noticing. Same family as the mid-file summary lines and the
  // hardcoded HIGHEST_RULE — a measurement whose scope quietly excluded the
  // thing it was trusted to measure.
  //
  // It runs. When the cache it needs is absent, the runner reports NOT RUN and
  // FAILS, because "could not check the signatures" and "the signatures are
  // fine" must never print the same way.
  // NOT OFFLINE, and it took a flaky failure to notice. It calls
  // getRecentFilings and getFilingText — the blob store and EDGAR — so it
  // fails intermittently when the network does, and a suite that can fail for
  // reasons unrelated to the code makes the whole runner's green untrustworthy.
  // It passes 52/52 when run alone; it is not broken, it is misfiled.
  "lib/fetch/noteLocation.test.ts": "reads filing text from the blob cache and EDGAR — run it with the live checks, not the offline set",
  // BILLS. Its own header says so: "This is a real-cost script (calls
  // Haiku/Sonnet on the FIRST run of any given company) ... It is kept
  // separate from `npm test` ... so ordinary offline runs stay free."
  //
  // The hand-maintained list it replaced had excluded it deliberately.
  // DISCOVERY SWEPT IT BACK IN — a list that was wrong by omission replaced
  // by discovery that was wrong by inclusion — and it re-extracted DaVita at
  // v31 during a routine `npm run test:offline`, spending real money and
  // breaking the cold pass's 10/10 reconciliation gate before it ran.
  //
  // An exclusion list is not a nuisance to keep short. It is the only place
  // this runner can know what discovery cannot see.
  "lib/cache/determinism.test.ts": "BILLS — calls Haiku/Sonnet on the first run of any company; its own header keeps it out of the ordinary test path",
};

/** The suites excluded above still have to be RUNNABLE. Named so nobody has to grep for how. */
const HOW_TO_RUN_EXCLUDED = "npx tsx <path>  (each runs standalone; they need network and, for goldens, the blob token)";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const root = process.cwd();
const all = walk(join(root, "lib"))
  .map((p) => relative(root, p).split("\\").join("/"))
  .sort();
const skipped = all.filter((p) => p in NOT_OFFLINE);
const suites = all.filter((p) => !(p in NOT_OFFLINE));

console.log(`\n${"=".repeat(100)}`);
console.log(`OFFLINE SUITES — ${suites.length} discovered, ${skipped.length} excluded by name`);
console.log("=".repeat(100));
for (const s of skipped) console.log(`  ~ skipped  ${s}  — ${NOT_OFFLINE[s]}`);
if (skipped.length) console.log(`  run them with: ${HOW_TO_RUN_EXCLUDED}`);

const failed: string[] = [];
let totalAsserts = 0;
for (const suite of suites) {
  const r = spawnSync("npx", ["tsx", suite], { encoding: "utf-8", shell: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) totalAsserts += Number(m[1]);
  const ok = r.status === 0;
  // A SUITE THAT COULD NOT RUN IS NOT A SUITE THAT PASSED.
  //
  // golden.test.ts needs the blob cache. When that is unreachable it cannot
  // say anything about the signed goldens, and the one outcome this runner
  // must never produce is silence that reads as green. It is reported as NOT
  // RUN and it FAILS the run — the same disposition the codebase already gives
  // a comparison that cannot read its inputs (Rule 61).
  const couldNotRun = !m && /Blob cache read failed|fetch failed|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(out);
  if (couldNotRun) {
    failed.push(suite);
    console.log(`\n  ⚠ NOT RUN  ${suite}`);
    console.log(`        its inputs were unreachable, so it checked NOTHING. This fails the run rather than`);
    console.log(`        passing quietly: "could not check" and "checked and fine" must not print the same way.`);
    console.log(out.split("\n").filter((l) => /Blob cache read failed|fetch failed|Error/i.test(l)).slice(0, 4).map((l) => `        ${l}`).join("\n"));
  }
  else if (!ok) { failed.push(suite); console.log(`\n  ✗ FAIL  ${suite}${m ? `  (${m[0]})` : ""}`); console.log(out.split("\n").filter((l) => /FAIL|Error|✗/.test(l)).slice(0, 12).map((l) => `        ${l}`).join("\n")); }
  else console.log(`  ✓ ${suite.padEnd(52)} ${m ? m[0] : "(no assertion count printed)"}`);
}

console.log(`\n${"=".repeat(100)}`);
console.log(`  ${suites.length - failed.length} of ${suites.length} suites passed — ${totalAsserts} assertions`);
if (failed.length) { console.log(`  FAILED: ${failed.join(", ")}`); process.exit(1); }
console.log("=".repeat(100));
