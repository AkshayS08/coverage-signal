/**
 * SESSION 27 (Akshay, Oct 23, 2026) — THE NAME CHECK.
 *
 * A displayed instrument name is compared with its cited sentence
 * case-insensitively, whitespace normalised. A name not found there renders
 * as the plain instrument type with its link, never the model's paraphrase.
 *
 *   M1  verbatimNameSegments keeps every label segment its sentence contains
 *       (case and spacing aside): "Commercial Paper" in "commercial paper program"
 *   M2  a paraphrase its sentence does not contain becomes the plain type,
 *       linked to the same sentence where the type word appears in it
 *   M3  over all six cards (committed inputs) and the v33 replay cards: every
 *       table row's name passes the check after rendering
 *   M4  the same rule for a roll-forward delta's label (Cigna, Oct 23 ruling
 *       (a)): "$ 550 million, 1.250 % Notes due March 2026" is not in its
 *       sentence ("…repaid $ 550 million 1.250 % senior notes that matured in
 *       March 2026"), so it renders as the plain type as the sentence prints
 *       it; a label the sentence contains is kept. Over every rolled delta of
 *       the six (v31 and v33): each delta's label is in its own sentence
 *   control: the paraphrase itself fails the check
 *
 * Offline, $0. Run: npx tsx lib/cards/nameCheck.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as build from "./build";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const verbatimNameSegments = (build as any).verbatimNameSegments as ((segs: any[], instrument: string) => any[]) | undefined;
// Whitespace removed, as in acceptance N1: the HTML-to-text spacing prints "3.400 %" for 3.400%.
const nameIn = (stated: string, sentence: string) => sentence.replace(/\s+/g, "").toLowerCase().includes(stated.replace(/\s+/g, "").toLowerCase());

const cpSentence = "The commercial paper program had approximately $ 1.0 billion outstanding as of June 30, 2026 and an average interest rate of 3.92 %.";
const rvSentence = "The Company maintains a $ 6.5 billion, five-year revolving credit and letter of credit agreement that will mature in April 2030.";
console.log("\n=== M1-M2 ===");
const kept = verbatimNameSegments?.([{ k: "label", t: "commercial paper", stated: "Commercial Paper", src: { sentence: cpSentence, url: "u" } }], "Commercial Paper Program");
assert(!!kept && kept[0].k === "label" && kept[0].stated === "Commercial Paper", `[M1] "Commercial Paper" is kept: its sentence says "commercial paper"`);
const para = [{ k: "label", t: "Revolving Credit Agreement", stated: "Revolving Credit Agreement", src: { sentence: rvSentence, url: "u" } }];
assert(!nameIn(para[0].stated, rvSentence), `[control] "Revolving Credit Agreement" is not in its sentence`);
const fixed = verbatimNameSegments?.(para, "Revolving Credit Agreement");
assert(!!fixed && fixed.length === 1 && fixed[0].t === "revolver" && fixed[0].k === "label" && nameIn(fixed[0].stated, rvSentence) && fixed[0].src.sentence === rvSentence, `[M2] the paraphrase renders as the plain type "revolver", linked to the same sentence (stated "${fixed?.[0]?.stated}")`);
const noWord = verbatimNameSegments?.([{ k: "label", t: "Funding Line", stated: "Funding Line", src: { sentence: "The Company has a $50 million arrangement.", url: "u" } }], "Funding Line");
assert(!!noWord && noWord.every((x: any) => x.k !== "label" || nameIn(x.stated, x.src.sentence)), `[M2] where even the type word is not in the sentence, nothing unverbatim is shown as a linked name ("${noWord?.map((x: any) => x.t).join("")}")`);

console.log("\n=== M3: every table row name on the six cards, committed and v33 ===");
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const week = JSON.parse(readFileSync("lib/cards/inputs/week/2026-10-15.json", "utf-8"));
const replay = { results: nonEmpty("the v33 replay samples (baselines/s27-replay.json)", existsSync("baselines/s27-replay.json") ? JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")).results : null) };
for (const cik of CIKS) {
  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
  const factsPath = join("lib", "cards", "inputs", "facts", `${cik}.json`);
  const w = week.names[cik];
  for (const [label, result] of [["committed", snap.result], ["v33", replay.results.find((x: any) => x.result.cik === cik)?.result]] as const) {
    if (!result) continue;
    const card = build.buildCard({ result, briefDate: "2026-10-15", previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= "2026-10-15").map((x: any) => x.url), facts: existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf-8")) : null } as any);
    const bad = card.v3!.table.rows.flatMap((r) => r.instrument as any[]).filter((x) => x.k === "label" && !nameIn(x.stated, x.src.sentence));
    assert(bad.length === 0, `[M3:${snap.company} ${label}] every table name is in its sentence${bad.length ? `: ${bad.map((x) => `"${x.stated}"`).join(", ")}` : ""}`);
  }
}

(async () => {
console.log("\n=== M4: roll-forward delta labels ===");
const nameRule = await import("../events/nameRule").catch(() => null) as any;
const deltaSentence = "During the six months ended June 30, 2026, the Company repaid $ 550 million 1.250 % senior notes that matured in March 2026.";
const fixedLabel = nameRule?.nameOrPlainType?.("$ 550 million, 1.250 % Notes due March 2026", deltaSentence);
assert(!!fixedLabel && nameIn(fixedLabel, deltaSentence) && fixedLabel !== "$ 550 million, 1.250 % Notes due March 2026", `[M4] the paraphrased delta label renders as the plain type the sentence prints ("${fixedLabel}")`);
assert(nameRule?.nameOrPlainType?.("1.250 % senior notes", deltaSentence) === "1.250 % senior notes", `[M4] a delta label its sentence contains is kept`);
const { deriveGoldenState } = await import("../events/golden");
for (const cik of CIKS) {
  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
  for (const [label, result] of [["v31", snap.result], ["v33", replay.results.find((x: any) => x.result.cik === cik)?.result]] as const) {
    if (!result) continue;
    const st: any = deriveGoldenState(result, new Date("2026-10-15T00:00:00Z"));
    // Session 27 (Akshay, Oct 29): a delta's label is BUILT FROM ITS IDENTITY (coupon, type, maturity), and passes the name rule
    // as such; the words it links to are the sentence's own span.
    const rd = await import("../events/rollDeltas");
    for (const d of st.rolled?.deltas ?? []) {
      const span = rd.deltaStatedSpan(d);
      assert(rd.deltaLabelPasses(d) && d.instrument === rd.deltaLabelOf(d) && (span === null || nameIn(span, d.sourceLine)), `[M4:${snap.company} ${label}] delta "${d.instrument}" is built from its identity, and its stated span${span ? ` "${span}"` : ""} is in its sentence`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
})();
