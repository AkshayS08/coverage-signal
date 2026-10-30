/**
 * SESSION 27 (Akshay, Oct 30, 2026) — NO FIGURE CITES THE 10-K OUTSIDE RULE 66.
 *
 * Under Rule 66 the prior-period annual report is a source only when the
 * anchor locates no debt note AND directs the reader to it (Cigna). Tenet's
 * revolver maturity, "November 4, 2030", rendered from its 10-K; no 10-Q or
 * 8-K Tenet holds states it. Where a 10-Q sentence states a figure, cite it;
 * where none does, the figure is removed from the card.
 *
 *   A1  every card of the six: no rendered figure, date or label cites a
 *       10-K unless the name's anchor is not-located and directs to it
 *   A2  Tenet: its revolver and L/C facility show no maturity from the 10-K
 *   A3  control: a 10-K citation injected into Tenet's card is caught
 *   A4  control: Cigna's 10-K citations (its labelled prior-period base) are
 *       caught when its cross-reference is removed, so A1 is not passing
 *       only because a name was exempted
 *
 * Offline, $0. Run: npx tsx lib/cards/annualReportSource.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[];
const snapOf = (cik: string) => JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
const cardOf = (cik: string) => JSON.parse(readFileSync(join("lib", "cards", "generated", `${cik}.json`), "utf-8"));
const clone = (x: any) => JSON.parse(JSON.stringify(x));

/** Rule 66: the anchor locates no debt note and directs to the annual report in its own verified words. */
const rule66 = (snap: any) => { const dm = snap.result.results.find((t: any) => t.triggerId === "debt-maturity"); return dm?.anchorNoteShape === "not-located" && !!dm?.noteCrossReference; };
/** Every rendered segment (card.v3) whose source is a 10-K. */
const tenKCited = (card: any, snap: any) => {
  const isTenK = (src: any) => /^10-K/.test(src?.doc ?? "") || /^10-K/.test(snap.docs?.[src?.url]?.label ?? "");
  const out: string[] = [];
  const walk = (o: any, path: string) => { if (!o || typeof o !== "object") return; if (o.src && isTenK(o.src)) out.push(`${path}: ${o.t ?? o.printed ?? ""}`); for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v, `${path}.${k}`); };
  walk(card.v3, "v3");
  return out;
};
const violations = (card: any, snap: any) => (rule66(snap) ? [] : tenKCited(card, snap));

for (const cik of CIKS) {
  const snap = snapOf(cik), card = cardOf(cik), v = violations(card, snap);
  assert(v.length === 0, `[A1:${card.company}] ${rule66(snap) ? "Rule 66 applies (anchor not-located, directs to the 10-K)" : "Rule 66 does not apply"}; rendered 10-K citations outside it: ${v.length}${v.length ? ` (${v.slice(0, 2).join("; ")})` : ""}`);
}
const tenet = cardOf("0000070318");
const tenetMaturities = JSON.stringify(tenet.v3.facilities ?? []).match(/November 4, 2030/g) ?? [];
assert(tenetMaturities.length === 0, `[A2:Tenet] no facility shows the 10-K's November 4, 2030 (${tenetMaturities.length} found)`);

const injected = clone(tenet); const tsnap = snapOf("0000070318");
const tenK = Object.entries(tsnap.docs as Record<string, { label: string }>).find(([, d]) => /^10-K/.test(d.label))!;
injected.v3.facilities[0].bold.push({ k: "date", t: "November 4, 2030", src: { sentence: "The 2025 Credit Agreement will terminate on the earlier of (1) November 4, 2030", url: tenK[0], doc: tenK[1].label } });
assert(violations(injected, tsnap).length > 0, `[A3 control] a 10-K citation injected into Tenet's card is caught`);
const csnap = snapOf("0001739940"), cnoRef = clone(csnap);
cnoRef.result.results.find((t: any) => t.triggerId === "debt-maturity").noteCrossReference = null;
assert(tenKCited(cardOf("0001739940"), csnap).length > 0 && violations(cardOf("0001739940"), cnoRef).length > 0, `[A4 control] Cigna's 10-K citations are caught once its cross-reference is removed`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
