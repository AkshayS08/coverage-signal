/**
 * THE PRINTED-HEADING RULE ON THE PRODUCT'S OWN PATH (Oct 17, 2026).
 *
 * The loop records each row's printed heading; assemblePosition classes rows
 * from it alone. Asserted on the committed card snapshots — the loop's own
 * output, re-derived at $0 — so this is the main page's ladder, not a model
 * of it. Offline.
 *
 * Run: npx tsx lib/events/printedHeadings.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePosition } from "./position";
import { annotatePrintedHeadings } from "./printedHeadings";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const snap = (cik: string) => JSON.parse(readFileSync(join(process.cwd(), "lib", "cards", "inputs", `${cik}.json`), "utf-8"));
const ASOF = new Date("2026-10-15T00:00:00Z");
const rowsOf = (cik: string) => assemblePosition(snap(cik).result, ASOF).rows;
const row = (cik: string, name: string) => rowsOf(cik).find((r) => r.instrument === name);

console.log("\n=== every loop-derived row records its printed heading ===");
for (const cik of ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929"]) {
  const dm = snap(cik).result.results.find((r: any) => r.triggerId === "debt-maturity");
  const rows = dm.scheduleSequence.filter((e: any) => e.kind === "row");
  assert(rows.length > 0 && rows.every((e: any) => e.printedHeading !== undefined), `[1:${snap(cik).company}] all ${rows.length} rows carry printedHeading (a heading or an explicit null)`);
}

console.log("\n=== a heading the table prints classes the block it governs ===");
for (const n of ["5.125 % due 2027", "6.750 % due 2031"]) assert(row("0000070318", n)?.classification.priorityClass === "first-lien", `[2] Tenet "${n}" is first lien, from the printed "Senior secured first lien notes"`);
assert(row("0000070318", "6.125 % due 2028")?.classification.priorityClass === "senior-unsecured", `[2] Tenet "6.125 % due 2028" is senior unsecured, from the printed "Senior unsecured notes"`);
assert(!!row("0000927066", "Term Loan B-2")?.classification.priorityClass, `[2] DaVita "Term Loan B-2" carries the printed "Senior Secured Credit Facilities" class`);

console.log("\n=== a heading governs only its contiguous block ===");
for (const n of ["Acquisition obligations and other notes payable", "Financing lease obligations"]) {
  const r = row("0000927066", n);
  assert(!!r && r.printedHeading === null && r.classification.priorityClass === null, `[3] DaVita "${n}" is not governed by "Senior Notes" and carries no class`);
}

console.log("\n=== a recorded heading the table never printed classes nothing ===");
const chs = snap("0001108109").result.results.find((r: any) => r.triggerId === "debt-maturity");
const recorded = chs.scheduleSequence.filter((e: any) => e.kind === "row" && (e.seniority || e.section));
assert(recorded.length > 0 && recorded.every((e: any) => e.printedHeading === null), `[4] CHS: ${recorded.length} rows record "senior-priority secured" / "junior-priority secured", printed nowhere — every printedHeading is null`);
assert(row("0001108109", "Other")?.classification.priorityClass === null, `[4] CHS "Other" carries no class (its recorded heading is not printed)`);

console.log("\n=== negative control: a heading printed nowhere in the text is never recorded as printed ===");
const tenet = snap("0000070318").result.results.find((r: any) => r.triggerId === "debt-maturity");
const forged = tenet.scheduleSequence.map((e: any) => (e.kind === "row" ? { ...e, section: "Junior subordinated debentures", seniority: null } : e));
const text = snap("0000070318").docs[tenet.debtScheduleSourceFiling.url].text;
const flat = text.replace(/\s+/g, " ");
const out = annotatePrintedHeadings(forged, text, (l: string) => { const i = flat.indexOf(l.replace(/\s+/g, " ")); return i < 0 ? null : i; });
assert(out.filter((e: any) => e.kind === "row").every((e: any) => e.printedHeading === null), `[5] a forged recorded heading ("Junior subordinated debentures") is recorded as not printed on every row`);

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
