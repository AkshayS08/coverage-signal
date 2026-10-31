/**
 * SESSION 27 (Akshay, Nov 1, 2026) — A SENIORITY OR SECURITY WORD LABELS A DEBT
 * ONLY WHERE ITS SENTENCE PREDICATES IT OF THAT DEBT (as Rules 57/70 do for
 * dates and figures). DaVita's refreshed card called its 6.75% notes "senior
 * secured" from "…the refinancing of Term Loan B-1 with a secured Term Loan B-2
 * facility … and issuance of the 6.75% Senior Notes…": "secured" there is the
 * term loan's, not the notes'.
 *
 * Predicated: inside the debt's own name ("6.75% senior secured notes",
 * "senior unsecured 6.75% notes"), or in a predicate about it ("the 6.75%
 * Senior Notes are senior unsecured obligations").
 *
 *   S1  DaVita's sentence does not make the 6.75% notes "secured"
 *   S2  a predicate labels: "The 6.75% Senior Notes are unsecured obligations"
 *   S3  the name labels: "our 6.75% senior secured notes due 2033"
 *   S4  every committed card of the six and the three batch refreshes: each
 *       seniority and security label taken from a sentence sits inside its
 *       debt's name or a predicate about it
 *   S5  control: the checker flags DaVita's "secured" taken from the term
 *       loan's clause
 *
 * Offline, $0. Run: npx tsx lib/cards/labelPredication.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sentenceClass, predicatedSpan } from "./labels";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const S = (sentence: string) => ({ sentence, url: "u", doc: "10-Q" });

const dva = "By comparison, the same period in 2025 included the refinancing of Term Loan B-1 with a secured Term Loan B-2 facility in the aggregate principal amount of $1,878 million and issuance of the 6.75% Senior Notes in the amount of $1,000 million.";
assert(sentenceClass("6.75% Senior Notes", [S(dva)]).security === null, `[S1] DaVita: "secured" modifying the Term Loan B-2 does not label the 6.75% notes`);
assert(sentenceClass("6.75% Senior Notes", [S("The 6.75% Senior Notes are unsecured obligations of the Company and rank equally with its other senior indebtedness.")]).security?.t === "unsecured", `[S2] a predicate labels the notes "unsecured"`);
assert(sentenceClass("6.75% Senior Notes due 2033", [S("In 2025 we issued our 6.75% senior secured notes due 2033 in the amount of $1,000 million.")]).security?.t === "secured", `[S3] the debt's own name labels it "secured"`);

/** The checker: a label from a sentence must be stated inside that debt's predicated span of the sentence. */
const txt = (l: any[]) => l.map((s: any) => s.t ?? "").join("");
function violations(card: any): string[] {
  const out: string[] = [];
  for (const r of card.v3.table.rows) {
    const name = r.name ?? txt(r.instrument);
    for (const seg of r.instrument) {
      if (seg.k !== "label" || !/^(senior|junior|subordinated|secured|unsecured|first[- ]lien|second[- ]lien)$/i.test(seg.t)) continue;
      if (!seg.src?.sentence || seg.src.sentence.replace(/\s+/g, " ").includes(name.replace(/\s+/g, " ").slice(0, 12)) && /\d[\d,]{3,}\s+\d[\d,]{3,}/.test(seg.src.sentence)) continue; // the row's own table line
      const span = predicatedSpan(seg.src.sentence, name);
      if (span === null || !span.toLowerCase().includes(String(seg.stated).toLowerCase())) out.push(`${name}: "${seg.t}" from "${seg.src.sentence.slice(0, 90)}…"`);
    }
  }
  return out;
}
const cards: [string, any][] = [
  ...(JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[]).map((c) => [`${c} committed`, JSON.parse(readFileSync(join("lib", "cards", "generated", `${c}.json`), "utf-8"))] as [string, any]),
  ...["0000070318", "0000927066", "0001108109"].map((c) => [`${c} refresh`, JSON.parse(readFileSync(join("sessions", "27", "refresh", `${c}_review_card.json`), "utf-8"))] as [string, any]),
];
for (const [label, card] of cards) {
  const v = violations(card);
  assert(v.length === 0, `[S4:${card.company} ${label.split(" ")[1]}] every sentence-sourced class label is predicated of its debt${v.length ? ` — ${v.join("; ")}` : ""}`);
}
const bad = JSON.parse(JSON.stringify(cards.find(([l]) => l === "0000927066 refresh")![1]));
const row = bad.v3.table.rows.find((r: any) => /6\.75%/.test(txt(r.instrument)));
row.instrument.splice(2, 0, { k: "label", t: "secured", stated: "secured", src: { sentence: dva, url: "u", doc: "10-Q" } }, { k: "text", t: " " });
assert(violations(bad).some((x) => /secured/.test(x)), `[S5 control] "secured" taken from the term loan's clause is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
