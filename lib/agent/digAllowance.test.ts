/**
 * SESSION 27 (Akshay, Oct 31, 2026) — THE PER-BUILD CAP STAYS; DIGS DRAW ONLY
 * ON WHAT IS LEFT UNDER IT. A dig (a follow-up read) may spend only the cap
 * less the other stages' counted worst case. When the next dig would not fit,
 * it is refused before the call and its trigger renders as UNRESOLVED,
 * flagged on the card. A cap is never raised to fit a worst case.
 *
 *   D1  with an allowance of $0.10, a dig whose counted worst case is $0.06
 *       runs; the next ($0.06 more) is refused before any call is made
 *   D2  a non-dig call is not limited by the dig allowance
 *   D3  control: with no allowance set, both digs run
 *   D4  the card flags a trigger left unresolved by a refused dig; control:
 *       the same card without the refusal carries no flag
 *
 * A fake client (counted tokens, recorded usage); nothing can bill.
 * Offline, $0. Run: npx tsx lib/agent/digAllowance.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { guardedCreate, setSpendLimits, setDigAllowance, asKind, resetSpendGuard, DigRefusedError } from "./spendGuard";
import { buildCard } from "../cards/build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

// claude-haiku-4-5 at $1/M in, $5/M out: 10,000 in + 10,000 max out = $0.06 worst case; the fake reports half as used.
let created = 0;
const fake: any = { messages: { countTokens: async () => ({ input_tokens: 10_000 }), create: async () => { created++; return { usage: { input_tokens: 10_000, output_tokens: 5_000 }, content: [] }; } } };
const params: any = { model: "claude-haiku-4-5", max_tokens: 10_000, messages: [{ role: "user", content: "x" }] };
const dig = () => asKind("dig", () => guardedCreate(fake, params));

(async () => {
  resetSpendGuard(); setSpendLimits({ totalUsd: 2.0 }); setDigAllowance(0.10); created = 0;
  let first = false, second: unknown = null;
  try { await dig(); first = true; } catch { /* */ }
  try { await dig(); } catch (e) { second = e; }
  assert(first && second instanceof DigRefusedError && created === 1, `[D1] the first dig runs; the second would exceed the $0.10 left under the cap and is refused before the call (calls made: ${created})`);
  let other = false;
  try { await guardedCreate(fake, params); other = true; } catch { /* */ }
  assert(other && created === 2, `[D2] a non-dig call is not limited by the dig allowance`);
  resetSpendGuard(); setSpendLimits({ totalUsd: 2.0 }); created = 0;
  let both = 0;
  for (let k = 0; k < 2; k++) { try { await dig(); both++; } catch { /* */ } }
  assert(both === 2, `[D3 control] with no allowance set, both digs run`);

  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", "0001108109.json"), "utf-8"));
  const withUnresolved = JSON.parse(JSON.stringify(snap.result));
  const t = withUnresolved.results.find((x: any) => x.triggerId !== "debt-maturity");
  t.unresolved = "a follow-up read was refused: it would exceed what is left under the $2.00 per-build cap";
  const fp = join("lib", "cards", "inputs", "facts", "0001108109.json");
  const build = (result: any) => buildCard({ result, briefDate: "2026-10-15", previousBrief: "2026-10-04", weekFilings: [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: [], facts: existsSync(fp) ? JSON.parse(readFileSync(fp, "utf-8")) : null }) as any;
  const txt = (l: any[]) => l.map((s: any) => s.t ?? "").join("");
  const flagged = build(withUnresolved).v3.notShown.map(txt).join(" | ");
  assert(/unresolved/i.test(flagged) && /cap/i.test(flagged), `[D4] the card flags the unresolved trigger: "${flagged.slice(0, 160)}"`);
  const clean = build(snap.result).v3.notShown.map(txt).join(" | ");
  assert(!/unresolved/i.test(clean), `[D4 control] without the refusal, no unresolved flag`);

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
