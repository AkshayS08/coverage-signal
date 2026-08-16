/**
 * Version stamps folded into answer- and wording-cache keys
 * (lib/cache/answerCache.ts, lib/cache/wordingCache.ts). A cached answer
 * is otherwise permanently wrong once written — bumping the relevant
 * version orphans every existing entry under it (never read again)
 * without deleting anything, so a bad model answer or a prompt-wording
 * fix can be invalidated cleanly instead of manually purging the store.
 *
 * Session 15: split from one shared PROMPT_VERSION into two, because the
 * card-narration prompt changed this session while the extraction prompt
 * did not — a single shared constant would have forced every company's
 * expensive Haiku extraction to be re-asked just because the cheap Sonnet
 * narration prompt changed, which is exactly the wasted-cost outcome
 * Session 14's separate "three caches, three jobs" design exists to avoid.
 * Each constant bumps independently now.
 */

/** claude.ts's 15-trigger extraction prompt + schema, and proceedsUse.ts's classification prompt. Untouched this session — stays at 1. */
export const EXTRACTION_PROMPT_VERSION = 1;

/** sonnetEventBriefing.ts's card-narration prompt + schema. Bumped this session (CALL ABOUT/WHY NOW/OPEN WITH replaces What/Why call/Angle). */
export const NARRATION_PROMPT_VERSION = 2;
