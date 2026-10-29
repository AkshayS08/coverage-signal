/**
 * SESSION 27 — SIGNING PROPOSALS, WHERE 3/3 HOLDS. $0, offline, writes no golden.
 *
 * For Tenet, Encompass (its pre-Oct 28 read set: the canonical and both
 * re-tastes were taken before its earnings 8-K), DaVita and Cigna:
 *   1. 3/3: each re-taste against the canonical v33 answer, under the same
 *      comparison and acceptances as s27nineb (Rule 66; countsToward9b, so a
 *      broken coverage tie is a check failure);
 *   2. the signer's refusals: Rule 58 (every amount stated by its sentence);
 *   3. the criteria, re-evaluated on the canonical answer;
 *   4. what re-signing would change: the canonical v33 state against the
 *      signed v31 state, every difference listed (compared across versions
 *      for the proposal only; goldenThroughLoop never does).
 * Akshay clears each name; nothing is signed here.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27signing.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, sourceLineCheckFor, countsToward9b, unsupportedAmountRows, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";

const AS_OF = new Date("2026-10-15T00:00:00Z");
const NAMES = ["0000070318", "0000785161", "0000927066", "0001739940"];
const canon = JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")).results as { result: any }[];
const re = JSON.parse(readFileSync("baselines/s27-retaste.json", "utf-8")).results as { bust: string; result: any }[];
const docsOf = (cik: string) => new Map<string, string>(Object.entries(JSON.parse(readFileSync(`lib/cards/inputs/${cik}.json`, "utf-8")).docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

/** s27nineb's comparison: Rule 66 accepted for the labelled prior-period base. */
function compare(c: any, r: any) {
  const expected: any = deriveGoldenState(c, AS_OF), actual: any = deriveGoldenState(r, AS_OF);
  const base = r.results.find((t: any) => t.triggerId === "debt-maturity")?.priorPeriodBase?.filingUrl;
  const extra = [...expected.filingSet.filter((u: string) => !actual.filingSet.includes(u)), ...actual.filingSet.filter((u: string) => !expected.filingSet.includes(u))];
  if (base && extra.length === 1 && extra[0] === base) {
    actual.filingSet = expected.filingSet;
    actual.otherCitations = (actual.otherCitations ?? []).filter((u: string) => u !== base);
    expected.otherCitations = (expected.otherCitations ?? []).filter((u: string) => u !== base);
  }
  const v = compareToGolden(expected, actual, { sourceLineCheck: sourceLineCheckFor(r, docsOf(r.cik), AS_OF) });
  return { v, tie: countsToward9b(expected, actual, v) };
}

for (const cik of NAMES) {
  const c = canon.find((x) => x.result.cik === cik)!.result;
  const samples = re.filter((x) => x.result.cik === cik);
  const g = JSON.parse(readFileSync(`baselines/golden/${cik}.json`, "utf-8")) as GoldenFile;
  const st: any = deriveGoldenState(c, AS_OF);
  say(`\n${"=".repeat(90)}\n${c.company} (CIK ${cik})`);
  const results = samples.map((s) => ({ bust: s.bust, ...compare(c, s.result) }));
  const n = 1 + results.filter((x) => x.tie.counts).length;
  say(`  9b: ${n}/${1 + samples.length} (canonical v33 + ${samples.length} re-tastes)${n === 3 ? " — HOLDS" : " — does not hold"}`);
  for (const x of results) {
    say(`    ${x.bust}: ${x.tie.counts ? "reproduces" : x.tie.checkFailure ? `CHECK FAILURE — ${x.tie.reason}` : "diverges"}`);
    if (x.v.kind === "diverged") for (const d of x.v.divergences) say(`      ✗ ${d.slice(0, 220)}`);
    if (x.v.kind !== "not-applicable") for (const t of x.v.tolerated) say(`      tolerated: ${t.slice(0, 220)}`);
  }
  const unsupported = unsupportedAmountRows(st);
  say(`  Rule 58: ${unsupported.length ? unsupported.map((u) => `REFUSES — ${u}`).join("; ") : "every amount is stated by its sentence"}`);
  say(`  position: ${st.rows.length} rows; captured face ${st.coverage.capturedFace}; residual ${st.coverage.residualPercent}% (${st.coverage.residualPasses ? "passes" : "FAILS"})${st.rolled ? `; rolled (${st.rolled.baseRows.length} base rows, ${st.rolled.deltas.length} deltas, roll ties: ${st.rolled.rollTies})` : ""}`);
  const crit = evaluateGoldenCriteria(c, AS_OF, { rowsCorrect: g.attestation?.rowsCorrect ?? true, instrumentTypeFaithful: g.attestation?.instrumentTypeFaithful ?? true, reproducedThreeTimes: n === 3, by: g.signature?.signedBy, on: g.signature?.signedOn });
  const moved = crit.criteria.filter((k) => { const o = g.criteria.find((x) => x.id === k.id); return !o || o.pass !== k.pass || o.detail !== k.detail; });
  say(`  criteria: ${crit.criteria.filter((k) => k.pass).length}/${crit.criteria.length} pass${crit.criteria.some((k) => !k.pass) ? ` (failing: ${crit.criteria.filter((k) => !k.pass).map((k) => k.id).join(", ")})` : ""}; changed from signed: ${moved.length ? moved.map((k) => k.id).join(", ") : "none"}`);
  for (const k of moved) say(`    ${k.id}: was "${(g.criteria.find((x) => x.id === k.id)?.detail ?? "—").slice(0, 160)}" → now "${k.detail.slice(0, 160)}"`);
  // Rule 66 for the proposal's comparison too: the labelled prior-period base joining the identity is accepted.
  const base = c.results.find((t: any) => t.triggerId === "debt-maturity")?.priorPeriodBase?.filingUrl;
  const signedState: any = JSON.parse(JSON.stringify(g.state));
  const added = st.filingSet.filter((u: string) => !signedState.filingSet.includes(u)), dropped = signedState.filingSet.filter((u: string) => !st.filingSet.includes(u));
  if (base && added.length === 1 && added[0] === base && dropped.length === 0) { signedState.filingSet = st.filingSet; say(`  against the signed state: accepted: Rule 66 — ${base.split("/").pop()} joins the identity`); }
  const vs = compareToGolden(signedState, st);
  say(`  against the signed v${g.extractionVersion} state (${g.signature?.signedOn}): ${vs.kind === "matches" ? "the position is unchanged" : vs.kind === "not-applicable" ? `NOT APPLICABLE — ${vs.reason}` : `${vs.divergences.length} difference(s)`}`);
  if (vs.kind === "diverged") for (const d of vs.divergences) say(`      Δ ${d.slice(0, 220)}`);
  if (vs.kind !== "not-applicable") for (const t of vs.tolerated) say(`      tolerated: ${t.slice(0, 220)}`);
}
writeFileSync("sessions/27/signing_proposals.txt", lines.join("\n") + "\n");
