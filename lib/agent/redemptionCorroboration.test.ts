/**
 * SESSION 21 — THE STATUS CORROBORATION, PINNED ON THE REAL SIX.
 *
 * Every sourceLine below is verbatim from the v26 run — what the model
 * actually returned for each company, not a constructed example. The point
 * of pinning the real ones is that this check exists because the model got
 * two of them wrong, and a synthetic suite would never have caught that.
 *
 * Run: npx tsx lib/agent/redemptionCorroboration.test.ts
 */
import { corroborateRedemptionStatus } from "./redemptionStatus";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** company, status the model claimed, its own sourceLine, the status the evidence supports, why. */
const REAL: [string, "completed" | "intended", string, "completed" | "intended", string][] = [
  [
    "Tenet Healthcare", "completed",
    "Tenet intends to use the net proceeds from the sale of the Notes, after payment of fees and expenses, to finance, together with cash on hand, the redemption of all $1.5 billion outstanding of its 6.250% senior secured second lien notes due February 2027",
    "intended",
    'the sentence says "intends to use" — a plan for the proceeds, and "the redemption of" is a noun, not something done',
  ],
  [
    "Cigna Group", "completed",
    "The Company intends to use the proceeds (i) to repay $2.0 billion of loans outstanding under the Term Loan Agreement, dated as of",
    "intended",
    'the same construction — "intends to use ... to repay". "repay" is an infinitive; "repaid" would be the fact',
  ],
  [
    "HCA Healthcare", "intended",
    "On April 27, 2026, the Issuer provided notice of its election to redeem all $1.500 billion of its 5.250% senior notes due 2026",
    "intended",
    "a notice of an election to redeem is not a redemption; the past-tense verb belongs to the NOTICE",
  ],
  [
    "Encompass Health", "completed",
    "redeem at par $ 400  million in aggregate principal amount of the $ 800  million in outstanding principal amount of our 4.50 % Senior Notes due 2028",
    "intended",
    "THE SAFE SIDE, ON A CLAIM THAT IS ACTUALLY TRUE: Encompass really did redeem $400M, and its own June 30 table proves it ($792.0M to $396.9M). But the fragment it quoted starts at \"redeem\" and carries no completed verb, so the evidence does not support the status and the status yields. It costs nothing — the row stays live at $396.9M, which is what the filing says it is",
  ],
  [
    "Quest Diagnostics", "completed",
    "On June 1, 2026, the net proceeds from the 2036 Senior Notes and cash on hand were used to repay in full at maturity the $500 million",
    "completed",
    '"were used to repay in full" — past tense, and the only claim in the book whose evidence carries it',
  ],
  [
    "Molina Healthcare", "completed",
    "We used the net proceeds for repayment of $ 740  million in term loan debt related to the Prior Credit Agreement",
    "completed",
    '"We used the net proceeds for repayment" — corroborated here, though it is dropped anyway because its sourceLine is not in the filing it cites',
  ],
];

console.log("\n=== The six real claims in the book ===");
for (const [company, claimed, line, expected, why] of REAL) {
  const r = corroborateRedemptionStatus(claimed, line);
  assert(r.status === expected, `${company}: claimed ${claimed} → ${expected} — ${why} (got ${r.status})`);
}

console.log("\n=== It only ever fails toward the safe side ===");
{
  const up = corroborateRedemptionStatus("intended", "we redeemed all $1.5 billion of the notes");
  assert(up.status === "intended",
    "an INTENDED claim is never promoted to completed, however completed its sentence reads — the check refuses confidence, it does not manufacture it");
  const none = corroborateRedemptionStatus("completed", null);
  assert(none.status === "intended" && none.demotedReason !== null,
    "a completed claim with no sourceLine at all is demoted, and says why");
  const demoted = corroborateRedemptionStatus("completed", "the Company will repay the notes at maturity");
  assert(demoted.status === "intended" && (demoted.demotedReason ?? "").includes("will"),
    `a demotion names the construction that caused it, so the decision is reportable rather than silent (${demoted.demotedReason})`);
}

console.log("\n=== Tense is the test, not vocabulary ===");
{
  assert(corroborateRedemptionStatus("completed", "we repaid the 4.5% senior notes due 2028").status === "completed",
    "\"repaid\" is a completed payment");
  assert(corroborateRedemptionStatus("completed", "we intend to repay the 4.5% senior notes due 2028").status === "intended",
    "\"intend to repay\" is not — same instrument, same verb root, different tense, and that is the whole distinction");
  assert(corroborateRedemptionStatus("completed", "the notes were redeemed in full on March 1, 2026").status === "completed",
    "a passive past-tense redemption is still a redemption");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
