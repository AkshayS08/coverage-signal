/**
 * SESSION 27 (Akshay, Oct 30, 2026) — RULE 53, EXTENDED: "no amount was
 * outstanding", "no borrowings outstanding" and equivalent stated-nothing-
 * outstanding sentences are a stated zero for that facility's drawn amount,
 * taken from the facility's own sentence. Molina's three refresh samples left
 * drawn empty while its Q3 10-Q says "As of September 30, 2026, no amount was
 * outstanding under the Credit Agreement."
 *
 * The sentence must be in the anchor, name THIS facility (its name, or the
 * defined term its own sentences give it), name no other facility on the
 * list (Rule 19), assert absence for "drawn" (zeroSupportFor), and be dated at
 * the anchor's period (Rule 71).
 *
 *   Z1  every sample of the six: a stated drawn amount is never replaced; a
 *       facility left empty is filled exactly where such a sentence exists
 *   Z2  Molina's refresh shape: the Q3 sentence fills "$0"
 *   Z3  control: the same sentence dated December 31, 2025 does not fill
 *   Z4  control: a sentence naming two facilities on the list fills neither
 *   Z5  control: "no amounts were outstanding under the notes" is not a
 *       facility's zero
 *
 * Offline, $0. Run: npx tsx lib/agent/statedNothingOutstanding.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fillStatedNothingOutstanding } from "./verifyFacility";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const canon = read("baselines/s27-replay.json")?.results ?? [], re = read("baselines/s27-retaste.json")?.results ?? [];
const clone = (x: any) => JSON.parse(JSON.stringify(x));

for (const cik of CIKS) {
  const snap = read(join("lib", "cards", "inputs", `${cik}.json`));
  const samples = [{ label: "v31/v33 snapshot", result: snap.result }, ...canon.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })), ...re.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result }))];
  for (const s of samples) {
    const dm = s.result.results.find((t: any) => t.triggerId === "debt-maturity");
    const anchor = dm.debtScheduleSourceFiling;
    const text = snap.docs[anchor.url]?.text;
    if (!text || !(dm.facilities ?? []).length) continue;
    const before = clone(dm.facilities);
    const after = fillStatedNothingOutstanding(clone(dm.facilities), text, anchor.url, anchor.reportDate).facilities as any[];
    const kept = before.every((f: any, n: number) => !f.drawn || JSON.stringify(after[n].drawn) === JSON.stringify(f.drawn));
    const filled = after.filter((f: any, n: number) => !before[n].drawn && f.drawn);
    assert(kept && filled.every((f: any) => f.drawn.value === "$0" && text.replace(/\s+/g, " ").includes(f.drawn.sourceLine.replace(/\s+/g, " "))),
      `[Z1:${s.result.company} ${s.label}] stated drawn amounts untouched; ${filled.length} empty drawn filled from an anchor sentence (${filled.map((f: any) => `${f.name}: "${f.drawn.sourceLine.slice(0, 70)}"`).join("; ") || "none"})`);
  }
}

console.log("\n=== Z2-Z5: shapes ===");
const Q3 = "Credit Agreement We are party to a Credit Agreement (the \"Credit Agreement\") which includes a revolving credit facility (\"Credit Facility\") of $ 1.25 billion. As of September 30, 2026, no amount was outstanding under the Credit Agreement. The Credit Agreement has a term of five years.";
const molina = () => [{ name: "revolving credit facility", category: "revolver", facilitySize: { value: "$ 1.25 billion", sourceLine: "We are party to a Credit Agreement (the \"Credit Agreement\") which includes a revolving credit facility (\"Credit Facility\") of $ 1.25 billion." }, drawn: null, lettersOfCredit: null, available: null, maturity: null, citedUrl: "u", figureSources: {} }];
const z2: any = fillStatedNothingOutstanding(molina() as any, Q3, "u", "2026-09-30").facilities[0];
assert(z2.drawn?.value === "$0" && /no amount was outstanding/.test(z2.drawn?.sourceLine ?? "") && z2.figureSources?.drawn === "u", `[Z2] Molina's Q3 sentence fills drawn "$0" from "${z2.drawn?.sourceLine}"`);
const z3: any = fillStatedNothingOutstanding(molina() as any, Q3.replace("September 30, 2026", "December 31, 2025"), "u", "2026-09-30").facilities[0];
assert(!z3.drawn, `[Z3 control] the same sentence dated December 31, 2025 does not fill`);
const two = [...molina(), { ...molina()[0], name: "term loan credit agreement", category: "term-loan", facilitySize: { value: "$ 500 million", sourceLine: "The Company also has a $ 500 million term loan credit agreement." } }];
const z4 = fillStatedNothingOutstanding(two as any, "As of September 30, 2026, no amounts were outstanding under the revolving credit facility or the term loan credit agreement.", "u", "2026-09-30").facilities as any[];
assert(z4.every((f) => !f.drawn), `[Z4 control] a sentence naming two facilities on the list fills neither`);
const z5: any = fillStatedNothingOutstanding(molina() as any, "As of September 30, 2026, no amounts were outstanding under the 2026 senior notes.", "u", "2026-09-30").facilities[0];
assert(!z5.drawn, `[Z5 control] "no amounts were outstanding under the notes" is not the revolver's zero`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
