/**
 * ONE NAME, CACHE_BUST x3 AT v30 — criterion 9b, tested rather than assumed.
 *
 * THIS RUN BILLS: three cold extractions.
 *
 * TWO QUESTIONS, REPORTED SEPARATELY, because folding them is how this
 * session's dominant defect class keeps happening:
 *
 *   9b — does the POSITION reproduce? Rows, amounts, dates, provenance,
 *        coverage. This is what GoldenState pins and what a signature covers.
 *
 *   the facility figures — do drawn / LCs / available / size reproduce? NOT
 *        covered by 9b, and we already know `drawn` gave two different
 *        answers across two v30 asks this session. It decides whether a
 *        re-baseline pins a value that holds, so it is measured and shown.
 *
 * A pass on the first with a failure on the second is a real outcome and must
 * be readable as one, not averaged into a verdict.
 *
 * CACHE_BUST writes to its own key per run, so the canonical answer — the one
 * the page serves and the re-baseline would pin — is never touched here.
 *
 * Run: npx tsx lib/cache/s23molinarepro.ts "<Company>"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, type GoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const COMPANY = process.argv[2] ?? "Molina Healthcare";
const RUNS = Number(process.env.REPRO_RUNS ?? 3);
const BUST_TAG = process.env.REPRO_TAG ?? "s23-9b";
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

interface Fig { value: string; sourceLine: string }
interface Snap {
  label: string;
  state: GoldenState;
  /** One line per row: identity, amount, date, provenance, capacity flag. */
  position: string[];
  coverage: string;
  /** One line per facility figure. */
  figures: string[];
  cost: number;
}

function positionOf(state: GoldenState): string[] {
  return state.rows
    .map((r) => `${r.instrument} | ${r.amount} | ${r.maturityDate} | ${r.dateGranularity} | ${r.provenance} | ${r.isCapacity}`)
    .sort();
}

/**
 * 9b BY THE COMPARATOR THE SIGNATURE IS MADE UNDER, not by string equality.
 *
 * The first version of this harness compared the raw lines above and reported
 * UHS's 9b as FAILING on fourteen fields. Eleven of the fourteen were not
 * movement at all:
 *
 *   - "$700 million" against "$ 700 million" — a space. golden.test.ts [7a]
 *     names this exactly: "WHITESPACE IS NOT A TRANSCRIPTION ... string
 *     equality called that a divergence, which blocks a signature over
 *     nothing and trains its reader to wave divergences through."
 *   - "Revolving Credit Facility" against "Revolving credit facility" — a
 *     RENAME. Session 22 moved row identity off the label for precisely this
 *     (Molina's own v29 evidence records it), so keying on the label reports
 *     one instrument as a row removed and a row added.
 *
 * A harness stricter than the signature it gates is not being careful; it is
 * measuring a different thing and reporting it under the signature's name.
 * `compareToGolden` IS that standard, so 9b is asked of it.
 */
function nineBVerdict(snaps: { state: GoldenState }[]): { holds: boolean; divergences: string[]; tolerated: string[] } {
  const divergences: string[] = [];
  const tolerated: string[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const v = compareToGolden(snaps[0].state, snaps[i].state);
    if (v.kind === "not-applicable") { divergences.push(`run 1 vs run ${i + 1}: ${v.reason}`); continue; }
    for (const t of v.tolerated) tolerated.push(`run 1 vs run ${i + 1}: ${t}`);
    if (v.kind === "diverged") divergences.push(...v.divergences.map((d) => `run 1 vs run ${i + 1}: ${d}`));
  }
  return { holds: divergences.length === 0, divergences, tolerated };
}

function figuresOf(result: { results: { triggerId: string; facilities?: unknown }[] }): string[] {
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
  return facs
    .flatMap((f) => FIELDS.map((k) => `${String(f.name)}.${k} = ${(f[k] as Fig | null)?.value ?? "null"}`))
    .sort();
}

/** Every distinct value a line took across the runs. One entry means it held. */
function driftOf(snaps: Snap[], pick: (s: Snap) => string[]): Map<string, Set<string>> {
  const keys = new Set<string>();
  const perRun = snaps.map((s) => {
    const m = new Map<string, string>();
    for (const line of pick(s)) {
      const i = line.indexOf(" = ") >= 0 ? line.indexOf(" = ") : line.indexOf(" | ");
      const k = i < 0 ? line : line.slice(0, i);
      m.set(k, line);
      keys.add(k);
    }
    return m;
  });
  const drift = new Map<string, Set<string>>();
  for (const k of keys) drift.set(k, new Set(perRun.map((m) => m.get(k) ?? "(absent this run)")));
  return drift;
}

(async () => {
  const snaps: Snap[] = [];
  let spend = 0;

  for (let i = 1; i <= RUNS; i++) {
    process.env.CACHE_BUST = `${BUST_TAG}-${COMPANY.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${i}`;
    const result = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;
    const cost = currentCompanySpend().totalUsd;
    spend += cost;
    const state = deriveGoldenState(result, PINNED_AS_OF);
    snaps.push({
      label: `run ${i}`,
      state,
      position: positionOf(state),
      coverage: `statedTotalDebt=${state.coverage.statedTotalDebt} capturedFace=${state.coverage.capturedFace} statedBridge=${state.coverage.statedBridge} denominator=${state.coverage.denominatorSource}`,
      figures: figuresOf(result),
      cost,
    });
    console.log(`\n  RUN ${i}: ${state.rows.length} rows   $${cost.toFixed(4)}`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — ${RUNS} CACHE_BUST re-asks at v${EXTRACTION_PROMPT_VERSION}, as-of ${PINNED_AS_OF_DAY}`);
  console.log("=".repeat(104));

  // ── 9b: the position ──────────────────────────────────────────────────
  const posDrift = driftOf(snaps, (s) => s.position);
  const posMoved = [...posDrift.entries()].filter(([, vals]) => vals.size > 1);
  const rowCounts = snaps.map((s) => s.position.length);
  const covSame = new Set(snaps.map((s) => s.coverage)).size === 1;

  console.log(`\n[9b] THE POSITION — what a signature covers\n`);
  console.log(`  rows per run: ${rowCounts.join(", ")}`);
  console.log(`  coverage:     ${covSame ? "identical across all three" : "MOVED"}`);
  if (!covSame) for (const s of snaps) console.log(`      ${s.label}: ${s.coverage}`);
  // THE VERDICT, by the comparator a signature is made under.
  const verdict = nineBVerdict(snaps);
  const nineBHolds = verdict.holds && covSame && new Set(rowCounts).size === 1;
  if (verdict.tolerated.length > 0) {
    console.log(`
  TOLERATED by the gate — reported, not counted, and written into the signature basis:`);
    for (const t of verdict.tolerated) console.log(`      ${t}`);
    console.log("");
  }
  if (verdict.holds) {
    console.log(`  every row reproduces under compareToGolden — identity, amount, date, granularity, provenance, capacity flag`);
  } else {
    console.log(`  ${verdict.divergences.length} divergence(s) under compareToGolden:`);
    for (const d of verdict.divergences) console.log(`      ${d}`);
  }

  // AND THE RAW LINES, SHOWN SEPARATELY AND LABELLED AS WHAT THEY ARE.
  // Whitespace and label renames are not divergences under the signature's
  // comparator, and they are still worth SEEING — a rename that appears every
  // run is Session 22's known Molina case; a rename that appears once may not
  // be. Shown, never counted toward the verdict.
  if (posMoved.length > 0) {
    console.log(`\n  ${posMoved.length} line(s) differ by transcription or label only — NOT divergences, shown so a rename is visible:`);
    for (const [k, vals] of posMoved) { console.log(`      ${k}`); for (const v of vals) console.log(`          ${v}`); }
  }
  console.log(`\n  9b: ${nineBHolds ? "HOLDS — the position reproduced three times at this version" : "DOES NOT HOLD — the position moved between runs at the same version"}`);

  // ── the facility figures ──────────────────────────────────────────────
  const figDrift = driftOf(snaps, (s) => s.figures);
  const figMoved = [...figDrift.entries()].filter(([, vals]) => vals.size > 1);
  console.log(`\n[FACILITY FIGURES] — NOT covered by 9b, and the reason we are here\n`);

  // VALUES WITHOUT LABELS, FIRST. figuresOf keys each figure by its facility's
  // NAME, so a facility the filing calls two things reads as five figures
  // vanishing and five appearing — UHS printed "40 figure(s) MOVED" for four
  // renamed facilities whose numbers never changed. The same label-keying
  // mistake as the position comparison, one layer down.
  //
  // So the multiset of VALUES is compared with names stripped. Identical
  // multisets plus differing names is one finding — a rename — not forty.
  const valuesOnly = snaps.map((s) =>
    [...s.figures]
      .map((line) => line.slice(line.indexOf(".") + 1).replace(/\s+/g, " ").replace(/\$ /g, "$"))
      .sort()
      .join("\n")
  );
  const valuesStable = new Set(valuesOnly).size === 1;
  const namesPerRun = snaps.map((s) => new Set(s.figures.map((l) => l.slice(0, l.indexOf(".")))));
  const namesStable = new Set(namesPerRun.map((n) => [...n].sort().join(" | "))).size === 1;
  console.log(`  values, with facility labels stripped: ${valuesStable ? "IDENTICAL across all three runs" : "MOVED"}`);
  console.log(`  facility labels:                       ${namesStable ? "identical across all three runs" : "MOVED — the filing names these instruments more than one way"}`);
  if (valuesStable && !namesStable) {
    console.log(`  → ONE finding, not ${[...driftOf(snaps, (s) => s.figures).entries()].filter(([, v]) => v.size > 1).length}: every figure holds, and the labels swing between the filing's own names.`);
    for (let i = 0; i < namesPerRun.length; i++) console.log(`      ${snaps[i].label}: ${[...namesPerRun[i]].sort().join(" | ")}`);
  }
  console.log("");
  if (figMoved.length === 0) {
    console.log(`  every facility figure identical across all three runs`);
  } else {
    console.log(`  ${figMoved.length} figure(s) MOVED between runs at the same version:`);
    // THE SENTINEL IS NOT A VALUE AND MUST NOT BE SLICED LIKE ONE. This read
    // `v.slice(v.indexOf(" = ") + 3)`, and "(absent this run)" contains no
    // " = " — indexOf returned -1, so it printed "bsent this run)". A report
    // that garbles the one line saying a thing was MISSING is the worst line
    // in the report to garble.
    for (const [k, vals] of figMoved) {
      console.log(`      ${k}`);
      for (const v of vals) {
        const i = v.indexOf(" = ");
        console.log(`          ${i < 0 ? v : v.slice(i + 3)}`);
      }
    }
  }
  for (const [k, vals] of figDrift) if (vals.size === 1 && /\.drawn/.test(k)) console.log(`  held: ${[...vals][0]}`);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} across ${RUNS} runs`);
  console.log(`  ${nineBHolds && figMoved.length === 0 ? "Both hold — a re-baseline pins values that reproduce." : nineBHolds ? "9b holds, but a facility figure does not. The position is signable; the figure it renders is not stable." : `9b does not hold. ${COMPANY} stays held, unsigned, exactly as it was.`}`);
  console.log("=".repeat(104));
})();
