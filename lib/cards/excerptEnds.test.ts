/**
 * SESSION 27 (Akshay, Nov 13, 2026) — AN EXCERPT ENDS AT ITS SENTENCE, NOT AT THE NEXT HEADING OR NOTE NUMBER.
 *
 * Found: "…to repay a portion of the amounts outstanding under our revolving credit facility. 5." — the next note's
 * number carried into the quote. A quoted excerpt ends where its sentence ends, before a heading or a note number.
 *   X1  over every shown card (and the cards built from the re-verified re-run facts): no quoted excerpt ends in a
 *       note number ("… facility. 5.”") or a note heading ("… Note 7.”")
 *   control: the re-verified Encompass card as committed before this rule fails X1
 *
 * Offline, $0. Run: npx tsx lib/cards/excerptEnds.test.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { shownCards } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
function linesIn(o: any, out: any[][] = []): any[][] {
  if (Array.isArray(o)) { if (o.length && o.every((x) => x && typeof x === "object" && typeof x.k === "string" && "t" in x)) out.push(o); else o.forEach((v) => linesIn(v, out)); }
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "src" && k !== "parts") linesIn(v, out);
  return out;
}
/** A quoted excerpt whose end is a note number or heading. */
const STRAY = /[.;]\s+(?:Note\s+)?\d{1,2}\.\s*(?:…)?[”"]/;
export const strays = (card: any): string[] => linesIn(card.v3).map((l) => l.map((s: any) => s.t ?? "").join("")).filter((x) => STRAY.test(x)).map((x) => `"…${(STRAY.exec(x) ?? [""])[0]}" in "${x.slice(0, 70)}"`);

const extra = join("sessions", "27", "facts_rerun", "reverified", "cards");
const cards: [string, any][] = nonEmpty("the cards to check", [
  ...shownCards().map((s) => [`${s.card.company} ${s.label}`, s.card] as [string, any]),
  ...(existsSync(extra) ? readdirSync(extra).filter((f) => f.endsWith(".json")).map((f) => [`${f} (re-verified facts)`, JSON.parse(readFileSync(join(extra, f), "utf-8"))] as [string, any]) : []),
]);
for (const [label, card] of cards) { const v = strays(card); assert(v.length === 0, `[X1:${label}]${v.length ? ` — ${v.join("; ")}` : " holds"}`); }

const before = JSON.parse(execSync("git show 0382ac0:sessions/27/facts_rerun/reverified/cards/0000785161.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(strays(before).length > 0, `[control] the re-verified Encompass card before this rule fails X1: ${strays(before)[0] ?? "none"}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
