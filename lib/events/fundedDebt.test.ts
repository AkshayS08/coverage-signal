/**
 * SESSION 27 (Akshay, Oct 29, 2026) — THE DEBT TABLE DECIDES, BY RULE.
 *
 *   (a) Letters of credit are never funded debt: never in captured debt, the
 *       position or the ladder; they render only under Facilities.
 *   (b) A facility description supplies a debt row only when the anchor's
 *       debt table has no row for that facility, and only its drawn amount.
 *       Never a second row for the same facility.
 *
 * DaVita's two re-tastes added two rows the table never carried: a second
 * revolver row read from the facility description, and a "bilateral secured
 * letter of credit facility" row of $188,482 thousand.
 *
 *   F1  over all six names, every sample (v31 snapshot, v33 canonical,
 *       re-tastes): no letters-of-credit row; no facility with two rows
 *   F2  a letters-of-credit prose instrument injected into each name is not
 *       a row and not captured debt; control: the same amount as "notes" is
 *   F3  a revolver prose instrument injected where the table has a revolver
 *       row is not a second row; control: with the table's revolver row
 *       removed, it supplies the row
 *   F4  DaVita's four Oct 15 samples: the face signed on that read set; its three
 *       refresh samples: the golden now signed on its Oct 29 read set
 *
 * Offline, $0. Run: npx tsx lib/events/fundedDebt.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assemblePosition } from "./position";
import { computeCoverage } from "./coverage";
import { deriveGoldenState } from "./golden";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const AS_OF = new Date("2026-10-15T00:00:00Z");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null);
const replay = nonEmpty("the v33 replay samples (baselines/s27-replay.json)", read("baselines/s27-replay.json")?.results);
const retaste = nonEmpty("the v33 re-taste samples (baselines/s27-retaste.json)", read("baselines/s27-retaste.json")?.results);
const samples = (cik: string) => [
  { label: "v31", result: read(join("lib", "cards", "archive", "2026-10-15", "inputs", `${cik}.json`)).result }, // the Oct 15 brief, archived (Nov 3)
  ...replay.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: "v33", result: x.result })),
  ...retaste.filter((x: any) => x.result.cik === cik).map((x: any) => ({ label: x.bust, result: x.result })),
];
const dmOf = (r: any) => r.results.find((t: any) => t.triggerId === "debt-maturity");
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const facilityKind = (t: string | null | undefined) => (t === "revolver" || t === "credit-facility" ? "revolver" : t);

console.log("\n=== F1: every sample of the six ===");
for (const cik of CIKS) for (const s of samples(cik)) {
  const rows = assemblePosition(s.result, AS_OF).rows;
  // A letters-of-credit instrument: by type, or by name where nothing in the name makes it a revolver or credit agreement
  // (Cigna's "revolving credit and letter of credit agreement" is its revolver).
  const lc = rows.filter((r: any) => r.classification.instrumentType === "letter-of-credit" || (/letters? of credit/i.test(r.instrument) && !/revolv|credit agreement|credit facility/i.test(r.instrument)));
  const revolvers = rows.filter((r: any) => !r.isCapacity && facilityKind(r.classification.instrumentType) === "revolver");
  assert(lc.length === 0, `[F1:${s.result.company} ${s.label}] no letters-of-credit row${lc.length ? ` (found ${lc.map((r: any) => r.instrument).join(", ")})` : ""}`);
  assert(revolvers.length <= 1, `[F1:${s.result.company} ${s.label}] at most one funded row per revolver (${revolvers.map((r: any) => `${r.instrument} ${r.amount}`).join("; ") || "none"})`);
}

console.log("\n=== F2-F3: injected prose instruments, each name ===");
for (const cik of CIKS) {
  const base = read(join("lib", "cards", "archive", "2026-10-15", "inputs", `${cik}.json`)).result; // the Oct 15 brief, archived (Nov 3)
  const cov0 = computeCoverage(base).capturedFace;
  const withProse = (p: any) => { const r = clone(base); dmOf(r).proseInstruments = [...(dmOf(r).proseInstruments ?? []), p]; return r; };
  const lcProse = { category: "other", name: "standby letters of credit", amount: "$ 77 million", amountBasis: "outstanding", sourceLine: "The Company had $ 77 million of standby letters of credit outstanding." };
  const rLc = withProse(lcProse);
  assert(!assemblePosition(rLc, AS_OF).rows.some((r: any) => /letters of credit/i.test(r.instrument)) && computeCoverage(rLc).capturedFace === cov0, `[F2:${base.company}] a letters-of-credit instrument is not a row and not captured debt`);
  const notesProse = { ...lcProse, name: "other notes payable", sourceLine: "The Company had $ 77 million of other notes payable outstanding." };
  const rN = withProse(notesProse);
  assert(computeCoverage(rN).capturedFace !== cov0 || assemblePosition(rN, AS_OF).rows.some((r: any) => /other notes payable/i.test(r.instrument)), `[F2 control:${base.company}] the same amount as notes payable does enter the position`);
  const table = dmOf(base).scheduleSequence.filter((e: any) => e.kind === "row");
  const tableRevolver = table.find((e: any) => /revolv|line of credit|credit facility|\bABL\b/i.test(e.label));
  if (!tableRevolver) { console.log(`  · ${base.company}: no revolver row in the table — F3 not constructible`); continue; }
  const revProse = { category: "revolver", name: "senior secured revolving credit facility", amount: "$ 91 million", amountBasis: "outstanding", sourceLine: "The Company had $ 91 million drawn under its senior secured revolving credit facility." };
  const rR = withProse(revProse);
  const revRows = assemblePosition(rR, AS_OF).rows.filter((r: any) => !r.isCapacity && facilityKind(r.classification.instrumentType) === "revolver");
  assert(revRows.length <= 1 && !revRows.some((r: any) => /\$ 91 million/.test(r.amount)), `[F3:${base.company}] a revolver description where the table has a revolver row is not a second row`);
  const rNoTable = clone(rR);
  dmOf(rNoTable).scheduleSequence = dmOf(rNoTable).scheduleSequence.filter((e: any) => e !== tableRevolver && e.label !== tableRevolver.label);
  assert(assemblePosition(rNoTable, AS_OF).rows.some((r: any) => /\$ 91 million/.test(r.amount)), `[F3 control:${base.company}] with the table's revolver row removed, the description supplies the row`);
}

console.log("\n=== F4: DaVita's samples against the position each read set was signed at ===");
// Nov 1: DaVita is now signed on its Oct 29 read set (readSetAsOf). Its four Oct 15 samples keep the position they were
// signed at on the Oct 15 read set (Oct 29 signature: 9 rows, captured face $10,847,516,000); its three refresh samples
// are checked against the golden now signed.
const OCT15 = { rows: 9, capturedFace: 10847516000 };
for (const s of samples("0000927066")) {
  const st: any = deriveGoldenState(s.result, AS_OF);
  assert(st.rows.length === OCT15.rows && st.coverage.capturedFace === OCT15.capturedFace, `[F4:${s.label}] ${st.rows.length} rows (signed ${OCT15.rows} on Oct 15), captured face ${st.coverage.capturedFace} (signed ${OCT15.capturedFace})`);
}
const golden = read("baselines/golden/0000927066.json");
const signed = golden.state;
const refresh = read("baselines/s27-refresh-batch.json").names.find((n: any) => n.cik === "0000927066").samples;
for (const s of refresh) {
  const st: any = deriveGoldenState(s.result, new Date(`${signed.asOf}T00:00:00Z`));
  assert(golden.readSetAsOf === signed.asOf && st.rows.length === signed.rows.length && st.coverage.capturedFace === signed.coverage.capturedFace, `[F4:refresh ${s.bust ?? "canonical"}] ${st.rows.length} rows (signed ${signed.rows.length}), captured face ${st.coverage.capturedFace} (signed ${signed.coverage.capturedFace}, read set ${golden.readSetAsOf})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
