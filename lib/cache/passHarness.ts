/**
 * SESSION 19, ITEM 1b — A DETERMINISM SAMPLE IS ONLY VALID WHEN EVERY FETCH
 * SUCCEEDED.
 *
 * The acceptance and determinism harnesses each carried a per-company
 * try/catch that pushed `{ company, error }` into the array being compared.
 * That mirrors production's behaviour — one bad name must not abort a book —
 * but it is exactly wrong for a determinism SAMPLE, because it turns a
 * transient network failure into a byte difference and reports it as
 * non-determinism.
 *
 * Seen live: Book A passed, then failed on a re-run, then passed seven times
 * more. The failing pass reported `answer cache 8/8` where every clean pass
 * reports `10/10` — two lookups short, i.e. one company short-circuited and
 * its error text went into the compared bytes. Nothing about the code was
 * non-deterministic; the harness was measuring the network.
 *
 * The rule this file implements:
 *
 *   - Fetch errors leave the compared bytes ENTIRELY. A pass that throws is
 *     discarded whole, not patched with an error object.
 *   - A caught error invalidates that pass, logs { company, error, timestamp }
 *     to a SEPARATE channel — the timestamp alone would make the compared
 *     bytes unstable — and retries the pass, up to twice.
 *   - A pass that cannot complete cleanly after its retries reports
 *     INCOMPLETE, carrying its error log.
 *   - FAIL is reserved for byte differences between CLEAN passes.
 *
 * INCOMPLETE and FAIL mean different things and must not be collapsed:
 * INCOMPLETE says the sample could not be taken, FAIL says the sample was
 * taken and the code is non-deterministic. Only the second is a bug in this
 * repository.
 */

export interface PassError {
  company: string;
  error: string;
  /** Never enters the compared bytes — it is the reason the log is a separate channel. */
  timestamp: string;
}

export type PassResult =
  | { status: "clean"; json: string; elapsedMs: number; hitSummary: string; attempts: number; errors: PassError[] }
  | { status: "incomplete"; attempts: number; errors: PassError[] };

/** Thrown by a runner to say WHICH company failed, so the log can name it. */
export class CompanyFetchError extends Error {
  constructor(readonly company: string, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CompanyFetchError";
  }
}

export const MAX_PASS_ATTEMPTS = 3;

/**
 * Runs one pass, retrying the WHOLE pass on any company-level failure.
 *
 * The pass is retried rather than the company, deliberately: a book's output
 * is compared as one array, and re-running a single company mid-pass would
 * interleave a second cache state into the first pass's bytes. Whole-pass
 * retry keeps the sample a sample.
 */
export async function runPassWithRetries(
  runOnce: () => Promise<{ json: string; elapsedMs: number; hitSummary: string }>,
  maxAttempts: number = MAX_PASS_ATTEMPTS,
  log: (line: string) => void = (l) => console.error(l)
): Promise<PassResult> {
  const errors: PassError[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { json, elapsedMs, hitSummary } = await runOnce();
      return { status: "clean", json, elapsedMs, hitSummary, attempts: attempt, errors };
    } catch (err) {
      const entry: PassError = {
        company: err instanceof CompanyFetchError ? err.company : "(unknown)",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      };
      errors.push(entry);
      log(`  ⚠ pass attempt ${attempt}/${maxAttempts} invalidated by a fetch failure — ${entry.company}: ${entry.error}`);
    }
  }
  return { status: "incomplete", attempts: maxAttempts, errors };
}

/** Renders the separate-channel error log for a report. Never compared. */
export function formatPassErrors(errors: PassError[]): string[] {
  if (errors.length === 0) return [];
  return ["  error log (separate channel, never compared):", ...errors.map((e) => `    ${e.timestamp}  ${e.company}  ${e.error}`)];
}
