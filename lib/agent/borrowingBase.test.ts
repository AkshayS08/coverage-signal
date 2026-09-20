/**
 * SESSION 23, B4 WIDENED — either signal fires. Offline, $0.
 *
 * Every facility below is REAL, copied from the v30 cold pass's own stored
 * rows, sentences included.
 */
import { borrowingBaseOf } from "./borrowingBase";
import { checkRevolverArithmetic } from "../events/coverage";
import type { FacilityRow } from "./claude";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}
const fig = (value: string, sourceLine: string) => ({ value, sourceLine });

// REAL — CHS, exactly as v30 stored it, including availabilityBasis: null.
const CHS_AVAIL_SENTENCE =
  "At June 30, 2026 , the Company had no outstanding borrowings and approximately $ 751 million of additional borrowing capacity (after taking into consideration the $ 32 million of outstanding letters of credit) under the ABL Facility.";
const chs: FacilityRow = {
  name: "ABL Facility",
  category: "revolver",
  facilitySize: fig("$1.0 billion", 'Pursuant to the Amended and Restated ABL Credit Agreement, the lenders have extended to CHS a revolving asset-based loan facility in the maximum aggregate principal amount of $ 1.0 billion, subject to borrowing base capacity (the "ABL Facility").'),
  drawn: fig("$0 million", CHS_AVAIL_SENTENCE),
  lettersOfCredit: fig("$32 million", CHS_AVAIL_SENTENCE),
  available: fig("$751 million", CHS_AVAIL_SENTENCE),
  maturity: fig("June 5, 2029", "Principal amounts outstanding under the ABL Facility will be due and payable in full on June 5, 2029."),
  asOfDate: "2026-06-30",
  availabilityBasis: null,
};

// REAL — Tenet. Not an ABL; the borrowing base is stated in words only.
const tenet: FacilityRow = {
  name: "senior secured revolving credit facility",
  category: "revolver",
  facilitySize: fig("$1,900 million", "We have a senior secured revolving credit facility that provides for revolving loans in an aggregate principal amount of $ 1,900 million."),
  drawn: fig("$0", "On that date, we had no cash borrowings and less than $ 1 million of standby letters of credit outstanding under the Credit Agreement."),
  lettersOfCredit: null,
  available: fig("$1,900 million", "Our borrowing availability, which is calculated by reference to a borrowing base that is determined by specified percentages of eligible accounts receivable, eligible inventory and Medicaid supplemental payments, was $ 1,900 million."),
  maturity: fig("November 4, 2030", "The Credit Agreement matures on November 4, 2030."),
  asOfDate: "2026-06-30",
  availabilityBasis: null,
};

// REAL — UHS. The negative contrast: an ordinary revolver whose identity ties.
const UHS_SENTENCE =
  "As of June 30, 2026, we had $ 1.272 billion of available borrowing capacity pursuant to the terms of our $ 1.5 billion revolving credit facility (net of $ 225 million of outstanding borrowings and $ 3 million of letters of credit).";
const uhs: FacilityRow = {
  name: "Revolving credit facility",
  category: "revolver",
  facilitySize: fig("$1.5 billion", UHS_SENTENCE),
  drawn: fig("$225 million", UHS_SENTENCE),
  lettersOfCredit: fig("$3 million", UHS_SENTENCE),
  available: fig("$1.272 billion", UHS_SENTENCE),
  maturity: fig("September 26, 2029", "The maturity date for our Credit Agreement is September 26, 2029 ."),
  asOfDate: "2026-06-30",
  availabilityBasis: null,
};

console.log("=== [1] Either signal fires — and one alone would have missed a real case ===");
{
  const c = borrowingBaseOf(chs);
  assert(c !== null, "[1a] REAL CHS: fires. v30 returned availabilityBasis: null, so the field-only trigger missed the rule's own named example");
  assert(c?.signal === "stated-language" && /borrowing base/i.test(c.limitedBy),
    `[1b] and it fires on the filer's OWN words, which were in the sentences all along — "subject to borrowing base capacity" (got ${c?.signal}/${c?.limitedBy})`);

  const t = borrowingBaseOf(tenet);
  assert(t !== null && t.signal === "stated-language",
    "[1c] REAL Tenet: fires on stated language alone — a NON-ABL revolver can carry a borrowing base, so the label path alone would have missed it");
  assert(/eligible|borrowing base/i.test(t?.statement ?? ""),
    "[1d] and the sentence it renders is the filer's formula, not our paraphrase");

  // The label path, proven independently of the language.
  const labelOnly: FacilityRow = { ...chs, name: "ABL Facility", facilitySize: fig("$1.0 billion", "The Company maintains a $1.0 billion asset-based revolving credit facility."), drawn: null, lettersOfCredit: null, available: null };
  const l = borrowingBaseOf(labelOnly);
  assert(l !== null && l.signal === "asset-based-label",
    "[1e] an ABL with NO borrowing-base sentence still fires on the label — an ABL has a base by definition, which is what the instrument is");
}

console.log("\n=== [2] The negative contrast still holds ===");
{
  assert(borrowingBaseOf(uhs) === null,
    "[2a] REAL UHS: not asset-based, states no borrowing-base language — does NOT fire. Widening the trigger did not widen it onto an ordinary revolver");
  const r = checkRevolverArithmetic(uhs);
  assert(r.kind === "reconciles",
    `[2b] and its identity ties clean: 1,500 − 225 drawn − 3 LC = 1,272 available (got ${r.kind})`);
}

console.log("\n=== [3] CHS now renders as B4 intended ===");
{
  const r = checkRevolverArithmetic(chs);
  assert(r.kind === "borrowing-base-limited",
    `[3a] REAL CHS: borrowing-base-limited, not a failure to reconcile (got ${r.kind})`);
  assert(r.ok === true,
    "[3b] and NO flag is raised against the filer — $751M against a $1.0B commitment is an ABL working as disclosed");
  assert(Math.round(r.impliedBaseMillions ?? 0) === 783,
    `[3c] implied base ~$783M — the number an RM actually wants (got ${r.impliedBaseMillions})`);
  assert(/CEILING, not the expected value/.test(r.note),
    "[3d] and size − drawn − LCs is named a ceiling, so nobody quotes $968M as available");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
