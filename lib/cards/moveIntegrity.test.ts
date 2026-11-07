/**
 * SESSION 27 (Akshay, Nov 1, 2026) — A REFRESH NEVER LOSES A STATED FACT.
 * Tenet's refresh regressed its moves against production: the 2027
 * redemption read "With cash on hand", the 2034 issuance "Use of the proceeds
 * stated.", the dates fell from Sept 22/23 to "Sept 2026", and the partial
 * redemption lost "$1,250MM remains".
 *
 *   M1  debt-item 8-Ks filed since the latest 10-K stay among the card's
 *       documents (for move detail), even when they predate the anchor
 *   M2  the more precise statement of the same move wins: no move card shows
 *       a month where a document the card holds states that move's day
 *   M3  no template renders a placeholder with no content ("use of the
 *       proceeds stated", "a stated source")
 *   M4  a partial retirement's move card states what remains, as the table does
 *   M5  a funding line states every source its sentence names, in order; where
 *       a source is new debt, the move is "Refinanced" and pairs with the
 *       issuance (never "cash on hand" alone)
 *   Each over all ten cards (the six committed, the four refreshes), each with
 *   a control that must fail.
 *
 * Offline, $0. Run: npx tsx lib/cards/moveIntegrity.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { moveIntegrityViolations } from "./moveIntegrity";
import { nonEmpty } from "../testing/nonEmpty";
import { shownCards } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const CIKS = nonEmpty("the published cards", read(join("lib", "cards", "generated", "index.json")).ciks as string[]);
// Nov 7: over every card that can be shown or signed (lib/cards/shownCards.ts), never only the published ones.
const cards: { label: string; card: any; input: any }[] = shownCards().map((s) => ({ label: s.label === "published" ? "committed" : "refresh", card: s.card, input: s.input }));
void CIKS;
for (const x of cards) {
  const v = moveIntegrityViolations(x.card, x.input);
  for (const k of ["M1", "M2", "M3", "M4", "M5"] as const) assert(v[k].length === 0, `[${k}:${x.card.company} ${x.label}]${v[k].length ? ` — ${v[k].join("; ")}` : " holds"}`);
}

console.log("\n=== controls (Tenet's refresh, each defect re-introduced) ===");
const ten = cards.find((x) => x.label === "refresh" && x.card.cik === "0000070318")!;
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const c1 = clone(ten.input); c1.debtEightKs = [...(c1.debtEightKs ?? []), { form: "8-K", filingDate: "2026-09-08", items: "8.01", url: "https://example.invalid/8k.htm" }];
assert(moveIntegrityViolations(ten.card, c1).M1.length > 0, `[M1 control] a debt-item 8-K since the 10-K missing from the documents is flagged`);
const c2 = clone(ten.card); for (const m of c2.v3.moves) for (const s of m.meta) if (s.k === "label" && /Sept(ember)? 2[23], 2026/.test(s.t)) { s.t = "Sept 2026"; s.stated = "September 2026"; }
assert(moveIntegrityViolations(c2, ten.input).M2.length > 0, `[M2 control] "Sept 2026" where a held document states the day is flagged`);
const c3 = clone(ten.card); c3.v3.moves[0].detail = [{ k: "label", t: "use of the proceeds stated", stated: "finance", src: { sentence: "x", url: "u", doc: "d" } }];
assert(moveIntegrityViolations(c3, ten.input).M3.length > 0, `[M3 control] a placeholder with no content is flagged`);
const c4 = clone(ten.card); for (const m of c4.v3.moves) { for (const l of m.title) for (const s of l) if (typeof s.t === "string") s.t = s.t.replace(/\s*·\s*$/, ""); m.title = m.title.map((l: any[]) => l.filter((s: any) => !/remains/.test(s.t ?? "") && !(s.k === "computed" && /1,250/.test(s.t ?? "")))); if (m.retires) m.retires.items = m.retires.items.map((l: any[]) => l.filter((s: any) => !/remains/.test(s.t ?? "") && !(s.k === "computed" && /1,250/.test(s.t ?? "")))); }
assert(moveIntegrityViolations(c4, ten.input).M4.length > 0, `[M4 control] the partial redemption without "remains" is flagged`);
const c5 = clone(ten.card); c5.v3.moves = [{ meta: [{ k: "text", t: "Sept 23, 2026 · Redeemed" }], title: [[{ k: "text", t: "$1,500MM 5.125% senior secured first lien notes due November 2027" }]], detail: [{ k: "text", t: "With " }, { k: "label", t: "cash on hand", stated: "cash on hand", src: { sentence: "We used the net issuance proceeds, together with cash on hand, to finance the redemption of all $ 1.500 billion in aggregate principal amount of our 5.125 % senior secured first lien notes due November 2027", url: "u", doc: "10-Q" } }, { k: "text", t: "." }], retires: null }];
assert(moveIntegrityViolations(c5, ten.input).M5.length > 0, `[M5 control] a funding line keeping only "cash on hand" is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
