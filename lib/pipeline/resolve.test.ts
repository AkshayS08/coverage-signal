/**
 * SESSION 27, STAGE 2 — STEP 1, FIND THE COMPANY (pipeline_design §1; Akshay, Oct 29 and Nov 14, 2026).
 *
 * A query is a name, a ticker or a CIK. Every match is collected (exact, prefix, all-tokens); more than one shows a
 * picker, at $0, and the resolver never guesses. A guess is never cached: only the user's pick is.
 *   S1  a CIK (any padding) resolves directly
 *   S2  a ticker resolves by exact match, any case
 *   S3  a name that matches one registrant resolves; one that matches several returns them all, to choose from
 *   S4  no match is "could not build", with the reason
 *   S5  the resolver caches nothing per query (no guess made permanent)
 *   control: the old first-match resolver picks one of two "community health" registrants without asking
 *
 * Offline, $0 (lib/pipeline/fixtures/company_tickers_subset.json). Run: npx tsx lib/pipeline/resolve.test.ts
 */
import { readFileSync } from "node:fs";
import { matchCompany } from "./resolve";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const entries = nonEmpty("the company list fixture", JSON.parse(readFileSync("lib/pipeline/fixtures/company_tickers_subset.json", "utf-8")).entries as { cik_str: number; ticker: string; title: string }[]);

const cik = matchCompany("1739940", entries), padded = matchCompany("0001739940", entries);
assert(cik.kind === "one" && cik.match.title === "Cigna Group" && padded.kind === "one" && padded.match.cik === "0001739940", `[S1] a CIK resolves directly (${cik.kind === "one" ? cik.match.title : cik.kind})`);
const tick = matchCompany("thc", entries);
assert(tick.kind === "one" && tick.match.title === "TENET HEALTHCARE CORP", `[S2] a ticker resolves by exact match, any case`);
const one = matchCompany("Molina Healthcare", entries), many = matchCompany("community health", entries);
assert(one.kind === "one" && many.kind === "choose" && many.matches.length >= 2 && many.matches.some((m) => m.ticker === "CYH") && many.matches.some((m) => m.ticker === "CHCT"), `[S3] one match resolves; "community health" offers ${many.kind === "choose" ? many.matches.map((m) => m.title).join(" | ") : many.kind}`);
const none = matchCompany("Zzyzx Unobtainium Holdings", entries);
assert(none.kind === "none" && /No SEC registrant matches/.test(none.reason), `[S4] no match: "${none.kind === "none" ? none.reason : none.kind}"`);
const src = readFileSync("lib/pipeline/resolve.ts", "utf-8");
assert(!/edgar\/cik\//.test(src) && !/cachedFetch<CikMatch>/.test(src), `[S5] the resolver caches nothing per query`);

// Control: the old resolver's rule — the first exact, else first prefix, else first all-tokens match — guesses.
const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\b(inc|incorporated|corp|corporation|co|company|holdings|holding|ltd|plc|llc|group)\b/g, "").replace(/\s+/g, " ").trim();
const target = norm("community health");
const old = entries.find((e) => norm(e.title) === target) ?? entries.find((e) => norm(e.title).startsWith(target) || target.startsWith(norm(e.title)));
assert(!!old, `[control] the old first-match resolver picks "${old?.title}" without asking`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
