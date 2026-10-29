/**
 * SESSION 27 (Akshay, Oct 29, 2026) — CIGNA RULINGS (b) AND (c).
 *
 *   (b) Tolerated, for 9b and golden comparison: whitespace-only differences
 *       and footnote markers like "(1)". Both sides are normalised before
 *       comparing; the stored text keeps its original form.
 *   (c) Roll-forward labels compare under the name rule: case-insensitive, on
 *       the displayed label.
 *
 *   W1  over all six names: every text field of the state re-spaced, and a
 *       footnote marker added to each sentence, still matches — tolerated
 *   W2  control: one word changed in the same fields diverges
 *   W3  control: a changed figure inside a sentence diverges ("1,406" → "1,407")
 *   W4  the compared states are not rewritten: the original text is kept
 *   L1  a delta label differing only in case is tolerated (Cigna)
 *   L2  control: a different displayed label still diverges
 *
 * Offline, $0. Run: npx tsx lib/events/goldenTextTolerance.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveGoldenState, compareToGolden } from "./golden";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const AS_OF = new Date("2026-10-15T00:00:00Z");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const clone = (x: any) => JSON.parse(JSON.stringify(x));

/** Every sentence and label field the state stores as text, as [object, key] pairs. */
const textFields = (st: any): [any, string][] => [
  ...st.rows.flatMap((r: any) => [[r, "sourceLine"]] as [any, string][]),
  ...(st.rolled ? st.rolled.baseRows.flatMap((r: any) => [[r, "instrument"], [r, "sourceLine"]] as [any, string][]) : []),
  ...(st.rolled ? st.rolled.deltas.map((r: any) => [r, "sourceLine"] as [any, string]) : []),
  ...st.cards.flatMap((c: any) => c.derived.map((x: any) => [x, "text"] as [any, string])),
];
const respace = (s: string) => s.replace(/\$(\d)/g, "$ $1").replace(/(\d)%/g, "$1 %").replace(/ /, "  ");

for (const cik of CIKS) {
  const result = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8")).result;
  const st: any = deriveGoldenState(result, AS_OF);
  const fields = textFields(st).filter(([o, k]) => typeof o[k] === "string" && o[k].length > 0);
  const w = clone(st);
  textFields(w).filter(([o, k]) => typeof o[k] === "string" && o[k].length > 0).forEach(([o, k]) => { o[k] = respace(o[k]) + (k === "sourceLine" ? " (1)" : ""); });
  const before = JSON.stringify(w);
  const v = compareToGolden(st, w);
  assert(v.kind === "matches" && v.tolerated.some((t) => /whitespace|footnote/i.test(t)), `[W1:${result.company}] ${fields.length} text fields re-spaced and footnote-marked: ${v.kind}${v.kind === "diverged" ? ` (${v.divergences[0].slice(0, 140)})` : ""}`);
  assert(JSON.stringify(w) === before, `[W4:${result.company}] comparing does not rewrite the stored text`);
  const c2 = clone(st);
  const target = textFields(c2).find(([o, k]) => typeof o[k] === "string" && /\b[A-Za-z]{4,}\b/.test(o[k]) && k !== "sourceLine");
  if (target) { const [o, k] = target; o[k] = o[k].replace(/\b([A-Za-z]{4,})\b/, "$1x"); assert(compareToGolden(st, c2).kind === "diverged", `[W2 control:${result.company}] one changed word in ${k} diverges`); }
  else console.log(`  · ${result.company}: no non-sentence text field for W2`);
}

const cigna: any = deriveGoldenState(JSON.parse(readFileSync(join("lib", "cards", "inputs", "0001739940.json"), "utf-8")).result, AS_OF);
const w3 = clone(cigna); const br = w3.rolled.baseRows.find((r: any) => /1,406/.test(r.sourceLine)); br.sourceLine = br.sourceLine.replace("1,406", "1,407");
assert(compareToGolden(cigna, w3).kind === "diverged", `[W3 control] a changed figure inside a base row's sentence diverges`);
const l1 = clone(cigna); l1.rolled.deltas[1].instrument = l1.rolled.deltas[1].instrument.toUpperCase();
const vl = compareToGolden(cigna, l1);
assert(vl.kind === "matches", `[L1] a delta label differing only in case ("${cigna.rolled.deltas[1].instrument}" / "${l1.rolled.deltas[1].instrument}") is tolerated: ${vl.kind}`);
const l2 = clone(cigna); l2.rolled.deltas[0].instrument = "notes";
assert(cigna.rolled.deltas[0].instrument.toLowerCase() === "notes" || compareToGolden(cigna, l2).kind === "diverged", `[L2 control] a different displayed label ("${cigna.rolled.deltas[0].instrument}" / "notes") diverges`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
