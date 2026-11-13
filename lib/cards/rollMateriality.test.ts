/**
 * SESSION 27 (Akshay, Nov 13, 2026) — EXACT FIGURES, AND A STATED MATERIALITY LINE.
 *
 * A roll uses the cash-flow statement's exact figure over rounded prose for the same fact (commercial paper: "Net
 * change in short-term debt" over "approximately $0.5 billion"). A residual is attributed only to a cause a read
 * sentence states, quoted. The unattributed residual is always shown on the card ("$X (Y%) not attributed to a stated
 * cause"). At or under 0.2% of rolled debt (Akshay's ruling) the roll counts and the card passes with the residual
 * disclosed; over it, the card fails its checks.
 *   E1  Cigna June 30 (published): commercial paper from the cash-flow line (975); unattributed $10MM (0.03%); the roll
 *       counts and the card discloses the residual
 *   E2  Cigna Sept 30 (refresh): commercial paper 463; the $40MM of long-term debt repaid beyond the named notes is
 *       attributed to the cash-flow line, quoted; unattributed $194MM (0.62%); Checks failed, disclosed in the panel
 *   E3  over every shown card with a counted roll: the residual is disclosed in that wording
 *   E4  without the anchor's text, an approximate figure with an exact counterpart fails closed (the roll does not count)
 *   E5  the 0.2% line is recorded in the spec as Akshay's ruling
 *   controls: the June input with its target moved to put the residual just over 0.2% fails; just under passes
 *
 * Offline, $0. Run: npx tsx lib/cards/rollMateriality.test.ts
 */
import { readFileSync } from "node:fs";
import { shownCards, everyShownCard, inScope } from "./shownCards";
import { rolledCoverageFor } from "../events/rolledCoverage";
import { MATERIALITY_FRACTION } from "../events/rollForward";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const anchorTextOf = (s: any) => { const dm = s.input.result.results.find((r: any) => r.triggerId === "debt-maturity"); return s.input.docs[dm.debtScheduleSourceFiling.url]?.text ?? null; };
const cardText = (card: any) => JSON.stringify(card.v3).replace(/\\"/g, "");
const DISCLOSED = /\$[\d,]+MM \(\d+\.\d+%\) not attributed to a stated cause/;

const june = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "published")!;
const sept = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "review")!;
const rj: any = rolledCoverageFor(june.input.result, { anchorText: anchorTextOf(june) });
const rs: any = rolledCoverageFor(sept.input.result, { anchorText: anchorTextOf(sept) });

const cpOf = (rc: any) => (rc.movements ?? []).find((m: any) => m.placement === "delta" && /commercial paper|short-term debt/i.test(`${m.instrument} ${m.sourceLine}`));
assert(rj.counts === true && cpOf(rj)?.amountMillions === 975 && rj.unattributedMillions === 10 && (!inScope("0001739940", "published") || (DISCLOSED.test(cardText(june.card)) && /\$10MM \(0\.03%\) not attributed/.test(cardText(june.card)) && !june.card.v3.breakage)),
  `[E1] June: CP ${cpOf(rj)?.amountMillions}, unattributed ${rj.unattributedMillions}MM, counts ${rj.counts}; the card discloses "${(/\$[\d,]+MM \([\d.]+%\) not attributed to a stated cause/.exec(cardText(june.card)) ?? ["none"])[0]}"`);
const attr = (rs.attributions ?? []) as { amountMillions: number; sourceLine: string }[];
assert(rs.counts === false && cpOf(rs)?.amountMillions === 463 && attr.some((a) => a.amountMillions === -40 && /Repayment of long-term debt/.test(a.sourceLine)) && rs.unattributedMillions === 194 && (!inScope("0001739940", "review") || (sept.card.v3.checks === "failed" && /\$194MM \(0\.62%\) not attributed to a stated cause/.test(cardText(sept.card)))),
  `[E2] Sept: CP ${cpOf(rs)?.amountMillions}, attributed ${attr.map((a) => `${a.amountMillions} ("${a.sourceLine.slice(0, 40)}")`).join(", ") || "none"}, unattributed ${rs.unattributedMillions}MM, counts ${rs.counts}`);

for (const s of shownCards()) {
  const rc: any = rolledCoverageFor(s.input.result, { anchorText: anchorTextOf(s) });
  if (!rc.counts && !rc.fired) continue;
  assert(DISCLOSED.test(cardText(s.card)), `[E3:${s.card.company} ${s.label}] the roll's unattributed residual is disclosed`);
}

const blind: any = rolledCoverageFor(june.input.result);
assert(blind.counts === false && blind.fired === true && /cash-flow statement/i.test(blind.reason), `[E4] without the anchor's text the June roll does not count: "${String(blind.reason).slice(0, 120)}"`);

const spec = readFileSync("docs/card_spec.md", "utf-8");
assert(MATERIALITY_FRACTION === 0.002 && /0\.2%[^\n]*Akshay/.test(spec), `[E5] the 0.2% materiality line is ${MATERIALITY_FRACTION} and recorded in the spec as Akshay's ruling`);

// Controls, both sides of the line: move the June roll's target so the unattributed residual is 0.21% and 0.19%.
const at = (frac: number) => {
  const r = clone(june.input.result); const dm = r.results.find((x: any) => x.triggerId === "debt-maturity");
  const computed = rj.rollTie.computedMillions; dm.xbrlDebtTotal.total = Math.round(computed * (1 - frac)) * 1e6;
  return rolledCoverageFor(r, { anchorText: anchorTextOf(june) }) as any;
};
const over = at(0.0021), under = at(0.0019);
assert(over.counts === false && under.counts === true, `[controls] 0.21% of rolled debt fails (counts ${over.counts}); 0.19% passes (counts ${under.counts})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
