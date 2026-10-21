/**
 * SESSION 27, STAGE 1, STEP 3 — THE KEY COVERS WHAT EXTRACTION READ, AND NOTHING ELSE.
 *
 * Over all six signed names' real catalogs (lib/cache/fixtures/s27-catalogs.json),
 * each rule is asserted on the key under test and on a negative control that
 * must fail it:
 *
 *   K1  an unrelated 8-K (Item 5.02 shape) does not move the key
 *       control: the whole-catalog fingerprint, which it moves
 *   K2  a new 10-Q does move it (it becomes the anchor)
 *       control: a key over the 8-Ks alone, which it does not move
 *   K3  an 8-K with a debt item (1.01, 2.03) inside the read window moves it
 *       control: a key over the 10-Qs and 10-K alone
 *   K4  a prompt-version bump moves it
 *       control: the same key with the version left out
 *   K5  a read document whose content changes moves it
 *       control: a key over accession numbers alone
 *   K6  filings aging out of EDGAR's recent window (the Encompass Form 4 case:
 *       the oldest 8-K/10-Q/10-K drop off the catalog) do not move it
 *       control: the whole-catalog fingerprint
 *   K7  one deciding function: the loop, checkFree and preflight all decide
 *       what is read through readSetOf and build the key through
 *       readSetFingerprint; none selects filings or hashes the catalog itself
 *       control: a source that calls selectBaselineFilings directly is flagged
 *
 * Before readSet.ts exists, the key under test is the current whole-catalog
 * fingerprint (the before count). Offline, $0, no network.
 *
 * Run: npx tsx lib/cache/readSet.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { corpusFingerprint } from "./answerCache";
import type { FilingEntry } from "../fetch";

interface Catalog { cik: string; company: string; filings: FilingEntry[] }
const catalogs: Catalog[] = JSON.parse(readFileSync("lib/cache/fixtures/s27-catalogs.json", "utf-8"));
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const textOf = (url: string) => `the text of ${url}`;

interface KeyInputs { cik: string; company: string; filings: FilingEntry[]; contentHash: (url: string) => string; xbrlDebtTotal: number | null; promptVersion: number; locatorVersion: number }
type KeyFn = (i: KeyInputs) => string;

(async () => {
  const mod: any = existsSync("lib/cache/readSet.ts") ? await import("./readSet") : null;
  const readSetOf: (f: FilingEntry[]) => FilingEntry[] = mod ? mod.readSetOf : (f: FilingEntry[]) => f;
  const underTest: KeyFn = mod
    ? (i) => mod.readSetFingerprint(i)
    : (i) => `${corpusFingerprint(i.filings)}/v${i.promptVersion}`;
  console.log(mod ? "key under test: readSetFingerprint (lib/cache/readSet.ts)" : "key under test: the CURRENT whole-catalog fingerprint (readSet.ts does not exist yet) — the before count");

  // Controls: each is a key that ignores exactly the input its rule is about.
  const wholeCatalog: KeyFn = (i) => `${corpusFingerprint(i.filings)}/v${i.promptVersion}`;
  const only = (forms: string[]): KeyFn => (i) => sha(readSetOf(i.filings).filter((f) => forms.includes(f.form)).map((f) => f.accessionNumber).join(",") + i.promptVersion);
  const noVersion: KeyFn = (i) => sha(readSetOf(i.filings).map((f) => `${f.accessionNumber}|${i.contentHash(f.primaryDocUrl)}`).join(","));
  const accessionOnly: KeyFn = (i) => sha(readSetOf(i.filings).map((f) => f.accessionNumber).join(",") + i.promptVersion);

  const base = (c: Catalog, filings = c.filings, over: Partial<KeyInputs> = {}): KeyInputs => ({ cik: c.cik, company: c.company, filings, contentHash: (u) => sha(textOf(u)), xbrlDebtTotal: 1e9, promptVersion: 32, locatorVersion: 1, ...over });
  const NEXT = "2026-10-22";
  const synth = (c: Catalog, form: string, items: string, n: number): FilingEntry => {
    const acc = `9999999999-26-${String(900000 + n).padStart(6, "0")}`;
    return { form, filingDate: NEXT, reportDate: form === "10-Q" ? "2026-09-30" : "", accessionNumber: acc, primaryDocument: `synthetic-${n}.htm`, primaryDocUrl: `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${acc.replace(/-/g, "")}/synthetic-${n}.htm`, items };
  };
  const withNew = (c: Catalog, f: FilingEntry) => [f, ...c.filings];

  interface Rule { id: string; name: string; moves: boolean; change: (c: Catalog) => [KeyInputs, KeyInputs]; control: KeyFn; controlName: string }
  const RULES: Rule[] = [
    { id: "K1", name: "an unrelated 8-K (Item 5.02) does not move the key", moves: false, change: (c) => [base(c), base(c, withNew(c, synth(c, "8-K", "5.02", 1)))], control: wholeCatalog, controlName: "the whole-catalog fingerprint" },
    { id: "K2", name: "a new 10-Q moves the key", moves: true, change: (c) => [base(c), base(c, withNew(c, synth(c, "10-Q", "", 2)))], control: only(["8-K"]), controlName: "a key over the 8-Ks alone" },
    { id: "K3", name: "an 8-K with a debt item (1.01, 2.03) inside the read window moves the key", moves: true, change: (c) => [base(c), base(c, withNew(c, synth(c, "8-K", "1.01,2.03,9.01", 3)))], control: only(["10-Q", "10-K"]), controlName: "a key over the 10-Qs and 10-K alone" },
    { id: "K4", name: "a prompt-version bump moves the key", moves: true, change: (c) => [base(c), base(c, c.filings, { promptVersion: 33 })], control: noVersion, controlName: "the key with the version left out" },
    { id: "K5", name: "a read document whose content changes moves the key", moves: true, change: (c) => { const anchor = readSetOf(c.filings)[0].primaryDocUrl; return [base(c), base(c, c.filings, { contentHash: (u) => sha(textOf(u) + (u === anchor ? " restated" : "")) })]; }, control: accessionOnly, controlName: "a key over accession numbers alone" },
    { id: "K6", name: "filings aging out of EDGAR's recent window (the Encompass Form 4 case) do not move the key", moves: false, change: (c) => [base(c), base(c, c.filings.slice(0, c.filings.length - 3))], control: wholeCatalog, controlName: "the whole-catalog fingerprint" },
  ];

  let passed = 0, failed = 0, controls = 0, controlsFailed = 0;
  const failures: string[] = [];
  for (const r of RULES) {
    console.log(`\n${r.id} — ${r.name}`);
    for (const c of catalogs) {
      const [a, b] = r.change(c);
      const moved = underTest(a) !== underTest(b);
      if (moved === r.moves) { passed++; console.log(`  ✓ ${c.company}: ${moved ? "moves" : "stays"}`); }
      else { failed++; failures.push(`${r.id} ${c.company}: the key ${moved ? "moved" : "stayed"}`); console.log(`  ✗ ${c.company}: the key ${moved ? "moved" : "stayed"}, the rule says it ${r.moves ? "moves" : "stays"}`); }
      controls++;
      const cMoved = r.control(a) !== r.control(b);
      if (cMoved !== r.moves) controlsFailed++;
      else console.log(`  ✗ CONTROL PASSED on ${c.company}: ${r.controlName} also satisfies the rule, so it does not distinguish`);
    }
  }

  // K7 — one deciding function, read off the source.
  console.log(`\nK7 — one deciding function for the loop, checkFree and preflight`);
  // The loop and checkFree decide through the read-set module itself; preflight may do so through checkFree.
  const audit = (src: string, via = /readSetOf\s*\(|resolveReadSet\s*\(/): string[] => {
    const f: string[] = [];
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (/selectBaselineFilings\s*\(/.test(code)) f.push("selects filings itself (selectBaselineFilings)");
    if (/corpusFingerprint\s*\(/.test(code)) f.push("hashes the whole catalog (corpusFingerprint)");
    if (!via.test(code)) f.push("does not decide its reads through readSetOf / resolveReadSet");
    return f;
  };
  for (const file of ["lib/agent/loop.ts", "lib/cache/freeRun.ts", "lib/cache/preflight.ts"]) {
    const f = audit(readFileSync(file, "utf-8"), file.endsWith("preflight.ts") ? /resolveReadSet\s*\(|checkFree\s*\(/ : undefined);
    if (f.length === 0) { passed++; console.log(`  ✓ ${file}`); } else { failed++; failures.push(`K7 ${file}: ${f.join("; ")}`); console.log(`  ✗ ${file}: ${f.join("; ")}`); }
  }
  controls++;
  if (audit(`const baseline = selectBaselineFilings(filings); readSetOf(filings);`).length > 0) controlsFailed++;
  else console.log("  ✗ CONTROL PASSED: a source selecting its own filings was not flagged");

  console.log(`\n${passed} passed, ${failed} failed; negative controls ${controlsFailed} of ${controls} failed as required.`);
  if (failures.length) { console.log("\nFAILURES:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(failed > 0 || controlsFailed < controls ? 1 : 0);
})();
