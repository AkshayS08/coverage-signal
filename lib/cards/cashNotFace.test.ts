/**
 * SESSION 27 (Akshay, Nov 13, 2026) — CASH-FLOW FIGURES ARE CASH, NOT FACE.
 *
 * A cash-flow statement line ("Net change in short-term debt 975") may feed a carrying-value roll, labelled as cash
 * proceeds, but never a displayed face amount. June Cigna's commercial paper displays "~$1,000MM" (the stated
 * outstanding, at face); the roll uses 975 against the balance sheet; the residual stays $10MM (0.03%).
 *   C1  over every shown card: a figure citing a cash-flow line never stands in a face context (the call, the total,
 *       the ladder's bars, the table's face column), and every computed part citing one is labelled cash
 *   C2  June Cigna: commercial paper displays ~$1,000MM; the roll's commercial paper is 975 (cash), its coverage entry
 *       1,000 (face); the rolled note discloses $10MM (0.03%)
 *   control: June Cigna with its table's commercial paper face cited to the cash-flow line fails C1
 *
 * Offline, $0. Run: npx tsx lib/cards/cashNotFace.test.ts
 */
import { shownCards, everyShownCard, inScope } from "./shownCards";
import { rolledCoverageFor } from "../events/rolledCoverage";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
/** A line of the cash-flow statement. */
export const CASH_FLOW_LINE = /^(?:Net (?:change|increase|decrease|\(decrease\) increase|increase \(decrease\)) in short-term debt|Repayments? of long-term debt|Net proceeds (?:on|from) (?:the )?issuance)/i;
const cashSrc = (x: any) => !!x?.src?.sentence && CASH_FLOW_LINE.test(String(x.src.sentence).trim());

function c1(card: any): string[] {
  const v = card.v3, out: string[] = [];
  if (!v) return out;
  const walk = (o: any, where: string, face: boolean) => {
    if (Array.isArray(o)) { o.forEach((x) => walk(x, where, face)); return; }
    if (!o || typeof o !== "object") return;
    if ((o.k === "figure" || o.k === "label") && cashSrc(o) && face) out.push(`${where}: "${o.t}" cites "${o.src.sentence.slice(0, 50)}"`);
    if (o.k === "computed") for (const p of o.parts ?? []) {
      if (cashSrc(p) && face) out.push(`${where}: a part of "${o.t}" cites "${p.src.sentence.slice(0, 50)}"`);
      if (cashSrc(p) && p.basis !== "cash") out.push(`${where}: a part of "${o.t}" cites a cash-flow line without the cash label`);
    }
    for (const [k, x] of Object.entries(o)) if (k !== "src" && k !== "parts") walk(x, where, face);
  };
  walk(v.call, "call", true); walk(v.totalDebt, "total", true); walk(v.chart?.bars, "ladder", true);
  walk((v.table?.rows ?? []).map((r: any) => r.face), "table face", true);
  walk(v.rolledNote, "rolled note", false); walk(v.footnote, "footnote", false); walk(v.breakage, "breakage", false);
  return out;
}

for (const s of shownCards()) { const v = c1(s.card); assert(v.length === 0, `[C1:${s.card.company} ${s.label}]${v.length ? ` — ${v.slice(0, 3).join("; ")}` : " holds"}`); }

const june = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "published")!;
const dm = june.input.result.results.find((r: any) => r.triggerId === "debt-maturity");
const rc: any = rolledCoverageFor(june.input.result, { anchorText: june.input.docs[dm.debtScheduleSourceFiling.url].text });
const cpRoll = (rc.rollDeltas ?? []).find((d: any) => /commercial paper|short-term debt/i.test(`${d.label} ${d.sourceLine}`));
const cpEntry = (rc.entries ?? []).find((e: any) => e.kind === "movement" && /commercial paper/i.test(`${e.label} ${e.sourceLine}`));
const cpShown = (june.card.v3.call?.rows ?? []).find((r: any) => r.isCP);
if (inScope("0001739940", "published")) assert(cpRoll?.amountMillions === 975 && cpEntry?.amountMillions === 1000 && /~\$1,000MM/.test(txt(cpShown?.body)) && /\$10MM \(0\.03%\) not attributed/.test(txt(june.card.v3.rolledNote)),
  `[C2] June Cigna: roll CP ${cpRoll?.amountMillions} (cash), coverage CP ${cpEntry?.amountMillions} (face), displayed "${txt(cpShown?.body).slice(0, 40)}", disclosed "${(/\$\d+MM \([\d.]+%\)/.exec(txt(june.card.v3.rolledNote)) ?? ["none"])[0]}"`);

const bad = clone(june.card);
const row = (bad.v3.table?.rows ?? []).find((r: any) => /commercial paper/i.test(txt(r.instrument)));
if (row?.face) row.face = { k: "figure", t: "$975MM", printed: "$ 975 million", src: { sentence: "Net change in short-term debt 975", url: "u", doc: "10-Q" } };
assert(!!row && c1(bad).length > 0, `[control] a cash-flow figure rendered as the table's commercial-paper face fails C1`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
