/**
 * SESSION 27 (Akshay, Nov 9, 2026) — A MOVE CITES THE SENTENCE STATING THE MOVE, NOT A SUMMARY OR A BULLET.
 *
 * When several sentences state the same figure, the move's figures and labels link to the sentence stating the move
 * itself ("In September 2026, we issued $2.000 billion … of 6.250% senior unsecured notes…") over a summary or bullet
 * ("• Net proceeds from the issuance of … our 6.250% senior unsecured notes due September 2034…"). Found when paragraph
 * breaks made Tenet's cash-flow bullet a sentence of its own and its coupon label moved to it.
 *   C1  over every shown card: no move's coupon or instrument label cites a summary or bullet where a held document
 *       has a sentence stating the move (a completed-move verb) that names the same coupon and year
 *   C2  Tenet's 6.250% coupon cites its issuance sentence
 *   control: Tenet's card with its coupon re-cited to the bullet fails C1
 *
 * Offline, $0. Run: npx tsx lib/cards/moveCitation.test.ts
 */
import { shownCards, everyShownCard, inScope } from "./shownCards";
import { paragraphSentences } from "./antecedent";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const flat = (s: string) => s.replace(/[\s ]+/g, " ").trim();
/** A summary or bullet: a list item, or a cash-flow line ("Net proceeds from …"). */
export const SUMMARY = /^[•·▪●◦\-–]\s|^(?:Net\s+(?:cash\s+)?)?proceeds\s+from\b/i;
const MOVE_VERB = /\b(?:issued|completed (?:an|the|a) (?:offering|issuance|sale)|sold|redeemed|repurchased|repaid|retired|priced)\b/i;
const couponKey = (s: string) => (/(\d{1,2}(?:\.\d{1,4})?)\s*%/.exec(s) ?? [])[1];

function c1(card: any, input: any): string[] {
  const out: string[] = [];
  const pool = Object.values(input.docs as Record<string, { text: string }>).flatMap((d) => paragraphSentences(d.text).sentences.map((x) => flat(x.sentence)));
  for (const m of card.v3?.moves ?? []) for (const line of m.title ?? []) for (const s of line) {
    if (s.k !== "label" || !s.src?.sentence || !SUMMARY.test(flat(s.src.sentence))) continue;
    const c = couponKey(s.stated ?? s.t ?? ""), y = (/\b(20\d\d)\b/.exec(s.t ?? "") ?? [])[1];
    if (!c) continue;
    const better = pool.find((x) => !SUMMARY.test(x) && MOVE_VERB.test(x) && couponKey(x) === c && x.includes(c + "") && (!y || x.includes(y)) && new RegExp(`${c.replace(".", "\\.")}\\s*%`).test(x));
    if (better) out.push(`"${s.t}" cites "${flat(s.src.sentence).slice(0, 70)}…" where "${better.slice(0, 70)}…" states the move`);
  }
  return out;
}

for (const s of shownCards()) { const v = c1(s.card, s.input); assert(v.length === 0, `[C1:${s.card.company} ${s.label}]${v.length ? ` — ${v.join("; ")}` : " holds"}`); }

const ten = everyShownCard().find((x) => x.cik === "0000070318" && x.label === "published") as any;
const seg = ten.card.v3.moves.flatMap((m: any) => m.title.flat()).find((x: any) => x.k === "label" && /6\.250/.test(x.t ?? ""));
if (inScope("0000070318", "published")) assert(!!seg && /^In September 2026, we issued/.test(flat(seg.src.sentence)), `[C2] Tenet's 6.250% coupon cites its issuance sentence ("${seg ? flat(seg.src.sentence).slice(0, 80) : "no label"}…")`);

const bullet = Object.values(ten.input.docs as Record<string, { text: string }>).flatMap((d) => paragraphSentences(d.text).sentences.map((x) => x.sentence)).find((x) => /^•\s*Net proceeds from the issuance[\s\S]*?6\.250%/.test(flat(x)));
const bad = clone(ten.card); for (const m of bad.v3.moves) for (const l of m.title) for (const x of l) if (x.k === "label" && /6\.250/.test(x.t ?? "")) { x.src.sentence = bullet; x.stated = "6.250%"; }
assert(!!bullet && c1(bad, ten.input).length > 0, `[control] Tenet's coupon re-cited to the cash-flow bullet fails C1`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
