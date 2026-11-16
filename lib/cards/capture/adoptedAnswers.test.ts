/**
 * SESSION 27 (Akshay, Nov 14, 2026) — AN ANSWER THAT WAS NOT ADOPTED IS EVIDENCE, NEVER SERVED AS CURRENT.
 *
 * The decision 11 facts re-run (Nov 9) wrote answers to the cache under the inputs a rebuild now builds; production kept
 * its earlier facts. A rebuild uses production's ADOPTED facts (lib/cards/inputs/facts/<cik>.json) where they were read
 * from the same anchor; an unadopted answer (baselines/unadopted.json) is refused by the cache, before any read.
 *   U1  Tenet, DaVita and CHS: the facts a rebuild uses are production's adopted facts, at $0
 *   U2  every answer key of the re-run is registered unadopted, and the cache refuses each one before reading
 *   U3  Tenet's card rebuilt with those facts equals production's card
 *   control: serving the re-run answer instead (its verified facts) gives a Tenet card that differs from production
 *
 * Offline, $0. Run: npx tsx lib/cards/capture/adoptedAnswers.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { factsForBuild } from "./factsForBuild";
import { cachedCardFacts, UnadoptedAnswerError, isUnadopted } from "../../cache/answerCache";
import { buildCard } from "../build";
import { nonEmpty } from "../../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

for (const cik of ["0000070318", "0000927066", "0001108109"]) {
  const input = read(join("lib", "cards", "inputs", `${cik}.json`));
  const got = factsForBuild(input);
  assert(got.source === "adopted" && JSON.stringify(got.facts) === JSON.stringify(read(join("lib", "cards", "inputs", "facts", `${cik}.json`))), `[U1:${cik}] the rebuild's facts are production's adopted facts (${got.source})`);
}

const keys = nonEmpty("the re-run's answer keys", readdirSync(join("sessions", "27", "facts_rerun")).filter((f) => /^raw-\d{10}\.json$/.test(f)).flatMap((f) => read(join("sessions", "27", "facts_rerun", f)).keys as string[]));
const unregistered = keys.filter((k) => !isUnadopted(k));
let refused = 0;
(async () => {
  // Nov 16: the facts key is (read set, prompt version). These keys hashed an input, so no build can reach them; they
  // stay registered as evidence.
  const reachable = keys.filter((k) => /\/card-facts\/rs-/.test(k));
  assert(keys.length > 0 && unregistered.length === 0 && reachable.length === 0, `[U2] ${keys.length} re-run answer keys: all registered unadopted; ${reachable.length} reachable under the read-set key`);
  // A registered key of the read-set scheme is refused before the store is asked.
  const current = (read(join("baselines", "unadopted.json")).keys as { key: string }[]).map((x) => x.key).filter((k) => /\/card-facts\/rs-/.test(k));
  let storeAsked = false;
  for (const k of current) {
    const m = /^answer\/(\d+)\/card-facts\/rs-(\w+)\/cf-v(\d+)-ask(\d+)\.json$/.exec(k)!;
    try { await cachedCardFacts(m[1], m[2], Number(m[3]), Number(m[4]), "any", async () => { throw new Error("would bill"); }, async () => { storeAsked = true; return { data: null as any, hit: false }; }); }
    catch (e) { if (e instanceof UnadoptedAnswerError) refused++; }
  }
  assert(refused === current.length && !storeAsked, `[U2b] ${current.length} registered read-set keys: ${refused} refused before the store is asked`);

  const BRIEF = "2026-11-09";
  const ten = read(join("lib", "cards", "inputs", "0000070318.json"));
  const week = read(join("lib", "cards", "inputs", "week", `${BRIEF}.json`)).names["0000070318"];
  const build = (facts: any) => buildCard({ result: ten.result, briefDate: BRIEF, previousBrief: week?.previousBrief ?? null, weekFilings: week?.filings ?? [], cash: ten.cash, textByUrl: new Map(Object.entries(ten.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: ten.periodSentence, laterUrls: (ten.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
  const prod = read(join("lib", "cards", "generated", "0000070318.json"));
  assert(JSON.stringify(build(factsForBuild(ten).facts).v3) === JSON.stringify(prod.v3), `[U3] Tenet's rebuilt card equals production's`);
  const reRun = read(join("sessions", "27", "facts_rerun", "0000070318.json"));
  assert(JSON.stringify(build(reRun).v3) !== JSON.stringify(prod.v3), `[control] serving the re-run answer gives a Tenet card that differs from production`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
