/**
 * SESSION 27 (Akshay, Nov 11, 2026) — NO ROLL FALLBACK. A ROLLED BASE THAT FAILS TO RECONCILE FAILS THE CARD.
 *
 * When a rolled base fails to reconcile within its band, the build never drops the base and never renders a partial
 * position from the debt the anchor names. The card goes to "Checks failed" with the breakage panel showing the roll:
 * its line-by-line arithmetic and its gap. The same principle as a failed read (fail closed). Found on Cigna's refresh:
 * the roll missed by $271MM, the base was dropped, and the card rendered ~$5,000MM of anchor-named debt.
 *   F1  over every shown card: a card whose roll fired and failed states no call, total or ladder, carries the panel
 *       under "Checks failed", and its panel's gap is the roll's own gap (not the anchor-named shortfall)
 *   F2  such a card states no anchor-only total anywhere: not in the panel, not in the footnote
 *   control: Cigna's published input (its roll reconciles) with a forced roll miss produces no card total from
 *            anchor-only rows
 *
 * Offline, $0. Run: npx tsx lib/cards/rollFallback.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { shownCards, everyShownCard } from "./shownCards";
import { rolledCoverageFor } from "../events/rolledCoverage";
import { buildCard } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));

/** The roll fired (a base was read to roll) and did not reconcile. */
const rollFailed = (result: any) => { const rc: any = rolledCoverageFor(result); return !rc.counts && rc.fired === true; };

function f(card: any, result: any): string[] {
  if (!rollFailed(result)) return [];
  const v = card.v3, out: string[] = [];
  const rc: any = rolledCoverageFor(result);
  for (const k of ["call", "totalDebt", "chart", "table"]) if (v[k]) out.push(`states its ${k}`);
  if (!v.breakage || v.checks !== "failed") out.push("no breakage panel under \"Checks failed\"");
  const gap = rc.rollTie?.residualMillions ?? null;
  if (v.breakage && gap !== null && Math.abs(Math.abs(v.breakage.gap.usd) - Math.abs(gap) * 1e6) >= 0.5e6) out.push(`the panel's gap is ${v.breakage.gap.t}, not the roll's ${Math.abs(gap)}MM`);
  const panel = v.breakage ? [txt(v.breakage.cause), ...v.breakage.sources.map(txt)].join(" | ") : "";
  if (/Stated on this card's filings|Face total/i.test(panel) || /Face total/i.test(txt(v.footnote))) out.push(`states an anchor-only total ("${(/(?:Stated on this card's filings|Face total)[^|.]*/i.exec(panel + " " + txt(v.footnote)) ?? [""])[0]}")`);
  return out;
}

const fired = shownCards().filter((s) => rollFailed(s.input.result));
for (const s of shownCards()) { const v = f(s.card, s.input.result); assert(v.length === 0, `[F1/F2:${s.card.company} ${s.label}]${rollFailed(s.input.result) ? " (roll failed)" : ""}${v.length ? ` — ${v.join("; ")}` : " holds"}`); }
console.log(`  (${fired.length} shown card(s) with a failed roll)`);

// Control: Cigna's published input, whose roll reconciles, with its target moved $1,000MM.
const pub = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "published")!;
const forced = clone(pub.input.result);
const dm = forced.results.find((r: any) => r.triggerId === "debt-maturity");
dm.xbrlDebtTotal.total += 1e9;
const factsPath = join("lib", "cards", "inputs", "facts", "0001739940.json");
const card = buildCard({ result: forced, briefDate: pub.card.briefDate, previousBrief: null, weekFilings: [], cash: pub.input.cash, textByUrl: new Map(Object.entries(pub.input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: pub.input.periodSentence, laterUrls: [], facts: existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf-8")) : null });
assert(rollFailed(forced) && f(card, forced).length === 0 && !card.v3!.totalDebt, `[control] a forced roll miss on Cigna's published input produces no card total (${f(card, forced).join("; ") || "Checks failed, roll shown"})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
