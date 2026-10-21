/**
 * SESSION 27 — A FAILED READ IS AN ERROR, NEVER A FALLBACK.
 *
 * In Session 26's last run a cached read failed on a network drop and the
 * loop carried on without it: the XBRL debt total came back empty, the debt
 * note's boundary abstained, the excerpt changed, and the denominator fell to
 * the model-read captions ("expected xbrl, got model-read" on Tenet). It cost
 * $0 only because the key was blank. With a key present that is a silent bill
 * and a different answer from a different source.
 *
 * So every read the extraction depends on either returns what it read or
 * throws this, naming the source. Nothing catches it to switch source, to
 * treat it as a cache miss, or to call a model to cover the gap. The same
 * read may be retried, at most twice (`retryRead`); a different source is
 * never tried in its place.
 */
export type ReadSource = "blob" | "edgar" | "xbrl";

export class ReadFailedError extends Error {
  readonly source: ReadSource;
  readonly what: string;
  constructor(source: ReadSource, what: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message + (cause.cause instanceof Error ? ` (${cause.cause.message})` : "") : String(cause);
    super(`READ FAILED (${source}): ${what}: ${detail}. The build stops here: it does not switch source, treat this as a cache miss, or call a model.`);
    this.name = "ReadFailedError";
    this.source = source;
    this.what = what;
    this.cause = cause;
  }
}

export const isReadFailed = (e: unknown): e is ReadFailedError => e instanceof ReadFailedError;

/** The read and at most two retries of the SAME read, with a short pause between. */
export const READ_RETRIES = 2;
export async function retryRead<T>(read: () => Promise<T>, retries = READ_RETRIES): Promise<T> {
  let last: unknown;
  for (let n = 0; n <= retries; n++) {
    try {
      return await read();
    } catch (e) {
      last = e;
      if (n < retries) await new Promise((r) => setTimeout(r, 400 * (n + 1)));
    }
  }
  throw last;
}
