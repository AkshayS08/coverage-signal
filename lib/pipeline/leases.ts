/**
 * SESSION 27, STAGE 2 — ONE BUILD PER KEY (pipeline_design §7; Akshay, Oct 29, 2026: Upstash Redis, not Vercel Blob).
 *
 * Before a billed stage a build takes `lease:<cik>:<read-set fp>:v<version>:<sample>` with SET … NX EX 600 through
 * Upstash's REST API (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN). Exactly one caller wins; the lease expires
 * after ten minutes; only its owner releases it (compare-and-delete). A store that is not configured or cannot be read
 * throws LeaseUnavailableError, and the build stops: never proceeds as if the lease were free. A cached build bills
 * nothing and takes no lease.
 */
export class LeaseUnavailableError extends Error {
  constructor(why: string) { super(`LEASE UNAVAILABLE — ${why}; the build stops rather than risk billing twice`); this.name = "LeaseUnavailableError"; }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>;
export interface LeaseConfig { url?: string; token?: string; fetch?: FetchLike }
export const LEASE_TTL_SECONDS = 600;

export function leaseKey(cik: string, fingerprint: string, version: number, sample: string | null): string {
  return `${cik}:${fingerprint}:v${version}:${sample ?? "canonical"}`;
}

async function command(cmd: (string | number)[], cfg: LeaseConfig): Promise<any> {
  // Vercel's Upstash integration names them KV_REST_API_URL / KV_REST_API_TOKEN; the read-only token never takes a lease.
  const url = cfg.url ?? process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = cfg.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) throw new LeaseUnavailableError("Upstash is not configured (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)");
  const f: FetchLike = cfg.fetch ?? (fetch as unknown as FetchLike);
  let res;
  try { res = await f(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd.map(String)) }); }
  catch (e) { throw new LeaseUnavailableError(`Upstash could not be reached (${e instanceof Error ? e.message : String(e)})`); }
  if (!res.ok) throw new LeaseUnavailableError(`Upstash answered ${res.status}`);
  const body = await res.json();
  if (body && body.error) throw new LeaseUnavailableError(`Upstash error: ${body.error}`);
  return body?.result;
}

/** True if this caller now holds the lease; false if another build does. */
export async function acquireLease(key: string, owner: string, cfg: LeaseConfig = {}): Promise<boolean> {
  return (await command(["SET", `lease:${key}`, owner, "NX", "EX", LEASE_TTL_SECONDS], cfg)) === "OK";
}

/** Releases the lease only if this caller still owns it. */
export async function releaseLease(key: string, owner: string, cfg: LeaseConfig = {}): Promise<void> {
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
  await command(["EVAL", script, 1, `lease:${key}`, owner], cfg);
}
