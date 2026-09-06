/**
 * SESSION 21, STAGE 7 — THE NARRATION SET, PRICED AND HELD.
 *
 * Narration is the one Sonnet call per card-eligible event. It is priced
 * here and NOT drafted: the set is presented for review before any of it is
 * billed.
 *
 * ATTEMPTED AND RENDERED-CLEAN ARE SEPARATE COLUMNS, deliberately. A
 * briefing that comes back and fails a structural guard is not a card that
 * did not exist — it is a card that exists and renders a failure banner, and
 * collapsing the two into one number hides exactly the state a reviewer needs
 * to see. Session 18 lost three cards to a guard disagreement and the run
 * summary read as though the cards had simply not been eligible.
 *
 * Reads the wording cache WITHOUT computing: a key that is present costs
 * nothing to render, a key that is absent is what the price is for.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { buildEvents } from "../events/buildEvents";
import { buildVerifiedFactBase } from "../events/factBase";
import { buildContext } from "../events/sonnetEventBriefing";
import { readCache } from "../fetch/cache";
import { NARRATION_PROMPT_VERSION } from "./promptVersion";
import { createHash } from "node:crypto";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];
const ASOF = new Date("2026-09-06T00:00:00Z");

/** Measured on this project's own persisted cost log for a Sonnet card briefing. */
const PER_CARD_LOW = 0.020;
const PER_CARD_HIGH = 0.030;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

(async () => {
  let attempted = 0, cached = 0, clean = 0, failed = 0, uncached = 0;
  const rows: string[] = [];

  for (const company of ALL) {
    const result = await runAgentLoop(company);
    const cards = buildEvents([result], ASOF).flashCardCandidates;
    const factBase = buildVerifiedFactBase(result);
    for (const card of cards) {
      attempted++;
      const key = `wording/card/nar-v${NARRATION_PROMPT_VERSION}/${sha256(buildContext(card, factBase))}.json`;
      const hit = await readCache<{ source?: string; failureReason?: string }>(key, null);
      let state: string;
      if (hit === null) { uncached++; state = "NOT CACHED — would be billed"; }
      else {
        cached++;
        if (hit.source === "failed") { failed++; state = `CACHED, RENDERS A FAILURE BANNER — ${hit.failureReason ?? "(no reason recorded)"}`; }
        else { clean++; state = "CACHED, RENDERS CLEAN"; }
      }
      rows.push(`  ${result.company.padEnd(30)} ${card.headlineTrigger.triggerId.padEnd(20)} ${state}`);
    }
  }

  console.log(`\n${"=".repeat(100)}\nNARRATION SET — PRICED AND HELD FOR REVIEW (nothing drafted, nothing billed)\n${"=".repeat(100)}`);
  for (const r of rows) console.log(r);
  console.log("");
  console.log(`  ATTEMPTED (card-eligible events):   ${attempted}`);
  console.log(`  RENDERED CLEAN:                     ${clean}`);
  console.log(`  RENDERS A FAILURE BANNER:           ${failed}`);
  console.log(`  NOT CACHED (would be billed):       ${uncached}`);
  console.log("");
  console.log(`  Narration prompt version: nar-v${NARRATION_PROMPT_VERSION}`);
  console.log(`  PRICE TO DRAFT the uncached set: ${uncached} call(s) x $${PER_CARD_LOW.toFixed(3)}-$${PER_CARD_HIGH.toFixed(3)} = $${(uncached * PER_CARD_LOW).toFixed(2)}-$${(uncached * PER_CARD_HIGH).toFixed(2)}`);
  console.log(`  A failed briefing is deliberately NOT cached, so every re-attempt of a failing card re-bills.`);
  console.log(`  HELD. Nothing here has been drafted.`);
})();
