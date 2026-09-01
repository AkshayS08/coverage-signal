/**
 * SESSION 20, STAGE 4 — THE EIGHT TABLE-READING COMPANIES, PINNED ON FACE.
 *
 * The unit rule added at v24 ("copy the digits as printed, never restate them
 * in another unit") exists for one case: a note that states its instruments
 * as bulleted sentences in millions, which the model had been rewriting into
 * the thousands a table would have used. The obvious way for that fix to go
 * wrong is the reverse — a company whose ladder legitimately comes from a
 * table stated in thousands reading "700,000" as $700 rather than $700
 * million, or being rescaled the other way.
 *
 * The two cases are not symmetric in risk. Eight of the ten companies read
 * from tables and were already correct; only UHS reads from bullets. So the
 * fix is only safe if the eight do not move AT ALL, and "captured face" is
 * the right thing to hold them to: it is the sum every coverage figure is
 * built from, and it is insensitive to label wording, ordering, and the
 * unit-string cosmetics that drift between runs regardless.
 *
 * These are literals on purpose. A test that recomputes the expectation from
 * the same file it is checking proves nothing.
 *
 * Run: npx tsx lib/events/capturedFace.test.ts [baseline]
 */
import { readFileSync } from "node:fs";
import { computeCoverage } from "./coverage";
import type { CompanyResult } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const file = process.argv[2] ?? "baselines/s20-stage4.json";
const book = JSON.parse(readFileSync(file, "utf8")) as { company: string; result: CompanyResult }[];
const dmOf = (c: string) => book.find((b) => b.company === c)?.result.results.find((r) => r.triggerId === "debt-maturity");

/** company, captured face, stated total debt — measured at v23 (commit f09bca7), before the unit rule. */
const PINS: [string, number, number][] = [
  ["DaVita", 10_847_581_000, 10_781_013_000],
  ["HCA Healthcare", 50_169_000_000, 49_718_000_000],
  ["Tenet Healthcare", 13_333_000_000, 13_248_000_000],
  ["Encompass Health", 2_634_000_000, 2_634_000_000],
  ["Community Health Systems", 9_770_000_000, 9_578_000_000],
  ["Quest Diagnostics", 5_674_000_000, 5_642_000_000],
  ["Centene Corporation", 16_179_000_000, 16_105_000_000],
  ["Molina Healthcare", 3_800_000_000, 3_769_000_000],
];

console.log(`\n=== The eight table-reading companies do not move (${file}) ===`);
for (const [company, face, stated] of PINS) {
  const c = computeCoverage(dmOf(company));
  assert(
    c.capturedFace === face && c.statedTotalDebt === stated,
    `${company}: captured face $${(face / 1e9).toFixed(3)}B against stated $${(stated / 1e9).toFixed(3)}B ` +
      `(got $${(c.capturedFace / 1e9).toFixed(3)}B / $${((c.statedTotalDebt ?? 0) / 1e9).toFixed(3)}B) — a table stated in thousands still reads as thousands`
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
