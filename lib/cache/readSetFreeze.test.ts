/**
 * SESSION 27 (Akshay, Nov 14, 2026) — A CARD IS SERVED FROM ITS LAST BUILD BETWEEN TRIGGERS; THE 8-K RULE TAKES EFFECT
 * AT EACH NAME'S NEXT TRIGGER.
 *
 * Between refresh triggers (a new 10-Q or 10-K, or an 8-K carrying Item 1.01, 1.02, 2.03, 2.04 or 8.01) a card's read
 * set is the one its last build read (baselines/builds.json). A later filing that is not a trigger is listed in the
 * header, not read. The 8-K rule of Nov 14 — only 8-Ks carrying debt items (1.01, 1.02, 2.03, 2.04, 7.01, 8.01) filed
 * since the latest 10-K, none if there are none, no fallback — applies to a build whose last trigger falls on or after
 * Nov 14; answers built under the earlier rule are served until the name's next trigger.
 *   R1  Molina at Nov 9 reads its Oct 29 build's read set: its Nov 6 Item 7.01 8-K does not move the key
 *   R2  each of the six names at Nov 9 reads its last build's read set
 *   R3  a trigger after the last build (a new 10-Q) makes the read set as of that trigger
 *   R4  the 8-K rule applies from a trigger on or after Nov 14: debt-item 8-Ks since the 10-K, none if none
 *   R5  resolveReadSet freezes the filing list through lastBuild.ts (one deciding function)
 *   controls: Molina's read set computed unfrozen at Nov 9 (its Nov 6 7.01 8-K moving the key) fails R1; the old
 *             selection applied after Nov 14 fails R4
 *
 * Offline, $0 (filing lists from lib/cache/fixtures). Run: npx tsx lib/cache/readSetFreeze.test.ts
 */
import { readFileSync } from "node:fs";
import { readSetOf } from "./readSet";
import { frozenFilings, readSetDateFor, READ_SET_RULE_V2_FROM, selectEightKsV2 } from "./lastBuild";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const fx = (cik: string) => JSON.parse(readFileSync(`lib/cache/fixtures/filings-${cik}.json`, "utf-8")).filings as any[];
const upTo = (fs: any[], d: string) => fs.filter((f) => f.filingDate <= d);
const ids = (fs: any[]) => fs.map((f) => f.accessionNumber).sort().join(",");
const builds = JSON.parse(readFileSync("baselines/builds.json", "utf-8")).builds as Record<string, { readSetAsOf: string }[]>;

const mol = fx("0001179929");
const frozen = readSetOf(frozenFilings("0001179929", upTo(mol, "2026-11-09"), "2026-11-09"));
assert(ids(frozen) === ids(readSetOf(upTo(mol, "2026-10-29"))), `[R1] Molina at Nov 9 reads its Oct 29 build's read set (${readSetDateFor("0001179929", upTo(mol, "2026-11-09"), "2026-11-09")})`);
const unfrozen = readSetOf(upTo(mol, "2026-11-09"));
assert(ids(unfrozen) !== ids(readSetOf(upTo(mol, "2026-10-29"))), `[control] unfrozen at Nov 9, Molina's Nov 6 7.01 8-K moves the key (so R1 would fail without the freeze)`);

for (const cik of Object.keys(builds)) {
  const fs = upTo(fx(cik), "2026-11-09");
  const last = builds[cik].map((b) => b.readSetAsOf).filter((d) => d <= "2026-11-09").sort().pop()!;
  assert(ids(readSetOf(frozenFilings(cik, fs, "2026-11-09"))) === ids(readSetOf(upTo(fs, last))), `[R2:${cik}] reads its last build's read set (as of ${last})`);
}

// R3: Tenet with a synthetic 10-Q filed after its last build.
const ten = upTo(fx("0000070318"), "2026-11-09");
const newQ = { form: "10-Q", filingDate: "2026-11-12", reportDate: "2026-09-30", items: "", accessionNumber: "synthetic-q", primaryDocUrl: "https://example.invalid/q.htm" };
assert(readSetDateFor("0000070318", [newQ, ...ten], "2026-11-12") === "2026-11-12", `[R3] a 10-Q after the last build makes the read set as of that trigger (${readSetDateFor("0000070318", [newQ, ...ten], "2026-11-12")})`);

// R4: after Nov 14, only debt-item 8-Ks since the latest 10-K; none if none.
const later = { ...newQ, filingDate: "2026-11-20", accessionNumber: "synthetic-q2" };
const cnaAfter = [later, ...upTo(fx("0001739940"), "2026-11-14")];
const v2 = readSetOf(frozenFilings("0001739940", cnaAfter, "2026-11-20")).filter((f) => f.form === "8-K");
const tenK = cnaAfter.filter((f) => f.form === "10-K").sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))[0];
const DEBT = ["1.01", "1.02", "2.03", "2.04", "7.01", "8.01"];
const want = selectEightKsV2(cnaAfter);
assert(READ_SET_RULE_V2_FROM === "2026-11-14" && ids(v2) === ids(want) && v2.every((f) => f.filingDate >= tenK.filingDate && String(f.items).split(",").some((i) => DEBT.includes(i.trim()))), `[R4] after Nov 14 the read set's 8-Ks are the debt-item 8-Ks since the 10-K (${v2.length}: ${v2.map((f) => `${f.filingDate} ${f.items}`).join("; ")})`);
const none = selectEightKsV2([later, { form: "10-K", filingDate: "2026-02-01", items: "", accessionNumber: "k", primaryDocUrl: "" }, { form: "8-K", filingDate: "2026-03-01", items: "2.02,9.01", accessionNumber: "e", primaryDocUrl: "" }]);
assert(none.length === 0, `[R4] none, where no 8-K since the 10-K carries a debt item (no fallback)`);
const oldAfter = cnaAfter.filter((f) => f.form === "8-K").slice(0, 6);
assert(ids(oldAfter) !== ids(v2), `[control] the old selection (six newest signal 8-Ks) applied after Nov 14 differs from R4`);

const rs = readFileSync("lib/cache/readSet.ts", "utf-8");
assert(/frozenFilings\(/.test(rs) && /from "\.\/lastBuild"/.test(rs), `[R5] resolveReadSet freezes through lastBuild.ts`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
