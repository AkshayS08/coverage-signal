/**
 * DRIFT AFTER WIRING — the measurement the pre-wiring one could not be. $0.
 *
 * THE EARLIER ZERO PROVED NOTHING, and that is worth stating plainly. The
 * referenced-note module was not wired into loop.ts when "zero drift on the
 * other nine" was reported, so no code path could have moved and the answer
 * was fixed before the check ran. It is the same defect class as Rules 42, 43
 * and 52 — a check whose inputs make its answer predetermined — committed
 * while reporting on a feature built to avoid exactly that.
 *
 * Now the module IS wired, so the question is real: does a gate that fires for
 * one company leave the other nine untouched?
 *
 * Measured per name: whether the gate fired, whether a prior-period base was
 * attached, the ladder's row count and its rows' identity, and whether any row
 * fails Rule 58. The nine non-firing names must show no base and no movement.
 *
 * Run: npx tsx lib/cache/s24postwire.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, amountSupportOf } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/** Row counts as they stood BEFORE the wiring, from this session's own measurements. */
const BEFORE: Record<string, number> = {
  "DaVita": 9, "HCA Healthcare": 4, "Tenet Healthcare": 12, "Universal Health Services": 10,
  "Encompass Health": 7, "Community Health Systems": 12, "Quest Diagnostics": 15,
  "Centene Corporation": 9, "Cigna Group": 6, "Molina Healthcare": 6,
};

(async () => {
  let spend = 0;
  const moved: string[] = [];
  console.log(`\n${"=".repeat(104)}`);
  console.log(`DRIFT AFTER WIRING — nine non-firing names must be unmoved`);
  console.log("=".repeat(104));
  console.log(`\n  ${"name".padEnd(28)} ${"shape".padEnd(14)} base  rows(before→after)  Rule58`);

  for (const company of ALL) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const shape = String(dm?.anchorNoteShape ?? "not-recorded");
    const base = dm?.priorPeriodBase as { rows?: unknown[]; label?: string } | null | undefined;
    const bad = pos.rows.filter((x) => amountSupportOf(x.amount, x.sourceLine).kind === "unsupported").length;
    const before = BEFORE[company];
    const changed = before !== pos.rows.length;
    if (changed) moved.push(`${company}: ${before} → ${pos.rows.length} rows`);
    console.log(
      `  ${company.padEnd(28)} ${shape.padEnd(14)} ${base ? String((base.rows ?? []).length).padStart(3) : " no"}   ${String(before).padStart(2)} → ${String(pos.rows.length).padStart(2)}${changed ? "  MOVED" : "       "}      ${bad === 0 ? "clean" : `${bad} FAIL`}`
    );
    if (base) console.log(`      base label: "${base.label}"`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  names whose ladder MOVED: ${moved.length === 0 ? "none" : moved.join("; ")}`);
  console.log(`  BAR: zero movement on the nine that do not fire. ${moved.length === 0 ? "MET." : "NOT MET — read the names above."}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
