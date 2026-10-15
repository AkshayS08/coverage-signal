/**
 * THE HEADING RULE, ASSERTED ON EVERY PRINTED HEADING IN THE SIX TABLES.
 *
 * A heading counts only where its text is printed in the table, directly
 * before the first row it governs; it governs a contiguous block, ending at
 * the next heading or at a row whose own label names a different instrument
 * type (Akshay, Oct 15 2026). Offline, over lib/cards/fixtures.
 *
 * Run: npx tsx lib/cards/headings.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kindOf, printedBefore, printedHeadings } from "./headings";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const FIX = join(process.cwd(), "lib", "cards", "fixtures");
const fixtures = readdirSync(FIX).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(FIX, f), "utf-8")));

console.log("=== [1] THE NAMED CASE: DaVita's \"Senior Notes:\" ===");
{
  const d = fixtures.find((f) => /davita/i.test(f.company));
  const h = d?.headings.find((x: any) => x.text === "Senior Notes");
  assert(!!h && h.governs.length === 4 && h.governs.every((g: string) => /Senior Notes$/.test(g)), `[1a] it governs exactly its four notes (got: ${h?.governs.join(" | ")})`);
  assert(!!h && !h.governs.includes("Acquisition obligations and other notes payable") && !h.governs.includes("Financing lease obligations"), "[1b] and not the acquisition obligations or the financing leases that follow it with no heading of their own");
}

console.log("\n=== [2] EVERY PRINTED HEADING IN THE SIX TABLES ===");
let headingCount = 0;
for (const f of fixtures) {
  const rows: string[] = f.table.rows.map((r: any) => r.label);
  for (const h of f.headings) {
    headingCount++;
    const at = rows.indexOf(h.governs[0]);
    const contiguous = h.governs.every((g: string, i: number) => rows[at + i] === g);
    assert(printedBefore(f.table.text, h.text, h.governs[0]), `[2:${f.company}] "${h.text}" is printed directly before its first row`);
    assert(contiguous, `[2:${f.company}] "${h.text}" governs a contiguous block of ${h.governs.length} row(s)`);
    const hk = kindOf(h.text);
    const strays = h.governs.filter((g: string) => kindOf(g) !== null && hk !== null && kindOf(g) !== hk);
    assert(strays.length === 0, `[2:${f.company}] no row under "${h.text}" names a different instrument type${strays.length ? ` (${strays.join(", ")})` : ""}`);
    const next = rows[at + h.governs.length];
    const ends = next === undefined || (kindOf(next) !== null && hk !== null && kindOf(next) !== hk) || f.headings.some((o: any) => o !== h && o.governs[0] === next);
    assert(ends, `[2:${f.company}] the block under "${h.text}" ends at the next heading, a different instrument type, or the table's end (next: ${next ?? "end"})`);
  }
}
assert(headingCount > 0, `[2z] ${headingCount} printed headings checked across ${fixtures.length} tables — a rule asserted on no heading is not asserted`);

console.log("\n=== [3] A RECORDED HEADING THE TABLE NEVER PRINTED COUNTS FOR NOTHING ===");
for (const f of fixtures) {
  const recorded = new Set(f.table.rows.map((r: any) => r.recordedHeading).filter(Boolean));
  for (const r of recorded) {
    const printed = f.table.rows.some((row: any) => row.recordedHeading === r && printedBefore(f.table.text, r as string, row.label));
    const kept = f.headings.some((h: any) => h.text === String(r).replace(/[:—–-]+$/, "").trim());
    if (!printed) assert(!kept, `[3:${f.company}] "${r}" is recorded but not printed, and is not a heading`);
  }
}

console.log("\n=== [4] NEGATIVE CONTROL — the rule can refuse ===");
{
  const table = "Senior Notes: 4.625% Senior Notes 2,750 Acquisition obligations and other notes payable 39 Financing lease obligations 160";
  const rows = [
    { label: "4.625% Senior Notes", recordedHeading: "Senior Notes" },
    { label: "Acquisition obligations and other notes payable", recordedHeading: "Senior Notes" },
    { label: "Financing lease obligations", recordedHeading: "Senior Notes" },
  ];
  const h = printedHeadings(table, rows);
  assert(h.length === 1 && h[0].governs.length === 1, `[4a] a heading recorded over three rows governs only the one its type covers (got ${h[0]?.governs.length})`);
  const invented = printedHeadings("6 % Senior Secured Notes due 2029 644 5 ¼% Senior Secured Notes due 2030 1,535", [
    { label: "6 % Senior Secured Notes due 2029", recordedHeading: "senior-priority secured" },
    { label: "5 ¼% Senior Secured Notes due 2030", recordedHeading: "senior-priority secured" },
  ]);
  assert(invented.length === 0, "[4b] a heading recorded but not printed (CHS's \"senior-priority secured\") is not a heading");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
