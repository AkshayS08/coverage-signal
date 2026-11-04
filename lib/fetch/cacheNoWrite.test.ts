/**
 * SESSION 27 (Akshay, Nov 3, 2026) — PRICE WITHOUT WRITING TO THE SHARED CACHE.
 *
 * Encompass's refresh is priced once its stale filing list expires (Nov 4), without writing to the shared Blob cache
 * production reads. CACHE_NO_WRITE=1 makes a cache miss fetch and return the fresh data without persisting it.
 *   N1  with CACHE_NO_WRITE=1, a miss returns the fetched data and never writes
 *   N2  control: without it, the same miss writes (the default production behaviour is unchanged)
 *
 * Offline, $0 (the Blob client is replaced by an in-memory stand-in). Run: npx tsx lib/fetch/cacheNoWrite.test.ts
 */
import { cachedFetchWith, writeCache } from "./cache";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

(async () => {
  const writes: string[] = [];
  const store = { read: async () => null, write: async (p: string) => { writes.push(p); } };
  process.env.CACHE_NO_WRITE = "1";
  const a = await cachedFetchWith(store, "edgar/filings/x__10-q.json", async () => ["fresh"]);
  assert(a.data[0] === "fresh" && !a.fromCache && writes.length === 0, `[N1] CACHE_NO_WRITE=1: the miss returns fresh data and writes nothing (${writes.length} writes)`);
  delete process.env.CACHE_NO_WRITE;
  await cachedFetchWith(store, "edgar/filings/x__10-q.json", async () => ["fresh"]);
  assert(writes.length === 1, `[N2 control] without it, the same miss writes (${writes.length} write)`);
  // N3: every direct writer (answerCache, wordingCache) goes through writeCache, which honours the switch. Offline: with
  // no Blob token, a write that tried to persist would throw; with the switch it returns without touching the store.
  const token = process.env.BLOB_READ_WRITE_TOKEN; delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CACHE_NO_WRITE = "1";
  let threw = false; try { await writeCache("answer/x.json", { a: 1 }); } catch { threw = true; }
  assert(!threw, `[N3] CACHE_NO_WRITE=1: writeCache persists nothing (it returned before reaching the store)`);
  delete process.env.CACHE_NO_WRITE;
  let threw2 = false; try { await writeCache("answer/x.json", { a: 1 }); } catch { threw2 = true; }
  assert(threw2, `[N3 control] without it, writeCache goes to the store (no token here, so it refuses)`);
  if (token !== undefined) process.env.BLOB_READ_WRITE_TOKEN = token;
  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
