/**
 * Single shared version stamp, folded into every answer- and wording-cache
 * key (lib/cache/answerCache.ts, lib/cache/wordingCache.ts). A cached
 * answer is otherwise permanently wrong once written — this is the escape
 * hatch: bump PROMPT_VERSION and every existing cache entry is orphaned
 * (never read again) without deleting anything, so a bad model answer or a
 * prompt-wording fix can be invalidated cleanly instead of manually purging
 * the store.
 *
 * Bump this whenever a change could plausibly change what the model
 * returns for the same input: the extraction prompt (claude.ts), the card
 * or portfolio-summary system prompts (sonnetEventBriefing.ts,
 * sonnetPortfolioSummary.ts), the proceedsUse prompt, or the schema/tool
 * definitions any of them submit against.
 */
export const PROMPT_VERSION = 1;
