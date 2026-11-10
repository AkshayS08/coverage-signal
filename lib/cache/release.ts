/**
 * THE RELEASE CHECKLIST, AS CODE (Akshay, Oct 21, 2026).
 *
 * `npm run release` is the only push path. It runs every required check at
 * $0, in order, and pushes only if all of them pass:
 *
 *   1. preflight              no failed read; reports which names would re-extract
 *   2. (60s pause)            the checks after it never read a blob preflight
 *                             just rewrote (build log, Oct 21: read-after-overwrite)
 *   3. goldenThroughLoop      every signed name reproduces at $0, or is reported
 *                             not comparable with its reason; no failed read
 *   4. the offline suite      every suite in lib/ that needs no network, its shown-card checks over the
 *                             published cards (all must pass); 4b runs them over the review cards and reports
 *                             (a failing review card blocks only its own signing: releaseGate.test)
 *   5. failClosed             a failed or hung read stops the build, named, at $0
 *
 * Then it records the commit it cleared in .git/release-checked, commits any
 * $0 ledger lines the checks wrote (refusing if any line billed), pushes, and
 * waits until /api/health serves the pushed SHA.
 *
 * The pre-push hook (.githooks/pre-push, via core.hooksPath) refuses a push
 * to main of any commit this did not clear, so the checklist cannot be
 * skipped by pushing directly. (`git push --no-verify` bypasses any git hook;
 * that is a deliberate act, not a skipped step.)
 *
 * Run: npm run release
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN_SUITES } from "../cards/shownCards";

const HEALTH = "https://coverage-signal.vercel.app/api/health";
const LEDGER = "baselines/cost-log.jsonl";
const sh = (cmd: string) => execSync(cmd, { encoding: "utf-8" }).trim();
const fail = (why: string): never => { console.error(`\nRELEASE REFUSED: ${why}`); process.exit(1); };

function check(label: string, script: string, env: Record<string, string> = {}): void {
  console.log(`\n=== ${label} ===`);
  const started = Date.now();
  const r = spawnSync("npx", ["tsx", script], { stdio: "inherit", shell: true, env: { ...process.env, ANTHROPIC_API_KEY: "", ...env } });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.status !== 0) fail(`${label} exited ${r.status} after ${secs}s. Nothing was pushed.`);
  console.log(`=== ${label}: passed (${secs}s) ===`);
}

/** Every shown-card suite over the review cards: reported, never gating. A failing review card cannot be signed. */
function reviewReport(): void {
  console.log(`\n=== 4b. the review cards (reported, not gating) ===`);
  const failing: string[] = [];
  for (const t of SHOWN_SUITES) {
    const r = spawnSync("npx", ["tsx", t], { encoding: "utf-8", shell: true, env: { ...process.env, ANTHROPIC_API_KEY: "", SHOWN_SCOPE: "review" } });
    const tally = (/(\d+ passed, \d+ failed)/.exec(r.stdout ?? "") ?? [])[1] ?? `exit ${r.status}`;
    console.log(`  ${r.status === 0 ? "✓" : "✗"} ${t}  ${tally}`);
    if (r.status !== 0) failing.push(...(r.stdout ?? "").split("\n").filter((l) => /✗ FAIL/.test(l)).map((l) => `    ${l.trim().slice(0, 200)}`));
  }
  console.log(failing.length ? `  Review cards with failures cannot be signed until they pass:\n${failing.join("\n")}` : "  Every review card passes.");
}

(async () => {
  if (sh("git rev-parse --abbrev-ref HEAD") !== "main") fail("not on main");
  if (sh("git status --porcelain")) fail("the working tree has uncommitted changes; the checks must run on exactly what is pushed");
  const sha = sh("git rev-parse HEAD");
  const ledgerBefore = readFileSync(LEDGER, "utf-8").trim().split("\n").length;
  console.log(`Release checklist for ${sha.slice(0, 7)}. Every check runs with the API key blank, so none can bill.`);

  check("1. preflight", "lib/cache/preflight.ts");
  console.log("\n(60s pause: no check reads a blob preflight just rewrote)");
  await new Promise((r) => setTimeout(r, 60_000));
  check("3. goldenThroughLoop", "lib/cache/goldenThroughLoop.test.ts");
  // Nov 9 (releaseGate.test): the release is gated on the published cards, which must all pass, and on every check
  // that is not about a card. The review cards are checked too, and reported: a failing one blocks only its own signing.
  check("4. offline suite (shown cards: the published)", "lib/cache/runOffline.ts", { SHOWN_SCOPE: "published" });
  reviewReport();
  check("5. failClosed", "lib/cache/failClosed.test.ts");

  // The checks write $0 lines to the ledger. Any line that billed stops the release.
  const added = readFileSync(LEDGER, "utf-8").trim().split("\n").slice(ledgerBefore).map((l) => JSON.parse(l));
  const billed = added.filter((j) => (j.totalUsd ?? 0) > 0);
  if (billed.length) fail(`${billed.length} ledger line(s) written by the checks billed: ${billed.map((j) => `${j.company} $${j.totalUsd}`).join(", ")}`);
  const changed = sh("git status --porcelain");
  if (changed && changed.split("\n").some((l) => !l.endsWith(LEDGER))) fail(`the checks changed files other than the ledger:\n${changed}`);

  writeFileSync(join(sh("git rev-parse --git-dir"), "release-checked"), `${sha}\n${new Date().toISOString()}\npreflight, goldenThroughLoop, offline suite (published cards), review cards reported, failClosed\n`);
  if (changed) {
    sh(`git add ${LEDGER}`);
    sh(`git commit -q -m "Ledger: $0 scopes from the release checks (${added.length} lines)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`);
  }
  const pushed = sh("git rev-parse HEAD");
  console.log(`\nAll checks passed. Pushing ${pushed.slice(0, 7)}${pushed !== sha ? ` (${sha.slice(0, 7)} plus its $0 ledger lines)` : ""}.`);
  const p = spawnSync("git", ["push", "origin", "main"], { stdio: "inherit" });
  if (p.status !== 0) fail("git push failed");

  for (let i = 0; i < 45; i++) {
    try {
      const h = (await (await fetch(HEALTH, { cache: "no-store" })).json()) as { sha: string | null };
      if (h.sha === pushed) { console.log(`\n/api/health serves ${pushed} — released.`); return; }
    } catch { /* the deployment may be mid-swap */ }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  fail(`pushed, but /api/health did not serve ${pushed.slice(0, 7)} within 15 minutes; check the Vercel deployment`);
})();
