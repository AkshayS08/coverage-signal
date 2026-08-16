import { createHash } from "node:crypto";
import { readCache, writeCache } from "../fetch/cache";
import { NARRATION_PROMPT_VERSION } from "./promptVersion";
import { cacheStats } from "./stats";
import { draftEventBriefing, buildContext as buildCardContext } from "../events/sonnetEventBriefing";
import type { DraftedEventBriefing } from "../events/eventBriefing";
import type { FlashCard } from "../events/buildEvents";
import type { VerifiedFact } from "../events/factBase";

// Deliberately not re-exported from lib/events/index.ts — pulls in
// sonnetEventBriefing.ts, which pulls in the Anthropic SDK. Server-only,
// same as that file.
//
// Session 15: the portfolio-table wording cache (cachedDraftPortfolioSummary)
// is deleted along with sonnetPortfolioSummary.ts — the table is now a
// deterministic renderer (lib/events/portfolioTable.ts) with no model call
// to cache the output of.

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

/**
 * "Same event -> same card sentence, every run." Only a successful result
 * (source "sonnet") is cached — a "failed" result (an infra hiccup or a
 * structural-guard rejection that survived one retry) is never written, so
 * a transient failure gets a fresh attempt on the next run instead of
 * permanently freezing a failure banner in place of a card that could
 * otherwise succeed.
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
 * Card wording (CALL ABOUT / WHY NOW / OPEN WITH). Keyed by a hash of
 * EXACTLY the context string Sonnet is prompted with (buildContext,
 * exported from sonnetEventBriefing.ts unchanged) — the same gated
 * headline fact + relevant other facts, decided upstream by deterministic
 * code (the gate) and never re-decided here.
 */
export async function cachedDraftEventBriefing(
  card: FlashCard,
  factBase: VerifiedFact[]
): Promise<DraftedEventBriefing> {
  const context = buildCardContext(card, factBase);
  const key = `wording/card/${sha256(`v${NARRATION_PROMPT_VERSION}\n${context}`)}.json`;
  return getOrCompute(key, () => draftEventBriefing(card, factBase));
}
