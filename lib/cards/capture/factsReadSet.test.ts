/**
 * SESSION 27 (Akshay, Nov 16): ADOPTED FACTS ARE VALID ONLY FOR THE READ SET THEY WERE READ FROM, NOT JUST THE ANCHOR.
 * When a build's read set differs from the facts' read set, the facts stage must run; until it does, the moves section
 * renders "not yet read" and the badge cannot be Checks passed.
 *
 * A read set is the documents read (EDGAR filings do not change once filed, so their URLs name them): one key, shared by
 * the facts cache key, the facts a stage writes, adopted facts, the card and the badge (factsValidity.ts).
 *   F1  today's CHS build (read set after the Nov 10 trigger): production's CHS facts, read over its earlier read set,
 *       are not valid; the build gets no adopted facts
 *   F2  production (Nov 21, since the Nov 20 adoption): every published card's facts were read over its read set. Before it,
 *       none was: each facts input held fewer documents than the read set (factsDocs.test S7), and Cigna's (Oct 16, a
 *       v31 input) recorded none
 *   F3  a card given facts read over another read set renders "Debt moves this year: not yet read"
 *   F4  without facts read for its read set, the badge is neither Checks passed nor Signed
 *   F5  the key is the documents: Molina's two captures read the same documents under different extraction
 *       fingerprints, and have one key
 *   control: the anchor-only rule (today's CHS build) serves production's CHS facts to the new read set
 *
 * Offline, $0. Run: npx tsx lib/cards/capture/factsReadSet.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { factsForBuild } from "./factsForBuild";
import { factsReadSetOf, factsValidFor } from "../factsValidity";
import { buildCard } from "../build";
import { decideBadge } from "../../pipeline/badge";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const anchorOf = (input: any) => input.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;

const chsToday = read("sessions/27/chs_refresh/input.json");
// Nov 21 (Akshay): F1, F3 and the control compare today's CHS build with the CHS facts production had before the Nov 20
// adoption, pinned to the commit before it (c0c285c~1).
const chsFacts = JSON.parse(execSync("git show c0c285c~1:lib/cards/inputs/facts/0001108109.json", { encoding: "utf-8", maxBuffer: 64e6 }));
// Nov 21: F1 judges the pinned pre-adoption facts; factsForBuild now serves the facts adopted Nov 20, read over this read set.
assert(!factsValidFor(chsFacts, chsToday.result, anchorOf(chsToday)), `[F1] today's CHS build (read set ${factsReadSetOf(chsToday.result)?.slice(0, 8)}): the facts production had before Nov 20 (read over ${String(chsFacts.readSet).slice(0, 8)}) are not valid for it`);

// Nov 21: since the Nov 20 adoption, every published card's facts were read over its read set.
const valid = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
for (const cik of [...valid, "0001739940"]) {
  const input = read(`lib/cards/inputs/${cik}.json`);
  const ok = factsForBuild(input).source === "adopted";
  assert(ok === valid.includes(cik), `[F2:${cik}] production facts valid for its card's read set: ${ok}`);
}

const BRIEF = "2026-11-16";
const week = (chsToday.laterFilings ?? []).filter((f: any) => f.filingDate >= "2026-11-10" && f.filingDate <= BRIEF).map((f: any) => ({ form: f.form, filingDate: f.filingDate, items: f.items ?? "", primaryDocUrl: f.url, accessionNumber: "", reportDate: "", primaryDocument: "" }));
const card = buildCard({ result: chsToday.result, briefDate: BRIEF, previousBrief: null, weekFilings: week, cash: chsToday.cash, textByUrl: new Map(Object.entries(chsToday.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: chsToday.periodSentence, laterUrls: (chsToday.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts: chsFacts });
const v3 = card.v3!;
assert(/Debt moves this year: not yet read/.test(txt(v3.movesUnread)) && v3.moves.length === 0, `[F3] given facts read over another read set, the card says "${txt(v3.movesUnread)}" and shows ${v3.moves.length} moves`);

const base = { stoppedAt: null, goldenReproduces: false, cardChecksFailed: false, failures: [], samplesReproducing: 3, samples: 3 };
const noFacts = decideBadge({ ...base, factsRead: false }), noFactsSigned = decideBadge({ ...base, goldenReproduces: true, factsRead: false });
assert(noFacts.badge !== "checks-passed" && noFactsSigned.badge !== "signed" && decideBadge({ ...base, factsRead: true }).badge === "checks-passed", `[F4] facts not read for the read set: ${noFacts.badge} (${noFacts.reasons.join("; ")}); with a reproducing golden: ${noFactsSigned.badge}`);

const molThen = JSON.parse(execSync("git show ee071dd:sessions/27/molina_review_input.json", { encoding: "utf-8", maxBuffer: 64e6 }));
const molNow = read("lib/cards/inputs/0001179929.json");
assert(molThen.corpusFingerprint !== molNow.corpusFingerprint && factsReadSetOf(molThen.result) === factsReadSetOf(molNow.result), `[F5] Molina: extraction fingerprints ${molThen.corpusFingerprint.slice(0, 8)} / ${molNow.corpusFingerprint.slice(0, 8)}; one documents key ${factsReadSetOf(molNow.result)?.slice(0, 8)}`);

// Control: the anchor-only rule, which today's CHS build applied.
const anchorOnly = chsFacts.anchorUrl === anchorOf(chsToday);
assert(anchorOnly && factsReadSetOf(chsToday.result) !== chsFacts.readSet, `[control] by anchor alone, production's CHS facts are served to a read set they were not read from`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
