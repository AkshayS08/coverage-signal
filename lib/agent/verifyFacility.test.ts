/**
 * SESSION 22, STAGE 3 — THE FACILITY GUARD, PINNED BEFORE ANY SPEND.
 *
 * The guarantee under test, in the words it was asked for:
 *
 *     NO FACILITY FIGURE IS EVER SOURCED FROM A FILING THAT DOES NOT STATE IT.
 *
 * The central fixture is Encompass's ACTUAL v28 output — four figures and
 * one sentence, that sentence stating only the drawn figure — because the
 * point of the guard is to reject what shipped, not to accept what we would
 * have liked to ship. If this suite passes, the $824 million cannot be
 * rendered as a verified availability by any path through this module.
 *
 * Run: npx tsx lib/agent/verifyFacility.test.ts
 */
import { verifyFacilities, facilityArithmetic } from "./verifyFacility";
import type { FacilityRow } from "./claude";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const URL = "https://sec.gov/ehc-10q.htm";
const DRAWN_SENTENCE = "As of June 30, 2026, $ 200.0 million was drawn under the revolving credit facility with an interest rate of 4.9 %.";
const SIZE_SENTENCE = "We have a $ 1 billion revolving credit facility maturing in June 2028.";
const FILING_TEXT = `Other content. ${SIZE_SENTENCE} More content. ${DRAWN_SENTENCE} Further content about unrelated matters.`;
const textByUrl = new Map([[URL, FILING_TEXT]]);
const fig = (value: string, sourceLine: string) => ({ value, sourceLine });
const parse = (s: string): number | null => {
  const m = /([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?/i.exec(s.replace(/\$/g, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase();
  return unit === "billion" ? n * 1e9 : unit === "million" ? n * 1e6 : unit === "thousand" ? n * 1e3 : n;
};

console.log("\n=== [1] ENCOMPASS AS SHIPPED — four figures, one sentence about one of them ===");
{
  const f: FacilityRow = {
    name: "revolving credit facility", category: "revolver",
    facilitySize: fig("$1 billion", DRAWN_SENTENCE),
    drawn: fig("$200.0 million", DRAWN_SENTENCE),
    lettersOfCredit: fig("$46.3 million", DRAWN_SENTENCE),
    available: fig("$824 million", DRAWN_SENTENCE),
    maturity: null, asOfDate: "2026-06-30",
  };
  const r = verifyFacilities({ facilities: [f], textByUrl });

  assert(r.verified.length === 1,
    "[1a] THE FACILITY SURVIVES. A withheld figure never erases a verified instrument — that is the whole difference between a refusal and a suppression");
  const v = r.verified[0];
  assert(v.drawn?.value === "$200.0 million",
    "[1b] the DRAWN figure is kept: its sentence is in the filing and states it");
  assert(v.available === null,
    `[1c] THE $824 MILLION IS REJECTED. Its sentence is real and is in the filing — and says nothing about $824 million. A true number and a true quote joined by nothing is the composite-fabrication class, and this is the check whose absence shipped it (got ${JSON.stringify(v.available)})`);
  assert(v.facilitySize === null && v.lettersOfCredit === null,
    "[1d] and so are the size and the letters of credit, for the same reason — the guard is per figure, not per facility");
  assert(r.rejections.filter((x) => x.reason === "sentence does not state this figure").length === 3,
    `[1e] all three rejections are NAMED with their reason, so the surface can say why a line is missing rather than just omitting it (got ${JSON.stringify(r.rejections.map((x) => x.field))})`);
}

console.log("\n=== [2] THE SAME FACILITY, EACH FIGURE WITH ITS OWN SENTENCE ===");
{
  const f: FacilityRow = {
    name: "revolving credit facility", category: "revolver",
    facilitySize: fig("$1 billion", SIZE_SENTENCE),
    drawn: fig("$200.0 million", DRAWN_SENTENCE),
    lettersOfCredit: null,
    available: null,
    maturity: fig("June 2028", SIZE_SENTENCE),
    asOfDate: "2026-06-30",
  };
  const r = verifyFacilities({ facilities: [f], textByUrl });
  assert(r.verified.length === 1 && r.verified[0].facilitySize?.value === "$1 billion" && r.verified[0].drawn?.value === "$200.0 million",
    "[2a] two figures, two sentences, both stating their own figure — both kept. The guard rejects mis-attribution, not multiplicity");
  assert(r.rejections.length === 0, "[2b] and nothing is rejected when nothing is mis-attributed");
}

console.log("\n=== [3] A SENTENCE NO FILING CONTAINS ===");
{
  const f: FacilityRow = {
    name: "receivables facility", category: "receivables-facility",
    facilitySize: fig("$600 million", "The Company maintains a $ 600 million secured receivables facility."),
    drawn: null, lettersOfCredit: null, available: null, maturity: null, asOfDate: null,
  };
  const r = verifyFacilities({ facilities: [f], textByUrl });
  assert(r.verified.length === 0 && r.droppedFacilities.includes("receivables facility"),
    "[3a] a facility whose ONLY figure rests on a sentence nobody filed is dropped entirely — a name with nothing behind it asserts an instrument on no evidence, which is worse than withholding a figure from one we can see");
  assert(r.rejections[0]?.reason === "sentence appears in no fetched filing",
    "[3b] and the reason distinguishes 'in no fetched filing' from 'in a filing but not about this figure' — two different failures needing two different fixes");
}

console.log("\n=== [4] THE ARITHMETIC IS REPORTED, NEVER REPAIRED ===");
{
  const tie: FacilityRow = {
    name: "r", category: "revolver",
    facilitySize: fig("$1.5 billion", "x"), drawn: fig("$225 million", "x"),
    lettersOfCredit: fig("$3 million", "x"), available: fig("$1.272 billion", "x"),
    maturity: null, asOfDate: null,
  };
  const a = facilityArithmetic(tie, parse);
  assert(a.checkable && a.ties === true,
    "[4a] UHS's four figures reconcile — 225 + 3 + 1,272 = 1,500 — and the check says so");

  const broken: FacilityRow = { ...tie, facilitySize: fig("$1 billion", "x"), available: fig("$824 million", "x"), lettersOfCredit: fig("$46.3 million", "x"), drawn: fig("$200.0 million", "x") };
  const b = facilityArithmetic(broken, parse);
  assert(b.checkable && b.ties === false && b.why.includes("DOES NOT TIE"),
    `[4b] Encompass's do not, and that renders as its own flag rather than as a liquidity figure someone might act on (${b.why})`);

  const partial: FacilityRow = { ...tie, lettersOfCredit: null };
  const c = facilityArithmetic(partial, parse);
  assert(c.checkable === false && c.ties === null && c.why.includes("letters of credit"),
    `[4c] A MISSING COMPONENT MEANS NO CONCLUSION, and names what is missing. Treating it as zero manufactures a gap the filing never stated, and we cannot tell "there are no letters of credit" from "they are not stated here" — Rule 10 (${c.why})`);

  const none: FacilityRow = { ...tie, available: null, drawn: null, lettersOfCredit: null };
  assert(facilityArithmetic(none, parse).checkable === false,
    "[4d] and with no available figure it is not checkable at all, which is stated rather than silently passing");
}

console.log("\n=== [5] NOTHING IS EVER STITCHED IN ===");
{
  // The failure mode the guarantee names: a figure that would make the
  // arithmetic reconcile, taken from a document that does not state it.
  const f: FacilityRow = {
    name: "revolving credit facility", category: "revolver",
    facilitySize: fig("$1 billion", SIZE_SENTENCE),
    drawn: fig("$200.0 million", DRAWN_SENTENCE),
    lettersOfCredit: null,
    // $800M would make 200 + 800 = 1,000 reconcile perfectly. It is not in
    // the filing, and no amount of arithmetic convenience may admit it.
    available: fig("$800 million", "Available capacity was $ 800 million."),
    maturity: null, asOfDate: null,
  };
  const r = verifyFacilities({ facilities: [f], textByUrl });
  assert(r.verified[0].available === null,
    "[5a] A FIGURE THAT WOULD MAKE THE FACILITY RECONCILE IS STILL REJECTED when the filing does not state it. Reconciling by stitching is the composite-fabrication class, and a check that can be satisfied by inventing its own input is not a check");
  const after = facilityArithmetic(r.verified[0], parse);
  assert(after.checkable === false && after.ties === null,
    `[5b] so the facility reads as not-checkable rather than as reconciling — the honest outcome of a missing figure, not a convenient one (${after.why})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
