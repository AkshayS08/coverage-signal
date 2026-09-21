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
  "lib/events/golden.test.ts": "replays signed goldens from the blob cache",
};

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

const failed: string[] = [];
let totalAsserts = 0;
for (const suite of suites) {
  const r = spawnSync("npx", ["tsx", suite], { encoding: "utf-8", shell: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) totalAsserts += Number(m[1]);
  const ok = r.status === 0;
  if (!ok) { failed.push(suite); console.log(`\n  ✗ FAIL  ${suite}${m ? `  (${m[0]})` : ""}`); console.log(out.split("\n").filter((l) => /FAIL|Error|✗/.test(l)).slice(0, 12).map((l) => `        ${l}`).join("\n")); }
  else console.log(`  ✓ ${suite.padEnd(52)} ${m ? m[0] : "(no assertion count printed)"}`);
}

console.log(`\n${"=".repeat(100)}`);
console.log(`  ${suites.length - failed.length} of ${suites.length} suites passed — ${totalAsserts} assertions`);
if (failed.length) { console.log(`  FAILED: ${failed.join(", ")}`); process.exit(1); }
console.log("=".repeat(100));
