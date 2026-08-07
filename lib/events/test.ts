import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runAgentLoop } from "../agent";
import type { CompanyResult } from "../agent";
import {
  buildEvents,
  buildPortfolioSummary,
  buildVerifiedFactBase,
  BUCKET_LABELS,
  type EventRecord,
  type FlashCard,
  type FlashCardActiveItem,
  type VerifiedFact,
} from "./index";
import { draftEventBriefing } from "./sonnetEventBriefing";
import { extractMoneyTokens, extractDateTokens } from "./numberGuard";
import { compactLabelWithTiming } from "./labels";

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

function timingLabel(e: { timing: EventRecord["timing"] }): string {
  if (e.timing.monthsToNearestFuture !== null) return `~${e.timing.monthsToNearestFuture}mo out`;
  if (e.timing.isPendingLive) return "pending/live";
  return "live now (no future date)";
}

function wc(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function describeAlsoActive(a: FlashCardActiveItem): string {
  return `${BUCKET_LABELS[a.bucket]} (${timingLabel(a)}) — ${a.trigger.triggerName}`;
}

function describeFact(f: VerifiedFact): string {
  const source = f.sourceFiling ? `${f.sourceFiling.form} ${f.sourceFiling.date}` : "n/a";
  const base = `[${f.linkedTriggerId}] "${f.verifiedText}" (${source})`;
  if (f.normalizedText !== f.verifiedText) {
    return `${base}\n      -> normalized: "${f.normalizedText}"`;
  }
  return base;
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
  const factBaseByCompany = new Map(results.map((r) => [r.company, buildVerifiedFactBase(r)]));

  console.log(`\n\n########################################`);
  console.log(`### VERIFIED FACT BASE (per company)`);
  console.log(`########################################\n`);
  for (const r of results) {
    const facts = factBaseByCompany.get(r.company) ?? [];
    console.log(`--- ${r.company} (${facts.length} verified facts) ---`);
    for (const f of facts) console.log(`  ${describeFact(f)}`);
    console.log("");
  }

  console.log(`########################################`);
  console.log(`### FLASH CARDS (${flashCardCandidates.length}), ordered by time-to-event`);
  console.log(`########################################\n`);

  for (let i = 0; i < flashCardCandidates.length; i++) {
    const card: FlashCard = flashCardCandidates[i];
    const factBase = factBaseByCompany.get(card.company) ?? [];
    const briefing = await draftEventBriefing(card, factBase);
    const tags = [BUCKET_LABELS[card.bucket], card.secondaryBucket ? BUCKET_LABELS[card.secondaryBucket] : null]
      .filter(Boolean)
      .join(" + ");
    console.log(`--- #${i + 1} ${card.company} — ${tags} (${timingLabel(card)}) ---`);
    console.log(`Headline: ${card.headlineTrigger.triggerName}`);
    console.log(`Freshness gate: ${card.freshnessReason}`);
    console.log(`Citations: ${card.citations.map((c) => `${c.form} ${c.date}`).join(", ")}`);
    console.log(`Fact base used (${factBase.length} facts): ${factBase.map((f) => f.linkedTriggerId).join(", ")}`);
    console.log(`What (${wc(briefing.what)}w): ${briefing.what}`);
    console.log(`Why call (${wc(briefing.whyCall)}w): ${briefing.whyCall}`);
    console.log(`Angle (${wc(briefing.angle)}w): ${briefing.angle} [${briefing.source}]`);
    if (wc(briefing.what) > 30 || wc(briefing.whyCall) > 30 || wc(briefing.angle) > 30) {
      console.log(`  ⚠ WORD LIMIT EXCEEDED (target ~25 max per line)`);
    }
    const alsoActiveText = card.alsoActive
      .map((item) => compactLabelWithTiming(item.trigger.triggerId, item.trigger.triggerName, item.timing))
      .join(" · ");
    const cardText = `${briefing.what} ${briefing.whyCall} ${briefing.angle} ${alsoActiveText}`;
    const money = extractMoneyTokens(cardText);
    const dates = extractDateTokens(cardText);
    if (money.length > 0 || dates.length > 0) {
      console.log(
        `  Numbers/dates in card+also-active text: ${[...money.map((m) => m.raw), ...dates.map((d) => d.raw)].join(", ")} — all traced to the fact base above (source: ${briefing.source})`
      );
    }
    if (card.alsoActive.length > 0) {
      console.log(`Also active: ${card.alsoActive.map(describeAlsoActive).join(" · ")}`);
    }
    console.log("");
  }

  console.log(`########################################`);
  console.log(`### QUOTE VERIFICATION — every fired trigger across the book`);
  console.log(`########################################\n`);
  let verifiedCount = 0;
  let failedCount = 0;
  for (const r of results) {
    for (const t of r.results) {
      if (!t.fired) continue;
      if (t.quoteVerified) {
        verifiedCount++;
      } else {
        failedCount++;
        console.log(`✗ FAILED: ${r.company} — ${t.triggerName}`);
        console.log(`    evidence (unverified, discarded downstream): ${t.evidence}`);
      }
    }
  }
  console.log(`\n${verifiedCount} verified, ${failedCount} failed quote verification (excluded from cards, marked unverified in table).`);

  console.log(`########################################`);
  console.log(`### CARD/TABLE BUCKET AGREEMENT CHECK`);
  console.log(`########################################\n`);
  for (const card of flashCardCandidates) {
    const p = portfolio.find((x) => x.company === card.company)!;
    const tableEvent = Object.values(p.buckets)
      .flat()
      .find((e) => e.triggers.some((t) => t.triggerId === card.headlineTrigger.triggerId));
    const agree = tableEvent?.bucket === card.bucket;
    console.log(
      `${card.company}: card=${card.bucket}, table=${tableEvent?.bucket ?? "MISSING"} ${agree ? "✓ agree" : "✗ DISAGREE"}`
    );
  }

  console.log(`\n########################################`);
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
  const flashCardByCompany = new Map(flashCardCandidates.map((c) => [c.company, c]));
  for (const p of portfolio) {
    console.log(`--- ${p.company} ---`);
    const summary = buildPortfolioSummary(p, flashCardByCompany.get(p.company) ?? null);
    console.log(`  ${summary.actionLine}`);
    for (const bullet of summary.bullets) console.log(`  • ${bullet}`);
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
