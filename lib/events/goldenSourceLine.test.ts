/**
 * SESSION 27 — A TOLERATED DIFFERENCE CLASS FOR 9b AND GOLDEN COMPARISON
 * (Akshay, Oct 23, 2026): a cited source line may differ across samples if it
 * appears verbatim in the same document and states the amount (Rule 58).
 *
 * A derived line's inputs are the source lines of the rows it computes from.
 * Two samples can transcribe the same row's line differently — Tenet's
 * "5.125 % due 2027 $ 1,500 $ 1,500" (signed) and "Senior secured first lien
 * notes: 5.125 % due 2027 1,500" (v33) — while the row, its amount and its
 * document are the same. That difference is tolerated, and recorded, when:
 *   - both inputs are the source lines of the same row (same instrument, same amount);
 *   - the new line is verbatim (whitespace aside) in the document that row cites;
 *   - the new line states the row's amount.
 * Otherwise it stays a divergence. With no check supplied the comparison is
 * as strict as before.
 *
 *   L1  Tenet's real case: the signed golden against the replayed v33 answer
 *   L2  over every name with a derived line: an input re-spaced (still
 *       verbatim, still stating the amount) is tolerated
 *   controls: a line in no document; a line stating another amount; no check
 *
 * Offline, $0. Run: npx tsx lib/events/goldenSourceLine.test.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { compareToGolden, deriveGoldenState, sourceLineCheckFor, type GoldenFile } from "./golden";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const goldens = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8")) as GoldenFile).filter((g) => g.extractionVersion === 31);
const snap = (cik: string) => JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
const docsOf = (cik: string) => new Map<string, string>(Object.entries(snap(cik).docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));

console.log("\n=== L1: Tenet, signed v31 against the replayed v33 answer ===");
const replay = existsSync("baselines/s27-replay.json") ? JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")) : null;
const tg = goldens.find((g) => g.state.cik === "0000070318")!;
const tr = replay?.results.find((x: any) => x.result.cik === "0000070318")?.result;
if (tr) {
  const asOf = new Date(`${tg.state.asOf}T00:00:00Z`);
  const actual = deriveGoldenState(tr, asOf);
  const strict = compareToGolden(tg.state, actual);
  const tolerant = compareToGolden(tg.state, actual, { sourceLineCheck: sourceLineCheckFor(tr, docsOf("0000070318"), asOf) });
  assert(strict.kind === "diverged" && strict.divergences.every((d) => /derived\[".+"\]\.inputs/.test(d)), `[L1 control] without the check, the only divergences are the derived lines' inputs (${strict.kind === "diverged" ? strict.divergences.length : 0})`);
  assert(tolerant.kind === "matches" && tolerant.tolerated.some((t) => /derived\[".+"\]\.inputs/.test(t)), `[L1] with the check, Tenet matches and the re-transcribed inputs are recorded as tolerated`);
}

console.log("\n=== L2: every name with a derived line ===");
for (const g of goldens) {
  const s = snap(g.state.cik);
  const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
  const base = deriveGoldenState(s.result, asOf);
  const card = base.cards.find((c) => c.derived.some((d) => d.inputs.some((i) => base.rows.some((r) => r.sourceLine === i))));
  if (!card) { console.log(`  · ${g.state.company}: no derived line computed from a row — nothing to vary`); continue; }
  const dl = card.derived.find((d) => d.inputs.some((i) => base.rows.some((r) => r.sourceLine === i)))!;
  const j = dl.inputs.findIndex((i) => base.rows.some((r) => r.sourceLine === i));
  const row = base.rows.find((r) => r.sourceLine === dl.inputs[j])!;
  const check = sourceLineCheckFor(s.result, docsOf(g.state.cik), asOf);
  const vary = (line: string) => {
    const a = JSON.parse(JSON.stringify(base));
    const ar = a.rows.find((r: any) => r.instrument === row.instrument); ar.sourceLine = line;
    a.cards.find((c: any) => c.triggerId === card.triggerId).derived.find((d: any) => d.kind === dl.kind).inputs[j] = line;
    return a;
  };
  const respaced = row.sourceLine.replace(/ /g, "  ");
  const v1 = compareToGolden(base, vary(respaced), { sourceLineCheck: check });
  assert(v1.kind === "matches", `[L2:${g.state.company}] "${dl.kind}" input re-spaced (verbatim, states ${row.amount}) is tolerated`);
  const v2 = compareToGolden(base, vary(`${row.instrument} ${row.amount} appears in no filing`), { sourceLineCheck: check });
  assert(v2.kind === "diverged", `[L2 control:${g.state.company}] an input in no document is a divergence`);
  const other = base.rows.find((r) => r.amount !== row.amount && r.sourceLine && !r.isCapacity);
  if (other) assert(compareToGolden(base, vary(other.sourceLine), { sourceLineCheck: check }).kind === "diverged", `[L2 control:${g.state.company}] an input stating another row's amount (${other.amount}) is a divergence`);
  assert(compareToGolden(base, vary(respaced)).kind === "diverged", `[L2 control:${g.state.company}] with no check supplied, the comparison stays strict`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
