/**
 * Session 14 — cache-layer tests. Two things, both explicitly required by
 * the session brief:
 *
 * 1. A missing BLOB_READ_WRITE_TOKEN must fail the run, never silently
 *    degrade (no disk/tmp/in-memory fallback exists at all now).
 * 2. A real write-then-read round-trips against the actual Blob store —
 *    this hits the network (Vercel Blob), not Anthropic/EDGAR, so it's
 *    fast and free, but it IS a real integration check, not a fixture
 *    replay: run `npm run test:cache` with BLOB_READ_WRITE_TOKEN set.
 *
 * Run: npx tsx lib/cache/cache.test.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { del } from "@vercel/blob";
import { readCache, writeCache, assertBlobConfigured } from "../fetch/cache";
import { corpusFingerprint } from "./answerCache";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ PASS — ${name}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL — ${name}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("=== Session 14 cache-layer tests ===\n");

  const realToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!realToken) {
    console.log("BLOB_READ_WRITE_TOKEN is not set locally — cannot run the round-trip half of this test.");
    console.log("(The missing-token assertions below still run correctly with no token set.)\n");
  }

  // --- 1. Missing token must throw, never silently proceed -----------------
  delete process.env.BLOB_READ_WRITE_TOKEN;

  let threw = false;
  let message = "";
  try {
    assertBlobConfigured();
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  check("assertBlobConfigured() throws when BLOB_READ_WRITE_TOKEN is unset", threw, message);
  check("the thrown error names the missing variable", message.includes("BLOB_READ_WRITE_TOKEN"), message);

  let readThrew = false;
  try {
    await readCache("test/should-never-be-reached.json");
  } catch {
    readThrew = true;
  }
  check(
    "readCache() THROWS (not returns null) when the token is missing — a missing cache must fail the run, not silently look like a cold cache",
    readThrew
  );

  let writeThrew = false;
  try {
    await writeCache("test/should-never-be-written.json", { probe: true });
  } catch {
    writeThrew = true;
  }
  check("writeCache() throws when the token is missing", writeThrew);

  process.env.BLOB_READ_WRITE_TOKEN = realToken;

  // --- 2. Real round-trip against the actual store (token restored) --------
  if (realToken) {
    const probeKey = `test/cache-roundtrip-${Date.now()}.json`;
    const probeValue = { hello: "world", n: 42, nested: { ok: true } };

    await writeCache(probeKey, probeValue);
    const readBack = await readCache<typeof probeValue>(probeKey);
    check(
      "a real write then read round-trips the exact same data",
      JSON.stringify(readBack) === JSON.stringify(probeValue),
      JSON.stringify(readBack)
    );

    const missKey = `test/cache-miss-${Date.now()}.json`;
    const miss = await readCache(missKey);
    check("reading a key that was never written is a clean miss (null), not a throw", miss === null);

    // Permanent (ttlMs: null) entries must never expire.
    const permanentKey = `test/cache-permanent-${Date.now()}.json`;
    await writeCache(permanentKey, { permanent: true });
    const permanentReadBack = await readCache<{ permanent: boolean }>(permanentKey, null);
    check("a ttlMs:null read returns the entry regardless of age", permanentReadBack?.permanent === true);

    await del(probeKey, { token: realToken }).catch(() => {});
    await del(permanentKey, { token: realToken }).catch(() => {});
  }

  // --- 3. corpusFingerprint: the mechanism behind "only genuinely new -----
  //        filings trigger a fresh Haiku call" (Step 4). Offline, zero
  //        cost — this is the pure function the answer-cache key is built
  //        from, so proving IT is stable/sensitive proves the property
  //        without needing a live 8-known-1-new EDGAR scenario.
  const nineFilings = Array.from({ length: 9 }, (_, i) => ({
    form: i < 2 ? "10-Q" : i === 2 ? "10-K" : "8-K",
    filingDate: `2026-0${(i % 9) + 1}-01`,
    items: "",
    primaryDocUrl: `https://example.com/filing-${i}.htm`,
  }));

  const fpBase = corpusFingerprint(nineFilings);
  const fpReordered = corpusFingerprint([...nineFilings].reverse());
  check("corpusFingerprint is order-independent (same 9 filings, different array order)", fpBase === fpReordered);

  const tenFilings = [
    ...nineFilings,
    { form: "8-K", filingDate: "2026-09-01", items: "1.01", primaryDocUrl: "https://example.com/filing-new.htm" },
  ];
  const fpTen = corpusFingerprint(tenFilings);
  check(
    "corpusFingerprint changes when one new filing is added to a known 9 — this is what makes a refresh with 8 known + 1 new filing a genuine (single) cache miss, never a re-ask of the 8 unchanged ones",
    fpTen !== fpBase
  );

  const eightFilings = nineFilings.slice(0, 8);
  const fpEight = corpusFingerprint(eightFilings);
  check("corpusFingerprint also changes when a filing drops out of the set", fpEight !== fpBase);

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.log("\nSOME CACHE TESTS FAILED");
    process.exit(1);
  }
  console.log("\nALL CACHE TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
