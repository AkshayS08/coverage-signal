/**
 * SESSION 20 — THE BRIDGE MEASUREMENT, PINNED.
 *
 * COVERAGE_RESIDUAL_LIMIT is 2.5% because the book's real bridge was
 * measured, not assumed. That measurement was first done by a throwaway
 * script that then disagreed with itself across rewrites, so the number was
 * confirmed by hand against each note's own adjustment lines. A threshold
 * resting on a hand-count is a threshold nobody can re-derive.
 *
 * This suite IS the measurement, run against the committed baseline. It is
 * the source of truth for the threshold from here on: if a future book's
 * bridge moves, this fails and states the new figure, and the response is to
 * itemise the new bridge item — never to raise the line.
 *
 * Run: npx tsx lib/events/bridgeMeasurement.test.ts
 */
import { readFileSync } from "node:fs";
import { computeCoverage, COVERAGE_RESIDUAL_LIMIT } from "./coverage";
import { normalizeScheduleSequence, parseMoneyAmount } from "./position";
import type { CompanyResult } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const book = JSON.parse(readFileSync("baselines/s20-stage2.json", "utf8")) as { company: string; result: CompanyResult }[];
const dmOf = (c: string) => book.find((b) => b.company === c)?.result.results.find((r) => r.triggerId === "debt-maturity");

/**
 * The stated bridge, per company, as a FRACTION of stated total debt —
 * measured from the committed baseline, at the anchor, before any prose
 * instrument exists. Each figure is the note's own discount /
 * deferred-financing line, named beside it.
 */
const EXPECTED_BRIDGE: [string, number, string][] = [
  ["Encompass Health", 0.0, "no discount line stated"],
  ["Cigna Group", 0.0, "no discount line stated"],
  ["Quest Diagnostics", 0.0057, '"Debt issuance costs" (32)'],
  ["DaVita", 0.0062, '"Discount, premium and deferred financing costs" (66,503)'],
  ["Tenet Healthcare", 0.0064, '"Unamortized issue costs and note discounts" (85)'],
  ["Molina Healthcare", 0.0082, '"Deferred debt issuance costs" (31)'],
  ["HCA Healthcare", 0.0091, '"Debt issuance costs and discounts" (451)'],
  ["Community Health Systems", 0.0200, '"Less: Unamortized deferred debt issuance costs" (192)'],
];

console.log("\n=== [1] The measured bridge, per company ===");
{
  for (const [company, expected, source] of EXPECTED_BRIDGE) {
    const dm = dmOf(company);
    const caps = dm?.balanceSheetDebtCaptions ?? [];
    const stated = caps.reduce((a, c) => a + (parseMoneyAmount(c.amount) ?? 0), 0);
    const bridge = normalizeScheduleSequence(dm?.scheduleSequence)
      .filter((e) => e.kind === "adjustment")
      .filter((e) => !/current|within one year|due within/i.test(e.label ?? ""))
      .reduce((a, e) => a + (parseMoneyAmount(e.amount) ?? 0), 0);
    const frac = stated ? Math.abs(bridge) / Math.abs(stated) : 0;
    assert(Math.abs(frac - expected) < 0.0015,
      `[1] ${company}: bridge ${(frac * 100).toFixed(2)}% of stated total, expected ${(expected * 100).toFixed(2)}% — ${source}`);
  }
}

console.log("\n=== [2] The threshold clears every measured bridge item ===");
{
  const worst = EXPECTED_BRIDGE.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert(worst[1] < COVERAGE_RESIDUAL_LIMIT,
    `[2a] the largest measured bridge is ${worst[0]} at ${(worst[1] * 100).toFixed(2)}%, inside the ${(COVERAGE_RESIDUAL_LIMIT * 100).toFixed(1)}% line`);
  assert(COVERAGE_RESIDUAL_LIMIT < 0.046,
    "[2b] and the line sits BELOW UHS's drawn revolver at 4.6% of its total — the smallest single instrument this check must still catch");
}

console.log("\n=== [3] The bridge is subtracted, so the residual it leaves is ~zero ===");
{
  // These four have no current-portion complication and no prose instruments
  // yet, so stated total should reconcile to rows-plus-bridge exactly.
  for (const company of ["Molina Healthcare", "Quest Diagnostics", "Cigna Group", "Encompass Health"]) {
    const c = computeCoverage(dmOf(company));
    assert(c.residualFraction !== null && c.residualFraction < 0.005,
      `[3] ${company}: residual after subtracting the stated bridge is ${((c.residualFraction ?? 1) * 100).toFixed(2)}% — the bridge is explained, not tolerated`);
  }
}

console.log("\n=== [4] UHS is the case the threshold exists for ===");
{
  const c = computeCoverage(dmOf("Universal Health Services"));
  assert(c.residualFraction !== null && c.residualFraction > 0.5,
    `[4a] UHS's residual is ${((c.residualFraction ?? 0) * 100).toFixed(0)}% — an order of magnitude beyond any bridge item, which is why one threshold can serve both`);
  assert(c.residualPasses === false, "[4b] and it FAILS, before any prose instrument exists");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
