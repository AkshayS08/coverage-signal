/**
 * SESSION 27 (Akshay, Nov 4, 2026) — A PRICING SUMMARY NAMES THE RUN IT PRICED.
 *
 * Encompass's refresh was priced on Nov 4 and its summary read "Batch (Tenet, DaVita, CHS) declared: $1.80", a line
 * left from the Oct 31 batch. A summary that names the wrong run is a check failure.
 *   S1  the summary of each recorded pricing names exactly the companies it priced, and its declared total
 *   S2  control: the Nov 4 line ("Batch (Tenet, DaVita, CHS) …" over Encompass's pricing) fails
 *   S3  s27priceBatch prints the checked summary, not a fixed string
 *
 * Offline, $0. Run: npx tsx lib/cache/pricingSummary.test.ts
 */
import { readFileSync } from "node:fs";
import { pricingSummary, summaryNamesRun } from "./pricingSummary";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

for (const p of nonEmpty("the recorded pricings", ["sessions/27/encompass_q3_pricing.json", "sessions/27/refresh_batch_pricing.json"])) {
  const rows = nonEmpty(`${p} rows`, JSON.parse(readFileSync(p, "utf-8")).rows as { company: string; declared: number }[]);
  const line = pricingSummary(rows);
  const v = summaryNamesRun(line, rows);
  assert(v.length === 0, `[S1] ${p}: "${line}"${v.length ? ` — ${v.join("; ")}` : ""}`);
}
const enc = JSON.parse(readFileSync("sessions/27/encompass_q3_pricing.json", "utf-8")).rows;
const old = "Batch (Tenet, DaVita, CHS) declared: $1.80. Molina, already run: extraction $0.6165 + facts $0.0574 = $0.6739, nothing further.";
assert(summaryNamesRun(old, enc).length > 0, `[S2 control] the Nov 4 line over Encompass's pricing fails: ${summaryNamesRun(old, enc).join("; ")}`);
const src = readFileSync("lib/cache/s27priceBatch.ts", "utf-8");
assert(/pricingSummary\(rows\)/.test(src) && !/Batch \(Tenet, DaVita, CHS\)/.test(src), `[S3] s27priceBatch prints the checked summary of the rows it priced`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
