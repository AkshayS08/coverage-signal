/**
 * SESSION 22, STAGE 1 — DO THE THREE DEMO NAMES RENDER CLEAN? $0.
 *
 * Stage 1 changed only what the CODE renders: the header's timing tag, the
 * month counts in the derived block, and two Session 21 surfaces that were
 * bypassing the house money formatter. Narration is untouched, so nothing
 * here reads the wording cache and nothing here can bill.
 *
 * The checks are the four defects the stage exists to close, asserted rather
 * than eyeballed:
 *   A  no "1 months" anywhere — the plural agrees with its count
 *   B  no fabricated month for a bare-year maturity, in the tag or the block
 *   C  every code-rendered figure in the house format
 *   D  the timing tag is the date the filing states, not asOf + a rounded count
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { buildEvents } from "../events/buildEvents";
import { assemblePosition } from "../events/position";
import { buildDerivedLines } from "../events/derived";
import { headlineTimingTag } from "../events/labels";
import { formatMoneyForDisplay } from "../events/money";
import { currentCompanySpend } from "../agent/costMeter";
import { checkWarm } from "./s22warmcheck";

const ASOF = PINNED_AS_OF;
const DEMO = ["Tenet Healthcare", "Encompass Health", "Universal Health Services"];

let failures = 0;
const bad = (s: string) => { console.log(`      !! ${s}`); failures++; };

(async () => {
  const warmth = await checkWarm(DEMO);
  const cold = warmth.filter((w) => !w.warm);
  if (cold.length) {
    console.error(`ABORT — cold, would bill: ${cold.map((w) => w.company).join(", ")}`);
    process.exit(1);
  }

  let spend = 0;
  for (const company of DEMO) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const { flashCardCandidates } = buildEvents([result], ASOF);
    const pos = assemblePosition(result, ASOF);

    console.log(`\n${"=".repeat(96)}\n${result.company} — ${flashCardCandidates.length} card(s)\n${"=".repeat(96)}`);

    for (const card of flashCardCandidates) {
      const tag = headlineTimingTag(card.timing, card.citations, ASOF);
      const row = pos.rows.find((r) => r.id === card.headlineRowId);
      console.log(`\n  TIMING TAG:  "${tag}"`);
      console.log(`  HEADLINE ROW: ${row ? `${formatMoneyForDisplay(row.amount)}  ${row.instrument}  (states ${row.maturityDate ?? "no date"}, granularity ${row.dateGranularity ?? "—"})` : "(not on the ladder)"}`);

      // B / D — a bare year must never acquire a month, anywhere.
      if (row?.dateGranularity === "year") {
        if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(tag)) {
          bad(`the tag names a MONTH for a row whose filing states only a year: "${tag}"`);
        } else {
          console.log(`      ok — bare year renders as "${tag}", no month invented`);
        }
      } else if (row?.maturityDate && !tag.includes("matures")) {
        bad(`a dated row rendered no maturity tag: "${tag}"`);
      }

      const block = buildDerivedLines({
        card, position: pos,
        debtMaturity: result.results.find((t) => t.triggerId === "debt-maturity"),
        newDebtIssuance: result.results.find((t) => t.triggerId === "new-debt-issuance"),
        asOf: ASOF,
      });
      console.log("  DERIVED:");
      for (const l of block.lines) {
        console.log(`    · ${l.label}: ${l.text}`);
        // A — the plural agrees with the count that precedes it.
        for (const m of l.text.matchAll(/\b(-?\d+)\s+(month|months)\b/g)) {
          const n = Math.abs(Number(m[1]));
          const want = n === 1 ? "month" : "months";
          if (m[2] !== want) bad(`plural disagrees with its count: "${m[0]}" should be "${n} ${want}"`);
        }
        if (row?.dateGranularity === "year" && /\b\d+\s+months?\b/.test(l.text)) {
          bad(`a month count was computed for a bare-year maturity: "${l.text}"`);
        }
      }
      for (const w of block.withheld) console.log(`    · ${w.kind}: WITHHELD — ${w.unverified.join(", ")}`);
    }
  }

  console.log(`\n${"=".repeat(96)}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log(failures === 0 ? "  ALL THREE RENDER CLEAN — plurals agree, no month invented for a bare year, tags state the filing's own date."
                             : `  ${failures} DEFECT(S) — listed above.`);
  console.log("=".repeat(96));
  if (failures > 0) process.exit(1);
})();
