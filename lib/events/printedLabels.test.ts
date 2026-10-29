/**
 * SESSION 27 (Akshay, Oct 29, 2026) — PRINTED HEADINGS AND SUBTOTAL LABELS
 * ARE RECOVERED FROM THE READ DOCUMENT, IN CODE, so no model sample can drop
 * them. DaVita's v33 canonical left "Total debt principal outstanding" null on
 * a subtotal whose own sentence prints it; Molina's v33 canonical recorded no
 * heading where its table prints "Non-current long-term debt:".
 *
 *   H1  every sample of the six, with every row's recorded headings
 *       (section, seniority) REMOVED: the printed headings recovered from the
 *       anchor's text are the same in every sample of the name, and include
 *       every heading any sample's model recorded and the table prints
 *   H2  control: the pre-Session-27 behaviour (recorded headings only) on
 *       the same stripped input recovers no heading at all, so H1 must fail
 *       without the text rule
 *   S1  every sample, with every subtotal label NULLED: the labels recovered
 *       from the document are the same in every sample, and DaVita's first
 *       subtotal is "Total debt principal outstanding"
 *   S2  control: a subtotal the filer prints without a label stays null
 *       (DaVita's second subtotal, Encompass's first)
 *   P1  control: a digit-bearing phrase before a row ("June 30, 2026:") is
 *       never a heading; a phrase not printed directly before a row governs
 *       nothing
 *
 * Offline, $0. Run: npx tsx lib/events/printedLabels.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { annotatePrintedHeadings, recoverSubtotalLabels, textHeadingBefore } from "./printedHeadings";
import { createTextLocator } from "../agent/verifyQuote";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const canon = read("baselines/s27-replay.json")?.results ?? [], re = read("baselines/s27-retaste.json")?.results ?? [];
const samples = (cik: string) => [
  { label: "v31", result: read(join("lib", "cards", "inputs", `${cik}.json`)).result },
  ...canon.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })),
  ...re.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result })),
];
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const dmOf = (r: any) => r.results.find((t: any) => t.triggerId === "debt-maturity");
const strip = (seq: any[]) => seq.map((e) => (e.kind === "row" ? { ...e, section: null, seniority: null, printedHeading: undefined } : e));
const nullSubtotals = (seq: any[]) => seq.map((e) => (e.kind === "subtotal" ? { ...e, label: null } : e));
/** The pre-Session-27 annotation: recorded headings only, checked against print. Reproduced here as the control. */
import { printedHeadings, headingFor, tableTextAround, printedBefore } from "./printedHeadings";
const recordedOnly = (seq: any[], text: string, find: (l: string) => number | null) => {
  const rows = seq.filter((e) => e.kind === "row");
  const tt = tableTextAround(text, rows.map((e) => e.sourceLine), find);
  const hs = printedHeadings(tt, rows.map((e) => { const c = [e.section, e.seniority].filter(Boolean); return { label: e.label ?? "", recordedHeading: c.find((h: string) => printedBefore(tt, h, e.label ?? "")) ?? c[0] ?? null }; }));
  return seq.map((e) => (e.kind === "row" ? headingFor(hs, e.label ?? "")?.text ?? null : null));
};

for (const cik of CIKS) {
  const snap = read(join("lib", "cards", "inputs", `${cik}.json`));
  const ss = samples(cik);
  const byLabel = (r: any) => {
    const dm = dmOf(r); const text = snap.docs[dm.debtScheduleSourceFiling.url]?.text ?? null;
    return { dm, text, find: text ? ((l: string) => createTextLocator(text).find(l)) : () => null };
  };
  const headingsOf = (r: any) => {
    const { dm, text, find } = byLabel(r);
    const rows = annotatePrintedHeadings(strip(dm.scheduleSequence ?? []), text, find).filter((e) => e.kind === "row");
    return rows.map((e) => `${e.label}=${e.printedHeading ?? "∅"}`);
  };
  const recorded = new Set(ss.flatMap((s) => (dmOf(s.result).scheduleSequence ?? []).filter((e: any) => e.kind === "row" && e.printedHeading).map((e: any) => e.printedHeading)));
  const got = ss.map((s) => headingsOf(s.result));
  const recovered = new Set(got.flatMap((g) => g.map((x) => x.split("=").pop()).filter((h) => h !== "∅")));
  const company = ss[0].result.company;
  if ((dmOf(ss[0].result).scheduleSequence ?? []).length === 0) { console.log(`  · ${company}: no anchor table (its position is rolled from the prior 10-K) — nothing to annotate`); continue; }
  // Samples may carry different rows (CHS's v33 holds its nil ABL Facility out of the rows); each row BOTH carry must get the same heading.
  const headingByRow = got.map((g) => new Map(g.map((x) => [x.slice(0, x.lastIndexOf("=")), x.slice(x.lastIndexOf("=") + 1)] as const)));
  const sameAcross = headingByRow.every((m) => [...m].every(([row, h]) => headingByRow.every((o) => !o.has(row) || o.get(row) === h)));
  assert(sameAcross && [...recorded].every((h) => recovered.has(h as string)),
    `[H1:${company}] with recorded headings removed, ${ss.length} samples recover the same printed headings from the text (${[...recovered].join("; ") || "none"}), covering every heading a model recorded (${[...recorded].join("; ") || "none"})`);
  if (recorded.size) {
    const { dm, text, find } = byLabel(ss[0].result);
    assert(recordedOnly(strip(dm.scheduleSequence), text ?? "", find).every((h) => h === null), `[H2 control:${company}] recorded headings only, on the stripped input, recovers none`);
  }
  const subsOf = (r: any) => { const { dm, text, find } = byLabel(r); return recoverSubtotalLabels(nullSubtotals(dm.scheduleSequence ?? []), text, find).filter((e) => e.kind === "subtotal").map((e) => e.label ?? "∅"); };
  const subs = ss.map((s) => subsOf(s.result));
  assert(subs.every((x) => JSON.stringify(x) === JSON.stringify(subs[0])), `[S1:${company}] with every subtotal label nulled, ${ss.length} samples recover the same labels: ${subs[0].join(" | ") || "none"}`);
  if (cik === "0000927066") {
    assert(subs.every((x) => x[0] === "Total debt principal outstanding"), `[S1:DaVita] the first subtotal is "Total debt principal outstanding" in every sample, the v33 canonical included`);
    assert(subs.every((x) => x[1] === "∅"), `[S2 control:DaVita] the second subtotal, printed with no label, stays null`);
  }
  if (cik === "0000785161") assert(subs.every((x) => x[0] === "∅"), `[S2 control:Encompass] the first subtotal, printed with no label, stays null`);
}

console.log("\n=== P1: what is not a heading ===");
assert(textHeadingBefore("December 31, 2025 June 30, 2026: 6.125 % due 2028 $ 1,750", "6.125 % due 2028") === null, `[P1 control] a digit-bearing phrase is never a heading`);
assert(textHeadingBefore("December 31, 2025 Senior unsecured notes: 6.125 % due 2028 $ 1,750", "6.125 % due 2028") === "Senior unsecured notes", `[P1] a short phrase ending in ":" printed directly before the row is its heading`);
assert(textHeadingBefore("Senior unsecured notes: are described below. 4.625 % due 2028 600 600 6.125 % due 2028 $ 1,750", "6.125 % due 2028") === null, `[P1 control] a phrase not printed directly before the row governs nothing`);
assert(textHeadingBefore("value (1) Senior Secured Credit Facilities: Term Loan A-2 (2) $ 1,975,000", "Term Loan A-2") === "Senior Secured Credit Facilities", `[P1] a footnote mark before the heading is a boundary`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
