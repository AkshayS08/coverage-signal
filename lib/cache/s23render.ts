/**
 * SESSION 23 — THE RENDER STATE, FOR A HAND-CHECK. $0, cache hits only.
 *
 * Items 1 (stated zero), 3 (borrowing base) and the position.ts:603 collapse
 * fix all changed what renders, over the SAME cached v30 answers. This prints
 * the result for a person to read against the filings before anything is
 * re-signed — the ladder each company renders, and every facility's four
 * figures with the basis that governs them.
 *
 * Every figure shown is one that survived verification against its own
 * sentence, so what prints here is what the product would show.
 *
 * Run: npx tsx lib/cache/s23render.ts [company ...]
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { checkRevolverArithmetic } from "../events/coverage";
import { borrowingBaseOf } from "../agent/borrowingBase";
import { currentCompanySpend } from "../agent/costMeter";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const v = (f: { value: string } | null | undefined) => (f ? f.value : "—");

(async () => {
  const names = process.argv.length > 2 ? process.argv.slice(2) : ALL;
  let spend = 0;
  for (const company of names) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");

    console.log(`\n${"=".repeat(104)}`);
    console.log(`${result.company} — ${pos.rows.length} ladder rows`);
    console.log("=".repeat(104));
    for (const r of pos.rows) {
      console.log(
        `  ${String(r.instrument).slice(0, 50).padEnd(52)} ${String(r.amount ?? "—").slice(0, 18).padEnd(20)} ` +
          `${(r.maturityDate ?? "—").padEnd(12)} ${r.isCapacity ? "capacity" : "debt"}`
      );
    }

    const facs = dm?.facilities ?? [];
    if (facs.length === 0) continue;
    console.log(`\n  FACILITIES`);
    for (const f of facs) {
      const bb = borrowingBaseOf(f);
      const arith = checkRevolverArithmetic(f);
      console.log(`\n    ${f.name}`);
      console.log(`      size ${v(f.facilitySize).padEnd(16)} drawn ${v(f.drawn).padEnd(14)} LCs ${v(f.lettersOfCredit).padEnd(14)} available ${v(f.available).padEnd(16)} matures ${v(f.maturity)}`);
      console.log(`      ${bb ? `BORROWING-BASE LIMITED (${bb.signal}) — ${bb.limitedBy}` : "no stated limit on availability"}`);
      if (arith.checked) {
        console.log(`      check: ${arith.kind}${arith.impliedBaseMillions !== undefined ? ` — implied base ~$${Math.round(arith.impliedBaseMillions)}M` : ""}`);
        if (arith.kind === "unexplained-gap") console.log(`      ⚠ ${arith.note}`);
      } else {
        console.log(`      check: not checkable — fewer than all four figures stated`);
      }
    }
  }
  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — cache hits only; a non-zero figure here means something re-billed and must be explained.`);
  console.log("=".repeat(104));
})();
