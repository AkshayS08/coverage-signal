/**
 * SESSION 27 (Akshay, Oct 30, 2026) — NO RAW SOURCE AMOUNT RENDERS AS A CARD
 * FIGURE. Every displayed figure goes through the card's single format
 * function (Rule 67): "approximately $ 746 million" is "~$746MM", the tilde
 * earned by "approximately". Encompass's computed liquidity rendered its
 * part's raw source string when opened.
 *
 *   R1  every card of the six: every rendered figure (a figure segment, a
 *       computed total, and each part of a computed figure as the view shows
 *       it) is in the card's format, never a raw source string
 *   R2  Encompass: the availability part renders "~$746MM"
 *   R3  control: the pre-fix view (a part shown as its raw `printed`) fails
 *       R1 on Encompass
 *
 * Offline, $0. Run: npx tsx lib/cards/rawAmount.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partText } from "./format";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[];
const cardOf = (cik: string) => JSON.parse(readFileSync(join("lib", "cards", "generated", `${cik}.json`), "utf-8"));
/** The card's own money format: $MM / $B / $K at the source's precision, an optional ~ or <, a sign, or $0. */
const CARD_FORMAT = /^[−-]?\s?[~<]?\$[\d,]+(?:\.\d+)?(?:MM|B|K)?$/;

/** Every figure the page renders, as the view renders it. `part` is how a computed figure's part is shown. */
function renderedFigures(card: any, part: (p: any) => string): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const walk = (o: any, path: string) => {
    if (!o || typeof o !== "object") return;
    if (o.k === "figure" && typeof o.t === "string") out.push({ where: path, text: o.t });
    if (o.k === "computed") { if (typeof o.t === "string") out.push({ where: path, text: o.t }); for (const [n, p] of (o.parts ?? []).entries()) out.push({ where: `${path}.parts.${n}`, text: part(p) }); }
    for (const [k, v] of Object.entries(o)) if (k !== "src" && k !== "parts") walk(v, `${path}.${k}`);
  };
  walk(card.v3, "v3");
  return out;
}
const raw = (figs: { text: string }[]) => figs.filter((f) => !CARD_FORMAT.test(f.text.trim()));

for (const cik of CIKS) {
  const card = cardOf(cik), figs = renderedFigures(card, partText), bad = raw(figs);
  assert(bad.length === 0, `[R1:${card.company}] ${figs.length} rendered figures, all in the card's format${bad.length ? ` — raw: ${bad.slice(0, 3).map((b) => `"${b.text}" at ${b.where}`).join("; ")}` : ""}`);
}
const ehc = cardOf("0000785161");
const parts = renderedFigures(ehc, partText).filter((f) => /parts/.test(f.where)).map((f) => f.text);
assert(parts.includes("~$746MM"), `[R2:Encompass] the availability part renders "~$746MM" (parts: ${parts.join(", ")})`);
assert(raw(renderedFigures(ehc, (p) => p.printed)).length > 0, `[R3 control] the pre-fix view, showing a part's raw printed text, fails R1 on Encompass`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
