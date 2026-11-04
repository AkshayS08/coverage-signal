/**
 * SESSION 27 (Akshay, Nov 3, 2026) — NO CHECK PASSES ON ZERO ITEMS.
 *
 * failClosed passed the Nov 3 release reading "0 passed, 0 failed; controls 0 of 0": it selected v31 goldens, and none
 * were left. Every suite and release check fails when it evaluates zero items (names, cards, goldens, samples):
 *   V1  nonEmpty passes a non-empty set through unchanged
 *   V2  control: a suite fed an empty set fails (a child process exits non-zero, naming the set)
 *   V3  the offline runner fails a suite that exits 0 having asserted nothing
 *   V4  every suite that loads a data-driven set guards it (the sweep, by source)
 *
 * Offline, $0. Run: npx tsx lib/testing/nonEmpty.test.ts
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nonEmpty } from "./nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

assert(nonEmpty("three names", ["a", "b", "c"]).length === 3, `[V1] a non-empty set passes through`);

// V2: a suite fed an empty set must fail.
const dir = join(process.env.TEMP ?? ".", "nonEmptyControl");
mkdirSync(dir, { recursive: true });
const suite = join(dir, "empty.test.ts");
writeFileSync(suite, `import { nonEmpty } from ${JSON.stringify(join(process.cwd(), "lib", "testing", "nonEmpty").replace(/\\/g, "/"))};\nconst names: string[] = [];\nlet passed = 0;\nfor (const n of nonEmpty("the signed goldens at the current version", names)) passed++;\nconsole.log(\`\${passed} passed, 0 failed.\`);\n`);
const r = spawnSync("npx", ["tsx", suite], { encoding: "utf-8", shell: true });
const out = `${r.stdout}${r.stderr}`;
assert(r.status !== 0 && /the signed goldens at the current version/.test(out), `[V2 control] a suite fed an empty set exits ${r.status} and names it: ${out.split("\n").find((l) => /vacuous/i.test(l))?.trim() ?? out.slice(0, 120)}`);
rmSync(dir, { recursive: true, force: true });

// V3: the runner's own rule.
const runner = readFileSync(join("lib", "cache", "runOffline.ts"), "utf-8");
assert(/VACUOUS/.test(runner) && /Number\(m\[1\]\) === 0|!m/.test(runner), `[V3] runOffline fails a suite that exits 0 having asserted nothing`);

// V4: every suite reading a data-driven set guards it.
const suites = spawnSync("git", ["ls-files", "lib/**/*.test.ts", "lib/*.test.ts"], { encoding: "utf-8", shell: true }).stdout.trim().split(/\s+/).filter(Boolean);
const LOADS = /readdirSync\(|\.ciks\b|baselines\/golden|s27-refresh-batch|s27-replay|s27-retaste|s27-molina-refresh/;
const unguarded = suites.filter((s) => LOADS.test(readFileSync(s, "utf-8")) && !/nonEmpty\(/.test(readFileSync(s, "utf-8")) && !/lib\/testing\//.test(s));
assert(unguarded.length === 0, `[V4] every suite that loads a data-driven set guards it with nonEmpty (${unguarded.length} unguarded${unguarded.length ? `: ${unguarded.join(", ")}` : ""})`);

// V5: the release checks that are not test files (preflight) guard their sets too.
for (const p of ["lib/cache/preflight.ts"]) assert(/nonEmpty\(/.test(readFileSync(p, "utf-8")), `[V5] ${p} guards its set`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
