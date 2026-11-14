/**
 * SESSION 27, STAGE 2 — CAPS, THE DEMO ALLOWANCE AND THE APPROVAL SCREEN (Akshay, Oct 29 and Nov 9, 2026).
 *
 * Checked before any call: $2.00 worst case per card, $10 a day per user, $25 a day across everyone. A cached card is
 * proven free first and never asks. For the demo, Akshay funds a per-user daily allowance inside those caps: a build
 * whose worst case fits the user's remaining allowance runs with no approval screen; above it, the approval screen.
 * Paying users keep the approval screen for every billed build. Prices round up to the cent.
 *   K1  a cached build is free and never asks
 *   K2  within the allowance a demo build runs, no screen; above it, the approval screen with the declared price
 *   K3  a paying user sees the approval screen even within the allowance
 *   K4  each cap refuses before any call: per card, per user per day, global per day
 *   K5  the price is rounded up to the cent; the allowance can never exceed the per-user cap
 *   control: a decision that skips the global cap lets a build through that $25 refuses
 *
 * Offline, $0. Run: npx tsx lib/pipeline/caps.test.ts
 */
import { decide, CAPS, allowanceUsd } from "./caps";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const base = { cached: false, worstUsd: 0.7, userSpentToday: 0, globalSpentToday: 0, allowanceUsd: 2, paying: false };

assert(decide({ ...base, cached: true }).kind === "free", `[K1] a cached build is free`);
const inA = decide({ ...base, worstUsd: 1.5, userSpentToday: 0.4 }), overA = decide({ ...base, worstUsd: 1.7, userSpentToday: 0.4 });
assert(inA.kind === "run" && overA.kind === "needs-approval" && overA.declaredUsd === 1.7, `[K2] within the allowance it runs (${inA.kind}); above it, the approval screen at $${overA.kind === "needs-approval" ? overA.declaredUsd.toFixed(2) : "?"}`);
assert(decide({ ...base, paying: true }).kind === "needs-approval", `[K3] a paying user sees the approval screen`);
const perCard = decide({ ...base, worstUsd: 2.01 }), perUser = decide({ ...base, worstUsd: 1, userSpentToday: 9.5, allowanceUsd: 20 }), global = decide({ ...base, worstUsd: 1, globalSpentToday: 24.5 });
assert(perCard.kind === "refused" && perUser.kind === "refused" && global.kind === "refused", `[K4] refused before any call: ${[perCard, perUser, global].map((d) => (d.kind === "refused" ? d.reason : d.kind)).join(" | ")}`);
const r = decide({ ...base, worstUsd: 1.701, allowanceUsd: 0 });
assert(r.kind === "needs-approval" && r.declaredUsd === 1.71 && allowanceUsd("50") === CAPS.perUserDayUsd && allowanceUsd(undefined) === 2, `[K5] $1.701 is declared $${r.kind === "needs-approval" ? r.declaredUsd : "?"}; an allowance of $50 is held to $${allowanceUsd("50")}`);

// Control: the same rule without the global cap.
const noGlobal = (x: typeof base) => (x.userSpentToday + x.worstUsd <= Math.min(x.allowanceUsd, CAPS.perUserDayUsd) && x.worstUsd <= CAPS.perBuildUsd ? "run" : "needs-approval");
assert(noGlobal({ ...base, worstUsd: 1, globalSpentToday: 24.5 }) === "run" && global.kind === "refused", `[control] skipping the global cap would run a build that $25 a day refuses`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
