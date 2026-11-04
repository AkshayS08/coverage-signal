/**
 * SESSION 27 (Akshay, Nov 3, 2026) — NEVER PRICE OR EXTRACT ON A FILING LIST OLDER THAN THE REQUEST.
 *
 * On Nov 3 Encompass's refresh was priced at 21:41Z on a filing list cached at 19:35Z (24-hour TTL). EDGAR already
 * listed its Q3 10-Q, filed that day, so the pricing anchored on the Aug 7 10-Q. The rule: before any billed build or
 * pricing, the filing list is re-fetched from EDGAR ($0) or verified newer than the request time; a filing EDGAR lists
 * on or before the request that the list lacks refuses the build.
 *
 *   F1  today's case, reproduced: cached 19:35Z, requested 21:41Z, EDGAR lists the 10-Q filed Nov 3 that the cached
 *       list lacks: refused, naming the filing (the control: what priced Encompass on the wrong anchor)
 *   F2  a list cached after the request needs no re-fetch
 *   F3  a list older than the request that EDGAR confirms complete passes
 *   F4  a filing after the request time does not refuse (it was not there to be read)
 *   F5  s27priceBatch and s27batch call the guard before they price or build
 *
 * Offline, $0. Run: npx tsx lib/fetch/freshFilings.test.ts
 */
import { readFileSync } from "node:fs";
import { filingListVerdict } from "./freshFilings";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const f = (form: string, filingDate: string, acc: string) => ({ form, filingDate, accessionNumber: acc });

// Encompass as the cache held it at 19:35Z on Nov 3, and as EDGAR listed it at 21:41Z.
const cached = [f("8-K", "2026-10-28", "a5"), f("10-Q", "2026-08-07", "a4"), f("8-K", "2026-08-13", "a3"), f("10-Q", "2026-04-30", "a2"), f("10-K", "2026-02-20", "a1")];
const live = [f("10-Q", "2026-11-03", "a6"), ...cached];

const v1 = filingListVerdict({ cachedAt: "2026-11-03T19:35:27.678Z", requestAt: "2026-11-03T21:41:00Z", cached, live });
assert(!v1.ok && /10-Q 2026-11-03/.test(v1.reason), `[F1] today's stale-anchor pricing is refused: ${v1.reason}`);
const v2 = filingListVerdict({ cachedAt: "2026-11-03T22:00:00Z", requestAt: "2026-11-03T21:41:00Z", cached, live: null });
assert(v2.ok, `[F2] a list cached after the request needs no re-fetch: ${v2.reason}`);
const v3 = filingListVerdict({ cachedAt: "2026-11-03T19:35:27.678Z", requestAt: "2026-11-03T21:41:00Z", cached: live, live });
assert(v3.ok, `[F3] an older list EDGAR confirms complete passes: ${v3.reason}`);
const v4 = filingListVerdict({ cachedAt: "2026-11-03T19:35:27.678Z", requestAt: "2026-11-02T12:00:00Z", cached, live });
assert(v4.ok, `[F4] a filing after the request time does not refuse: ${v4.reason}`);
const v5 = filingListVerdict({ cachedAt: "2026-11-03T19:35:27.678Z", requestAt: "2026-11-03T21:41:00Z", cached, live: null });
assert(!v5.ok, `[F1b] an older list with no EDGAR re-fetch is refused, never assumed current: ${v5.reason}`);

for (const p of ["lib/cache/s27priceBatch.ts", "lib/cache/s27batch.ts"]) {
  const src = readFileSync(p, "utf-8");
  assert(/assertFilingListCurrent\(/.test(src), `[F5] ${p} checks the filing list is current before it prices or builds`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
