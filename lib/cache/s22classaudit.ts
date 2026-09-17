/**
 * SESSION 22, STAGE 2 — WHAT CLASS AND TYPE MATERIAL ACTUALLY EXISTS. $0.
 *
 * Rule 32 settled that the class string is already extracted verbatim from
 * the note's own section header and already rendered — so the Session 22
 * item is NORMALIZE, COMPLETE, ADD TYPE, MAKE STRUCTURAL, not "add the
 * field". Which means the normalization has to be built against the actual
 * spellings the filers use, not against a vocabulary invented here. Rule 22
 * on the reading side: measure the source, do not instruct it.
 *
 * So, before any mapping is written, this prints:
 *   - every distinct seniority string on the book, with the rows carrying it
 *   - every row carrying NONE, with its instrument name, because "class not
 *     disclosed" versus "class we failed to map" is the whole distinction
 *   - the note's own section headings, which is where the class comes from
 *   - every instrument name, which is where the TYPE has to come from since
 *     no type field exists anywhere
 *
 * $0 and structurally so — checkWarm first, cold companies named and skipped.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, normalizeScheduleSequence } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";
import { checkWarm } from "./s22warmcheck";

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  const warmth = await checkWarm(BOOK);
  const cold = warmth.filter((w) => !w.warm);
  if (cold.length) console.log(`\n  SKIPPED, would bill: ${cold.map((w) => w.company).join(", ")}`);

  const seniorityStrings = new Map<string, string[]>();
  const sectionStrings = new Map<string, string[]>();
  const noClass: string[] = [];
  const allInstruments: string[] = [];
  let spend = 0, rowsTotal = 0, rowsClassed = 0;

  for (const company of warmth.filter((w) => w.warm).map((w) => w.company)) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const seq = normalizeScheduleSequence(dm?.scheduleSequence);

    for (const e of seq) {
      if (!e.section) continue;
      if (!sectionStrings.has(e.section)) sectionStrings.set(e.section, []);
      sectionStrings.get(e.section)!.push(company);
    }

    console.log(`\n${"=".repeat(100)}\n${result.company}  —  ${pos.rows.length} row(s)\n${"=".repeat(100)}`);
    for (const r of pos.rows) {
      rowsTotal++;
      allInstruments.push(r.instrument);
      const cls = r.seniority?.trim() || "";
      if (cls) {
        rowsClassed++;
        if (!seniorityStrings.has(cls)) seniorityStrings.set(cls, []);
        seniorityStrings.get(cls)!.push(company);
      } else {
        noClass.push(`${company}: ${r.instrument}${r.isCapacity ? "  [capacity]" : ""}`);
      }
      console.log(`  ${(cls || "(no class)").padEnd(34)} ${r.isCapacity ? "CAP " : "    "} ${r.instrument.slice(0, 56)}`);
    }
  }

  console.log(`\n${"=".repeat(100)}\nDISTINCT CLASS STRINGS — what the normalization must map FROM\n${"=".repeat(100)}`);
  for (const [s, companies] of [...seniorityStrings].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(companies.length).padStart(3)}x  "${s}"   (${[...new Set(companies)].join(", ")})`);
  }

  console.log(`\n${"=".repeat(100)}\nNOTE SECTION HEADINGS — the class's own source in the filing\n${"=".repeat(100)}`);
  for (const [s, companies] of [...sectionStrings].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(companies.length).padStart(3)}x  "${s}"   (${[...new Set(companies)].join(", ")})`);
  }

  console.log(`\n${"=".repeat(100)}\nROWS WITH NO CLASS — each is "not disclosed" or "not mapped", and they are different\n${"=".repeat(100)}`);
  for (const n of noClass) console.log(`  ${n}`);

  console.log(`\n${"=".repeat(100)}\nEVERY INSTRUMENT NAME — the only place an instrument TYPE can come from\n${"=".repeat(100)}`);
  for (const i of [...new Set(allInstruments)].sort()) console.log(`  ${i}`);

  console.log(`\n${"=".repeat(100)}`);
  console.log(`  ROWS: ${rowsTotal}   WITH A CLASS: ${rowsClassed}   WITHOUT: ${rowsTotal - rowsClassed}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(100));
})();
