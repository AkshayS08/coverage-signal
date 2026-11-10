/**
 * SESSION 27 (Akshay, Nov 9, 2026) — A SOURCE TAG FOLLOWS THE FULL INSTRUMENT LABEL, NEVER MID-LABEL.
 *
 * "4.50% senior unsecured notes 10-K", never "4.50% senior unsecured 10-K notes". The tag marks a standing term read
 * from the latest 10-K (seniority, security); it renders after the instrument phrase that term sits in — the label
 * segments and instrument words that follow it — and before anything else (a figure, a parenthesis, " · ").
 *   P1  over every line of every shown card: no tag position is followed by an instrument word or label
 *   P2  Encompass's 4.50% notes read "4.50% senior unsecured notes" then the tag (table and call)
 *   P3  the page places tags with tagPositions (one rule, one home)
 *   control: the old placement (the tag right after the tagged label) fails P1 on Encompass
 *
 * Offline, $0. Run: npx tsx lib/cards/tagPlacement.test.ts
 */
import { readFileSync } from "node:fs";
import { shownCards, everyShownCard, inScope } from "./shownCards";
import { tagPositions, INSTRUMENT_WORDS } from "./tagPlacement";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[]) => l.map((s: any) => s.t ?? "").join("");

/** Every Line in a card: an array of segments ({ k, t }). */
function linesIn(o: any, out: any[][] = []): any[][] {
  if (Array.isArray(o)) { if (o.length && o.every((x) => x && typeof x === "object" && typeof x.k === "string" && "t" in x)) out.push(o); else for (const v of o) linesIn(v, out); }
  else if (o && typeof o === "object") for (const v of Object.values(o)) linesIn(v, out);
  return out;
}
const continues = (s: any) => s && ((s.k === "label") || (s.k === "text" && /\S/.test(s.t) && INSTRUMENT_WORDS.test(s.t)));
function p1(card: any, place: (l: any[]) => number[] = tagPositions): string[] {
  const out: string[] = [];
  for (const l of linesIn(card.v3)) for (const p of place(l)) if (continues(l[p + 1]) || (l[p + 1]?.k === "text" && !/\S/.test(l[p + 1].t) && continues(l[p + 2]))) out.push(`"${txt(l.slice(0, p + 1))}[10-K]${txt(l.slice(p + 1)).slice(0, 30)}"`);
  return out;
}

for (const s of shownCards()) { const v = p1(s.card); assert(v.length === 0, `[P1:${s.card.company} ${s.label}]${v.length ? ` — ${v.slice(0, 3).join("; ")}` : " holds"}`); }

const enc = everyShownCard().find((s) => s.cik === "0000785161" && s.label === "published")!;
if (inScope("0000785161", "published")) {
  const row = enc.card.v3.table.rows.find((r: any) => /4\.50%/.test(txt(r.instrument)));
  const pos = row ? tagPositions(row.instrument) : [];
  assert(!!row && pos.length > 0 && /4\.50% senior unsecured notes$/.test(txt(row.instrument.slice(0, pos[pos.length - 1] + 1))), `[P2] Encompass's table row reads "${row ? txt(row.instrument.slice(0, (pos[pos.length - 1] ?? -1) + 1)) : "no row"}" then the tag`);
}

const view = readFileSync("app/cards/CardView.tsx", "utf-8");
assert(/tagPositions\(/.test(view) && !/s\.tenK \? <span/.test(view), `[P3] the page places tags with tagPositions, not beside each tagged segment`);

const old = (l: any[]) => l.map((s, n) => ((s.k === "label" || s.k === "date") && s.tenK ? n : -1)).filter((n) => n >= 0);
assert(p1(enc.card, old).length > 0, `[control] the old placement fails P1 on Encompass: ${p1(enc.card, old)[0] ?? "none"}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
