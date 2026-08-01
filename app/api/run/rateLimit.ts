const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RUNS_PER_WINDOW = 10;

/**
 * In-memory only — resets on cold start/redeploy, and isn't shared across
 * serverless instances. That's an accepted tradeoff for a single low-traffic
 * demo link: the passphrase gate is the real defense, this is a lightweight
 * backstop so even a valid passphrase can't be looped expensively. Not a
 * substitute for real distributed rate limiting at scale.
 */
const runTimestamps = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const recent = (runTimestamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_RUNS_PER_WINDOW) {
    const oldest = Math.min(...recent);
    runTimestamps.set(key, recent);
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }

  recent.push(now);
  runTimestamps.set(key, recent);
  return { allowed: true };
}
