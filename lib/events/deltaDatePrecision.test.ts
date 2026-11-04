/**
 * SESSION 27 (Akshay, Oct 29, 2026) — CIGNA RULING (a): A DELTA'S DATE IS HELD
 * IN CODE TO THE PRECISION ITS OWN SENTENCE STATES (Rules 76–78). The model's
 * date field never adds precision. "matured in March 2026" is 2026-03, never
 * 2026-03-01 — the signed golden's 2026-03-01 is logged as a finding.
 *
 * Applies to the movements whose date and sentence are one claim: repayments
 * and stated balances. (An issuance's date is the issuance's own, from its own
 * sentence, not its tranche line.)
 *
 *   P1  over all six names, every sample: each repayment / balance-change date
 *       is no more precise than its own sentence states
 *   P2  Cigna's four samples: the repayment delta is dated 2026-03
 *   P3  control: a sentence that states the day keeps the day
 *   P4  control: the checker used by P1 flags a month sentence carrying a day
 *   P5  a sentence stating no matching date leaves the movement undated (not
 *       counted), as a maturity with no stating sentence is nulled (Rule 76)
 *
 * Offline, $0. Run: npx tsx lib/events/deltaDatePrecision.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rolledCoverageFor } from "./rolledCoverage";
import { derivePlacedMovements } from "./rollDeltas";
import { statedDatePrecision, datePrecisionOf, morePrecise, type FactToken } from "../agent/factTokens";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const canon = nonEmpty("the v33 replay samples (baselines/s27-replay.json)", read("baselines/s27-replay.json")?.results), re = nonEmpty("the v33 re-taste samples (baselines/s27-retaste.json)", read("baselines/s27-retaste.json")?.results);
const samples = (cik: string) => [
  { label: "v31", result: read(join("lib", "cards", "inputs", `${cik}.json`)).result },
  ...canon.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })),
  ...re.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result })),
];

/** A date string at its own precision: "2026", "2026-03", "2026-03-15". */
const token = (d: string): FactToken => { const p = d.split("-"); return { kind: "date", raw: d, index: 0, dateValue: { year: +p[0], month: p[1] ? +p[1] : null, day: p[2] ? +p[2] : null } } as FactToken; };
/** True when the date claims no more precision than the sentence states for it. */
const heldToSentence = (d: string, sentence: string) => { const t = token(d); const s = statedDatePrecision(t, sentence); return !!s && !morePrecise(datePrecisionOf(t)!, s); };

console.log("\n=== P1-P2: every sample of the six ===");
for (const cik of CIKS) for (const s of samples(cik)) {
  const ms = rolledCoverageFor(s.result).movements.filter((m) => (m.kind === "repayment" || m.kind === "balance-change") && m.date);
  const bad = ms.filter((m) => !heldToSentence(m.date!, m.sourceLine));
  if (ms.length) assert(bad.length === 0, `[P1:${s.result.company} ${s.label}] ${ms.length} dated movement(s) held to their sentences${bad.length ? ` — not: ${bad.map((m) => m.date).join(", ")}` : ""}`);
  if (cik === "0001739940") {
    const d = ms.find((m) => m.kind === "repayment" && m.placement === "delta");
    assert(d?.date === "2026-03", `[P2:Cigna ${s.label}] the repayment delta is dated 2026-03 ("matured in March 2026"), got ${d?.date ?? "none"}`);
  }
}

console.log("\n=== P3-P5: fixtures ===");
const move = (eventDate: string, sourceLine: string) => derivePlacedMovements({
  baseDate: "2025-12-31", anchorDate: "2026-06-30",
  noteRetirements: [{ instrument: "senior notes", amount: "$ 550 million", eventDate, sourceLine, citedUrl: "u" }],
  issuedTranches: [], issuanceDate: null, intendedRedemptions: [], anchorBalances: [], baseRows: [],
  parseMillions: (a) => Number(a.replace(/[^\d.]/g, "")),
})[0];
const day = move("2026-03-15", "On March 15, 2026, the Company repaid $ 550 million of senior notes.");
assert(day.date === "2026-03-15" && day.placement === "delta", `[P3 control] a sentence stating the day keeps it (${day.date})`);
assert(!heldToSentence("2026-03-01", "the Company repaid $ 550 million 1.250 % senior notes that matured in March 2026."), `[P4 control] the checker flags a day on a sentence that states only the month`);
const none = move("2026-03-01", "The Company repaid $ 550 million of senior notes.");
assert(none.date === null && none.placement === "undated", `[P5] a sentence stating no date leaves the movement undated (${none.date}, ${none.placement})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
