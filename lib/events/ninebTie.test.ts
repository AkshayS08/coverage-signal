/**
 * SESSION 27 (Akshay, Oct 29, 2026) — RULE 1(c): THE COVERAGE TIE MUST HOLD
 * FOR A SAMPLE TO COUNT TOWARD 9b. A sample that breaks the tie to the balance
 * sheet is a CHECK FAILURE, not an alternate reading.
 *
 *   T1  over all six names, the signed card's input (v31) against its own
 *       state: counts exactly when the tie holds and the comparison matches
 *   T2  control: the same sample with its tie broken (residualPasses false)
 *       does NOT count, even when the comparison is forced to "matches"
 *   T3  control: a broken tie does not count even when the canonical breaks
 *       it identically (agreeing on a failure is not reproducing a position)
 *
 * Offline, $0. Run: npx tsx lib/events/ninebTie.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveGoldenState, compareToGolden, countsToward9b } from "./golden";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const AS_OF = new Date("2026-10-15T00:00:00Z");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const clone = (x: any) => JSON.parse(JSON.stringify(x));

for (const cik of CIKS) {
  const result = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8")).result;
  const st: any = deriveGoldenState(result, AS_OF);
  const v = compareToGolden(st, st);
  const holds = st.coverage.residualPasses !== false;
  const c = countsToward9b(st, st, v);
  assert(c.counts === (holds && v.kind === "matches"), `[T1:${result.company}] tie ${holds ? "holds" : "breaks"} (residual ${st.coverage.residualPercent}%), comparison ${v.kind} → ${c.counts ? "counts" : "does not count"}`);
  const broken = clone(st); broken.coverage.residualPasses = false; broken.coverage.residualPercent = 2.35;
  const c2 = countsToward9b(st, broken, { kind: "matches", tolerated: [] });
  assert(!c2.counts && c2.checkFailure === true, `[T2 control:${result.company}] a broken tie is a check failure and does not count, even if the comparison "matches"`);
  const c3 = countsToward9b(broken, clone(broken), { kind: "matches", tolerated: [] });
  assert(!c3.counts && c3.checkFailure === true, `[T3 control:${result.company}] a broken tie does not count even when the canonical breaks it the same way`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
