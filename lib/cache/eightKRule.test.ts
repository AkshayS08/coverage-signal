/**
 * SESSION 27 (Akshay, Nov 16): THE NEW READ WINDOW APPLIES FROM EACH NAME'S FIRST BUILD AFTER THE DECISION — NEVER BY
 * THE TRIGGER FILING'S DATE.
 *
 * The rule was chosen by comparing the last trigger's filing date with Nov 14. CHS's trigger, its Nov 10 8-K, predates
 * that date, so its first build after the decision would have read under the earlier rule. The rule is now a property
 * of the build: a read set that is a recorded build (baselines/builds.json) keeps the rule it was built under; any new
 * build — a trigger since the last build, or a name never built — reads under the new window.
 *   E1  CHS (last build Oct 31, trigger Nov 10): its next build is new, so the new window; its read set holds the
 *       Jan 20, Feb 2 and Feb 18 debt-item 8-Ks
 *   E2  each name served from its last build keeps that build's recorded rule, and its read set is unchanged
 *   E3  a name never built reads under the new window
 *   E4  every recorded build names its rule; no rule is chosen by a date (no date cutoff in lastBuild.ts or readSet.ts)
 *   control: the trigger-date rule gives CHS the earlier rule, and its read set misses the three 8-Ks
 *
 * Offline, $0 (filing lists from lib/cache/fixtures). Run: npx tsx lib/cache/eightKRule.test.ts
 */
import { readFileSync } from "node:fs";
import { readSetOf } from "./readSet";
import { eightKRuleFor, frozenFilings, lastTriggerDate, readSetDateFor } from "./lastBuild";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const fx = (cik: string) => JSON.parse(readFileSync(`lib/cache/fixtures/filings-${cik}.json`, "utf-8")).filings as any[];
const upTo = (fs: any[], d: string) => fs.filter((f) => f.filingDate <= d);
const ids = (fs: any[]) => fs.map((f) => f.accessionNumber).sort().join(",");
const registry = JSON.parse(readFileSync("baselines/builds.json", "utf-8")).builds as Record<string, { readSetAsOf: string; eightKRule?: number }[]>;

const CHS = "0001108109", TODAY = "2026-11-16";
const chs = upTo(fx(CHS), TODAY);
const chsRule = eightKRuleFor(CHS, chs, TODAY);
const chsRs = readSetOf(frozenFilings(CHS, chs, TODAY), chsRule);
const early = ["2026-01-20", "2026-02-02", "2026-02-18"];
const has = (rs: any[], d: string) => rs.some((f) => f.form === "8-K" && f.filingDate === d);
assert(chsRule === 2 && early.every((d) => has(chsRs, d)), `[E1] CHS's next build (trigger ${lastTriggerDate(chs, TODAY)}, after its last build): rule ${chsRule}; reads ${early.filter((d) => has(chsRs, d)).join(", ") || "none"} of the early-year 8-Ks`);

for (const [cik, list] of Object.entries(registry)) {
  if (cik === CHS) continue;
  const last = list.map((b) => b.readSetAsOf).sort().pop()!;
  const fs = upTo(fx(cik), "2026-11-09");
  const served = readSetDateFor(cik, fs, "2026-11-09");
  const rec = list.find((b) => b.readSetAsOf === served);
  const rule = eightKRuleFor(cik, fs, "2026-11-09");
  assert(rec !== undefined && rule === rec.eightKRule && ids(readSetOf(frozenFilings(cik, fs, "2026-11-09"), rule)) === ids(readSetOf(upTo(fs, last), 1)), `[E2:${cik}] served from its build of ${served}: rule ${rule} as recorded; read set unchanged`);
}

const fresh = eightKRuleFor("0000000001", upTo(fx(CHS), TODAY), TODAY);
assert(fresh === 2, `[E3] a name never built reads under the new window (rule ${fresh})`);

const src = readFileSync("lib/cache/lastBuild.ts", "utf-8") + readFileSync("lib/cache/readSet.ts", "utf-8");
const allNamed = Object.values(registry).flat().every((b) => b.eightKRule === 1 || b.eightKRule === 2);
assert(allNamed && !/READ_SET_RULE_V2_FROM|>=\s*"20\d\d-\d\d-\d\d"/.test(src), `[E4] every recorded build names its rule (${allNamed}); no rule chosen by a date`);

// Control: the trigger-date rule (a trigger on or after Nov 14 reads under the new window).
const byDate = (lastTriggerDate(chs, TODAY) ?? "") >= "2026-11-14" ? 2 : 1;
const ctlRs = readSetOf(frozenFilings(CHS, chs, TODAY), byDate as 1 | 2);
assert(byDate === 1 && !early.some((d) => has(ctlRs, d)), `[control] by the trigger's date CHS reads under rule ${byDate} and misses all three early-year 8-Ks`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
