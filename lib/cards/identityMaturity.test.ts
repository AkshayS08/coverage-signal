/**
 * SESSION 27 (Akshay, Nov 14, 2026) — AN IDENTITY LABEL INCLUDES THE STATED MATURITY.
 *
 * A move's instrument label carries the maturity a sentence states for it: "$550MM 1.250% notes due March 2026", never
 * "$550MM 1.250% notes" when the move's own sentence says "notes that matured in March 2026". The maturity is read from
 * the table row, the instrument's name, or the move's own sentence ("due …", "matured in …", "maturing on …").
 *   I1  over every shown card: a move title naming a coupon includes "due <date>" wherever the sentence it cites, or the
 *       move's own sentence, states the note's maturity
 *   control: Cigna's refresh card as committed before this rule ("$550MM 1.250% notes") fails I1
 *
 * Offline, $0. Run: npx tsx lib/cards/identityMaturity.test.ts
 */
import { execSync } from "node:child_process";
import { shownCards } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";
import { statedMaturityIn } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");

export function i1(card: any): string[] {
  const out: string[] = [];
  for (const m of card.v3?.moves ?? []) for (const line of [...(m.title ?? []), ...(m.retires?.items ?? [])]) {
    const shown = txt(line);
    if (!/\d%/.test(shown) || /\bdue\b/.test(shown)) continue;
    const sentences = line.filter((s: any) => s.src?.sentence).map((s: any) => s.src.sentence as string);
    const stated = sentences.map((s: string) => statedMaturityIn(s)).find(Boolean);
    if (stated) out.push(`"${shown}" omits its stated maturity (${stated})`);
  }
  return out;
}

for (const s of nonEmpty("the cards that can be shown or signed", shownCards())) { const v = i1(s.card); assert(v.length === 0, `[I1:${s.card.company} ${s.label}]${v.length ? ` — ${v.join("; ")}` : " holds"}`); }
const before = JSON.parse(execSync("git show e53033d:sessions/27/refresh/0001739940_review_card.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(i1(before).length > 0, `[control] Cigna's refresh before this rule: ${i1(before)[0] ?? "no omission found"}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
