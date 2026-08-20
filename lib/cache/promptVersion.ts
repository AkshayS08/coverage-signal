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

/**
 * sonnetEventBriefing.ts's card-narration prompt + schema.
 * v2 (Session 15): CALL ABOUT/WHY NOW/OPEN WITH replaces What/Why call/Angle.
 * v3 (Session 15b): evidence sentences added to context, the accuracy
 * corpus, and a required callAbout figure-or-date check — the prompt and
 * what counts as "verified" both changed, so old cached bodies (drafted
 * without ever seeing evidence text) must not be replayed as if
 * equivalent.
 * v4 (Session 16 Fix D, attempt 1): explicit "state figures exactly as
 * given, never a sum/rounded/derived total" instruction — Centene's
 * callAbout requirement was making Sonnet occasionally compute a round
 * total ("$2.0 billion") from two stated redemption amounts instead of
 * using the stated remaining balance ("$568.7 million"), correctly
 * rejected by the number-guard.
 * v5 (Session 16 Fix D, attempt 2): v4's abstract instruction wasn't
 * concrete enough — verified live, Centene still failed 3/3 fresh attempts
 * under v4, still computing "$2.1 billion"/"$2 billion". Replaced with a
 * concrete worked example of the exact failure shape (a balance paid down
 * in steps, plus what remains) so the instruction has something specific
 * to pattern-match against, not just an abstract rule.
 * v6 (Session 17, bumped once at the end per Item 0, after every narration
 * change was in): Item 4 (citations computed from which facts the drafted
 * text actually references, not the headline trigger alone), Item 16
 * (timing stated as "N months out," never "inside the N-month refi
 * window" — the threshold is an internal rule, not a market term), and
 * Item 17 (OPEN WITH replaced with KEY POINTS — 2-4 plain-fact bullets,
 * first bullet always the headline fact, no bullet may connect two facts
 * together). Old cached bodies used a different field (openWith) and a
 * different citation rule entirely — replaying them would be a shape the
 * current code can no longer even parse correctly, not just stale wording.
 */
export const NARRATION_PROMPT_VERSION = 6;

/**
 * Session 17 Item 0: this project's session prompts have referred to this
 * constant as "wordingPromptVersion" and its extraction counterpart as
 * "extractionPromptVersion." The FUNCTIONAL split those names describe —
 * two independent constants, one per cache namespace, bumped
 * independently — already happened in Session 15 (see NARRATION_PROMPT_
 * VERSION's own history above) and was re-verified intact at the start of
 * this session (Item 0's diagnosis: already done, nothing to split).
 * Kept under their existing SCREAMING_SNAKE_CASE names rather than
 * renamed to match a session prompt's casing convention — renaming would
 * touch every read site across the codebase for a naming preference, not
 * a functional gap, and this project's own standing rules favor fixing
 * the shape of a real problem over cosmetic churn.
 */
