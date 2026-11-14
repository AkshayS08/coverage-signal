/**
 * SESSION 27 (Akshay, Nov 14, 2026) — AN UNREAD FILING "MAY AFFECT DEBT"; NO CARD SAYS "AFFECTING DEBT".
 *
 * A filing whose text the card has not read is described as one that "may affect debt", everywhere on the card. A
 * filing judged by its 8-K items alone is described by what was read (its items: "none with a debt item"), never as
 * "affecting debt" or "not affecting debt".
 *   W1  over every shown card: no line says "affecting debt"
 *   W2  a not-shown line about an unread filing says "may affect debt"
 *   control: June Cigna as committed before this rule ("1 filing this week affecting debt: text not read") fails W1
 *
 * Offline, $0. Run: npx tsx lib/cards/unreadWording.test.ts
 */
import { execSync } from "node:child_process";
import { shownCards } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
function linesIn(o: any, out: any[][] = []): any[][] {
  if (Array.isArray(o)) { if (o.length && o.every((x) => x && typeof x === "object" && typeof x.k === "string" && "t" in x)) out.push(o); else o.forEach((v) => linesIn(v, out)); }
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "src" && k !== "parts") linesIn(v, out);
  return out;
}
const lines = (card: any) => linesIn(card.v3).map((l) => l.map((s: any) => s.t ?? "").join(""));
export const affecting = (card: any) => lines(card).filter((x) => /affecting debt/i.test(x));

for (const s of shownCards()) {
  const a = affecting(s.card);
  const unread = lines(s.card).filter((x) => /text not read|not yet read/i.test(x) && /filing/i.test(x) && !/may affect debt/.test(x) && /debt/.test(x));
  assert(a.length === 0 && unread.length === 0, `[W1/W2:${s.card.company} ${s.label}]${a.length || unread.length ? ` — ${[...a, ...unread].map((x) => `"${x.slice(0, 80)}"`).join("; ")}` : " holds"}`);
}
const before = JSON.parse(execSync("git show 61fe886:lib/cards/generated/0001739940.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(affecting(before).length > 0, `[control] June Cigna before this rule: ${affecting(before).map((x) => `"${x.slice(0, 70)}"`).join("; ")}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
