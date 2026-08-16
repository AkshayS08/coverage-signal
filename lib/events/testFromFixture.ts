/**
 * Session 12 Parts B/C verification script. Sources CompanyResult[] from
 * the cached, no-TTL fixture (__fixtures__/session11-facts.json) instead of
 * calling runAgentLoop — this is deliberately NOT "running the live book"
 * (no fresh EDGAR fetch, no fresh Haiku classification pass over all 8
 * companies); it only exercises the two Sonnet narration consumers (card
 * briefing + portfolio summary) against real, already-verified facts, which
 * is exactly what Parts B and C need tested. Mirrors test.ts's structure,
 * swapping the data source and adding the portfolio-summary section.
 *
 * Run: npx tsx lib/events/testFromFixture.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult } from "../agent";
import {
  buildEvents,
  buildVerifiedFactBase,
  buildCompanyTableBlock,
  TABLE_BUCKET_ORDER,
  BUCKET_LABELS,
  type EventRecord,
  type FlashCard,
} from "./index";
import { draftEventBriefing } from "./sonnetEventBriefing";
import { extractMoneyTokens, extractDateTokens } from "./numberGuard";
import { compactLabelWithTiming } from "./labels";

function wc(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function timingLabel(e: { timing: EventRecord["timing"] }): string {
  if (e.timing.monthsToNearestFuture !== null) return `~${e.timing.monthsToNearestFuture}mo out`;
  if (e.timing.isPendingLive) return "pending/live";
  return "live now (no future date)";
}

async function main() {
  const fixturePath = join(__dirname, "__fixtures__/session11-facts.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as { generatedAt: string; companies: CompanyResult[] };
  const results = fixture.companies;
  console.log(`=== Loaded ${results.length} companies from cached fixture (generatedAt=${fixture.generatedAt}) — no live EDGAR/Haiku run ===\n`);

  const { flashCardCandidates, portfolio } = buildEvents(results);
  const factBaseByCompany = new Map(results.map((r) => [r.company, buildVerifiedFactBase(r)]));

  let narrationFailures = 0;
  let scrapeRejections = 0;

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
    if (briefing.source === "failed") {
      narrationFailures++;
      if (briefing.failureReason?.includes("scrape-shaped")) scrapeRejections++;
      console.log(`  ⚠ NARRATION FAILURE — banner reason: ${briefing.failureReason}`);
    } else {
      console.log(`Call about: ${briefing.callAbout}`);
      console.log(`Why now (${wc(briefing.whyNow)}w): ${briefing.whyNow}`);
      console.log(`Open with: ${briefing.openWith} [${briefing.source}]`);
      const alsoActiveText = card.alsoActive
        .map((item) => compactLabelWithTiming(item.trigger.triggerId, item.trigger.triggerName, item.timing))
        .join(" · ");
      const cardText = `${briefing.callAbout} ${briefing.whyNow} ${briefing.openWith} ${alsoActiveText}`;
      const money = extractMoneyTokens(cardText);
      const dates = extractDateTokens(cardText);
      if (money.length > 0 || dates.length > 0) {
        console.log(
          `  Numbers/dates: ${[...money.map((m) => m.raw), ...dates.map((d) => d.raw)].join(", ")} — traced to fact base (source: ${briefing.source})`
        );
      }
    }
    if (card.alsoActive.length > 0) {
      console.log(`Also active: ${card.alsoActive.map((a) => `${BUCKET_LABELS[a.bucket]} — ${a.trigger.triggerName}`).join(" · ")}`);
    }
    console.log("");
  }

  console.log(`########################################`);
  console.log(`### PORTFOLIO TABLE — deterministic, no model call (Session 15 Part B)`);
  console.log(`########################################\n`);

  for (const r of results) {
    const cardsForCompany = flashCardCandidates.filter((c) => c.cik === r.cik);
    const block = buildCompanyTableBlock(r, cardsForCompany);
    console.log(`--- ${block.company}  (${block.headerLine}) ---`);
    if (block.emptyStateLine) console.log(`  ${block.emptyStateLine}`);
    for (const bucket of TABLE_BUCKET_ORDER) {
      const lines = block.buckets[bucket];
      console.log(`  ${BUCKET_LABELS[bucket]}:`);
      if (lines.length === 0) {
        console.log(`    · no signal found`);
        continue;
      }
      for (const line of lines) {
        const text = line.timingPhrase ? `${line.description} — ${line.timingPhrase}` : line.description;
        const marker = line.isHedgingFlag ? "⚑" : "·";
        const cardMark = line.cardEligible ? " [card above]" : "";
        const sources = line.citations.map((c) => `${c.form} ${c.date}`).join(", ");
        console.log(`    ${marker} ${text}${cardMark} (${sources})`);
      }
    }
    if (block.relationshipFlags.length > 0) {
      console.log(`  Relationship flags (distress, not a bucket): ${block.relationshipFlags.join(", ")}`);
    }
    console.log("");
  }

  console.log(`########################################`);
  console.log(`### SUMMARY`);
  console.log(`########################################\n`);
  console.log(`${flashCardCandidates.length} flash cards, ${portfolio.length} portfolio-table entries.`);
  console.log(`Narration failures (loud banner surfaced): ${narrationFailures}`);
  console.log(`Scrape-shaped-text rejections observed: ${scrapeRejections} (see stderr [eventBriefing]/[portfolioSummary] logs above for detail)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
