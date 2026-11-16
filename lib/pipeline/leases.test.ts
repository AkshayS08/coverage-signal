/**
 * SESSION 27, STAGE 2 — ONE BUILD PER KEY: UPSTASH LEASES (pipeline_design §7; decided Oct 29, 2026).
 *
 * Before a billed stage, a build takes the lease on (cik, read-set fingerprint, version, sample): `SET lease:<key>
 * <owner> NX EX 600` on Upstash Redis. Exactly one caller wins; the lease expires after ten minutes; it is released
 * only by its owner. A store that is not configured, or cannot be read, stops the build (fail closed) — never treated
 * as a free lease.
 *   L1  two concurrent acquires of one key: exactly one wins
 *   L2  the owner releases it, and only the owner: a stranger's release leaves it held
 *   L3  an unconfigured store, or a failed read, throws LeaseUnavailableError
 *   L4  the command sent is SET <key> <owner> NX EX 600
 *   control: the same acquire without NX lets both callers win
 *
 * Offline, $0 (an in-memory stand-in for Upstash's REST API). Run: npx tsx lib/pipeline/leases.test.ts
 */
import { acquireLease, releaseLease, leaseKey, LeaseUnavailableError } from "./leases";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

/** Upstash's REST API in memory: POST a command array, get { result }. */
function fakeUpstash(opts: { honourNx?: boolean } = {}) {
  const store = new Map<string, string>();
  const sent: string[][] = [];
  const fetchFn = async (_url: string, init: any) => {
    const cmd = JSON.parse(init.body) as string[];
    sent.push(cmd);
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    if (cmd[0] === "SET") { const nx = opts.honourNx !== false && cmd.includes("NX"); if (nx && store.has(cmd[1])) return { ok: true, json: async () => ({ result: null }) }; store.set(cmd[1], cmd[2]); return { ok: true, json: async () => ({ result: "OK" }) }; }
    if (cmd[0] === "EVAL") { const key = cmd[3], owner = cmd[4]; if (store.get(key) === owner) { store.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; } return { ok: true, json: async () => ({ result: 0 }) }; }
    return { ok: false, status: 400, json: async () => ({ error: "unknown" }) };
  };
  return { store, sent, fetchFn };
}
const cfg = (f: any) => ({ url: "https://example.upstash.io", token: "t", fetch: f });

(async () => {
  const key = leaseKey("0001739940", "1db66a3c", 33, null);
  const u = fakeUpstash();
  const [a, b] = await Promise.all([acquireLease(key, "build-A", cfg(u.fetchFn)), acquireLease(key, "build-B", cfg(u.fetchFn))]);
  assert([a, b].filter(Boolean).length === 1, `[L1] two concurrent acquires: ${[a, b].filter(Boolean).length} won`);
  const owner = a ? "build-A" : "build-B", stranger = a ? "build-B" : "build-A";
  await releaseLease(key, stranger, cfg(u.fetchFn));
  const heldAfterStranger = u.store.has(`lease:${key}`);
  await releaseLease(key, owner, cfg(u.fetchFn));
  assert(heldAfterStranger && !u.store.has(`lease:${key}`), `[L2] a stranger's release leaves it held; the owner's releases it`);
  let unconfigured = false, unreadable = false;
  try { await acquireLease(key, "x", { url: "", token: "", fetch: u.fetchFn }); } catch (e) { unconfigured = e instanceof LeaseUnavailableError; }
  try { await acquireLease(key, "x", cfg(async () => { throw new Error("network down"); })); } catch (e) { unreadable = e instanceof LeaseUnavailableError; }
  assert(unconfigured && unreadable, `[L3] unconfigured: ${unconfigured}; unreadable: ${unreadable} (both stop the build)`);
  const set = u.sent.find((c) => c[0] === "SET")!;
  assert(set[1] === `lease:${key}` && set[3] === "NX" && set[4] === "EX" && set[5] === "600", `[L4] sent: ${set.join(" ")}`);
  const loose = fakeUpstash({ honourNx: false });
  const [c, d] = await Promise.all([acquireLease(key, "build-C", cfg(loose.fetchFn)), acquireLease(key, "build-D", cfg(loose.fetchFn))]);
  assert(c && d, `[control] without NX both callers win (${[c, d].filter(Boolean).length})`);
  // L5: Vercel's Upstash integration names the store KV_REST_API_URL / KV_REST_API_TOKEN; either naming configures it.
  const saved = Object.fromEntries(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN"].map((k) => [k, process.env[k]]));
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.KV_REST_API_URL = "https://kv.upstash.io"; process.env.KV_REST_API_TOKEN = "kv-token";
  let seen: { url: string; auth: string } | null = null;
  const kvU = fakeUpstash();
  await acquireLease("kv-key", "o", { fetch: async (url: string, init: any) => { seen = { url, auth: init.headers.Authorization }; return kvU.fetchFn(url, init); } });
  assert(seen !== null && (seen as any).url === "https://kv.upstash.io" && (seen as any).auth === "Bearer kv-token", `[L5] KV_REST_API_URL / KV_REST_API_TOKEN configure the store (${JSON.stringify(seen)})`);
  // Control: the read-only token cannot take a lease, so it never stands in for the write token.
  delete process.env.KV_REST_API_TOKEN; process.env.KV_REST_API_READ_ONLY_TOKEN = "ro-token";
  let roStops = false;
  try { await acquireLease("kv-key2", "o", { fetch: kvU.fetchFn }); } catch (e) { roStops = e instanceof LeaseUnavailableError; }
  assert(roStops, `[L5 control] only the read-only token set: the build stops (${roStops})`);
  restore();
  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
