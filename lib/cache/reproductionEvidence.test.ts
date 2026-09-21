/**
 * THE 9b GATE MUST BE ABLE TO REFUSE. Offline, $0.
 *
 * The bug this pins: the evidence map was keyed by COMPANY alone, so Molina's
 * "CACHE_BUST x3 at v29" was returned for a v30 signature and the gate passed
 * without a word. The test that matters is therefore a REFUSAL — a gate whose
 * only assertions are that it accepts has not been tested at all.
 */
import { evidenceFor, REPRODUCTION_EVIDENCE, RUNS_REQUIRED } from "./reproductionEvidence";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

console.log("=== [1] The bug, as the case that must now refuse ===");
{
  const v30 = evidenceFor("Molina Healthcare", 30);
  assert(v30.kind === "wrong-version",
    `[1a] REAL Molina: evidence recorded at v29, asked for at v30 → REFUSED as wrong-version (got ${v30.kind}). Before the fix this returned the v29 text and the signature proceeded`);
  assert(v30.kind === "wrong-version" && /v29/.test(v30.reason) && /v30/.test(v30.reason),
    "[1b] and the refusal names BOTH versions — which one exists and which one was asked for — because 'no evidence' and 'evidence about another version' need different actions");
  assert(v30.kind === "wrong-version" && v30.found.length > 0,
    "[1c] the evidence it DID find comes back with the refusal rather than being discarded, so the reader can see what is on file");

  const v29 = evidenceFor("Molina Healthcare", 29);
  assert(v29.kind === "usable",
    `[1d] and at the version it was actually recorded at, it is usable — the fix keys the lookup, it does not disable it (got ${v29.kind})`);
}

console.log("\n=== [2] Every name on file is refused at the CURRENT version ===");
{
  // Not a design statement — a measurement. Every recorded entry is v29 and
  // the code is at v30, so today the honest answer for all six is "re-run".
  const refusedNow = REPRODUCTION_EVIDENCE.filter((e) => evidenceFor(e.company, EXTRACTION_PROMPT_VERSION).kind !== "usable");
  assert(refusedNow.length === REPRODUCTION_EVIDENCE.length,
    `[2a] all ${REPRODUCTION_EVIDENCE.length} recorded names refuse at v${EXTRACTION_PROMPT_VERSION} (got ${refusedNow.length}) — no golden can be signed at this version on evidence from the last one`);
}

console.log("\n=== [3] The other two ways it must refuse ===");
{
  const unknown = evidenceFor("Some Company Never Measured", 30);
  assert(unknown.kind === "none",
    `[3a] a name with nothing on file at any version is 'none', distinct from 'wrong-version' (got ${unknown.kind})`);
  assert(unknown.kind === "none" && /any version/.test(unknown.reason),
    "[3b] and says so, so it is not mistaken for a version problem that a re-run at the right version would fix");
  assert(RUNS_REQUIRED === 3,
    "[3c] 9b requires three runs, and the number is named rather than inlined — it IS the criterion");
}

console.log("\n=== [4] Name matching still works across the forms a company arrives in ===");
{
  assert(evidenceFor("MOLINA HEALTHCARE, INC.", 29).kind === "usable",
    "[4a] the filer's own name matches the recorded one — case and suffix do not break the lookup");
  assert(evidenceFor("Community Health Systems", 29).kind === "usable",
    "[4b] and the requested form matches too");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
