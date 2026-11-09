/**
 * SESSION 27 (Akshay, Nov 9, 2026) — THE REFINANCED TILE WHEN PART OF THE SAME INSTRUMENT WAS REFINANCED EARLIER.
 *
 * Encompass's call box reads "$400MM of 4.50% senior notes due 2028 are not yet refinanced; the other $400MM was
 * refinanced in May 2026", while its Refinanced tile read "$0 · None stated in any filing": true of the remainder, but
 * it reads as though nothing was ever refinanced. Where an instrument due in the window was partly refinanced earlier,
 * the $0 tile reads "$0 · None of the remaining $400MM", the remaining amount being the Due-in-window figure.
 *   F1  over every card that can be shown or signed: a $0 Refinanced tile beside an earlier partial refinancing reads
 *       "None of the remaining [due]"; without one it reads "None stated in any filing"
 *   F2  Encompass reads "None of the remaining $400MM"
 *   F3  control: Encompass with the old wording fails
 *
 * Offline, $0. Run: npx tsx lib/cards/refinancedTile.test.ts
 */
import { shownCards } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any) => (Array.isArray(l) ? l : l ? [l] : []).map((s: any) => s.t ?? s.printed ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));

function f1(card: any): string[] {
  const tiles = card.v3.call.tiles ?? [];
  const refi = tiles.find((x: any) => x.key === "refinanced"), due = tiles.find((x: any) => x.key === "due");
  if (!refi || refi.usd !== 0 || !due) return [];
  const partly = (card.v3.call.rows ?? []).some((r: any) => /refinanced · .*remains/i.test(txt(r.tag?.text)));
  const sub = txt(refi.sub);
  if (partly && sub !== `None of the remaining ${txt(due.value)}`) return [`the $0 Refinanced tile reads "${sub}" beside an earlier partial refinancing; it should read "None of the remaining ${txt(due.value)}"`];
  if (!partly && sub !== "None stated in any filing") return [`the $0 Refinanced tile reads "${sub}" with no earlier refinancing`];
  return [];
}

const shown = nonEmpty("the cards that can be shown or signed", shownCards());
for (const s of shown) { const v = f1(s.card); assert(v.length === 0, `[F1:${s.card.company} ${s.label}]${v.length ? ` — ${v.join("; ")}` : " holds"}`); }
const enc = shown.find((s) => s.cik === "0000785161" && s.label === "published")!;
const refi = enc.card.v3.call.tiles.find((x: any) => x.key === "refinanced");
assert(`${txt(refi.value)} · ${txt(refi.sub)}` === "$0 · None of the remaining $400MM", `[F2] Encompass's Refinanced tile reads "${txt(refi.value)} · ${txt(refi.sub)}"`);
const c = clone(enc.card); c.v3.call.tiles.find((x: any) => x.key === "refinanced").sub = [{ k: "text", t: "None stated in any filing" }];
assert(f1(c).length > 0, `[F3 control] Encompass's tile with the old wording "None stated in any filing" is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
