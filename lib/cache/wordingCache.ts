import { createHash } from "node:crypto";
import { readCache, writeCache } from "../fetch/cache";
import { PROMPT_VERSION } from "./promptVersion";
import { cacheStats } from "./stats";
import { draftEventBriefing, buildContext as buildCardContext } from "../events/sonnetEventBriefing";
import type { DraftedEventBriefing } from "../events/eventBriefing";
import type { FlashCard, CompanyPortfolio } from "../events/buildEvents";
import type { VerifiedFact } from "../events/factBase";
import { draftPortfolioSummary, buildFactLines } from "../events/sonnetPortfolioSummary";
import type { DraftedPortfolioSummary } from "../events/portfolioSummary";

// Deliberately not re-exported from lib/events/index.ts — pulls in
// sonnetEventBriefing.ts/sonnetPortfolioSummary.ts, which pull in the
// Anthropic SDK. Server-only, same as those two files.

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

/**
 * "Same event -> same card sentence, every run." Only successful/
 * deterministic-fallback results are cached (source "sonnet", "template",
 * "quote") — a "failed" result (an infra hiccup: timeout, malformed
 * response) is never written, so a transient failure gets a fresh attempt
 * on the next run instead of permanently freezing a failure banner in
 * place of a card that could otherwise succeed.
 */
async function getOrCompute<T extends { source: string }>(key: string, compute: () => Promise<T>): Promise<T> {
  const cached = await readCache<T>(key, null);
  if (cached !== null) {
    cacheStats.wording.hits++;
    return cached;
  }
  cacheStats.wording.misses++;
  const data = await compute();
  if (data.source !== "failed") {
    await writeCache(key, data);
  }
  return data;
}

/**
 * Card wording (What/Why call/Angle). Keyed by a hash of EXACTLY the
 * context string Sonnet is prompted with (buildContext, exported from
 * sonnetEventBriefing.ts unchanged) — the same gated headline fact +
 * relevant other facts, decided upstream by deterministic code (the gate)
 * and never re-decided here.
 */
export async function cachedDraftEventBriefing(
  card: FlashCard,
  factBase: VerifiedFact[]
): Promise<DraftedEventBriefing> {
  const context = buildCardContext(card, factBase);
  const key = `wording/card/${sha256(`v${PROMPT_VERSION}\n${context}`)}.json`;
  return getOrCompute(key, () => draftEventBriefing(card, factBase));
}

/**
 * Portfolio-table per-company summary. Keyed by a hash of the exact GATED
 * FACT lines (buildFactLines, exported from sonnetPortfolioSummary.ts,
 * called here read-only — not modified) that summary is drafted from.
 */
export async function cachedDraftPortfolioSummary(
  portfolio: CompanyPortfolio,
  factBase: VerifiedFact[]
): Promise<DraftedPortfolioSummary> {
  const factLines = buildFactLines(portfolio, factBase);
  const context = JSON.stringify({ company: portfolio.company, lines: factLines.map((f) => f.text) });
  const key = `wording/portfolioSummary/${sha256(`v${PROMPT_VERSION}\n${context}`)}.json`;
  return getOrCompute(key, () => draftPortfolioSummary(portfolio, factBase));
}
