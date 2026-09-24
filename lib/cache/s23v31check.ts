/**
 * THE THREE NAMED REGRESSIONS, ANSWERED FIRST. $0 — cache hits only, run
 * after the v31 cold pass.
 *
 * Declared before the pass billed, so these are pass/fail on the fixes rather
 * than a reading of whatever came back:
 *
 *   1. CIGNA — fix 1. Its ladder must stay honestly EMPTY (anchor rows
 *      rendering means the fix over-reached and started filling the position
 *      from an older filing), and referencedScheduleSequence must now be
 *      POPULATED — ~37 rows carrying the 10-K's own period column, not the
 *      anchor's.
 *
 *   2. TENET — fix 3. No legitimately million-printed figure may be disturbed
 *      (49 of 52 scaled ladder amounts in the book print in millions; a rule
 *      that touches those over-fired), and Tenet's revolver must read
 *      "$1.900 billion" as the filing prints it rather than "$1,900 million".
 *
 *   3. DAVITA — the canary. 9 rows, not 17. Its doubling is what surfaced the
 *      bad example, so its row count is the read on whether the correction
 *      actually took. 17 means the removal did not land.
 *
 * Run: npx tsx lib/cache/s23v31check.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

interface Fig { value: string; sourceLine: string }
const SCALE = /\b(thousand|million|billion|trillion)s?\b/i;

function formOf(s: string): { digits: string; scale: string } | null {
  const m = s.match(/([\d][\d,.]*)\s*(thousand|million|billion|trillion)s?/i);
  return m ? { digits: m[1], scale: m[2].toLowerCase() } : null;
}

/** Re-expression ONLY: the sentence states this quantity with a DIFFERENT scale word. */
function reExpressed(amount: string, sentence: string): boolean {
  const a = formOf(amount);
  if (!a) return false;
  const bare = a.digits.replace(/,/g, "");
  const scaled = [...sentence.matchAll(/([\d][\d,.]*)\s*(thousand|million|billion|trillion)s?/gi)];
  for (const m of scaled) if (m[1].replace(/,/g, "") === bare) return m[2].toLowerCase() !== a.scale;
  const mult: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
  const want = Number(bare) * (mult[a.scale] ?? 1);
  for (const m of scaled) {
    const v = Number(m[1].replace(/,/g, "")) * (mult[m[2].toLowerCase()] ?? 1);
    if (Number.isFinite(v) && Math.abs(v - want) < 1) return true;
  }
  return false;
}

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  let spend = 0;
  const rowsBy: Record<string, number> = {};
  const results: Record<string, { rows: { amount: string; sourceLine: string; instrument: string }[]; facilities: Record<string, Fig | null | string>[]; referenced: number; schedule: number; crossRef: string | null; periods: string[] }> = {};

  for (const company of ALL) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const refSeq = (dm?.referencedScheduleSequence ?? []) as Record<string, unknown>[];
    rowsBy[company] = pos.rows.length;
    results[company] = {
      rows: pos.rows.map((x) => ({ amount: String(x.amount ?? ""), sourceLine: String(x.sourceLine ?? ""), instrument: String(x.instrument) })),
      facilities: (dm?.facilities ?? []) as Record<string, Fig | null | string>[],
      referenced: refSeq.length,
      schedule: ((dm?.scheduleSequence ?? []) as unknown[]).length,
      crossRef: (dm?.noteCrossReference as { statement?: string } | null)?.statement ?? null,
      periods: [...new Set(refSeq.map((e) => String(e.periodColumn ?? "—")))],
    };
  }

  const line = (n: number) => "=".repeat(n);
  console.log(`\n${line(104)}\nv${EXTRACTION_PROMPT_VERSION} CHECKPOINT — the three named regressions\n${line(104)}`);

  // ── 1. CIGNA ─────────────────────────────────────────────────────────
  const c = results["Cigna Group"];
  const cignaEmpty = c.schedule === 0;
  console.log(`\n[1] CIGNA — fix 1: route, don't prohibit\n`);
  console.log(`    anchor scheduleSequence      ${c.schedule}   ${cignaEmpty ? "✓ honestly empty — the anchor has no locatable note and the ladder does not invent one" : "✗ FAILED — the fix over-reached and filled the anchor position"}`);
  console.log(`    referencedScheduleSequence   ${c.referenced}   ${c.referenced >= 30 ? "✓ populated" : c.referenced > 0 ? "~ populated but short of the ~37 expected" : "✗ STILL EMPTY — fix 1 did not land"}`);
  console.log(`    its period column(s)         ${c.periods.join(", ") || "—"}   ${c.periods.some((p) => /2025-12|2025/.test(p)) ? "✓ the 10-K's own period, not the anchor's" : c.referenced > 0 ? "⚠ check by eye — must be the 10-K's period" : ""}`);
  console.log(`    the anchor's own sentence    ${c.crossRef ? `"${c.crossRef.slice(0, 120)}"` : "— (none reported)"}`);
  console.log(`    ladder rows rendered         ${rowsBy["Cigna Group"]}`);

  // ── 2. TENET AND THE BOOK'S MILLIONS ─────────────────────────────────
  console.log(`\n[2] TENET — fix 3: copy the printed unit, never convert\n`);
  let millions = 0, broke = 0;
  const brokeLines: string[] = [];
  for (const [company, r] of Object.entries(results)) {
    for (const row of r.rows) {
      if (!SCALE.test(row.amount)) continue;
      const f = formOf(row.amount);
      if (f?.scale === "million") millions++;
      if (reExpressed(row.amount, row.sourceLine)) {
        broke++;
        brokeLines.push(`      ${company} — ${row.instrument.slice(0, 40).padEnd(42)} ${row.amount.padEnd(20)}\n        "${row.sourceLine.replace(/\s+/g, " ").slice(0, 150)}"`);
      }
    }
  }
  console.log(`    million-printed ladder amounts across the book   ${millions}`);
  console.log(`    of those, re-expressed (rule over-fired)          ${broke}   ${broke === 0 ? "✓ none disturbed" : "✗ THE RULE OVER-FIRED"}`);
  for (const b of brokeLines) console.log(b);
  const tenetRev = results["Tenet Healthcare"].facilities.find((x) => /revolv/i.test(String(x.name)));
  const revSize = (tenetRev?.facilitySize as Fig | null)?.value ?? "—";
  console.log(`\n    Tenet revolver facilitySize   ${revSize}   ${/1\.900\s*billion/i.test(revSize) ? "✓ reads as the filing prints it" : /1,900\s*million/i.test(revSize) ? "✗ STILL CONVERTED" : "⚠ neither form — check by eye"}`);
  if (tenetRev) console.log(`      its sentence: "${((tenetRev.facilitySize as Fig | null)?.sourceLine ?? "").replace(/\s+/g, " ").slice(0, 160)}"`);

  // ── 3. DAVITA, THE CANARY ────────────────────────────────────────────
  console.log(`\n[3] DAVITA — the canary on the corrected example\n`);
  const dv = rowsBy["DaVita"];
  console.log(`    ladder rows   ${dv}   ${dv === 9 ? "✓ 9 — the example removal landed" : dv >= 16 ? "✗ STILL DOUBLED — the removal did not take" : `⚠ ${dv} — neither 9 nor 17, read the rows`}`);
  const seen = new Map<string, number>();
  for (const row of results["DaVita"].rows) seen.set(row.instrument, (seen.get(row.instrument) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  console.log(`    duplicated instruments   ${dupes.length}${dupes.length ? ` — ${dupes.map(([k, n]) => `${k} x${n}`).join(", ")}` : "   ✓ none"}`);

  console.log(`\n${line(104)}`);
  console.log(`  rows per name: ${Object.entries(rowsBy).map(([k, v]) => `${k.split(" ")[0]} ${v}`).join(" · ")}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — must be $0.0000; anything else means this checkpoint re-billed`);
  console.log(line(104));
})();
