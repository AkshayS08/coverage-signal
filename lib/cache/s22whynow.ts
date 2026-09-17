/**
 * SESSION 22, STAGE 5, ITEM 4 — THE v10 WHY-NOW RUN. PAID.
 *
 * Cost and result shape declared first, in
 * files/session_22_stage5_whynow_declaration.md, including the addendum that
 * corrects the item's own premise.
 *
 * Prints every card's why-now with the tranche event the model was shown, so
 * the two can be read against each other. A why-now that cites a balance is
 * FLAGGED rather than counted — the assertion is about which reason the card
 * gives, and a total cannot answer that (Rule 41).
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { buildEvents } from "../events/buildEvents";
import { buildVerifiedFactBase } from "../events/factBase";
import { draftEventBriefing } from "../events/sonnetEventBriefing";
import { currentCompanySpend } from "../agent/costMeter";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/**
 * A why-now resting on a position figure rather than an event. Deliberately
 * matched on the BALANCE VOCABULARY the instruction forbids, not on any
 * company's words — and every hit is printed in full for reading, never
 * reduced to a count.
 */
const BALANCE_REASON =
  /\b(?:cash and cash equivalents|cash balance|cash on hand|cash position|liquidity position)\b|\bcash\s+(?:grew|rose|increased|of)\b|\bdrawn\s+balance\b/i;

(async () => {
  let spend = 0, cards = 0, withEvent = 0, flagged = 0;
  const rows: string[] = [];

  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const pos = assemblePosition(result, PINNED_AS_OF);
    const facts = buildVerifiedFactBase(result, PINNED_AS_OF);
    const candidates = buildEvents([result], PINNED_AS_OF).flashCardCandidates;

    for (const card of candidates) {
      const briefing = await draftEventBriefing(card, facts);
      cards++;
      const row = card.headlineRowId ? pos.rows.find((r) => r.id === card.headlineRowId) : undefined;
      const fact = facts.find((f) => f.ladderRowId && f.ladderRowId === card.headlineRowId);
      const event = fact?.trancheEvent ?? null;
      if (event) withEvent++;
      const isBalance = BALANCE_REASON.test(briefing.whyNow);
      if (isBalance) flagged++;

      console.log(`\n${"-".repeat(100)}`);
      console.log(`${result.company}  —  ${card.headlineTrigger.triggerId}${row ? `  [${row.instrument.slice(0, 44)}]` : ""}`);
      console.log(`  EVENT SHOWN : ${event ? `${event.kind} — "${event.evidence.replace(/\s+/g, " ").slice(0, 150)}"` : "— none on this tranche —"}`);
      console.log(`  WHY-NOW     : ${briefing.whyNow}`);
      if (briefing.source === "failed") console.log(`  >>> NARRATION FAILED: ${briefing.failureReason}`);
      if (isBalance) console.log(`  >>> FLAGGED: this why-now rests on a balance, which v10 forbids`);
      rows.push(`  ${result.company.padEnd(28)} ${event ? "event" : "no-event"}  ${isBalance ? "BALANCE-REASON" : "ok"}`);
    }
    spend += currentCompanySpend().totalUsd;
  }

  console.log(`\n${"=".repeat(100)}\nv10 WHY-NOW SUMMARY\n${"=".repeat(100)}`);
  for (const r of rows) console.log(r);
  console.log(`\n  CARDS: ${cards}   with a tranche event shown: ${withEvent}   resting on a balance: ${flagged}`);
  console.log(`  TOTAL SPEND: $${spend.toFixed(4)}`);
})();
