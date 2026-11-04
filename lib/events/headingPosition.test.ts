/**
 * SESSION 27 (Oct 31, 2026) — A ROW'S PRINTED HEADING IS THE LAST ONE PRINTED
 * BEFORE THE ROW'S OWN POSITION IN THE TABLE.
 *
 * Tenet's Q3 10-Q prints "Senior secured first lien notes:" directly before
 * "5.125 % due 2027 — 1,500", a row now at nil that the answer no longer
 * carries. The rule matched a heading only when printed directly before a row
 * the answer has, so the secured heading governed nothing and the unsecured
 * block ran on through every secured row: the refreshed card called the
 * 4.625% senior secured notes due 2028 "senior unsecured".
 *
 *   H1  Tenet's refresh: the four unsecured rows read "Senior unsecured notes",
 *       the six secured rows "Senior secured first lien notes", the finance
 *       leases none
 *   H2  control: the adjacency rule on the same input misassigns the secured rows
 *   H3  every committed snapshot of the six: the position rule gives each row
 *       the heading it carries today (no regression)
 *
 * Offline, $0. Run: npx tsx lib/events/headingPosition.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { annotatePrintedHeadings, printedHeadings, headingFor, tableTextAround, printedBefore } from "./printedHeadings";
import { createTextLocator } from "../agent/verifyQuote";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const dmOf = (r: any) => r.results.find((t: any) => t.triggerId === "debt-maturity");
const strip = (seq: any[]) => seq.map((e) => (e.kind === "row" ? { ...e, printedHeading: undefined } : e));

const tr = nonEmpty("the refresh batch", JSON.parse(readFileSync("baselines/s27-refresh-batch.json", "utf-8")).names).find((n: any) => n.cik === "0000070318").samples.find((s: any) => s.bust === null).result;
const tin = JSON.parse(readFileSync("sessions/27/refresh/0000070318_input.json", "utf-8"));
const tdm = dmOf(tr), ttext = tin.docs[tdm.debtScheduleSourceFiling.url].text;
const loc = createTextLocator(ttext);
const rows = annotatePrintedHeadings(strip(tdm.scheduleSequence), ttext, (l) => loc.find(l)).filter((e: any) => e.kind === "row");
const want = (label: string) => (/^(6\.125 % due 2028|6\.875 % due 2031|6\.000 % due 2033|6\.250 % due 2034)$/.test(label) ? "Senior unsecured notes" : /due 20/.test(label) ? "Senior secured first lien notes" : null);
const wrong = rows.filter((e: any) => (e.printedHeading ?? null) !== want(e.label));
assert(wrong.length === 0, `[H1] Tenet's refresh: every row under the heading printed before it (${wrong.map((e: any) => `${e.label} → ${e.printedHeading}`).join("; ") || "all correct"})`);

const rowsOnly = tdm.scheduleSequence.filter((e: any) => e.kind === "row");
const tt = tableTextAround(ttext, rowsOnly.map((e: any) => e.sourceLine), (l) => loc.find(l));
const old = printedHeadings(tt, rowsOnly.map((e: any) => { const c = [e.section, e.seniority].filter(Boolean); return { label: e.label ?? "", recordedHeading: c.find((h: string) => printedBefore(tt, h, e.label ?? "")) ?? c[0] ?? null }; }));
assert(rowsOnly.some((e: any) => /4\.625/.test(e.label) && headingFor(old, e.label)?.text === "Senior unsecured notes"), `[H2 control] the adjacency rule puts the 4.625% senior secured notes under "Senior unsecured notes"`);

for (const cik of ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"]) {
  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
  const dm = dmOf(snap.result); const text = snap.docs[dm.debtScheduleSourceFiling.url]?.text;
  const seq = dm.scheduleSequence ?? [];
  if (!text || !seq.some((e: any) => e.kind === "row")) { console.log(`  · ${snap.company}: no anchor table rows`); continue; }
  // Only a snapshot the current loop captured (v33) carries today's headings; a v31 capture predates their recovery.
  if (snap.extractionVersion !== 33) { console.log(`  · ${snap.company}: a v${snap.extractionVersion} capture, predating heading recovery — not a reference`); continue; }
  const l2 = createTextLocator(text);
  const again = annotatePrintedHeadings(strip(seq), text, (l) => l2.find(l)).filter((e: any) => e.kind === "row");
  const diff = again.filter((e: any, i: number) => (e.printedHeading ?? null) !== (seq.filter((x: any) => x.kind === "row")[i].printedHeading ?? null));
  assert(diff.length === 0, `[H3:${snap.company}] the position rule gives every row its current heading${diff.length ? ` — differs: ${diff.map((e: any) => e.label).join(", ")}` : ""}`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
