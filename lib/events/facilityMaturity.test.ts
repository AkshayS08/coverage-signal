/**
 * RULE 57 — WHAT IS THIS DATE ATTACHED TO? Offline, $0.
 *
 * The case that earned the rule: UHS's $700 million delayed draw loan. Its
 * 10-Q states the FUNDING deadline as a date and the maturity as a span, and
 * the resolver took the only date it could find. In one run of three that
 * carded a $700 million maturity twelve months early.
 */
import { resolveFacilityMaturity, facilityMaturityNote } from "./facilityMaturity";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

console.log("=== [1] REAL UHS — the funding deadline is not the maturity ===");
{
  const v = "364 days after initial funding, on or prior to September 30, 2026";
  const m = resolveFacilityMaturity(v);
  assert(m.outcome === "relative",
    `[1a] REAL, as run 1 transcribed it: resolves RELATIVE, not dated (got ${m.outcome}${m.outcome === "dated" ? ` ${m.date}` : ""}). Before Rule 57 this returned 2026-09-30 and the facility carded`);
  assert(m.outcome === "relative" && /FUNDED/i.test(m.why),
    `[1b] and it names what the date IS attached to, rather than only refusing (got: ${m.outcome === "relative" ? m.why : "—"})`);
  assert(m.outcome === "relative" && /September 30, 2026/.test(m.why),
    "[1c] quoting the date it declined to use, so the reader can check the call rather than trust it");

  const m3 = resolveFacilityMaturity("364 days after funding");
  assert(m3.outcome === "relative",
    `[1d] REAL, as run 3 transcribed it: also relative — the two transcriptions now reach the SAME outcome, which is what stops the coin flip (got ${m3.outcome})`);
  assert(facilityMaturityNote(m3) !== null && !/no maturity stated/.test(facilityMaturityNote(m3)!),
    "[1e] and it renders its stated words rather than a blank — the filer disclosed a maturity, it just is not a date (Stage 5's render case)");
}

console.log("\n=== [2] A date the clause DOES predicate of maturity is still the maturity ===");
{
  const m = resolveFacilityMaturity("matures on September 26, 2029, five years from closing");
  assert(m.outcome === "dated" && m.date === "2029-09-26",
    `[2a] a relative term in the sentence does NOT disqualify a date the clause says it matures on (got ${m.outcome}${m.outcome === "dated" ? ` ${m.date}` : ""}) — the rule is predication, not proximity`);
  const p = resolveFacilityMaturity("payable in full on November 4, 2030, five years after the amendment");
  assert(p.outcome === "dated" && p.date === "2030-11-04",
    `[2b] "payable ... on" predicates maturity just as "matures on" does (got ${p.outcome})`);
}

console.log("\n=== [3] The ordinary cases are untouched ===");
{
  assert(resolveFacilityMaturity("September 26, 2029").outcome === "dated",
    "[3a] a bare date, with no relative term to adjudicate, resolves dated exactly as before");
  assert(resolveFacilityMaturity("April 2030").outcome === "dated",
    "[3b] and a month-precision date still resolves");
  assert(resolveFacilityMaturity("five years").outcome === "relative",
    "[3c] REAL HCA: a relative term with no date at all is relative, as it always was");
  assert(resolveFacilityMaturity("").outcome === "unstated",
    "[3d] and an empty value is unstated — still three outcomes, not two");
  const two = resolveFacilityMaturity("extended the scheduled maturity date from March 16, 2027 to November 4, 2030");
  assert(two.outcome === "relative",
    "[3e] REAL: two dates still refuse rather than pick, and Rule 57 did not disturb that path");
}

console.log("\n=== [4] The conservative edge, asserted as deliberate ===");
{
  const m = resolveFacilityMaturity("364 days after funding, but in no event later than December 31, 2027");
  assert(m.outcome === "relative",
    `[4a] a genuine outside bound naming no maturity word ALSO refuses (got ${m.outcome}). Refusing to card is the recoverable direction; carding on a date the clause does not predicate of maturity is not`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
