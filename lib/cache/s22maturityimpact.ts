/**
 * SESSION 22, STAGE 7 — WHAT THE MATURITY FIX CHANGES ABOUT CLAIMS. $0.
 *
 * Signability is the cheap question. The one that matters is which dates stop
 * being shown, and whether anything was CARDING on a date that cannot be
 * sourced — a facility that stops carding because its maturity has no
 * sentence behind it is honest, and it is also a call an RM no longer gets,
 * which is a thing to see rather than discover.
 *
 * Reports per row: the claimed date, whether its own sentence states it,
 * whether the facility's maturity sentence rescues it, and whether the row
 * was card-eligible before.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { evaluateRowEligibility } from "../events/eligibility";
import { buildEvents } from "../events/buildEvents";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  let withheld = 0, rescued = 0, lostCards = 0;
  console.log(`\n${"=".repeat(104)}\nMATURITY PROVENANCE — what stops being claimed\n${"=".repeat(104)}`);

  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const pos = assemblePosition(result, PINNED_AS_OF);
    const cardRowIds = new Set(
      buildEvents([result], PINNED_AS_OF).flashCardCandidates.map((c) => c.headlineRowId).filter(Boolean) as string[]
    );

    const affected = pos.rows.filter((r) => r.maturityWithheld);
    if (affected.length === 0) continue;

    console.log(`\n  ${result.company}`);
    for (const r of affected) {
      withheld++;
      // The post-pass may have supplied a properly-sourced date from the
      // facility's own maturity sentence. That is a rescue, not a loss.
      const nowHas = !!r.maturityDate;
      if (nowHas) rescued++;
      const elig = evaluateRowEligibility(r, PINNED_AS_OF);
      const cardsNow = cardRowIds.has(r.id);
      // Would it have carded on the claimed date? Same gate, claimed date substituted.
      const asClaimed = evaluateRowEligibility(
        { ...r, maturityDate: r.maturityWithheld!.claimed, dateGranularity: r.dateGranularity ?? "day" },
        PINNED_AS_OF
      );
      const lost = asClaimed.cardEligible && !elig.cardEligible;
      if (lost) lostCards++;
      console.log(`    ${r.instrument.slice(0, 50)}`);
      console.log(`        claimed date        ${r.maturityWithheld!.claimed}  — its own sentence does not state it`);
      console.log(`        after the fix       ${nowHas ? `${r.maturityDate} (RESCUED from the facility's own maturity sentence)` : "NOT STATED — no sentence in the corpus states a date for this row"}`);
      console.log(`        card-eligible now   ${elig.cardEligible ? "YES" : `no — ${elig.reason}`}`);
      console.log(`        would have carded   ${asClaimed.cardEligible ? "YES, on the unsourced date" : "no"}${lost ? "   >>> A CARD IS LOST, and it was resting on a date nothing states" : ""}`);
      console.log(`        currently a card    ${cardsNow ? "YES" : "no"}`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  rows whose claimed maturity its own sentence does not state: ${withheld}`);
  console.log(`  ...rescued by the facility's own maturity sentence:          ${rescued}`);
  console.log(`  ...now rendering "not stated":                               ${withheld - rescued}`);
  console.log(`  cards lost because the date cannot be sourced:               ${lostCards}`);
  console.log("=".repeat(104));
})();
