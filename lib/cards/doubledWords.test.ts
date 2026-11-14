/**
 * SESSION 27 (Akshay, Nov 13, 2026) — NO REPEATED ADJACENT WORDS ON A CARD.
 *
 * Found: "Redeemed at at par." The price clause prefixes "at" to the filer's own price phrase, which already reads
 * "at par". A price phrase that begins with "at" is used as stated.
 *   D1  over every shown card (and the cards built from the re-verified re-run facts): no rendered line repeats a word
 *       ("at at", "the the"), ignoring case; figures, dates and tags are not words here
 *   D2  a price stated "at par" renders "at par", and one stated "103%" renders "at 103%"
 *   control: a line reading "Redeemed at at par." fails D1
 *
 * Offline, $0. Run: npx tsx lib/cards/doubledWords.test.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { shownCards } from "./shownCards";
import { priceLabelText } from "./build";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

function linesIn(o: any, out: any[][] = []): any[][] {
  if (Array.isArray(o)) { if (o.length && o.every((x) => x && typeof x === "object" && typeof x.k === "string" && "t" in x)) out.push(o); else o.forEach((v) => linesIn(v, out)); }
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "src" && k !== "parts") linesIn(v, out);
  return out;
}
const REPEAT = /\b([A-Za-z]+)\s+\1\b/i;
export const doubled = (card: any): string[] => linesIn(card.v3).map((l) => l.map((s: any) => s.t ?? "").join("")).filter((x) => REPEAT.test(x)).map((x) => `"${(REPEAT.exec(x) ?? [""])[0]}" in "${x.slice(0, 90)}"`);

const extra = join("sessions", "27", "facts_rerun", "reverified", "cards");
const cards: [string, any][] = nonEmpty("the cards to check", [
  ...shownCards().map((s) => [`${s.card.company} ${s.label}`, s.card] as [string, any]),
  ...(existsSync(extra) ? readdirSync(extra).filter((f) => f.endsWith(".json")).map((f) => [`${f} (re-verified facts)`, JSON.parse(readFileSync(join(extra, f), "utf-8"))] as [string, any]) : []),
]);
for (const [label, card] of cards) { const v = doubled(card); assert(v.length === 0, `[D1:${label}]${v.length ? ` — ${v.join("; ")}` : " holds"}`); }

assert(priceLabelText("at par") === "at par" && priceLabelText("103 %") === "at 103%" && priceLabelText("At par") === "At par", `[D2] price phrases: "${priceLabelText("at par")}", "${priceLabelText("103 %")}"`);
assert(doubled({ v3: { moves: [{ detail: [{ k: "text", t: "Redeemed at at par." }] }] } }).length > 0, `[control] "Redeemed at at par." fails D1`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
