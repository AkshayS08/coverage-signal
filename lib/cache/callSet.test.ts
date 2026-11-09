/**
 * SESSION 27 (Akshay, Nov 9, 2026) — THE PRICED CALL SET EQUALS THE CALL SET THE RUN WOULD MAKE (lib/cache/callSet.ts).
 *   C1  every recorded pricing that records its calls prices every call its run would make
 *   C2  Cigna's re-declared pricing counts the referenced-note call for each sample whose note is not cached
 *   C3  control: Cigna's Nov 9 $1.75 pricing (base, digs, proceeds-use, facts; no note) fails
 *
 * Offline, $0. Run: npx tsx lib/cache/callSet.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { callSetFor, unpricedCalls, type Call } from "./callSet";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const BUSTS = [null, "s27-refresh-retaste-1", "s27-refresh-retaste-2"];

const priced = nonEmpty("the recorded pricings with their call sets", ["sessions/27/cigna_q3_pricing.json", "sessions/27/encompass_q3_pricing_recheck.json"].filter(existsSync).flatMap((p) => JSON.parse(readFileSync(p, "utf-8")).rows.filter((r: any) => Array.isArray(r.calls)).map((r: any) => ({ p, r }))));
for (const { p, r } of priced) {
  const would = callSetFor({ samples: BUSTS, directsToTenK: !!r.directsToTenK, noteCached: r.noteCached ?? {}, digBudget: 5, factsAsks: 3 });
  const v = unpricedCalls(r.calls as Call[], would);
  assert(v.length === 0, `[C1:${r.company}] ${p}: the priced call set equals the run's${v.length ? ` — ${v.join("; ")}` : ""}`);
}
const cig = priced.find((x) => /Cigna/.test(x.r.company));
assert(!!cig && cig.r.directsToTenK && (cig.r.calls as Call[]).filter((c) => c.stage === "referenced-note").length === BUSTS.filter((b) => !(cig.r.noteCached ?? {})[b ?? "canonical"]).length, `[C2] Cigna's pricing counts a referenced-note call for each sample whose note is not cached (${cig ? (cig.r.calls as Call[]).filter((c) => c.stage === "referenced-note").map((c) => c.sample).join(", ") : "no row"})`);

// C3: the Nov 9 pricing priced, per sample, the base, the dig budget and proceeds-use, and the facts asks: no note call.
const nov9: Call[] = [...BUSTS.flatMap((b) => [{ sample: b ?? "canonical", stage: "base", count: 1 }, { sample: b ?? "canonical", stage: "dig", count: 5 }, { sample: b ?? "canonical", stage: "proceeds-use", count: 1 }] as Call[]), { sample: "facts", stage: "facts", count: 3 }];
const wouldCig = callSetFor({ samples: BUSTS, directsToTenK: true, noteCached: cig?.r.noteCached ?? {}, digBudget: 5, factsAsks: 3 });
assert(unpricedCalls(nov9, wouldCig).length > 0, `[C3 control] the Nov 9 $1.75 pricing, without the note call, fails: ${unpricedCalls(nov9, wouldCig).join("; ")}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
