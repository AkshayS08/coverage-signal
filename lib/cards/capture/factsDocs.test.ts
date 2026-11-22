/**
 * SESSION 27 (Akshay, Nov 16): ONE DECIDING FUNCTION FOR DOCUMENTS.
 * The card input, the facts input and the recorded read set all come from the read-set function (readSetOf, recorded by
 * the loop as result.recordedReadSet), with no second selector. The facts stage refuses to run if any read-set document
 * is missing from its input. A build records only the documents its input actually held.
 *
 *   S1  control: today's CHS facts input (the Nov 16 v2 run's card input, 7 of 15 read-set documents) refuses, naming
 *       the 8 it lacks
 *   S2  over every card that can be shown or signed: its facts input either refuses, naming what it lacks, or holds a
 *       block for every read-set document and none outside it
 *   S3  CHS recaptured through the one function holds all 15 read-set documents; its facts input reads every one, and
 *       its moves window ends at the read set's latest filing
 *   S4  the facts the stage records name the documents the input held (the key of its blocks' URLs)
 *   S5  the price counts the input the stage will read: the same documents, from the read set alone
 *   S6  the card input names no second list: no debt-8-K selector; it records the read set it holds
 *   S7  adopted facts record only the documents their input held: none claims a document its input lacked
 *       (control: the facts stamped Nov 16 with the full read set claim documents their inputs never held)
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/factsDocs.test.ts
 */
import { readFileSync, existsSync } from "node:fs";

import { inputFor, factsReadOfResult, FactsInputIncompleteError, factsInputDocs } from "./facts";
import { readSetDocsKey, factsReadSetOf } from "../factsValidity";
import { everyShownCard } from "../shownCards";
import { adoptedFactsSources } from "./adoptedFactsSources";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const tryInput = (snap: any): { text: string | null; err: any } => { try { return { text: inputFor(snap), err: null }; } catch (e) { return { text: null, err: e }; } };
const rsUrls = (snap: any) => (snap.result.recordedReadSet ?? []).filter((r: any) => r.via === "base").map((r: any) => r.url as string);

// S1 control
const today = read("sessions/27/chs_refresh/input.json");
const t = tryInput(today);
assert(t.err instanceof FactsInputIncompleteError && t.err.missing.length === 8, `[S1 control] today's CHS facts input (${rsUrls(today).filter((u: string) => today.docs[u]).length} of ${rsUrls(today).length}) refuses: ${t.err?.message ?? "it ran"}`);

// S2 every shown card
for (const s of everyShownCard()) {
  const r = tryInput(s.input);
  const want = rsUrls(s.input);
  if (r.err) { assert(r.err instanceof FactsInputIncompleteError && r.err.missing.every((u: string) => !s.input.docs[u]), `[S2:${s.key}] refuses, naming ${r.err.missing?.length ?? "?"} document(s) it lacks`); continue; }
  const got = factsInputDocs(r.text!);
  assert(want.every((u: string) => got.includes(u)) && got.every((u) => want.includes(u)), `[S2:${s.key}] holds every one of the ${want.length} read-set documents and none outside it`);
}

// S3 / S4 / S5 CHS through the one function
const P = "sessions/27/chs_refresh_v3/input.json";
if (!existsSync(P)) assert(false, `[S3] CHS recaptured through the read set (${P}) not on disk`);
else {
  const chs = read(P);
  const want = rsUrls(chs);
  const r = tryInput(chs);
  const got = r.text ? factsInputDocs(r.text) : [];
  assert(want.length === 15 && want.every((u: string) => chs.docs[u]) && got.length === 15 && want.every((u: string) => got.includes(u)), `[S3] CHS card input holds ${want.filter((u: string) => chs.docs[u]).length} of ${want.length}; its facts input reads ${got.length}`);
  const through = (chs.result.recordedReadSet as any[]).filter((x) => x.via === "base").map((x) => x.filingDate).sort().pop();
  assert(!!r.text && r.text.includes(`Read through: ${through}`), `[S3] moves window ends at the read set's latest filing (${through})`);
  const fr = factsReadOfResult(chs.result)!;
  assert(fr.fingerprint === readSetDocsKey(got) && fr.fingerprint === factsReadSetOf(chs.result), `[S4] the key the facts record (${fr.fingerprint.slice(0, 8)}) is the key of the documents the input held`);
  // S5: the price's stub holds only the read set's documents and the anchor; it must build the same documents.
  const dm = chs.result.results.find((x: any) => x.triggerId === "debt-maturity");
  const stub = { cik: chs.cik, company: chs.company, result: { cik: chs.cik, company: chs.company, results: [{ triggerId: "debt-maturity", debtScheduleSourceFiling: dm.debtScheduleSourceFiling }], recordedReadSet: chs.result.recordedReadSet }, docs: Object.fromEntries(want.map((u: string) => [u, chs.docs[u]])) };
  const priced = factsInputDocs(inputFor(stub));
  assert(priced.length === got.length && priced.every((u) => got.includes(u)), `[S5] the price's input reads the same ${priced.length} documents`);
}

// S6 no second selector
const snapSrc = readFileSync("lib/cards/capture/snapshot.ts", "utf-8"), factsSrc = readFileSync("lib/cards/capture/facts.ts", "utf-8"), priceSrc = readFileSync("lib/pipeline/price.ts", "utf-8");
assert(!/debtEightKsSinceTenK|debtEightKs/.test(snapSrc + factsSrc + priceSrc), `[S6] no debt-8-K selector in the card input, the facts stage or the price`);

// S7 adopted facts claim only documents their input held.
// Nov 21 (Akshay): S7 checks the facts adopted before Nov 20 (as stamped Nov 16), pinned to the commit before the
// Nov 20 adoption (c0c285c~1); the facts adopted Nov 20 are S7b's.
const stamped = new Map<string, string>();
const preAdoption = (cik: string) => JSON.parse(require("node:child_process").execSync(`git show c0c285c~1:lib/cards/inputs/facts/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 }));
for (const src of adoptedFactsSources()) {
  const f = preAdoption(src.cik);
  const held = src.heldUrls();
  stamped.set(src.cik, src.fullReadSetKey());
  assert(f.readSet === readSetDocsKey(held), `[S7:${src.cik}] its facts record ${String(f.readSet).slice(0, 8)}, the ${held.length} document(s) their input held (full read set ${src.fullReadSetKey().slice(0, 8)})`);
}
const lied = [...stamped.entries()].filter(([cik, full]) => { const src = adoptedFactsSources().find((s) => s.cik === cik)!; return readSetDocsKey(src.heldUrls()) !== full; });
assert(lied.length > 0, `[S7 control] the Nov 16 stamp (full read set) claims documents the inputs never held for ${lied.length} name(s)`);

// S7b (Nov 21): the facts adopted Nov 20 name exactly the documents their facts input holds — the card's read set.
for (const cik of ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"]) {
  const input = read(`lib/cards/inputs/${cik}.json`), f = read(`lib/cards/inputs/facts/${cik}.json`);
  const held = factsInputDocs(inputFor(input));
  assert(f.readSet === readSetDocsKey(held) && f.readSet === factsReadSetOf(input.result), `[S7b:${cik}] its facts record ${String(f.readSet).slice(0, 8)}: the ${held.length} documents its input holds, its read set`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
