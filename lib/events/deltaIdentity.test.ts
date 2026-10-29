/**
 * SESSION 27 (Akshay, Oct 29, 2026) — CIGNA: A DELTA IS MATCHED BY IDENTITY,
 * AND ITS LABEL IS BUILT FROM THAT IDENTITY.
 *
 *   9b and golden comparison match deltas by identity (amount, date at stated
 *   precision, coupon, maturity). Label word choice is tolerated when both
 *   labels pass the name rule. The card's delta label is built from those
 *   identity fields, so it doesn't depend on the model's wording.
 *
 *   D1  every sample of the six: each delta's identity and built label; Cigna's
 *       four samples agree on both (the canonical's model labelled the
 *       repayment with the base row's name, the others with the sentence's)
 *   D2  Cigna's re-tastes against the canonical: no delta divergence
 *   D3  the card's "Repaid" line is the same for every model wording of the
 *       same delta; control: a different coupon changes it
 *   D4  control: a delta with a different amount, date or coupon is not the
 *       same delta, and diverges
 *   D5  control: a label that passes no part of the name rule (in no sentence,
 *       not a plain type) is not tolerated
 *
 * Offline, $0. Run: npx tsx lib/events/deltaIdentity.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rolledCoverageFor } from "./rolledCoverage";
import { deltaIdentityOf, deltaLabelOf } from "./rollDeltas";
import { deriveGoldenState, compareToGolden } from "./golden";
import { compareSample } from "../cache/s27compare";
import { cardFrom } from "../cache/s27sign";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const AS_OF = new Date("2026-10-15T00:00:00Z");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const canon = read("baselines/s27-replay.json")?.results ?? [], re = read("baselines/s27-retaste.json")?.results ?? [];
const samples = (cik: string) => [
  { label: "v31", result: read(join("lib", "cards", "inputs", `${cik}.json`)).result },
  ...canon.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })),
  ...re.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result })),
];
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const deltas = (r: any) => rolledCoverageFor(r).movements.filter((m) => m.placement === "delta");

console.log("\n=== D1: every sample of the six ===");
for (const cik of CIKS) {
  const ss = samples(cik);
  const per = ss.map((s) => deltas(s.result).map((m) => `${JSON.stringify(deltaIdentityOf(m))} → "${deltaLabelOf(m)}"`));
  if (per.every((p) => p.length === 0)) { console.log(`  · ${ss[0].result.company}: no position roll, so no deltas`); continue; }
  assert(per.every((p) => JSON.stringify(p) === JSON.stringify(per[0])), `[D1:${ss[0].result.company}] ${ss.length} samples agree on every delta's identity and built label: ${per[0].join("; ")}`);
}
const cigna = samples("0001739940");
const rep = deltas(cigna[1].result).find((m) => m.amountMillions < 0)!;
assert(deltaLabelOf(rep) === "1.250% notes due March 2026", `[D1:Cigna] the repayment's label is built from its identity: "${deltaLabelOf(rep)}"`);

console.log("\n=== D2: Cigna's re-tastes against the canonical ===");
for (const s of cigna.slice(2)) {
  const { verdict } = compareSample(cigna[1].result, s.result, AS_OF);
  const dl = verdict.kind === "diverged" ? verdict.divergences.filter((d) => /rolled\.deltas/.test(d)) : [];
  assert(dl.length === 0, `[D2:${s.label}] no delta divergence${dl.length ? `: ${dl.join("; ")}` : ""} (verdict ${verdict.kind})`);
}

console.log("\n=== D3: the card's Repaid line ===");
// The delta reaches the card as a move card (its title); the "Repaid: …, between" line is the same label where it renders.
const repaidLine = (card: string) => { const c = JSON.parse(card); const txt = (l: any[]) => l.map((x) => x.t ?? x.printed ?? "").join(""); return (c.v3?.moves ?? []).map((m: any) => m.title.map(txt).join(" / ")).find((x: string) => /\$550MM/.test(x)) ?? null; };
const lines = cigna.map((s) => repaidLine(cardFrom("0001739940", s.result)));
assert(lines.every((l) => l !== null && l === lines[0]) && lines[0] === "$550MM 1.250% notes due March 2026", `[D3:Cigna] every sample's card titles the repayment from its identity: "${lines[0]}"`);
const coupon = clone(cigna[1].result);
const nr = coupon.results.find((t: any) => t.triggerId === "debt-maturity").noteRetirements.find((x: any) => /1\.250/.test(x.sourceLine));
nr.sourceLine = nr.sourceLine.replace("1.250 %", "2.250 %"); nr.instrument = String(nr.instrument).replace("1.250", "2.250");
assert(repaidLine(cardFrom("0001739940", coupon)) !== lines[0], `[D3 control] a different coupon changes the Repaid line`);

console.log("\n=== D4-D5: what is not the same delta ===");
const st: any = deriveGoldenState(cigna[1].result, AS_OF);
for (const [what, mut] of [
  ["amount", (d: any) => { d.amountMillions = d.amountMillions - 1; }],
  ["date", (d: any) => { d.date = "2026-04"; }],
  ["coupon", (d: any) => { d.sourceLine = d.sourceLine.replace("1.250 %", "2.250 %"); d.instrument = d.instrument.replace("1.250", "2.250"); }],
] as [string, (d: any) => void][]) {
  const a = clone(st); mut(a.rolled.deltas.find((d: any) => d.amountMillions < 0));
  assert(compareToGolden(st, a).kind === "diverged", `[D4 control] a delta with a different ${what} is not the same delta`);
}
const l5 = clone(st); l5.rolled.deltas.find((d: any) => d.amountMillions < 0).instrument = "1.250% debentures of 2026";
assert(compareToGolden(st, l5).kind === "diverged", `[D5 control] a label in no sentence and not a plain type is not tolerated`);
const l6 = clone(st); l6.rolled.deltas.find((d: any) => d.amountMillions < 0).instrument = "1.250 % senior notes";
const v6 = compareToGolden(st, l6);
assert(v6.kind === "matches" && v6.tolerated.some((t) => /name rule/.test(t)), `[D5] a label verbatim in its sentence is tolerated as word choice`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
