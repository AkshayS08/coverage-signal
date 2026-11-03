/**
 * SESSION 27 (Akshay, Nov 3, 2026) — CRITERION 7 CHECKS WHAT IT IS FOR.
 *
 * It compared counts (the position's capacity rows against coverage's
 * capacity entries), so Tenet's refresh failed on a correct position: its
 * L/C facility's $200MM commitment is held out as capacity with no position
 * row, and captured face ($13,341MM) holds no capacity. The criterion now
 * checks the two things the count stood for:
 *   K1  every capacity figure is classified as capacity (each position
 *       capacity row is in coverage's capacity report)
 *   K2  no capacity amount is inside captured face (no counted entry is a
 *       capacity item: same label and amount)
 * Over every golden's stored result and the four refresh canonicals; Tenet's
 * refresh passes; control: a capacity amount added to captured face fails.
 *
 * Offline, $0. Run: npx tsx lib/events/capacityCriterion.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assemblePosition, ladderCapacityFor, facilityCategoriesOnLadder } from "./position";
import { computeCoverage } from "./coverage";
import { rolledCoverageFor } from "./rolledCoverage";
import { capacitySeparation, evaluateGoldenCriteria } from "./goldenCriteria";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const quiet = <T>(f: () => T): T => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const parts = (result: any, asOf: Date) => quiet(() => {
  const dm = result.results.find((t: any) => t.triggerId === "debt-maturity");
  const pos = assemblePosition(result, asOf);
  return { pos, cov: computeCoverage(dm, ladderCapacityFor(pos), facilityCategoriesOnLadder(pos, dm?.facilities), rolledCoverageFor(result)) };
});

const cases: { label: string; result: any; asOf: Date }[] = [
  ...readdirSync(join("baselines", "golden")).map((f) => read(join("baselines", "golden", f))).map((g: any) => ({ label: `${g.state.company} golden v${g.extractionVersion}`, result: g.sourceResult, asOf: new Date(`${g.state.asOf}T00:00:00Z`) })),
  ...read("baselines/s27-refresh-batch.json").names.map((n: any) => ({ label: `${n.company} refresh`, result: n.samples.find((s: any) => s.bust === null).result, asOf: new Date("2026-10-31T00:00:00Z") })),
  ...[read("baselines/s27-molina-refresh.json").results.find((x: any) => x.bust === null)].map((x: any) => ({ label: `${x.result.company} refresh`, result: x.result, asOf: new Date("2026-10-29T00:00:00Z") })),
];
for (const c of cases) {
  const { pos, cov } = parts(c.result, c.asOf);
  const k = capacitySeparation(pos, cov);
  assert(k.pass, `[K:${c.label}] ${k.detail}`);
  const seven = quiet(() => evaluateGoldenCriteria(c.result, c.asOf)).criteria.find((x) => x.id === "7")!;
  assert(seven.pass === k.pass && seven.detail === k.detail, `[K7:${c.label}] criterion 7 is this check`);
}

console.log("\n=== Tenet's refresh, and the control ===");
const ten = cases.find((c) => /TENET/.test(c.label) && /refresh/.test(c.label))!;
const { pos, cov } = parts(ten.result, ten.asOf);
assert(cov.capacity.length === 2 && pos.rows.filter((r: any) => r.isCapacity).length === 1 && capacitySeparation(pos, cov).pass, `[K] Tenet's refresh: 2 capacity entries, 1 capacity row, and it passes (${capacitySeparation(pos, cov).detail})`);
const lc = cov.capacity.find((e: any) => /letter of credit/i.test(e.label))!;
const bad = { ...cov, entries: [...cov.entries, { ...lc }], capturedFace: cov.capturedFace + (lc.amount ?? 0) };
assert(!capacitySeparation(pos, bad).pass, `[K control] the L/C facility's $${(lc.amount ?? 0) / 1e6}MM commitment added to captured face fails: ${capacitySeparation(pos, bad).detail}`);
const unreported = { ...cov, capacity: cov.capacity.filter((e: any) => !/revolving/i.test(e.label)) };
assert(!capacitySeparation(pos, unreported).pass, `[K control] a capacity row coverage does not report as capacity fails: ${capacitySeparation(pos, unreported).detail}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
