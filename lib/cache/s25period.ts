/**
 * SESSION 25 — WHICH PERIOD DOES EACH CURRENT-POSITION FIGURE BELONG TO?
 *
 * Diagnosis only. $0 — every sample is already bought and cached.
 *
 * Sample 2's position filing set is 3 documents where samples 1 and 3 are 2.
 * The extra document is the prior-period 10-K, and it arrives through a
 * FACILITY FIGURE's `figureSources` — the one path into the position that has
 * no anchor rule at all. Schedule rows have `rowsOnAnchor`; prose instruments
 * have `onAnchor`; facility figures have neither.
 *
 * Before writing a rule, look at what the sentences actually say (Rule 63 —
 * ask every producer, not the likeliest one).
 *
 * Run: npx tsx lib/cache/s25period.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { positionFilingSetOf } from "../events/golden";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";
import { PINNED_AS_OF } from "./pinnedAsOf";

const COMPANY = "Cigna Group";
const BUST_TAG = "s25-cigna";
const asOf = new Date(PINNED_AS_OF);

const short = (s: unknown, n = 150) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const doc = (u: string) => u.split("/").pop() ?? u;

(async () => {
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST;
    else process.env.CACHE_BUST = `${BUST_TAG}-${n}`;
    const r = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;

    const dm = r.results.find((t) => t.triggerId === "debt-maturity");
    const anchor = dm?.debtScheduleSourceFiling ?? null;
    const set = positionFilingSetOf(r, asOf);
    const pos = assemblePosition(r, asOf);

    console.log(`\n${"=".repeat(112)}`);
    console.log(`  ${n === 0 ? "sample 1 (canonical)" : `sample ${n + 1} (re-taste)`}`);
    console.log("=".repeat(112));
    console.log(`  anchor: ${anchor?.form} ${anchor?.reportDate}  ${doc(anchor?.url ?? "—")}`);
    console.log(`  position filing set (${set.length}): ${set.map(doc).join(", ")}`);
    console.log(`  ladder rows: ${pos.rows.length}`);

    console.log(`\n  --- ladder rows and their documents ---`);
    for (const row of pos.rows) {
      console.log(`    ${row.instrument.slice(0, 44).padEnd(46)} ${String(row.amount).padEnd(18)} ${row.citedUrl ? doc(row.citedUrl) : "(no url — facility row)"}`);
    }

    console.log(`\n  --- facility figures, each against its own sentence ---`);
    for (const f of dm?.facilities ?? []) {
      console.log(`    facility: ${f.name}`);
      console.log(`      citedUrl: ${doc(f.citedUrl ?? "—")}`);
      for (const field of ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const) {
        const fig = (f as unknown as Record<string, { value?: string; sourceLine?: string } | null>)[field];
        if (!fig) continue;
        const src = f.figureSources?.[field] ?? "";
        const offAnchor = src && anchor?.url && src !== anchor.url;
        console.log(`      ${field.padEnd(16)} = ${String(fig.value).padEnd(20)} from ${doc(src || "—")}${offAnchor ? "   <<< NOT THE ANCHOR" : ""}`);
        console.log(`        "${short(fig.sourceLine)}"`);
      }
    }
  }
  console.log(`\n  SPEND: $${currentCompanySpend().totalUsd.toFixed(4)}`);
})();
