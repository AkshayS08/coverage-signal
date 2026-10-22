/**
 * THE RELEASE CHECKLIST CANNOT BE SKIPPED BY PUSHING DIRECTLY.
 *
 * Runs the real .githooks/pre-push against a scratch repository:
 *   P1  the commit the checklist cleared is let through
 *   P2  the release's own ledger commit on top of it (cost-log only) is let through
 *   P3  a commit changing code on top of a cleared one is refused
 *   P4  a commit the checklist never saw is refused, and so is any push with no record
 *   P5  this repository runs that hook (core.hooksPath) and has `npm run release`
 * Negative control: a hook that lets everything through fails P3 and P4.
 *
 * Offline, $0. Run: npx tsx lib/cache/release.test.ts
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const HOOK = resolve(".githooks/pre-push");
const dir = mkdtempSync(join(tmpdir(), "release-hook-"));
const git = (args: string) => execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" }).trim();
const commit = (file: string, body: string, msg: string) => { mkdirSync(join(dir, file, ".."), { recursive: true }); writeFileSync(join(dir, file), body); git(`add -A`); git(`-c user.email=t@t -c user.name=t commit -q -m "${msg}"`); return git("rev-parse HEAD"); };
const push = (sha: string, hook = HOOK) => spawnSync("sh", [hook, "origin", "x"], { cwd: dir, input: `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`, encoding: "utf-8" }).status;

try {
  git("init -q -b main");
  const base = commit("lib/a.ts", "a", "base");
  const cleared = commit("lib/a.ts", "b", "cleared");
  const ledger = commit("baselines/cost-log.jsonl", "{}\n", "ledger");
  git(`checkout -q -b side ${cleared}`);
  const code = commit("lib/a.ts", "c", "code on top");
  git(`checkout -q -b other ${base}`);
  const unseen = commit("lib/b.ts", "d", "never checked");

  const record = join(dir, ".git", "release-checked");
  console.log("\n=== with no record, nothing is let through ===");
  assert(push(cleared) !== 0, "[P4] a push with no release record is refused");
  writeFileSync(record, `${cleared}\n2026-10-22T00:00:00Z\n`);
  console.log("\n=== with the cleared commit recorded ===");
  assert(push(cleared) === 0, "[P1] the cleared commit is let through");
  assert(push(ledger) === 0, "[P2] the release's ledger-only commit on top of it is let through");
  assert(push(code) !== 0, "[P3] a commit changing code on top of the cleared one is refused");
  assert(push(unseen) !== 0, "[P4] a commit the checklist never saw is refused");

  console.log("\n=== negative control: a hook that lets everything through ===");
  const open = join(dir, "open-hook"); writeFileSync(open, "#!/bin/sh\nexit 0\n");
  const caught = [push(code, open) !== 0, push(unseen, open) !== 0].filter((x) => !x).length;
  assert(caught === 2, `[control] the permissive hook fails P3 and P4 (${caught} of 2 caught), so the assertions can tell the two hooks apart`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n=== this repository runs the hook ===");
let hooksPath = "";
try { hooksPath = execSync("git config --get core.hooksPath", { encoding: "utf-8" }).trim(); } catch { /* unset */ }
assert(hooksPath === ".githooks", `[P5] core.hooksPath is ".githooks" (found "${hooksPath}")`);
assert(/"release":\s*"tsx lib\/cache\/release\.ts"/.test(readFileSync("package.json", "utf-8")), "[P5] package.json has `npm run release`");

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
