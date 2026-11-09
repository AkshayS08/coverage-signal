/**
 * SESSION 27 (Akshay, Nov 7, 2026) — ENCOMPASS'S REFRESH, THREE RULES OVER THE CLASS, OVER EVERY CARD THAT CAN BE SHOWN
 * OR SIGNED (lib/cards/shownCards.ts: the published brief and every review render).
 *
 *   T1  a referring phrase ("this borrowing", "this offering", "the Notes") resolves to the issuance named in the same
 *       sentence or, failing that, the nearest preceding sentence naming one in the same paragraph; a retirement it
 *       funds pairs with that issuance, never another. (The stored filing text carries no paragraph breaks: the
 *       paragraph is read as at most three sentences back, stopping at a note heading.)
 *   T2  amount guard: retirements paired to an issuance whose funding sentence names new debt as its only source may
 *       not exceed its stated proceeds (or face times issue price, or face)
 *   T3  an issuance of additional notes of an existing instrument (same coupon and maturity, stated as additional or an
 *       add-on) increases that instrument's face: Encompass's 5.875% 2034 notes read $600MM
 *   T4  a named instrument's carrying value may not exceed its face beyond a stated premium
 *   T5  every per-card acceptance and rulings suite runs over every card that can be shown or signed
 *
 * Offline, $0. Run: npx tsx lib/cards/rulingsNov7.test.ts
 */
import { readFileSync } from "node:fs";
import { couponsIn } from "./labels";
import { shownCards } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";
import { COMPLETED, NOT_DONE, usdIn } from "./refreshRulings";
import { scaledAmountString, locatorFor } from "../agent/tableScale";
import { parseMoneyAmount } from "../events/position";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const norm = (s: string) => s.replace(/[\s ]+/g, " ");
const sentencesOf = (text: string) => norm(text).split(/(?<=[.;])\s+(?=[A-Z(“"])/).filter((x) => x.length < 900);
export const REFERRING = /\b(?:this|the) (?:borrowing|offering|issuance)\b|\bthe Notes\b/;
const HEADING = /^\d{1,2}\.\s+[A-Z][a-z]+/;
const FUNDS = /\b(?:used|use|finance[ds]?|fund(?:ed|s)?)\b/i;
const REVOLVER = /revolving|revolver|credit facility|line of credit/i;

/** The issuances a sentence names as done: each as { face, coupon?, year? }. */
function issuesIn(s: string): { face: number; coupon?: number; year?: string }[] {
  if (!COMPLETED.test(s) || /\bmay\s+[a-z]|\bintends?\b/.test(s)) return [];
  const out: { face: number; coupon?: number; year?: string }[] = [];
  // A decimal point inside a coupon ("5.875 %") is not a sentence end; a face may be printed in dollars ("$2,000,000,000").
  for (const m of s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)?\s+(?:in aggregate principal amount\s+)?of\s+(?:our\s+|its\s+)?(?:existing\s+)?((?:[^.;]|\.(?=\d)){0,80}?\bNotes\b)/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    const face = m[2] ? n * (/billion/i.test(m[2]) ? 1e9 : 1e6) : n;
    if (face < 1e6) continue;
    out.push({ face, coupon: couponsIn(m[3])[0]?.rate, year: (/\b(20\d\d)\b/.exec(m[3]) ?? [])[1] });
  }
  return out;
}

/** T1: the antecedent of a referring funding sentence, in its own document. */
function antecedent(sentences: string[], at: number): { face: number; coupon?: number; year?: string }[] | null {
  const own = issuesIn(sentences[at]);
  if (own.length) return own;
  for (let k = at - 1; k >= Math.max(0, at - 3); k--) {
    if (HEADING.test(sentences[k + 1] ?? "") && k + 1 !== at) break;
    const found = issuesIn(sentences[k]);
    if (found.length) return found;
    if (HEADING.test(sentences[k])) break;
  }
  return null;
}

/** T1 over one card: every retirement in a pair whose funding sentence refers resolves to the pair's own issuance. */
function t1(card: any, input: any): string[] {
  const out: string[] = [];
  const docs = Object.values(input.docs as Record<string, { text: string }>).map((d) => sentencesOf(d.text));
  for (const mv of card.v3.moves.filter((m: any) => m.retires)) {
    const issFace = parseMoneyAmount(String((txt(mv.title[0]).match(/\$[\d,.]+(?:MM|B)/) ?? [""])[0]).replace("MM", " million").replace("B", " billion")) ?? 0;
    for (const item of mv.retires.items) {
      const line = txt(item);
      const amt = (/\$([\d,.]+)MM/.exec(line) ?? [])[1];
      const facility = REVOLVER.test(line) && !couponsIn(line).length;
      for (const ss of docs) ss.forEach((s, n) => {
        // A sentence stating the use done (an intention funds nothing yet), naming this retirement: a note by its coupon
        // and maturity year, a facility by its kind and its amount (or, without one, a repayment of no stated amount).
        if (!FUNDS.test(s) || !REFERRING.test(s) || NOT_DONE.test(s)) return;
        const year = (/\b(20\d\d)\b/.exec(line) ?? [])[1];
        const states = facility
          ? REVOLVER.test(s) && /\brepa(?:y|id)\b/i.test(s) && (amt ? usdIn(s).some((u) => Math.abs(u / 1e6 - Number(amt.replace(/,/g, ""))) < 0.5) : !usdIn(s.split(/\brepa(?:y|id)\b/i).slice(1).join(" ")).length)
          : couponsIn(line).some((c) => couponsIn(s).some((d) => Math.abs(c.rate - d.rate) < 1e-9)) && !!year && s.includes(year);
        if (!states) return;
        const a = antecedent(ss, n);
        // No antecedent, or more than one: this sentence identifies no issuance, so it is no evidence for any pairing.
        if (!a || a.length !== 1) return;
        if (Math.abs(a[0].face - issFace) > 0.5e6) out.push(`"${line}" is paired with the $${issFace / 1e6}MM issue, but "${s.slice(0, 70)}…" refers to the $${a[0].face / 1e6}MM issue`);
      });
    }
  }
  return out;
}

/** T2: where new debt is the only stated source, the paired retirements stay within the issue's proceeds. */
function t2(card: any): string[] {
  const out: string[] = [];
  for (const mv of card.v3.moves.filter((m: any) => m.retires)) {
    const funding = mv.retires.meta.map((s: any) => s.src?.sentence).find((x: any) => typeof x === "string") ?? "";
    if (/cash on hand|borrowings under|together with|and other/i.test(funding) || /cash on hand/i.test(txt(mv.retires.meta))) continue;
    const title = txt(mv.title[0]);
    const face = Number(((/\$([\d,.]+)MM/.exec(title) ?? [])[1] ?? "0").replace(/,/g, ""));
    const proceeds = (/approximately\s+\$\s?([\d,.]+)\s*million in net proceeds/i.exec(funding) ?? [])[1];
    const price = (/(\d{2,3}(?:\.\d+)?)\s?% of (?:the )?principal/i.exec(txt(mv.detail)) ?? [])[1];
    const cap = proceeds ? Number(proceeds.replace(/,/g, "")) : price ? face * Number(price) / 100 : face;
    const retired = mv.retires.items.reduce((a: number, l: any) => a + Number(((/\$([\d,.]+)MM/.exec(txt(l)) ?? [])[1] ?? "0").replace(/,/g, "")), 0);
    if (retired > cap + 0.5) out.push(`"${title}" funds $${retired}MM of retirements from new debt alone, beyond its $${cap}MM`);
  }
  return out;
}

/** T4: a table row's face against its carrying value in the anchor's schedule (beyond a stated premium). */
function t4(card: any, input: any): string[] {
  const out: string[] = [];
  const dm = input.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const anchorText = input.docs[dm.debtScheduleSourceFiling.url]?.text ?? "";
  const loc = locatorFor(anchorText);
  for (const r of card.v3.table.rows) {
    if (!r.face || /carrying value/i.test(txt([r.face])) || typeof r.face.usd !== "number" && r.face.k !== "figure") continue;
    const face = typeof r.face.usd === "number" ? r.face.usd : parseMoneyAmount(r.face.printed) ?? 0;
    const row = (dm.scheduleSequence ?? []).find((e: any) => e.kind === "row" && e.label === r.name);
    if (!row || !face) continue;
    const carrying = parseMoneyAmount(scaledAmountString(String(row.amount), row.sourceLine ?? "", anchorText, loc));
    if (carrying === null) continue;
    const premium = Math.max(1, ...Object.values(input.docs as Record<string, { text: string }>).flatMap((d) => [...norm(d.text).matchAll(/price of (\d{3}(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]) / 100)));
    if (carrying > face * premium + 0.5e6) out.push(`${r.name}: carrying $${(carrying / 1e6).toLocaleString("en-US")}MM exceeds its face $${(face / 1e6).toLocaleString("en-US")}MM`);
  }
  return out;
}

const shown = nonEmpty("the cards that can be shown or signed", shownCards());
console.log(`=== T1-T4 over the ${shown.length} cards that can be shown or signed ===`);
for (const s of shown) {
  const tag = `${s.card.company} ${s.label}`;
  for (const [id, v] of [["T1", t1(s.card, s.input)], ["T2", t2(s.card)], ["T4", t4(s.card, s.input)]] as const) assert(v.length === 0, `[${id}:${tag}]${v.length ? ` — ${v.join("; ")}` : " holds"}`);
}
const enc = shown.find((s) => s.cik === "0000785161" && s.label === "review")!;
const row = enc.card.v3.table.rows.find((r: any) => /5\.875/.test(r.name));
assert(!!row && /^600$/.test(txt([row.face])), `[T3] Encompass's 5.875% 2034 notes read 600 in the table ("${row ? txt([row.face]) : "no row"}")`);
const seg = enc.card.v3.totalDebt.legend.map((l: any) => `${txt(l.label)} ${txt([l.amount])}`).join(" | ");
assert(/senior (?:unsecured )?notes \$1,000MM/i.test(seg), `[T3] and $1,000MM of senior notes in the total-debt segments (400 + 600): "${seg}"`);

console.log("\n=== controls ===");
// T1/T2 control: Encompass's Q3 pairing as rendered on Nov 6 (the Aug revolver repayment attached to the May issue).
const bad = clone(enc.card); const may = bad.v3.moves.find((m: any) => /May 29, 2026 · Issued/.test(txt(m.meta)));
may.retires.items = [[{ k: "text", t: "$400MM 4.50% senior notes due 2028 · $400MM remains" }], [{ k: "text", t: "$100MM of the revolver, repaid" }], [{ k: "text", t: "of the revolver, repaid" }]];
assert(t1(bad, enc.input).length > 0, `[T1 control] the Aug revolver repayment attached to the May issue fails: ${t1(bad, enc.input)[0]?.slice(0, 160)}`);
const sole = clone(enc.card); const p = sole.v3.moves.find((m: any) => m.retires);
p.retires.meta = [{ k: "text", t: "Refinanced · redeemed May 2026, funded by the new notes" }];
p.retires.items = [[{ k: "text", t: "$400MM 4.50% senior notes due 2028" }], [{ k: "text", t: "$200MM of the revolver, repaid" }]];
assert(t2(sole).length > 0, `[T2 control] $600MM retired from a $500MM issue's proceeds alone fails: ${t2(sole)[0]}`);
const c4 = clone(enc.card); for (const r of c4.v3.table.rows) if (/5\.875/.test(r.name)) { r.face = { k: "computed", t: "500", usd: 500e6, parts: [] }; }
assert(t4(c4, enc.input).length > 0, `[T4 control] the 5.875% notes at $500MM face against $588.2MM carrying fail: ${t4(c4, enc.input)[0]}`);

console.log("\n=== T5: check scope ===");
const SUITES = ["lib/cards/acceptance.test.ts", "lib/cards/refreshRulings.test.ts", "lib/cards/rulingsNov4.test.ts", "lib/cards/rulingsNov7.test.ts", "lib/cards/moveIntegrity.test.ts", "lib/cards/possibleMoves.test.ts", "lib/cards/falseNotStated.test.ts", "lib/cards/retirementBalance.test.ts", "lib/cards/labelPredication.test.ts", "lib/cards/subFacilityScale.test.ts", "lib/cards/annualReportSource.test.ts", "lib/cards/rawAmount.test.ts"];
const narrow = SUITES.filter((f) => !/shownCards\(\)/.test(readFileSync(f, "utf-8")));
assert(narrow.length === 0, `[T5] every per-card acceptance and rulings suite runs over shownCards() (${narrow.length} not: ${narrow.join(", ")})`);
const fake = `const CIKS = JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks;`;
assert(!/shownCards\(\)/.test(fake), `[T5 control] a suite over the published cards only is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
