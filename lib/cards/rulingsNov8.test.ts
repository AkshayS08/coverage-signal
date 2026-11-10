/**
 * SESSION 27 (Akshay, Nov 8, 2026) — OVER EVERY CARD THAT CAN BE SHOWN OR SIGNED (lib/cards/shownCards.ts).
 *
 *   NS  "not stated" is forbidden where any read sentence states an amount for that item; stated as of another date
 *       it reads "stated only as of [date] in [form]; not shown". Encompass's L/C: "stated only as of March 9, 2026 in
 *       an 8-K; not shown"
 *   RT  refresh fact retention: a move fact on the prior card that disappears from the refreshed card while its move
 *       is still shown fails, unless a newer filing in the read set supersedes it (states that fact differently)
 *   VB  a revolver or facility repayment reads "repaid", never "redeemed"; every move line is sentence case
 *
 * Offline, $0. Run: npx tsx lib/cards/rulingsNov8.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shownCards, everyShownCard } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";
import { readSetStatement, type ReadSetItem } from "./readSetStatements";
import { couponsIn } from "./labels";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const docsOf = (input: any) => Object.entries(input.docs as Record<string, { text: string }>).map(([url, d]) => ({ url, text: d.text }));

/** NS: no "not stated" for an item a read sentence states an amount for. */
const NS_ITEMS: [RegExp, ReadSetItem][] = [[/letters of credit outstanding not stated/i, "lettersOfCredit"], [/availability not stated/i, "available"], [/\bdrawn not stated/i, "drawn"]];
function ns(card: any, input: any): string[] {
  const out: string[] = [];
  const lines = (card.v3.facilities ?? []).flatMap((f: any) => [f.bold, f.sub ?? []]);
  for (const l of lines) for (const [re, item] of NS_ITEMS) if (re.test(txt(l))) {
    const st = readSetStatement(item, docsOf(input));
    if (st) out.push(`"${txt(l).match(re)![0]}", but a read sentence states ${st.amount}${st.asOf ? ` as of ${st.asOf}` : ""}: "${st.sentence.slice(0, 90)}…"`);
  }
  return out;
}

/** RT: a prior card's move facts that the refreshed card no longer shows for the same move. */
const moveKey = (m: any) => { const title = txt(m.title[0]); const c = couponsIn(title)[0]?.rate; return `${(/· ([A-Za-z]+)/.exec(txt(m.meta)) ?? [])[1] ?? ""}|${(/\$([\d,.]+)MM/.exec(title) ?? [])[1] ?? ""}|${c ?? title.slice(0, 30)}`; };
const factsOf = (m: any): string[] => {
  const lines = txt(m.detail);
  return [...lines.matchAll(/\b\d{2,3}(?:\.\d+)?% of principal\b|adding to the existing notes|[Uu]sed to (?:repay|redeem|fund|finance)[^.]*/g)].map((x) => x[0]);
};
const retained = (fact: string, m: any) => {
  const all = [txt(m.meta), ...m.title.map(txt), txt(m.detail), ...(m.retires ? [txt(m.retires.meta), ...m.retires.items.map(txt)] : [])].join(" ");
  if (/^[Uu]sed to repay[^.]*revolver/.test(fact)) return /revolver/i.test(all) && /repa(?:y|id)/i.test(all);
  return all.includes(fact);
};
function rt(prior: any, next: any, input: any): string[] {
  const out: string[] = [];
  const text = docsOf(input).map((d) => d.text.replace(/[\s ]+/g, " ")).join(" ");
  for (const pm of prior.v3.moves) {
    const nm = next.v3.moves.find((x: any) => moveKey(x) === moveKey(pm));
    if (!nm) continue; // the move is no longer shown
    for (const f of factsOf(pm)) {
      if (retained(f, nm)) continue;
      // Superseded: a newer filing in the read set states this fact differently (another price for the same issue).
      const pct = (/(\d{2,3}(?:\.\d+)?)%/.exec(f) ?? [])[1];
      const restated = pct ? new RegExp(`\\b${pct.replace(".", "\\.")}\\s?%`).test(text) : true;
      if (restated) out.push(`${txt(nm.meta)} "${txt(nm.title[0])}": "${f}" is gone, and the read set still states it`);
    }
  }
  return out;
}

/** VB: facility repayments read "repaid"; every move line is sentence case. */
const FACILITY = /\brevolv|credit facility|line of credit|term loan\b/i;
function vb(card: any): string[] {
  const out: string[] = [];
  for (const m of card.v3.moves) {
    const lines = [m.meta, ...m.title, ...(m.detail ? [m.detail] : []), ...(m.retires ? [m.retires.meta, ...m.retires.items] : [])].map(txt).filter(Boolean);
    for (const l of lines) if (!/^[A-Z$~<\d(]/.test(l.trim())) out.push(`"${l}" is not sentence case`);
    if (m.retires && m.retires.items.every((i: any) => FACILITY.test(txt(i)) && !couponsIn(txt(i)).length) && /\bredeemed\b/i.test(txt(m.retires.meta))) out.push(`"${txt(m.retires.meta)}": a facility repayment reads "repaid", never "redeemed"`);
    if (!m.retires && /Redeemed/.test(txt(m.meta)) && FACILITY.test(txt(m.title[0])) && !couponsIn(txt(m.title[0])).length) out.push(`"${txt(m.meta)}": a facility repayment reads "repaid"`);
  }
  return out;
}

const shown = nonEmpty("the cards that can be shown or signed", shownCards());
console.log(`=== NS, VB over the ${shown.length} cards; RT over each review render against the card it would replace ===`);
for (const s of shown) {
  const tag = `${s.card.company} ${s.label}`;
  const a = ns(s.card, s.input), c = vb(s.card);
  assert(a.length === 0, `[NS:${tag}]${a.length ? ` — ${a.join("; ")}` : " holds"}`);
  assert(c.length === 0, `[VB:${tag}]${c.length ? ` — ${c.join("; ")}` : " holds"}`);
  if (s.label === "review") {
    const prior = JSON.parse(readFileSync(join("lib", "cards", "generated", `${s.cik}.json`), "utf-8"));
    const b = rt(prior, s.card, s.input);
    assert(b.length === 0, `[RT:${tag}] against the published card${b.length ? ` — ${b.join("; ")}` : " holds"}`);
  }
}
const encShown = shown.find((s) => s.cik === "0000785161" && s.label === "review");
if (encShown) {
  const lc = (encShown.card.v3.facilities ?? []).map((f: any) => txt(f.sub)).join(" ");
  assert(/Letters of credit outstanding: stated only as of March 9, 2026 in an 8-K; not shown\./.test(lc), `[NS] Encompass reads "Letters of credit outstanding: stated only as of March 9, 2026 in an 8-K; not shown." ("${lc.slice(0, 160)}")`);
  const aug = encShown.card.v3.moves.find((m: any) => /Aug 13, 2026 · Issued/.test(txt(m.meta)));
  assert(!!aug && /Issued at 98\.75% of principal, adding to the existing notes/.test(txt(aug.detail)), `[RT] Encompass's Aug 13 issue reads "Issued at 98.75% of principal, adding to the existing notes" ("${aug ? txt(aug.detail) : "no move"}")`);
  const mayIss = encShown.card.v3.moves.find((m: any) => /May 29, 2026 · Issued/.test(txt(m.meta)));
  assert(!!mayIss && !/98\.75%|adding to the existing notes/.test(txt(mayIss.detail)), `[RT] and the May 29 issue (at par) does not take the add-on's price or wording ("${mayIss ? txt(mayIss.detail) : "no move"}")`);
} else console.log(`  — NOT IN SCOPE (SHOWN_SCOPE=${process.env.SHOWN_SCOPE}): [NS], [RT] Encompass's review card`);
// Control material: read from every card, whatever the scope (releaseGate.test R4).
const enc = everyShownCard().find((s) => s.cik === "0000785161" && s.label === "review") as any;

console.log("\n=== controls ===");
const c1 = clone(enc.card); for (const f of c1.v3.facilities) if (f.sub) f.sub = [...f.sub.filter((x: any) => !/Letters of credit/.test(x.t ?? "")), { k: "notStated", t: "Letters of credit outstanding not stated." }];
assert(ns(c1, enc.input).length > 0, `[NS control] "Letters of credit outstanding not stated." on Encompass's refresh is flagged`);
const prior = JSON.parse(readFileSync(join("lib", "cards", "generated", "0000785161.json"), "utf-8"));
const c2 = clone(enc.card); for (const m of c2.v3.moves) if (/Aug 13, 2026 · Issued/.test(txt(m.meta))) m.detail = null;
assert(rt(prior, c2, enc.input).length > 0, `[RT control] the Aug 13 issue without its price and add-on is flagged`);
const c3 = clone(enc.card); c3.v3.moves.push({ meta: [{ k: "text", t: "Refinanced · redeemed Aug 2026" }], title: [[{ k: "text", t: "$100MM 5.875% senior notes due June 1, 2034" }]], detail: null, retires: { meta: [{ k: "text", t: "Refinanced · redeemed Aug 2026" }], items: [[{ k: "text", t: "of the revolver, repaid" }]] } });
assert(vb(c3).length >= 2, `[VB control] "redeemed" for a revolver repayment and a lower-case "of the revolver" are flagged (${vb(c3).length})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
