/**
 * SESSION 27, STAGE 2 — THE TRUST BADGE (pipeline_design §3), decided by rule in order; the first that applies decides.
 *   1 Could not build — the pipeline stopped before a card existed (a closed list of reasons, with the stage)
 *   2 Signed — a golden at the current version whose state the served answer reproduces
 *   3 Checks failed — any check fails (the card's breakage panel, a stability sample that does not reproduce, a failed
 *     check the build reports)
 *   4 Checks passed — no golden applies, every check passes, 3 of 3 samples reproduce
 *   B1  the order holds: a signed answer whose card failed a check is Signed only if the golden reproduces AND the card
 *       did not fail (a failing card is never Signed)
 *   B2  stability below 3 of 3 is Checks failed, named
 *   B3  no golden, every check passing, 3/3: Checks passed
 *   control: a rule that tests "has a golden" before the card's checks badges a failing card Signed
 *
 * Offline, $0. Run: npx tsx lib/pipeline/badge.test.ts
 */
import { decideBadge } from "./badge";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const ok = { stoppedAt: null, goldenReproduces: false, cardChecksFailed: false, failures: [] as string[], samplesReproducing: 3, samples: 3 };

assert(decideBadge({ ...ok, stoppedAt: { stage: "resolve", reason: "No SEC registrant matches \"x\"" } }).badge === "could-not-build", `[1] a stopped pipeline: Could not build`);
assert(decideBadge({ ...ok, goldenReproduces: true }).badge === "signed", `[2] a reproducing golden: Signed`);
const bad = decideBadge({ ...ok, goldenReproduces: true, cardChecksFailed: true, failures: ["coverage tie"] });
assert(bad.badge === "checks-failed", `[B1] a failing card is never Signed (${bad.badge})`);
const unstable = decideBadge({ ...ok, samplesReproducing: 2 });
assert(unstable.badge === "checks-failed" && unstable.reasons.some((r) => /2 of 3/.test(r)), `[B2] 2 of 3 samples: Checks failed ("${unstable.reasons.join("; ")}")`);
assert(decideBadge(ok).badge === "checks-passed", `[B3] no golden, every check passing, 3/3: Checks passed`);
const naive = (x: typeof ok) => (x.goldenReproduces ? "signed" : x.cardChecksFailed ? "checks-failed" : "checks-passed");
assert(naive({ ...ok, goldenReproduces: true, cardChecksFailed: true }) === "signed", `[control] testing the golden first badges a failing card Signed`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
