/**
 * SESSION 27 (Akshay, Nov 16): THE FACTS CACHE KEY COVERS WHAT THE FACTS STAGE READ — THE READ SET AND THE PROMPT
 * VERSION — NEVER THE BRIEF DATE. A cached facts answer is reused until its read set changes.
 *
 * The facts input was built from the card input's later filings through the brief date and named that date twice (an
 * input line, and the system prompt's moves window); the key hashed that input. So the next day's run missed the cache
 * and re-billed three asks over the same documents.
 *
 *   K1  the same read set on the next day (a later non-trigger 8-K now on file) builds the same input and key, and the
 *       second day's run is a cache hit: one compute across both days
 *   K2  neither the system prompt nor the input names a brief date; the moves window ends at the read set's latest filing
 *   K3  a changed read set (a new trigger 8-K) is a new key: a miss, read afresh
 *   K4  a new prompt version is a new key
 *   K5  a hit whose stored input differs from what the stage would read now is refused, never served
 *   control: the old key (a hash of the input built through the brief date) misses on the next day
 *
 * Offline, $0: the cache is an in-memory store. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/factsKey.test.ts
 */
import { createHash } from "node:crypto";
import { inputFor, SYSTEM, CARD_FACTS_PROMPT_VERSION, factsInputHash, type FactsRead } from "./facts";
import { cachedCardFacts, cardFactsKey, FactsReadChangedError } from "../../cache/answerCache";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

const A = "https://www.sec.gov/Archives/edgar/data/1108109/q3.htm";
const K10 = "https://www.sec.gov/Archives/edgar/data/1108109/10k.htm";
const T8K = "https://www.sec.gov/Archives/edgar/data/1108109/8k-1110.htm";
const NEW8K = "https://www.sec.gov/Archives/edgar/data/1108109/8k-1115.htm";
const T8K2 = "https://www.sec.gov/Archives/edgar/data/1108109/8k-1117.htm";
const doc = (label: string, text: string) => ({ label, text });
const snapOn = (day: string, extra: { form: string; filingDate: string; items: string; url: string }[] = []) => ({
  cik: "0001108109", company: "COMMUNITY HEALTH SYSTEMS INC", corpusFingerprint: "544c51ae", capturedOn: day,
  result: { cik: "0001108109", company: "COMMUNITY HEALTH SYSTEMS INC", results: [{ triggerId: "debt-maturity", debtScheduleSourceFiling: { form: "10-Q", date: "2026-10-23", reportDate: "2026-09-30", url: A } }] },
  laterFilings: [{ form: "8-K", filingDate: "2026-11-10", items: "8.01,9.01", url: T8K }, ...extra],
  debtEightKs: [{ form: "8-K", filingDate: "2026-11-10", items: "8.01,9.01", url: T8K }],
  docs: {
    [A]: doc("10-Q 2026-10-23", "Long-term debt. The Company redeemed $500 million of its 8.000% Senior Secured Notes due 2027 on March 2, 2026."),
    [K10]: doc("10-K 2026-02-18", "Long-term debt. The 2029 Notes mature on April 15, 2029."),
    [T8K]: doc("8-K 2026-11-10", "On November 10, 2026, the Company issued $700 million of 9.750% Senior Secured Notes due 2034."),
    ...Object.fromEntries(extra.map((e) => [e.url, doc(`${e.form} ${e.filingDate}`, "Item 7.01. The Company presented at a conference.")])),
  },
});
const readA: FactsRead = { fingerprint: "544c51ae", urls: [A, K10, T8K], through: "2026-11-10" };

/** An in-memory stand-in for the answer cache: getOrCompute over a Map. */
function memStore() {
  const m = new Map<string, unknown>();
  let computes = 0;
  const store = async <T>(key: string, compute: () => Promise<T>) => { if (m.has(key)) return { data: m.get(key) as T, hit: true }; computes++; const data = await compute(); m.set(key, data); return { data, hit: false }; };
  return { m, store, computes: () => computes };
}
const answer = { schedule: [], moves: [] };

(async () => {
  const day1 = snapOn("2026-11-16");
  const day2 = snapOn("2026-11-17", [{ form: "8-K", filingDate: "2026-11-17", items: "7.01", url: NEW8K }]);
  const in1 = inputFor(day1, readA), in2 = inputFor(day2, readA);
  const s = memStore();
  const r1 = await cachedCardFacts(day1.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION, 1, factsInputHash(in1), async () => answer, s.store);
  const r2 = await cachedCardFacts(day2.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION, 1, factsInputHash(in2), async () => answer, s.store);
  assert(in1 === in2 && !r1.hit && r2.hit && s.computes() === 1, `[K1] same read set, next day: same input ${in1 === in2}; day 1 ${r1.hit ? "hit" : "miss"}, day 2 ${r2.hit ? "hit" : "miss"}; ${s.computes()} compute(s)`);

  const dated = /20\d\d-\d\d-\d\d|brief date/i;
  assert(!dated.test(SYSTEM) && !/brief date/i.test(in1) && !in1.includes("2026-11-16") && /Read through: 2026-11-10/.test(in1) && !in2.includes(NEW8K), `[K2] the prompt names no date; the input reads through the read set's latest filing (2026-11-10) and not the day's extra 8-K`);

  const readB: FactsRead = { fingerprint: "9f00aa11", urls: [A, K10, T8K, T8K2], through: "2026-11-17" };
  const day3 = snapOn("2026-11-18", [{ form: "8-K", filingDate: "2026-11-17", items: "2.03,9.01", url: T8K2 }]);
  const r3 = await cachedCardFacts(day3.cik, readB.fingerprint, CARD_FACTS_PROMPT_VERSION, 1, factsInputHash(inputFor(day3, readB)), async () => answer, s.store);
  assert(!r3.hit && cardFactsKey(day3.cik, readB.fingerprint, CARD_FACTS_PROMPT_VERSION, 1) !== cardFactsKey(day1.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION, 1), `[K3] a new read set (a new trigger 8-K) is a new key: ${r3.hit ? "hit" : "miss"}`);

  assert(cardFactsKey(day1.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION + 1, 1) !== cardFactsKey(day1.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION, 1), `[K4] a new prompt version is a new key`);

  let refused = false, served = false;
  try { await cachedCardFacts(day1.cik, readA.fingerprint, CARD_FACTS_PROMPT_VERSION, 1, factsInputHash(in1 + "\nchanged"), async () => { served = true; return answer; }, s.store); }
  catch (e) { refused = e instanceof FactsReadChangedError; }
  assert(refused && !served, `[K5] a hit whose stored input differs from today's is refused (${refused}), never served or re-billed into the same key (${!served})`);

  // Control: the old rule — the key a hash of the input built from every later filing through the brief date.
  const legacy = (snap: any, brief: string) => {
    const docsThrough = snap.laterFilings.filter((f: any) => f.filingDate <= brief).map((f: any) => f.url).join(",");
    return createHash("sha256").update(`Brief date: ${brief}\n${docsThrough}`).digest("hex").slice(0, 24);
  };
  assert(legacy(day1, "2026-11-16") !== legacy(day2, "2026-11-17"), `[control] the old key misses on the next day (${legacy(day1, "2026-11-16").slice(0, 8)} → ${legacy(day2, "2026-11-17").slice(0, 8)})`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
