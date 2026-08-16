import { createHash } from "node:crypto";
import { readCache, writeCache } from "../fetch/cache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { cacheStats } from "./stats";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

/**
 * Stable fingerprint of exactly what Haiku was asked about: the full
 * filing catalog (form, filingDate, item codes, url) for this company —
 * not just the subset read into the baseline corpus, since the catalog's
 * own listing is part of the prompt too (see claude.ts's formatCatalog).
 * A filing's own content never changes once filed (filingText.ts caches it
 * permanently), so as long as this exact set of filings is unchanged, the
 * prompt sent to Haiku is byte-identical to the one that produced any
 * cached answer for it. The 24h-TTL filing-list cache is the only thing
 * that can change this fingerprint between runs (a company files
 * something new).
 */
export function corpusFingerprint(
  filings: { form: string; filingDate: string; items: string; primaryDocUrl: string }[]
): string {
  const sorted = [...filings].sort((a, b) => a.primaryDocUrl.localeCompare(b.primaryDocUrl));
  const key = sorted.map((f) => `${f.form}|${f.filingDate}|${f.items}|${f.primaryDocUrl}`).join("\n");
  return sha256(key);
}

async function getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<{ data: T; hit: boolean }> {
  const cached = await readCache<T>(key, null); // permanent: a filing's content never changes, so its answer never expires
  if (cached !== null) {
    cacheStats.answer.hits++;
    return { data: cached, hit: true };
  }
  cacheStats.answer.misses++;
  const data = await compute();
  await writeCache(key, data);
  return { data, hit: false };
}

/**
 * The main classifyAllTriggers pass — all 15 triggers, one Haiku call, over
 * the full baseline corpus. Keyed by company + the exact filing set +
 * promptVersion, per the architecture doc's "company + filingId + triggerId
 * + promptVersion" key (generalized to a filing SET here, since the model
 * is asked about all 15 triggers jointly over the whole corpus in one call
 * — not per-filing-per-trigger; restructuring that call shape is out of
 * scope for this session, see the final report).
 */
export async function cachedBaseClassification<T>(
  cik: string,
  fingerprint: string,
  compute: () => Promise<T>
): Promise<{ data: T; hit: boolean }> {
  return getOrCompute(`answer/${cik}/base/${fingerprint}/v${EXTRACTION_PROMPT_VERSION}.json`, compute);
}

/** A single-trigger dig follow-up against one specific extra filing. */
export async function cachedDigClassification<T>(
  cik: string,
  fingerprint: string,
  triggerId: string,
  digUrl: string,
  compute: () => Promise<T>
): Promise<{ data: T; hit: boolean }> {
  const key = `answer/${cik}/dig/${fingerprint}/${triggerId}/${sha256(digUrl)}/v${EXTRACTION_PROMPT_VERSION}.json`;
  return getOrCompute(key, compute);
}

/**
 * The proceedsUse Sonnet classification (lib/agent/proceedsUse.ts) — fully
 * determined by the cached base-pass result for a fixed corpus fingerprint
 * (its inputs are the issuance trigger's evidence/quote/citations plus the
 * most recent 10-Q, all deterministic once the base pass is cached), so the
 * fingerprint alone is a sufficient key.
 */
export async function cachedProceedsUse<T>(
  cik: string,
  fingerprint: string,
  compute: () => Promise<T>
): Promise<{ data: T; hit: boolean }> {
  return getOrCompute(`answer/${cik}/proceedsUse/${fingerprint}/v${EXTRACTION_PROMPT_VERSION}.json`, compute);
}
