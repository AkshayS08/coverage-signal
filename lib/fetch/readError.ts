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

/**
 * The read and at most two retries of the SAME read, with a short pause
 * between. A read that never answers is a failed read too: each attempt is
 * cut off after `readTimeoutMs()` (its AbortSignal fires and the attempt is
 * abandoned even if the transport ignores the signal), so a hang costs at
 * most three timeouts and then names its source, rather than holding the
 * build forever.
 */
export const READ_RETRIES = 2;
const DEFAULT_READ_TIMEOUT_MS = 60_000;
/** Per attempt. 60s by default (the largest read, a filer's company facts, is ~10MB); READ_TIMEOUT_MS overrides it. */
export function readTimeoutMs(): number {
  const n = Number(process.env.READ_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_READ_TIMEOUT_MS;
}
export async function retryRead<T>(read: (signal: AbortSignal) => Promise<T>, retries = READ_RETRIES): Promise<T> {
  let last: unknown;
  for (let n = 0; n <= retries; n++) {
    const ms = readTimeoutMs();
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(`no answer within ${ms / 1000}s`);
        ac.abort(e);
        reject(e);
      }, ms);
    });
    try {
      return await Promise.race([read(ac.signal), timedOut]);
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
    }
    if (n < retries) await new Promise((r) => setTimeout(r, 400 * (n + 1)));
  }
  throw last;
}

/**
 * A blob read the build depends on. The blob client retries its API calls
 * on its own (VERCEL_BLOB_RETRIES, 10 by default: about 17 minutes of backoff
 * before a failure surfaces), which would multiply with ours. Every blob read
 * is therefore the read and at most two retries, all of them here: the
 * client's own are set to zero for the call. (Only API calls such as `head`
 * read that setting; `get` fetches the blob directly and never retried.)
 */
export async function blobRead<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const prev = process.env.VERCEL_BLOB_RETRIES;
  process.env.VERCEL_BLOB_RETRIES = "0";
  try {
    return await retryRead(read);
  } finally {
    if (prev === undefined) delete process.env.VERCEL_BLOB_RETRIES;
    else process.env.VERCEL_BLOB_RETRIES = prev;
  }
}
