/**
 * SESSION 27 (Akshay, Nov 9, 2026) — A CARD WHOSE COVERAGE TIE FAILS STATES NO CALL.
 *
 * When the coverage tie fails beyond its earned band (COVERAGE_RESIDUAL_LIMIT, measured), the card withholds the
 * call, the tiles, the total and the ladder (chart and table), and renders the breakage panel instead — the gap, its
 * cause and its sources — under a "Checks failed" badge. A card may never state a call while its own footnote reports
 * unaccounted debt. Found on Cigna's refresh render: "Nothing matures in the next 18 months" over a ~$5,000MM total
 * against a $31,142MM balance sheet, its footnote reporting $26,142MM not accounted for, ~$2,359MM of 2027 notes in
 * the window.
 *   T1  over every shown card: a footnote reporting unaccounted debt, or a breakage panel, never stands beside a call,
 *       tiles, a total or a ladder; and a card with a breakage panel carries the "Checks failed" badge
 *   T2  a breakage panel states its gap (with its arithmetic), its cause and at least one source
 *   T3  Cigna's refresh render (roll outside its band) withholds and renders the panel
 *   control: today's Cigna render (call, tiles, total and ladder beside "$26,142MM is not accounted for") fails T1
 *
 * Offline, $0. Run: npx tsx lib/cards/trustRule.test.ts
 */

import { execSync } from "node:child_process";
import { shownCards, everyShownCard, inScope } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");

export function t1(card: any): string[] {
  const v = card.v3; const out: string[] = [];
  if (!v) return out;
  const broken = /not accounted for/.test(txt(v.footnote)) || !!v.breakage;
  if (!broken) return out;
  for (const k of ["call", "totalDebt", "chart", "table"]) if (v[k]) out.push(`states its ${k === "chart" || k === "table" ? `ladder (${k})` : k} beside unaccounted debt`);
  if (!v.breakage) out.push("reports unaccounted debt with no breakage panel");
  if (v.checks !== "failed") out.push(`badge is ${JSON.stringify(v.checks ?? null)}, not "Checks failed"`);
  return out;
}
const t2 = (card: any): string[] => {
  const b = card.v3?.breakage; if (!b) return [];
  const out: string[] = [];
  if (!(b.gap?.k === "computed" && (b.gap.parts ?? []).length > 0)) out.push("its gap carries no arithmetic");
  if (!txt(b.cause).trim()) out.push("it states no cause");
  if (!(b.sources ?? []).length) out.push("it cites no source");
  return out;
};

for (const s of shownCards()) {
  const a = t1(s.card), b = t2(s.card);
  assert(!a.length && !b.length, `[T1/T2:${s.card.company} ${s.label}]${a.length || b.length ? ` — ${[...a, ...b].join("; ")}` : " holds"}`);
}

if (inScope("0001739940", "review")) {
  const cig = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "review")!;
  assert(!!cig.card.v3.breakage && !cig.card.v3.call && cig.card.v3.checks === "failed", `[T3] Cigna's refresh render withholds its call and renders the breakage panel (cause: "${txt(cig.card.v3.breakage?.cause).slice(0, 140)}")`);
}

// Control: Cigna's render as committed before this rule (v14), the call beside "$26,142MM is not accounted for".
const before = JSON.parse(execSync("git show efc2ced:sessions/27/refresh/0001739940_review_card.json", { encoding: "utf-8", maxBuffer: 64e6 }).toString());
assert(/not accounted for/.test(txt(before.v3.footnote)) && t1(before).length > 0, `[control] today's Cigna render fails T1: ${t1(before).join("; ")}`);


console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
