/**
 * THE 9b GATE MUST BE ABLE TO REFUSE. Offline, $0.
 *
 * The bug this pins: the evidence map was keyed by COMPANY alone, so Molina's
 * "CACHE_BUST x3 at v29" was returned for a v30 signature and the gate passed
 * without a word. The test that matters is therefore a REFUSAL — a gate whose
 * only assertions are that it accepts has not been tested at all.
 *
 * THE MECHANISM IS TESTED AGAINST A FIXTURE, NOT AGAINST THE LIVE TABLE. The
 * first version of this suite asserted "Molina has no v30 evidence", which is
 * a fact about the data rather than about the function — and all four such
 * assertions broke the moment that evidence was recorded, which is the very
 * thing the gate exists to allow. Facts about the live table are asserted
 * separately, below, and only in forms that stay true as it grows.
 */
import { evidenceFor, REPRODUCTION_EVIDENCE, RUNS_REQUIRED, type ReproductionEvidence } from "./reproductionEvidence";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

/** The shape of the bug, frozen: one company, evidence at an older version only. */
const FIXTURE: ReproductionEvidence[] = [
  { company: "Molina Healthcare", version: 29, runs: 3, recordedOn: "2026-09-17", evidence: "CACHE_BUST x3 at v29 ...", toleratedDifferences: [] },
  { company: "Partial Co", version: 30, runs: 2, recordedOn: "2026-09-21", evidence: "CACHE_BUST x2 at v30 ...", toleratedDifferences: [] },
];

console.log("=== [1] The bug, as the case that must refuse ===");
{
  const v30 = evidenceFor("Molina Healthcare", 30, FIXTURE);
  assert(v30.kind === "wrong-version",
    `[1a] evidence recorded at v29, asked for at v30 → REFUSED as wrong-version (got ${v30.kind}). Keyed by company alone, this returned the v29 text and the signature proceeded`);
  assert(v30.kind === "wrong-version" && /v29/.test(v30.reason) && /v30/.test(v30.reason),
    "[1b] and the refusal names BOTH versions — which exists and which was asked for — because 'no evidence' and 'evidence about another version' need different actions");
  assert(v30.kind === "wrong-version" && v30.found.length > 0,
    "[1c] the evidence it DID find comes back with the refusal rather than being discarded, so the reader can see what is on file");

  const v29 = evidenceFor("Molina Healthcare", 29, FIXTURE);
  assert(v29.kind === "usable",
    `[1d] at the version it was actually recorded at, it is usable — the fix keys the lookup, it does not disable it (got ${v29.kind})`);
}

console.log("\n=== [2] The other two ways it must refuse ===");
{
  const unknown = evidenceFor("Some Company Never Measured", 30, FIXTURE);
  assert(unknown.kind === "none",
    `[2a] a name with nothing on file at any version is 'none', distinct from 'wrong-version' (got ${unknown.kind})`);
  assert(unknown.kind === "none" && /any version/.test(unknown.reason),
    "[2b] and says so, so it is not mistaken for a version problem a re-run at the right version would fix");

  const thin = evidenceFor("Partial Co", 30, FIXTURE);
  assert(thin.kind === "too-few-runs",
    `[2c] right version, two runs → 'too-few-runs', not 'usable' — three is the criterion, not a preference (got ${thin.kind})`);
  assert(RUNS_REQUIRED === 3,
    "[2d] and the number is named rather than inlined, because it IS the criterion");
}

console.log("\n=== [3] Name matching across the forms a company arrives in ===");
{
  assert(evidenceFor("MOLINA HEALTHCARE, INC.", 29, FIXTURE).kind === "usable",
    "[3a] the filer's own name matches the recorded one — case and suffix do not break the lookup");
  assert(evidenceFor("Molina", 29, FIXTURE).kind === "usable",
    "[3b] and a shorter requested form matches too");
}

console.log("\n=== [4] The LIVE table — stated so it stays true as the table grows ===");
{
  // Not "Molina has v30 evidence" — that breaks on the next bump. The
  // invariant is that nothing is usable at a version it was not recorded at.
  const misfiled = REPRODUCTION_EVIDENCE.filter((e) => {
    const l = evidenceFor(e.company, e.version + 1);
    return l.kind === "usable" && l.evidence.version !== e.version + 1;
  });
  assert(misfiled.length === 0,
    `[4a] no recorded entry is returned as usable one version past where it was recorded (got ${misfiled.length})`);

  // BY COMPANY, not by row. Counting rows printed "2 of 7 — Molina, Molina",
  // because Molina has two rows and both match the name. A count of one thing
  // reported as a count of another is this session's whole subject.
  const companies = [...new Set(REPRODUCTION_EVIDENCE.map((e) => e.company))];
  const usableNow = companies.filter((c) => evidenceFor(c, EXTRACTION_PROMPT_VERSION).kind === "usable");
  console.log(`      (at v${EXTRACTION_PROMPT_VERSION}: ${usableNow.length} of ${companies.length} company(ies) have usable evidence — ${usableNow.join(", ") || "none"})`);
  assert(REPRODUCTION_EVIDENCE.every((e) => e.runs >= 1 && e.version >= 1 && e.evidence.length > 40),
    "[4b] every recorded entry carries a version, a run count and evidence text substantial enough to be read");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
