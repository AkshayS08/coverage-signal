/**
 * SESSION 27 — RULE 53 OVER EVERY PRINTED FORM OF ZERO (Akshay, Oct 22, 2026).
 *
 * A stated zero is a stated figure, whichever way the filing (or the model,
 * copying it) writes it. CHS's v33 answer copied the ABL's drawn figure as
 * "$ —" where the signed answer had "$ 0 million", both against the same
 * sentence ("the Company had no outstanding borrowings"). The verifier knew
 * "—" and "$0" as zeros but not "$ —", so it sent the dash to the digit
 * check, rejected it, and the card lost its "$0 drawn".
 *
 *   Z1  every printed zero form is a zero; a quantity is not
 *   Z2  over all six names' verified facilities: a stated zero rewritten as
 *       "$ —" still verifies against its own sentence
 *       control: a stated QUANTITY rewritten as "$ —" is rejected
 *   Z3  CHS's own case: the ABL's "$ —" drawn, against its sentence, verifies
 *
 * Offline, $0: committed snapshots and the committed replay only.
 *
 * Run: npx tsx lib/agent/statedZeroForms.test.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as statedZero from "./statedZero";
const { isZeroValue } = statedZero;
import { verifyFacilities } from "./verifyFacility";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

console.log("\n=== Z1: every printed zero form is a zero ===");
for (const z of ["$ —", "$—", "$ –", "$ -", "—", "-", "$0", "$ 0", "$ 0 million", "$0 thousand", "0", " $ — "]) assert(isZeroValue(z), `[Z1] "${z}" is a stated zero`);
for (const q of ["$ 1", "$ 32 million", "$ 751 million", "$1,900 million", "", "$", "n/a"]) assert(!isZeroValue(q), `[Z1] "${q}" is not a zero`);

const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available"] as const;
const IN = join(process.cwd(), "lib", "cards", "inputs");
console.log("\n=== Z2: over all six, a stated zero written as \"$ —\" still verifies ===");
let zeros = 0, quantities = 0;
for (const f of readdirSync(IN).filter((x) => /^\d{10}\.json$/.test(x))) {
  const s = JSON.parse(readFileSync(join(IN, f), "utf-8"));
  const textByUrl = new Map<string, string>(Object.entries(s.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
  const dm = s.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const anchorReportDate = dm?.debtScheduleSourceFiling?.reportDate ?? null;
  for (const fac of dm?.facilities ?? []) for (const field of FIELDS) {
    const fig = fac[field];
    if (!fig?.value || !fig.sourceLine) continue;
    const dashed = { ...fac, [field]: { ...fig, value: "$ —" } };
    const r = verifyFacilities({ facilities: [dashed], textByUrl, anchorReportDate });
    const kept = r.verified[0]?.[field as keyof typeof r.verified[0]] as any;
    if (isZeroValue(fig.value)) {
      zeros++;
      assert(!!kept && kept.value === "$ —", `[Z2:${s.company}] ${fac.name} ${field}: "${fig.value}" written as "$ —" still verifies`);
    } else if (quantities < 12) {
      quantities++;
      assert(!kept, `[Z2 control:${s.company}] ${fac.name} ${field}: the quantity "${fig.value}" written as "$ —" is rejected`);
    }
  }
}
assert(zeros > 0, `[Z2] the six carry ${zeros} stated zero(s) to test (a check over none is not a check)`);

console.log("\n=== Z3: CHS's ABL, as its v33 answer wrote it ===");
// The answer as the canonical run stored it, before stored zeros were canonical (Oct 23): the replay now holds "$0".
const replayPath = join(process.cwd(), "baselines", "s27-canonical.json");
if (existsSync(replayPath)) {
  const chs = JSON.parse(readFileSync(replayPath, "utf-8")).results.find((x: any) => x.result.cik === "0001108109").result;
  const dm = chs.results.find((t: any) => t.triggerId === "debt-maturity");
  // As the answer wrote it: in the rejections under the old verifier, on the verified facility once the replay re-verifies it.
  const rej = (dm.facilityRejections ?? []).find((x: any) => x.facility === "ABL Facility" && x.field === "drawn") ?? dm.facilities.find((x: any) => x.name === "ABL Facility")?.drawn;
  const snap = JSON.parse(readFileSync(join(IN, "0001108109.json"), "utf-8"));
  const textByUrl = new Map<string, string>(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
  const fac = { ...dm.facilities.find((x: any) => x.name === "ABL Facility"), drawn: { value: rej?.value, sourceLine: rej?.sourceLine } };
  const r = verifyFacilities({ facilities: [fac], textByUrl, anchorReportDate: dm.debtScheduleSourceFiling?.reportDate ?? null });
  assert(!!rej && rej.value === "$ —", `[Z3] the v33 answer wrote the ABL's drawn figure as "${rej?.value}"`);
  assert((r.verified[0] as any)?.drawn?.value === "$ —", `[Z3] and it verifies as a stated zero against "${(rej?.sourceLine ?? "").slice(0, 70)}…"`);
}

// ── Z4-Z5 (Akshay, Oct 23): ONE canonical internal form for a stated zero, before storage and comparison (Rule 67's principle) ──
console.log("\n=== Z4: every printed zero has one canonical form; a quantity keeps its own ===");
const canonical = (statedZero as any).canonicalZero as ((v: string) => string) | undefined;
const CANON = (statedZero as any).CANONICAL_ZERO as string | undefined;
for (const z of ["$ —", "$—", "—", "$0", "$ 0 million", "$0 thousand", "nil", "none", "None", "zero"]) assert(!!canonical && canonical(z) === CANON, `[Z4] "${z}" is stored as ${CANON ?? "(no canonical form)"}`);
for (const q of ["$ 32 million", "$ 751 million", "$1.0 billion"]) assert(!!canonical && canonical(q) === q, `[Z4] "${q}" keeps its own form`);
assert(!!canonical && canonical("$ 32 million") !== CANON, `[Z4 control] a quantity is never the canonical zero`);

console.log("\n=== Z5: over all six, every stored facility zero is canonical, every quantity untouched ===");
const canonFacilities = (statedZero as any).canonicalizeFacilityZeros as ((f: any[]) => any[]) | undefined;
for (const f of readdirSync(IN).filter((x) => /^\d{10}\.json$/.test(x))) {
  const s0 = JSON.parse(readFileSync(join(IN, f), "utf-8"));
  const facs = s0.result.results.find((t: any) => t.triggerId === "debt-maturity")?.facilities ?? [];
  const out = canonFacilities ? canonFacilities(facs) : facs;
  let zerosHere = 0, ok = true;
  for (const [i, fac] of facs.entries()) for (const field of FIELDS) {
    const before = fac[field]?.value, after = out[i]?.[field]?.value;
    if (!before) continue;
    if (isZeroValue(before)) { zerosHere++; if (after !== CANON) ok = false; } else if (after !== before) ok = false;
    if (out[i]?.[field]?.sourceLine !== fac[field].sourceLine) ok = false;
  }
  assert(!!canonFacilities && ok, `[Z5:${s0.company}] ${zerosHere} stated zero(s) canonical, every quantity and every sentence untouched`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
