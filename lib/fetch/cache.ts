import fs from "fs/promises";
import path from "path";
import os from "os";

// Vercel's deployed function filesystem is read-only except /tmp — the
// project-relative cache/ folder can't be created there. Locally, keep
// using the project's own cache/ folder so nothing changes on-disk here.
const isVercel = Boolean(process.env.VERCEL);

export const CACHE_DIR = isVercel
  ? path.join(os.tmpdir(), "coverage-signal-cache")
  : path.join(process.cwd(), "cache");

function resolveCachePath(relPath: string): string {
  return path.join(CACHE_DIR, relPath);
}

/**
 * Session 13 Part B: the cache previously had no expiry at all — a real
 * live run found Concentra's 98% quarter-over-quarter cash build hidden
 * behind a stale filing-list fetch for weeks, because nothing ever forced
 * a re-fetch once a cache entry existed. 24 hours balances staying fresh
 * against not re-fetching EDGAR on every run within the same day.
 */
export const FILING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope<T> {
  cachedAt: string;
  data: T;
}

export async function readCache<T>(relPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(resolveCachePath(relPath), "utf-8");
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    const age = Date.now() - new Date(envelope.cachedAt).getTime();
    if (age > FILING_CACHE_TTL_MS) return null; // expired -- treat as a cache miss, caller re-fetches
    return envelope.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeCache(relPath: string, data: unknown): Promise<void> {
  const fullPath = resolveCachePath(relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const envelope: CacheEnvelope<unknown> = { cachedAt: new Date().toISOString(), data };
  await fs.writeFile(fullPath, JSON.stringify(envelope, null, 2), "utf-8");
}

/**
 * Reads relPath from the disk cache if present; otherwise calls fetcher(),
 * writes the result, and returns it. Callers can tell a cache hit from a
 * fresh pull via `fromCache`.
 */
export async function cachedFetch<T>(
  relPath: string,
  fetcher: () => Promise<T>
): Promise<{ data: T; fromCache: boolean }> {
  const cached = await readCache<T>(relPath);
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
