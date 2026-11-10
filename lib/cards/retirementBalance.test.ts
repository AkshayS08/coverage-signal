/**
 * SESSION 27 (Akshay, Nov 1, 2026) — ONE OFFER IS ONE TRANSACTION, AND
 * RETIREMENTS MUST BALANCE.
 *
 * CHS's refreshed card read "~$736MM repurchased in 2026 · $689MM remains" for
 * one tender offer: the facts kept it twice, dated by its launch (Apr 22) and
 * by its settlement (May 6). Launch, expiry and settlement of one offer are one
 * transaction, dated by its completion.
 *
 * The balance check: for each instrument, the retirements a card states
 * between two positions equal the change in outstanding face the filer's own
 * table prints (its prior period-end column to its current column), net of new
 * issuance. A mismatch is a check failure. CHS's 4¾% notes went from $1,057MM
 * to $689MM: $368MM, never $736MM.
 *
 *   R1  every committed card of the six and the four refreshes: each row's
 *       "retired / repurchased / redeemed … · remains" balances against its
 *       table's two columns
 *   R2  CHS's refresh: the repurchase reads ~$368MM, one move card dated by
 *       its completion
 *   R3  control: "~$736MM repurchased in 2026 · $689MM remains" against
 *       $1,057MM → $689MM fails the check
 *
 * Offline, $0. Run: npx tsx lib/cards/retirementBalance.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retirementBalanceViolations } from "./retirementBalance";
import { nonEmpty } from "../testing/nonEmpty";
import { shownCards, everyShownCard, inScope } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[]) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");

const docsOf = (path: string) => new Map<string, string>(Object.entries(JSON.parse(readFileSync(path, "utf-8")).docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
// Nov 7: over every card that can be shown or signed (lib/cards/shownCards.ts), never only the published ones.
const all: { label: string; card: any; result: any; docs: Map<string, string> }[] = shownCards().map((x) => ({ label: x.label === "published" ? "committed" : "refresh", card: x.card, result: x.input.result, docs: new Map<string, string>(Object.entries(x.input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])) }));
for (const x of all) {
  const v = retirementBalanceViolations(x.card, x.result, x.docs);
  assert(v.length === 0, `[R1:${x.card.company} ${x.label}] every stated retirement balances against its table's two columns${v.length ? ` — ${v.join("; ")}` : ""}`);
}
// Control material reads every card; [R2] is about CHS's review card and counts where it is in scope (releaseGate.test).
const chs = (() => { const x = everyShownCard().find((s) => s.label === "review" && s.cik === "0001108109")!; return { card: x.card, result: x.input.result, docs: new Map<string, string>(Object.entries(x.input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])) }; })();
const aboutChs = (ok: boolean, msg: string) => (inScope("0001108109", "review") ? assert(ok, msg) : console.log(`  — NOT IN SCOPE (SHOWN_SCOPE=${process.env.SHOWN_SCOPE}): ${msg.slice(0, 60)}`));
const rows = chs.card.v3.table.rows.map((r: any) => txt(r.status?.text)).filter(Boolean).join(" | ");
const moves = chs.card.v3.moves.filter((m: any) => /4¾%/.test(m.title.map(txt).join(" ")));
aboutChs(/~\$368MM repurchased in 2026 · \$689MM remains/.test(rows) && moves.length === 1 && /May 6, 2026/.test(txt(moves[0].meta)), `[R2] CHS: "~$368MM repurchased", one move card dated May 6 (statuses: ${rows}; ${moves.length} move card(s) for the 4¾% notes)`);
const bad = JSON.parse(JSON.stringify(chs.card));
for (const r of bad.v3.table.rows) for (const s of r.status?.text ?? []) if (typeof s.t === "string") s.t = s.t.replace("~$368MM", "~$736MM");
for (const r of bad.v3.table.rows) for (const s of r.status?.text ?? []) if (s.k === "figure" && s.t === "~$368MM") s.t = "~$736MM";
assert(retirementBalanceViolations(bad, chs.result, chs.docs).length > 0, `[R3 control] "~$736MM repurchased · $689MM remains" against $1,057MM → $689MM fails`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
