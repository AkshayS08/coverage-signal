/**
 * THE ROSTER, AND THE RULE THAT READS ITS SECOND OBSERVATION. Offline, $0.
 *
 * Two traps are asserted here because both are cheap to fall into and
 * expensive to fall into quietly:
 *
 *   - "null twice" is only a reproducing drop when both nulls are about the
 *     same documents. Where the corpus moved, they are not.
 *   - a field coming back FILLED is not automatically a recovery. Filled from
 *     somewhere other than the anchor is the regression Rule 51 removed.
 */
import { REFRESH_ROSTER, dropVerdict, activeWatches, rosterNames, type FieldDropWatch } from "./refreshRoster";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}

const molina = REFRESH_ROSTER.find((r) => r.company === "Molina Healthcare")!;
const encompass = REFRESH_ROSTER.find((r) => r.company === "Encompass Health")!;
const watch: FieldDropWatch = molina.fieldDrops[0];

console.log("=== [1] The roster says why each name is on it ===");
{
  assert(rosterNames().length === 4,
    `[1a] four names — Tenet, CHS, Molina, Encompass (got ${rosterNames().join(", ")})`);
  assert(molina.corpusMoved === false && molina.fieldDrops.length === 1,
    "[1b] Molina is on for the FIELD DROP, not for staleness — its corpus is unchanged, which is what makes the refresh a clean second trial");
  assert(encompass.corpusMoved === true && encompass.fieldDrops.length === 0,
    "[1c] Encompass is on for the CORPUS MOVE only — its lettersOfCredit watch was struck on evidence before any spend");
  assert(activeWatches().length === 1,
    `[1d] exactly one field watch survives the pre-check, so the refresh reports on one field and does not claim to answer two (got ${activeWatches().length})`);
}

console.log("\n=== [2] A watch is only worth re-asking if the filing states the field ===");
{
  assert(watch.statedBy.location === "anchor",
    "[2a] Molina's filling sentence is in the ANCHOR — a drop of something the anchor itself states is the model's, not the corpus's");
  assert(/no amount was outstanding/i.test(watch.statedBy.sentence),
    `[2b] and the sentence is carried verbatim, so a recovery can be checked against it rather than assumed (got "${watch.statedBy.sentence}")`);
  assert(watch.observedAtV30 === null,
    "[2c] v30's observation is recorded as the baseline — without it there is no first trial to compare a second against");
}

console.log("\n=== [3] Two nulls are one finding only when they are the same question ===");
{
  const v = dropVerdict(watch, { value: null, sentenceLocation: null }, false);
  assert(v.kind === "reproducing-drop",
    `[3a] null again over the SAME corpus → reproducing drop → prompt fix (got ${v.kind})`);

  const moved = dropVerdict(watch, { value: null, sentenceLocation: null }, true);
  assert(moved.kind === "not-comparable",
    `[3b] null again after the corpus MOVED is not a second trial — it is a null about different documents, and counting it as reproducing is Rule 30's error one field over (got ${moved.kind})`);
}

console.log("\n=== [4] A filled field is not automatically a recovery ===");
{
  const good = dropVerdict(watch, { value: "$0", sentenceLocation: "anchor" }, false);
  assert(good.kind === "one-time-drop",
    `[4a] filled from the ANCHOR's own text → v30's null was variance, and no prompt change is bought by it (got ${good.kind})`);

  const bad = dropVerdict(watch, { value: "$250.0 million", sentenceLocation: "off-anchor" }, false);
  assert(bad.kind === "off-anchor-substitution",
    `[4b] filled from a document that is NOT the anchor is the regression Rule 51 removed, not a recovery — and must never be scored as the drop resolving (got ${bad.kind})`);
  assert(bad.kind === "off-anchor-substitution" && /regression/i.test(bad.action),
    "[4c] and its action says so, rather than reading like a pass");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
