/**
 * Per-request cache hit/miss counters, for the "report the cache hit/miss
 * ratio" acceptance requirement (Session 14, Step 5). Not correctness-
 * critical — purely observational. Reset at the start of each API request
 * (app/api/run/route.ts) so counts reflect one run, not the lifetime of a
 * warm serverless instance.
 */
export interface CacheBucketStats {
  hits: number;
  misses: number;
}

function freshBucket(): CacheBucketStats {
  return { hits: 0, misses: 0 };
}

class CacheStatsTracker {
  answer: CacheBucketStats = freshBucket();
  wording: CacheBucketStats = freshBucket();

  reset(): void {
    this.answer = freshBucket();
    this.wording = freshBucket();
  }

  summary(): string {
    const ratio = (b: CacheBucketStats) => {
      const total = b.hits + b.misses;
      return total === 0 ? "n/a" : `${b.hits}/${total} (${Math.round((b.hits / total) * 100)}%)`;
    };
    return `answer cache ${ratio(this.answer)} hit, wording cache ${ratio(this.wording)} hit`;
  }
}

export const cacheStats = new CacheStatsTracker();
