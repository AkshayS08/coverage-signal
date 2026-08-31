/**
 * SESSION 19 — ONE SERIALIZER FOR A BOOK, SHARED BY THE HARNESSES AND THE
 * BASELINE WRITER.
 *
 * The rule: A BASELINE CAPTURES PRODUCT OUTPUT, NEVER PROCESS STDOUT.
 *
 * The baselines this project persists after every paid run were being
 * captured by redirecting a script's stdout to a file. That silently makes
 * the baseline a recording of the PROCESS rather than of the PRODUCT, and it
 * bit immediately: `dotenv` prints a rotating marketing tip to stdout on
 * load, so two captures of an identical book differed on line 1 —
 *
 *   ◇ injected env (4) from .env.local // tip: ⌘ suppress logs { quiet: true }
 *   ◇ injected env (4) from .env.local // tip: ⌁ auth for agents [...]
 *
 * — and every trace line, every ⚠ warning and every future console.log in the
 * pipeline was in there with it. A Stage 3 line-level diff against that is
 * unreadable at best and wrong at worst, since a changed warning would read
 * as a changed result.
 *
 * Two things follow, and this file is both:
 *
 *   1. The snapshot is built from the same in-memory objects the determinism
 *      harnesses compare, by the same function, so a baseline and a
 *      determinism pass CANNOT disagree about what a book's output is. They
 *      were previously two independent serializations that merely looked
 *      alike.
 *   2. `loadEnvQuietly` turns the tip off at the source, for every script,
 *      so nothing downstream has to remember to strip it.
 */
import { runAgentLoop } from "../agent";
import { buildEvents, buildVerifiedFactBase, buildCompanyTableBlock } from "../events";
import { cachedDraftEventBriefing } from "./wordingCache";
import { cacheStats } from "./stats";
import { CompanyFetchError, CompanyNarrationError } from "./passHarness";

/** Re-exported so existing callers keep one import; defined in loadEnv.ts,
 * which preflight.ts imports without pulling the Anthropic SDK in behind it. */
export { loadEnvQuietly } from "./loadEnv";

export interface BookSnapshot {
  /** The compared/persisted bytes. The ONLY thing either mechanism reads. */
  json: string;
  elapsedMs: number;
  hitSummary: string;
  /** The as-of date the book was rendered against — see captureBookSnapshot. */
  asOf: string;
}

/**
 * SESSION 20 (1b) — THE AS-OF DATE IS PINNED INTO THE BOOK, NOT LEFT TO THE
 * WALL CLOCK.
 *
 * Timing phrases are computed against `now`. Two captures a day apart are
 * therefore not byte-comparable through no fault of the code: Session 20's
 * first byte-identity proof showed CHS at "29mo out" and then "28mo out",
 * and Molina "54mo" then "53mo", purely because the calendar rolled. A month
 * boundary must never read as a regression.
 *
 * So the date is an INPUT, recorded alongside the bytes. A byte-identity
 * comparison is only valid between captures sharing an `asOf`; a diff across
 * two different `asOf` values must say so rather than report the difference
 * as a change in behaviour.
 */

/**
 * Runs a book and serializes it. Throws CompanyFetchError naming the company
 * on any failure — the caller decides what that means (passHarness.ts
 * discards the pass; production swallows it per company).
 */
export async function captureBookSnapshot(companies: string[], now: Date = new Date()): Promise<BookSnapshot> {
  cacheStats.reset();
  const t0 = Date.now();
  const outputs: unknown[] = [];

  for (const company of companies) {
    try {
      const result = await runAgentLoop(company);
      const { flashCardCandidates } = buildEvents([result], now);
      const factBase = buildVerifiedFactBase(result);

      const eventBriefings = [];
      for (const card of flashCardCandidates) {
        const briefing = await cachedDraftEventBriefing(card, factBase);
        // A failed card renders honestly on the primary surface and must
        // never become a baseline. See CompanyNarrationError.
        if (briefing.source === "failed") {
          throw new CompanyNarrationError(company, card.id, briefing.failureReason ?? "(no reason given)");
        }
        eventBriefings.push({ eventId: card.id, briefing });
      }
      // Deterministic — included for full coverage, though a pure function
      // cannot be the source of any drift.
      const table = buildCompanyTableBlock(result, flashCardCandidates, now);

      outputs.push({ company, result, eventBriefings, table });
    } catch (err) {
      // A narration failure already names itself; wrapping it would relabel
      // it as a fetch failure and send the next reader to the wrong fix.
      if (err instanceof CompanyNarrationError) throw err;
      throw new CompanyFetchError(company, err);
    }
  }

  return { json: JSON.stringify(outputs, null, 2), elapsedMs: Date.now() - t0, hitSummary: cacheStats.summary(), asOf: now.toISOString().slice(0, 10) };
}
