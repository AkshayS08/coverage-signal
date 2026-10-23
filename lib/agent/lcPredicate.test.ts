/**
 * SESSION 27 (Akshay, Oct 23, 2026) — A LETTER-OF-CREDIT FIGURE IS
 * "OUTSTANDING" ONLY WHERE ITS SENTENCE PREDICATES OUTSTANDING OR ISSUED
 * AMOUNTS. Where it predicates capacity (a sub-limit, an amount available
 * for issuance) it is capacity, and outstanding is "not stated" unless
 * another sentence states it. The predicate principle of Rules 57 and 70.
 *
 * Cigna's v33 answer read "with up to $ 500 million available for issuance
 * of letters of credit" as $500MM of letters of credit outstanding; the card
 * then showed it as outstanding and dropped the revolver's availability.
 *
 *   C1  the predicate of the clause stating the figure, over real sentences
 *       (Cigna's capacity, CHS's outstanding) and the class's shapes
 *   C2  over all six names' facilities (v31 snapshots and v33 replay):
 *       every letters-of-credit figure KEPT as outstanding is predicated
 *       outstanding or issued; every one predicated capacity is kept as
 *       capacity and NOT as outstanding
 *   C3  Cigna v33: the $500MM is capacity, outstanding not stated
 *   control: the same figure in a sentence predicating outstanding is kept
 *
 * Offline, $0. Run: npx tsx lib/agent/lcPredicate.test.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as vf from "./verifyFacility";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const predicate = (vf as any).letterOfCreditPredicate as ((value: string, sentence: string) => "outstanding" | "capacity" | "unstated") | undefined;

console.log("\n=== C1: the clause's own predicate ===");
const CASES: [string, string, "outstanding" | "capacity" | "unstated"][] = [
  ["$ 500 million", "The Company can borrow up to $ 6.5 billion under the Credit Agreement for general corporate purposes, with up to $ 500 million available for issuance of letters of credit.", "capacity"],
  ["$ 32 million", "At June 30, 2026 , the Company had no outstanding borrowings and approximately $ 751 million of additional borrowing capacity (after taking into consideration the $ 32 million of outstanding letters of credit) under the ABL Facility.", "outstanding"],
  ["$100 million", "The revolving credit facility includes a $100 million sub-limit for letters of credit.", "capacity"],
  ["$45.2 million", "As of June 30, 2026, letters of credit totaling $45.2 million were issued under the facility.", "outstanding"],
  ["$20 million", "The facility may be used to issue letters of credit of up to $20 million.", "capacity"],
  ["$12 million", "We had $12 million of letters of credit outstanding at quarter end.", "outstanding"],
  ["$75 million", "The agreement provides for $75 million of letters of credit.", "unstated"],
];
for (const [v, s, want] of CASES) assert(!!predicate && predicate(v, s) === want, `[C1] ${want}: "${s.slice(0, 80)}…"`);

const IN = join(process.cwd(), "lib", "cards", "inputs");
const replay = existsSync("baselines/s27-replay.json") ? JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")) : { results: [] };
console.log("\n=== C2: over all six names, v31 and v33 ===");
for (const f of readdirSync(IN).filter((x) => /^\d{10}\.json$/.test(x))) {
  const snap = JSON.parse(readFileSync(join(IN, f), "utf-8"));
  const textByUrl = new Map<string, string>(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
  const sources = [{ label: "v31", result: snap.result }, ...replay.results.filter((x: any) => x.result.cik === snap.cik).map((x: any) => ({ label: "v33", result: x.result }))];
  for (const s of sources) {
    const dm = s.result.results.find((t: any) => t.triggerId === "debt-maturity");
    // The model's own figures, as it returned them: the verified ones, and any the old verifier rejected.
    const raw = (dm?.facilities ?? []).map((fac: any) => {
      const rej = (dm.facilityRejections ?? []).find((r: any) => r.facility === fac.name && r.field === "lettersOfCredit");
      return { ...fac, lettersOfCredit: fac.lettersOfCredit ?? (rej ? { value: rej.value, sourceLine: rej.sourceLine } : null) };
    });
    const r = vf.verifyFacilities({ facilities: raw, textByUrl, anchorReportDate: dm?.debtScheduleSourceFiling?.reportDate ?? null });
    for (const fac of r.verified as any[]) {
      const offered = raw.find((x: any) => x.name === fac.name)?.lettersOfCredit;
      if (!offered?.value) continue;
      const p = predicate ? predicate(offered.value, offered.sourceLine) : "unstated";
      if (fac.lettersOfCredit) assert(p === "outstanding" || /^\$?\s*0|—/.test(fac.lettersOfCredit.value), `[C2:${snap.company} ${s.label}] ${fac.name}: kept as outstanding ${fac.lettersOfCredit.value}, and its sentence predicates ${p}`);
      const zero = /^\$?\s*0\b|^\$?\s*[—–-]$/.test(offered.value.trim());
      if (p === "capacity" && !zero) assert(!fac.lettersOfCredit && fac.lettersOfCreditCapacity?.value === offered.value, `[C2:${snap.company} ${s.label}] ${fac.name}: ${offered.value} predicated capacity is kept as capacity, not outstanding`);
      // A zero claimed from a capacity-only sentence: outstanding not stated — neither kept nor withheld.
      if (p === "capacity" && zero) assert(!fac.lettersOfCredit && !r.rejections.some((x: any) => x.facility === fac.name && x.field === "lettersOfCredit"), `[C2:${snap.company} ${s.label}] ${fac.name}: a zero claimed from a capacity-only sentence leaves outstanding not stated (not kept, not withheld)`);
      console.log(`    ${snap.company} ${s.label} ${fac.name}: offered ${offered.value} — predicate ${p}; outstanding ${fac.lettersOfCredit?.value ?? "not kept"}; capacity ${fac.lettersOfCreditCapacity?.value ?? "—"}`);
    }
    for (const rej of r.rejections.filter((x: any) => x.field === "lettersOfCredit")) console.log(`    ${snap.company} ${s.label} ${rej.facility}: ${rej.value} withheld — ${rej.reason}`);
  }
}

console.log("\n=== control: the same figure, predicated outstanding ===");
const cig = JSON.parse(readFileSync(join(IN, "0001739940.json"), "utf-8"));
const ctext = new Map<string, string>(Object.entries(cig.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
const line = "The Company can borrow up to $ 6.5 billion under the Credit Agreement for general corporate purposes, with up to $ 500 million available for issuance of letters of credit.";
const anchorUrl = cig.result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
const docText = ctext.get(anchorUrl)!;
const outLine = "Letters of credit of $ 500 million were outstanding under the Credit Agreement.";
ctext.set(anchorUrl, docText + " " + outLine);
const fac = { name: "revolving credit agreement", category: "revolver", facilitySize: { value: "$ 6.5 billion", sourceLine: line }, lettersOfCredit: { value: "$ 500 million", sourceLine: outLine } };
const kept = vf.verifyFacilities({ facilities: [fac as any], textByUrl: ctext, anchorReportDate: "2026-06-30" }).verified[0] as any;
assert(kept?.lettersOfCredit?.value === "$ 500 million", `[control] "$ 500 million" in a sentence predicating outstanding is kept as outstanding`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
