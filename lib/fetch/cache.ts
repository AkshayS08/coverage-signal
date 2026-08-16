import { get, put } from "@vercel/blob";

/**
 * Generic Blob-backed key/value cache. Used by the document cache (this
 * directory) and, on top of the same primitives, the answer and wording
 * caches (lib/cache/) — three different keying/TTL policies, one storage
 * mechanism.
 *
 * Session 14: the old disk cache used `os.tmpdir()` on Vercel, since
 * serverless functions have no persistent disk (Session 1's read-only-
 * filesystem bug). That "worked" — writes succeeded — but silently
 * degraded to a cache that mostly missed: `/tmp` doesn't survive cold
 * starts and isn't shared across concurrent invocations. Nothing failed,
 * nothing logged a warning, the app just re-asked the model on nearly
 * every click — which is the root cause Session 13 traced the whole
 * non-determinism failure back to. That silent degrade must never happen
 * again: a missing token, or any read/write failure, throws here. There is
 * no disk fallback, no /tmp fallback, no in-memory fallback.
 */

function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. The cache layer requires Vercel Blob and has no fallback (no disk, no /tmp, no in-memory) — a missing token must fail the run loudly, not silently degrade into a slow, cache-less run that looks normal. Set BLOB_READ_WRITE_TOKEN in .env.local locally, or in the Vercel project's environment variables in production."
    );
  }
  return token;
}

/**
 * Call before any run starts (not just implicitly on first cache access) so
 * a missing token is a visible, immediate failure rather than something
 * that only surfaces deep inside the first filing fetch.
 */
export function assertBlobConfigured(): void {
  requireBlobToken();
}

interface CacheEnvelope<T> {
  cachedAt: string;
  data: T;
}

/**
 * Session 13 Part B: the cache previously had no expiry at all — a real
 * live run found Concentra's 98% quarter-over-quarter cash build hidden
 * behind a stale filing-list fetch for weeks, because nothing ever forced
 * a re-fetch once a cache entry existed. 24 hours balances staying fresh
 * against not re-fetching EDGAR on every run within the same day.
 *
 * This is the default TTL, used by the filing-LIST caches (submissions,
 * per-company-per-form lists, CIK resolution). Callers whose content is
 * immutable once fetched (filing TEXT at a fixed URL, answer-cache
 * records, wording-cache records) pass `ttlMs: null` for a permanent
 * entry — see filingText.ts and lib/cache/*.
 */
export const FILING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reads relPath from the Blob cache. `ttlMs: null` means the entry never
 * expires (used for content that cannot legitimately change once written —
 * a filing's text, a model's answer to a fixed question, a card's wording
 * for a fixed fact). Any envelope older than a non-null ttlMs is treated as
 * a miss so the caller re-fetches.
 */
export async function readCache<T>(
  relPath: string,
  ttlMs: number | null = FILING_CACHE_TTL_MS
): Promise<T | null> {
  const token = requireBlobToken();

  let result;
  try {
    result = await get(relPath, { access: "public", token });
  } catch (err) {
    throw new Error(
      `Blob cache read failed for "${relPath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!result) return null;

  const raw = await new Response(result.stream).text();
  const envelope = JSON.parse(raw) as CacheEnvelope<T>;

  if (ttlMs !== null) {
    const age = Date.now() - new Date(envelope.cachedAt).getTime();
    if (age > ttlMs) return null; // expired -- treat as a cache miss, caller re-fetches
  }
  return envelope.data;
}

export async function writeCache(relPath: string, data: unknown): Promise<void> {
  const token = requireBlobToken();
  const envelope: CacheEnvelope<unknown> = { cachedAt: new Date().toISOString(), data };
  try {
    await put(relPath, JSON.stringify(envelope, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
  } catch (err) {
    throw new Error(
      `Blob cache write failed for "${relPath}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Reads relPath from the Blob cache if present and unexpired; otherwise
 * calls fetcher(), writes the result, and returns it. Callers can tell a
 * cache hit from a fresh pull via `fromCache`. See readCache's ttlMs doc.
 */
export async function cachedFetch<T>(
  relPath: string,
  fetcher: () => Promise<T>,
  ttlMs: number | null = FILING_CACHE_TTL_MS
): Promise<{ data: T; fromCache: boolean }> {
  const cached = await readCache<T>(relPath, ttlMs);
  if (cached !== null) {
    return { data: cached, fromCache: true };
  }
  const data = await fetcher();
  await writeCache(relPath, data);
  return { data, fromCache: false };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
