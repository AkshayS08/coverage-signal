/**
 * SESSION 27, STAGE 1, STEP 6 — EACH RE-EXTRACTED NAME AGAINST ITS SIGNED GOLDEN. $0, offline.
 *
 * Reads the results of a phase (baselines/s27-<phase>.json) and compares
 * each, through the same derivation goldenThroughLoop uses
 * (deriveGoldenState, compareToGolden), with the v31 golden it was signed
 * as, plus the position identity (Rule 65). "Zero position change" means
 * both match. Nothing here re-signs.
 *
 * Two differences are ACCEPTED by Akshay's rulings of Oct 22, 2026, each by
 * rule and never by name, and every acceptance is printed:
 *   - Rule 66: a document joins the position identity only as the result's
 *     own labelled prior-period base (priorPeriodBase), where the signed
 *     state already cited it. The comparison then runs with it in place.
 *   - A changed instrument label, paired to its signed row by amount,
 *     maturity, status and provenance, is accepted only when the new label is
 *     a verbatim substring of the row's own cited sentence (whitespace aside,
 *     case kept). Otherwise it stays a divergence.
 *
 * And one stability control per name: the position derived with the
 * retirements the classifier holds in the balance (rule (a)) and the note's
 * own retirement prose removed must equal the position derived with them.
 *
 * Run: npx tsx lib/cache/s27diff.ts replay
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, positionFilingSetOf, type GoldenFile, type GoldenState } from "../events/golden";

const phase = process.argv[2] ?? "canonical";
const run = JSON.parse(readFileSync(`baselines/s27-${phase}.json`, "utf-8")) as { results: { company: string; bust: string | null; usd: number; result: any }[] };
const goldens = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8")) as GoldenFile);
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const squash = (x: string) => x.replace(/\s+/g, "");
const verbatim = (label: string, sentence: string) => squash(sentence).includes(squash(label));
let changed = 0;

for (const r of run.results) {
  const g = goldens.find((x) => x.state.cik === r.result.cik && x.extractionVersion === 31);
  if (!g) { say(`${r.company}: NO v31 GOLDEN to compare against`); changed++; continue; }
  const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
  const actual: GoldenState = JSON.parse(JSON.stringify(deriveGoldenState(r.result, asOf)));
  let expected: GoldenState = JSON.parse(JSON.stringify(g.state));
  const accepted: string[] = [], refused: string[] = [];

  // Rule 66: the labelled prior-period base joining the identity.
  const dm = r.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const base = dm?.priorPeriodBase?.filingUrl as string | undefined;
  const idNow = positionFilingSetOf(r.result, asOf), idThen = g.state.filingSet;
  const added = idNow.filter((u) => !idThen.includes(u)), removed = idThen.filter((u) => !idNow.includes(u));
  if (removed.length === 0 && added.length === 1 && base && added[0] === base && ((g.state as any).otherCitations ?? []).includes(base)) {
    expected = { ...expected, filingSet: idNow, ...((expected as any).otherCitations ? { otherCitations: ((expected as any).otherCitations as string[]).filter((u) => u !== base) } : {}) } as GoldenState;
    accepted.push(`Rule 66: ${base.split("/").pop()} joins the position identity as the labelled prior-period base (it was already cited)`);
  }

  // Changed labels, paired by everything but the label — only where the plain comparison diverges on them.
  const plain = compareToGolden(expected, actual);
  const divergedOn = (label: string) => plain.kind === "diverged" && plain.divergences.some((d) => d.includes(label));
  const keyOf = (x: any) => [x.amount, x.maturityDate, x.status, x.provenance, x.isCapacity].join("|");
  for (const row of actual.rows) {
    if (expected.rows.some((e) => e.instrument === row.instrument)) continue;
    const twin = expected.rows.filter((e) => !actual.rows.some((a) => a.instrument === e.instrument) && keyOf(e) === keyOf(row));
    if (twin.length !== 1 || plain.kind === "matches" || !(divergedOn(row.instrument) || divergedOn(twin[0].instrument) || (plain.kind === "diverged" && plain.divergences.some((d: string) => /^rows/.test(d))))) continue;
    if (verbatim(row.instrument, row.sourceLine)) { accepted.push(`label "${twin[0].instrument}" → "${row.instrument}", verbatim in its sentence`); row.instrument = twin[0].instrument; }
    else refused.push(`label "${twin[0].instrument}" → "${row.instrument}" NOT accepted: not verbatim in its sentence "${row.sourceLine.slice(0, 90)}…"`);
  }
  if (actual.rolled && expected.rolled) for (const d of actual.rolled.deltas) {
    if (expected.rolled.deltas.some((e) => e.instrument === d.instrument)) continue;
    const twin = expected.rolled.deltas.filter((e) => !actual.rolled!.deltas.some((a) => a.instrument === e.instrument) && e.amountMillions === d.amountMillions && e.sourceLine === d.sourceLine);
    if (twin.length !== 1 || plain.kind === "matches") continue;
    if (verbatim(d.instrument, d.sourceLine)) { accepted.push(`roll delta label "${twin[0].instrument}" → "${d.instrument}", verbatim in its sentence`); d.instrument = twin[0].instrument; }
    else refused.push(`roll delta label "${twin[0].instrument}" → "${d.instrument}" NOT accepted: not verbatim in its sentence`);
  }

  const verdict = compareToGolden(expected, actual);
  const sameId = (verdict.kind !== "not-applicable") && actual.filingSet.join("|") === expected.filingSet.join("|");
  const same = verdict.kind === "matches" && sameId && refused.length === 0;
  if (!same) changed++;
  say(`\n${r.company}${r.bust ? ` [${r.bust}]` : ""} ($${r.usd.toFixed(4)}): ${same ? "ZERO POSITION CHANGE against the signed v31 golden" : "POSITION CHANGED — a finding to explain before any signing"}`);
  for (const a of accepted) say(`    accepted: ${a}`);
  for (const x of refused) say(`    ${x}`);
  if (verdict.kind === "diverged") for (const d of verdict.divergences) say(`    ${d}`);
  if (verdict.kind === "not-applicable") say(`    not applicable: ${verdict.reason}`);
  if (!sameId && verdict.kind !== "not-applicable") say(`    position identity: signed on ${expected.filingSet.map((u) => u.split("/").pop()).join(", ")}; now ${actual.filingSet.map((u) => u.split("/").pop()).join(", ")}`);

  // Stability: the position with and without the EXTRA events — the redemption
  // claims and note-prose retirements this answer has that the signed one did not.
  const signedOf = (res: any, id: string) => res.results.find((t: any) => t.triggerId === id);
  // An event is its sentence: a relabelled instrument is the same event, not an extra one.
  const sig = (c: any) => String(c.sourceLine ?? "").replace(/\s+/g, "");
  const signedRedeems = new Set((signedOf(g.sourceResult, "new-debt-issuance")?.redeems ?? []).map(sig));
  const signedNotes = new Set((signedOf(g.sourceResult, "debt-maturity")?.noteRetirements ?? []).map(sig));
  const stripped = JSON.parse(JSON.stringify(r.result));
  const snd = signedOf(stripped, "new-debt-issuance"), sdm = signedOf(stripped, "debt-maturity");
  const extraRedeems = (snd?.redeems ?? []).filter((c: any) => !signedRedeems.has(sig(c))).length;
  const extraNotes = (sdm?.noteRetirements ?? []).filter((c: any) => !signedNotes.has(sig(c))).length;
  if (snd) snd.redeems = (snd.redeems ?? []).filter((c: any) => signedRedeems.has(sig(c)));
  if (sdm) sdm.noteRetirements = (sdm.noteRetirements ?? []).filter((c: any) => signedNotes.has(sig(c)));
  const stable = JSON.stringify(deriveGoldenState(stripped, asOf)) === JSON.stringify(deriveGoldenState(r.result, asOf));
  say(`    stability: ${stable ? "the same" : "NOT the same"} position with and without the ${extraRedeems} redemption claim(s) and ${extraNotes} note-prose retirement(s) the signed answer did not have`);
  if (!stable) changed++;
}
say(`\n${run.results.length - changed} of ${run.results.length} with zero position change.`);
writeFileSync(`sessions/27/stage1_diffs_${phase}.txt`, lines.join("\n") + "\n");
process.exit(changed > 0 ? 1 : 0);
