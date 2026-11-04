/**
 * SESSION 27 (Akshay, Oct 30, 2026) — A NARRATIVE INSTRUMENT WITH NO AMOUNT
 * TAKES THE COMMITMENT ITS OWN CITED SENTENCE STATES, WITH A GUARDRAIL.
 *
 *   Through exactly one matching verified facility (same category, the same
 *   cited sentence), never from another sentence, never with two candidates.
 *   The filled amount is recorded with basis "commitment": it is facility
 *   size, never outstanding debt, never in captured debt or the ladder, and
 *   it renders only under Facilities.
 *
 *   K1  every sample of the six: after the fill, no narrative instrument
 *       lacks a basis where its sentence states a commitment through one
 *       facility; Cigna's v33 revolver is "$ 6.5 billion", "commitment"; and
 *       criterion 2 holds on every sample
 *   K2  the guardrail, every sample: captured face, the funded rows and the
 *       card's debt table are identical before and after the fill
 *   K3  control (the leak): the same filled amount recorded as "outstanding"
 *       DOES enter captured debt, so K2 would catch a fill that leaked
 *   K4  control: two matching facilities fill neither; a facility citing a
 *       different sentence fills nothing; an instrument with an amount is
 *       never touched
 *
 * Offline, $0. Run: npx tsx lib/events/commitmentFill.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fillCommitmentFromFacility } from "./instrument";
import { assemblePosition } from "./position";
import { computeCoverage } from "./coverage";
import { evaluateGoldenCriteria } from "./goldenCriteria";
import { cardFrom } from "../cache/s27sign";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const AS_OF = new Date("2026-10-15T00:00:00Z");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const canon = nonEmpty("the v33 replay samples (baselines/s27-replay.json)", read("baselines/s27-replay.json")?.results), re = nonEmpty("the v33 re-taste samples (baselines/s27-retaste.json)", read("baselines/s27-retaste.json")?.results);
const samples = (cik: string) => [
  { label: "v31", result: read(join("lib", "cards", "inputs", `${cik}.json`)).result },
  ...canon.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })),
  ...re.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result })),
];
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const dmOf = (r: any) => r.results.find((t: any) => t.triggerId === "debt-maturity");
const filled = (r: any) => { const c = clone(r); const dm = dmOf(c); dm.proseInstruments = fillCommitmentFromFacility(dm.proseInstruments ?? [], dm.facilities ?? []); return c; };
const funded = (r: any) => assemblePosition(r, AS_OF).rows.filter((x: any) => !x.isCapacity).map((x: any) => `${x.instrument}=${x.amount}`).join("|");
const debtTable = (card: string) => JSON.stringify(JSON.parse(card).v3?.table?.rows ?? null);

for (const cik of CIKS) for (const s of samples(cik)) {
  const after = filled(s.result);
  const name = `${s.result.company} ${s.label}`;
  const c2 = evaluateGoldenCriteria(after, AS_OF, {}).criteria.find((k) => k.id === "2")!;
  assert(c2.pass === true, `[K1:${name}] criterion 2 holds after the fill (${c2.detail.slice(0, 110)})`);
  assert(computeCoverage(dmOf(after)).capturedFace === computeCoverage(dmOf(s.result)).capturedFace && funded(after) === funded(s.result),
    `[K2:${name}] captured face and the funded rows are unchanged by the fill`);
  if (cik === "0001739940") {
    assert(debtTable(cardFrom(cik, after)) === debtTable(cardFrom(cik, s.result)), `[K2:${name}] the card's debt table is unchanged by the fill`);
  }
}
const cv33 = filled(canon.find((x: any) => x.result.cik === "0001739940").result);
const rev = dmOf(cv33).proseInstruments.find((p: any) => p.category === "revolver");
assert(rev?.amount === "$ 6.5 billion" && rev?.amountBasis === "commitment", `[K1:Cigna v33] the revolver takes "$ 6.5 billion" from its own sentence, basis "commitment" (got ${rev?.amount}, ${rev?.amountBasis})`);

console.log("\n=== K3: the leak control ===");
const leak = clone(cv33); const lp = dmOf(leak).proseInstruments.find((p: any) => p.category === "revolver"); lp.amountBasis = "outstanding"; lp.category = "other"; lp.name = "other borrowings";
assert(computeCoverage(dmOf(leak)).capturedFace !== computeCoverage(dmOf(cv33)).capturedFace, `[K3 control] the same $6.5B recorded as outstanding debt DOES move captured face (${computeCoverage(dmOf(cv33)).capturedFace} → ${computeCoverage(dmOf(leak)).capturedFace}), so K2 catches a fill that leaks`);

console.log("\n=== K4: what does not fill ===");
const p0 = { category: "revolver", name: "Revolving Credit Agreement", amount: null, amountBasis: null, sourceLine: "The Company maintains a $ 6.5 billion revolving credit agreement." };
const f0 = { name: "Revolving Credit Agreement", category: "revolver", facilitySize: { value: "$ 6.5 billion", sourceLine: p0.sourceLine } };
assert(fillCommitmentFromFacility([p0] as any, [f0, { ...f0, name: "Second revolver" }] as any)[0].amount === null, `[K4 control] two matching facilities fill neither`);
assert(fillCommitmentFromFacility([p0] as any, [{ ...f0, facilitySize: { value: "$ 6.5 billion", sourceLine: "A different sentence stating $ 6.5 billion." } }] as any)[0].amount === null, `[K4 control] a facility whose size cites a different sentence fills nothing`);
assert(fillCommitmentFromFacility([{ ...p0, amount: "$ 1.0 billion", amountBasis: "outstanding" }] as any, [f0] as any)[0].amount === "$ 1.0 billion", `[K4 control] an instrument that carries an amount is never touched`);
assert(fillCommitmentFromFacility([{ ...p0, sourceLine: "The Company maintains a revolving credit agreement." }] as any, [{ ...f0, facilitySize: { value: "$ 6.5 billion", sourceLine: "The Company maintains a revolving credit agreement." } }] as any)[0].amount === null, `[K4 control] a sentence that does not state the figure fills nothing`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
