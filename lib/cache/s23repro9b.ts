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
import { deriveGoldenState, type GoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const COMPANY = process.argv[2] ?? "Molina Healthcare";
const RUNS = Number(process.env.REPRO_RUNS ?? 3);
const BUST_TAG = process.env.REPRO_TAG ?? "s23-9b";
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

interface Fig { value: string; sourceLine: string }
interface Snap {
  label: string;
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
  if (posMoved.length === 0) {
    console.log(`  every row identical across all three runs — identity, amount, date, granularity, provenance, capacity flag`);
  } else {
    console.log(`  ${posMoved.length} row field(s) MOVED:`);
    for (const [k, vals] of posMoved) { console.log(`      ${k}`); for (const v of vals) console.log(`          ${v}`); }
  }
  const nineBHolds = posMoved.length === 0 && covSame && new Set(rowCounts).size === 1;
  console.log(`\n  9b: ${nineBHolds ? "HOLDS — the position reproduced three times at this version" : "DOES NOT HOLD — the position moved between runs at the same version"}`);

  // ── the facility figures ──────────────────────────────────────────────
  const figDrift = driftOf(snaps, (s) => s.figures);
  const figMoved = [...figDrift.entries()].filter(([, vals]) => vals.size > 1);
  console.log(`\n[FACILITY FIGURES] — NOT covered by 9b, and the reason we are here\n`);
  if (figMoved.length === 0) {
    console.log(`  every facility figure identical across all three runs`);
  } else {
    console.log(`  ${figMoved.length} figure(s) MOVED between runs at the same version:`);
    for (const [k, vals] of figMoved) { console.log(`      ${k}`); for (const v of vals) console.log(`          ${v.slice(v.indexOf(" = ") + 3)}`); }
  }
  for (const [k, vals] of figDrift) if (vals.size === 1 && /\.drawn/.test(k)) console.log(`  held: ${[...vals][0]}`);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} across ${RUNS} runs`);
  console.log(`  ${nineBHolds && figMoved.length === 0 ? "Both hold — a re-baseline pins values that reproduce." : nineBHolds ? "9b holds, but a facility figure does not. The position is signable; the figure it renders is not stable." : "9b does not hold. Molina stays held, unsigned, exactly as Session 22 left it."}`);
  console.log("=".repeat(104));
})();
