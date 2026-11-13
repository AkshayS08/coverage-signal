/**
 * SESSION 27 (Akshay, Nov 13, 2026) — A PURPOSE-TIED REVOLVER DRAW OR REPAYMENT IS A MOVE OR A POSSIBLE MOVE.
 *
 * Nov 6 ruled routine revolver activity stated only as period totals is covered by the drawn balance. A draw or a
 * repayment tied to a purpose is not routine: "we drew $250.0 million on the revolving credit facility … to repay in
 * full and retire the remaining amounts outstanding under the 2022 Credit Agreement"; "We used the net proceeds from this
 * offering … to … repay $100 million of outstanding amounts under our revolving credit facility". The possible-move net
 * had no kind for either, and needed a date in the sentence itself; a referring sentence ("this offering") is dated by
 * its antecedent (the card's rule, antecedent.ts).
 *   R1  Encompass: the March draw, the May repayment and the August repayment are located, each with its month
 *   R2  routine activity is not located: "Borrowings on revolving credit facility 745.0 140.0", "borrowings under our
 *       revolving credit facility" as a source of liquidity
 *   R3  on the card built from the re-verified re-run facts (which drop them), each appears as a possible move; on the
 *       published card each is covered by a move card
 *   control: the March sentence without its purpose clause is not located
 *
 * Offline, $0. Run: npx tsx lib/cards/purposeTiedDraws.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { locateMoveSentences } from "./moveSentences";
import { everyShownCard, inScope } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");

const enc = everyShownCard().find((s) => s.cik === "0000785161" && s.label === "published")!;
const docs = Object.entries(enc.input.docs as Record<string, { label: string; text: string }>).map(([url, d]) => ({ url, label: d.label, text: d.text }));
const located = locateMoveSentences(docs, "2026-01-01", "2026-11-09");
const find = (re: RegExp) => located.find((l) => re.test(l.sentence.replace(/\s+/g, " ")));
const march = find(/we drew \$ ?250\.0 million on the revolving credit facility/), may = find(/repay \$ ?100 million of outstanding amounts under our revolving credit facility/), aug = find(/net proceeds from this borrowing, together with cash on hand, to repay a portion/);
assert(march?.date.startsWith("2026-03") === true && may?.date.startsWith("2026-05") === true && aug?.date.startsWith("2026-08") === true, `[R1] located: March draw ${march?.date ?? "no"}, May repayment ${may?.date ?? "no"}, August repayment ${aug?.date ?? "no"}`);
assert(!find(/^Borrowings on revolving credit facility/) && !find(/primary sources of liquidity are cash on hand, cash flows from operations, and borrowings/), `[R2] routine revolver activity is not located`);

const rv = join("sessions", "27", "facts_rerun", "reverified", "cards", "0000785161.json");
if (existsSync(rv)) {
  const card = JSON.parse(readFileSync(rv, "utf-8"));
  const pm = (card.v3.possibleMoves ?? []).map(txt).join(" | ");
  // A long sentence shows excerpted (220 characters): the May repayment is matched by its opening.
  assert(/we drew \$ ?250\.0 million/.test(pm) && /net proceeds from this offering, together with cash on hand, to \(i\) redeem/.test(pm) && /this borrowing, together with cash on hand, to repay a portion/.test(pm), `[R3] the re-verified card flags all three as possible moves`);
}
if (inScope("0000785161", "published")) {
  const pm = (enc.card.v3.possibleMoves ?? []).map(txt).join(" | ");
  assert(!/revolving credit facility/.test(pm), `[R3] the published card covers them with its move cards (no possible-move line for them)`);
}

const bare = locateMoveSentences([{ url: "x", label: "10-Q", text: "During March 2026, we drew $250.0 million on the revolving credit facility under the 2026 Credit Agreement." }], "2026-01-01", "2026-11-09");
assert(bare.length === 0, `[control] the draw without its purpose clause is not located`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
