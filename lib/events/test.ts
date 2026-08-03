import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runAgentLoop } from "../agent";
import type { CompanyResult } from "../agent";
import { buildEvents, BUCKET_LABELS, type EventRecord } from "./index";
import { draftEventBriefing } from "./sonnetEventBriefing";

// Same default book as app/page.tsx's DEFAULT_BOOK.
const DEFAULT_BOOK = [
  "DaVita",
  "HCA Healthcare",
  "Tenet Healthcare",
  "Universal Health Services",
  "Encompass Health",
  "Acadia Healthcare",
  "Concentra Group Holdings",
  "Surgery Partners",
];

function describeEvent(e: EventRecord): string {
  const triggerNames = e.triggers.map((t) => t.triggerName).join(" + ");
  const dedupNote = e.triggers.length > 1 ? ` [DEDUPED from ${e.triggers.length} triggers]` : "";
  return `${triggerNames}${dedupNote}`;
}

function timingLabel(e: EventRecord): string {
  if (e.timing.monthsToNearestFuture !== null) return `~${e.timing.monthsToNearestFuture}mo out`;
  if (e.timing.isPendingLive) return "pending/live";
  return "live now (no future date)";
}

async function main() {
  const companies = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_BOOK;

  console.log(`=== Running agent loop for ${companies.length} companies ===\n`);
  const results: CompanyResult[] = [];
  for (const company of companies) {
    const result = await runAgentLoop(company);
    results.push(result);
  }

  const { flashCardCandidates, portfolio } = buildEvents(results);

  console.log(`\n\n########################################`);
  console.log(`### FLASH CARDS (${flashCardCandidates.length}), ordered by time-to-event`);
  console.log(`########################################\n`);

  for (let i = 0; i < flashCardCandidates.length; i++) {
    const e = flashCardCandidates[i];
    const briefing = await draftEventBriefing(e);
    console.log(`--- #${i + 1} ${e.company} — ${BUCKET_LABELS[e.bucket]} (${timingLabel(e)}) ---`);
    console.log(`Event: ${describeEvent(e)}`);
    console.log(`Eligibility reasons: ${e.eligibilityReasons.join("; ")}`);
    console.log(`Citations: ${e.citations.map((c) => `${c.form} ${c.date}`).join(", ")}`);
    console.log(`Summary: ${briefing.summary}`);
    console.log(`Angle: ${briefing.angle} [${briefing.source}]`);
    console.log("");
  }

  console.log(`########################################`);
  console.log(`### DEDUP CHECK — events built from >1 trigger`);
  console.log(`########################################\n`);
  const deduped = portfolio.flatMap((p) => Object.values(p.buckets).flat()).filter((e) => e.triggers.length > 1);
  if (deduped.length === 0) {
    console.log("(none this run — no two triggers shared an 8-K citation)");
  }
  for (const e of deduped) {
    console.log(
      `${e.company}: ${e.triggers.map((t) => t.triggerId).join(" + ")} -> merged via shared 8-K citation(s): ${e.citations
        .filter((c) => c.form === "8-K")
        .map((c) => c.url)
        .join(", ")}`
    );
  }

  console.log(`\n########################################`);
  console.log(`### PORTFOLIO TABLE (every company x 4 buckets)`);
  console.log(`########################################\n`);
  for (const p of portfolio) {
    console.log(`--- ${p.company} ---`);
    for (const bucket of ["treasury", "new_debt", "refi", "hedging"] as const) {
      const events = p.buckets[bucket];
      if (events.length === 0) continue;
      console.log(`  ${BUCKET_LABELS[bucket]}:`);
      for (const e of events) {
        console.log(`    - [${e.cardEligible ? "CARD" : "table-only"}] ${describeEvent(e)} (${e.eligibilityReasons.join("; ")})`);
      }
    }
    if (p.relationshipFlags.length > 0) {
      console.log(`  Relationship flags (distress, not a bucket): ${p.relationshipFlags.map((t) => t.triggerName).join(", ")}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
