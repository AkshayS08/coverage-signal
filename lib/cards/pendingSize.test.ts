/**
 * SESSION 27 — A MOVE'S SIZE COMES FROM THE SAME DECISION AS THE POSITION.
 *
 * A retirement move with no stated face takes its size from a redemption
 * claim for the same note. It took the FIRST such claim, whatever it was:
 * Tenet's v33 answer lists its November 2025 redemption of $750MM of the
 * 6.125% 2028 notes (already in the June 30 balance, rule (a)) before the
 * $0.5B the September 22 8-K intends, so the card read "$750MM refinanced ·
 * $1,000MM remains" where it had read "$500MM … pending".
 *
 *   S1  over all six names' pending moves, against the replayed v33 answers
 *       and the committed v31 ones: the sizing claim is a PENDING claim for
 *       that note, never one already in the balance
 *   S2  over all six names' completed moves: the sizing claim, if any, is one
 *       done since the position date
 *   control: the old chooser (first claim naming the note) sizes Tenet's
 *   pending 2028 move from a claim already in the balance
 *
 * Offline, $0. Run: npx tsx lib/cards/pendingSize.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifyRedeemsClaims } from "../events/position";
import { claimSizingMove, sameNoteOf } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const replay = existsSync("baselines/s27-replay.json") ? JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")) : { results: [] };
const sources: { label: string; result: any; cik: string }[] = [];
for (const cik of CIKS) {
  sources.push({ label: "v31 snapshot", cik, result: JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8")).result });
  const r = replay.results.find((x: any) => x.result.cik === cik);
  if (r) sources.push({ label: "v33 replay", cik, result: r.result });
}
let pendingChecked = 0;
for (const s of sources) {
  const factsPath = join("lib", "cards", "inputs", "facts", `${s.cik}.json`);
  if (!existsSync(factsPath)) continue;
  const moves = JSON.parse(readFileSync(factsPath, "utf-8")).moves ?? [];
  const dm = s.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const nd = s.result.results.find((t: any) => t.triggerId === "new-debt-issuance");
  const cls = classifyRedeemsClaims(dm, nd);
  for (const m of moves.filter((x: any) => /redemption|repayment|tender|repurchase|retire/i.test(x.type))) {
    const mv = { instrument: m.instrument.value, status: m.status, url: m.date.src.url };
    const c = claimSizingMove(mv, cls);
    if (!c) continue;
    const isPrior = cls.prior.some((x) => x.claim === c);
    if (m.status === "pending") {
      pendingChecked++;
      assert(cls.pending.some((x) => x.claim === c) && !isPrior, `[S1:${s.result.company} ${s.label}] pending "${mv.instrument}" is sized by a pending claim (${c.amount}), never one already in the balance`);
    } else {
      assert(cls.current.some((x) => x.claim === c) && !isPrior, `[S2:${s.result.company} ${s.label}] completed "${mv.instrument}" is sized by a claim done since the position date (${c.amount})`);
    }
  }
}
assert(pendingChecked > 0, `[S1] ${pendingChecked} pending move(s) sized (a check over none is not a check)`);

console.log("\n=== control: the old chooser ===");
const tenet = replay.results.find((x: any) => x.result.cik === "0000070318")?.result;
if (tenet) {
  const nd = tenet.results.find((t: any) => t.triggerId === "new-debt-issuance");
  const cls = classifyRedeemsClaims(tenet.results.find((t: any) => t.triggerId === "debt-maturity"), nd);
  const old = (nd.redeems ?? []).find((r: any) => sameNoteOf("6.125% senior unsecured notes due October 2028", r.instrument));
  assert(!!old && cls.prior.some((x) => x.claim === old), `[control] the first claim naming Tenet's 6.125% 2028 notes (${old?.amount}) is one already in the balance, so the old chooser would size the pending move from it`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
