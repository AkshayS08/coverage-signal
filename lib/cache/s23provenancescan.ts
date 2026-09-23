/**
 * RULE 58's SWEEP — does every ladder row's sourceLine state that row's
 * amount? $0, cached reads.
 *
 * This bug is book-wide by nature: any facility stating its size and its
 * maturity in different sentences hit it, and nothing about it was specific
 * to UHS. So the question is asked of EVERY row in every company's rendered
 * ladder — facility rows and schedule rows alike, because a rule about
 * provenance that checked only the rows it was written for would be the same
 * mistake one layer up.
 *
 * Rows carrying no amount are counted separately and not as failures: "(no
 * amount stated)" has nothing to support, which is a different fact from an
 * amount nothing supports.
 *
 * Run: npx tsx lib/cache/s23provenancescan.ts
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

(async () => {
  let rows = 0, supported = 0, noAmount = 0, unsupported = 0, noted = 0, spend = 0;
  const byKind: Record<string, number> = {};
  console.log(`\n${"=".repeat(104)}`);
  console.log(`RULE 58 — every ladder row in the book: does its sourceLine state its amount?`);
  console.log("=".repeat(104));

  for (const company of ALL) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);
    const bad: string[] = [];
    for (const r of pos.rows) {
      rows++;
      const amount = String(r.amount ?? "");
      if (amount === "" || amount === "(no amount stated)") { noAmount++; continue; }
      const line = String(r.sourceLine ?? "");
      // THE SAME DECIDER THE RENDER USES. The first version of this scan ran
      // sentenceStatesFigure directly and reported ten failures, six of which
      // were the filing's own conventions — em-dash zeros and a scale word
      // supplied by the column header. A scan that judges by a different
      // standard than the page is measuring a different thing.
      const support = amountSupportOf(amount, line);
      if (support.kind !== "unsupported") { supported++; byKind[support.kind] = (byKind[support.kind] ?? 0) + 1; continue; }
      unsupported++;
      if (r.amountProvenanceNote) noted++;
      bad.push(
        `      ${String(r.instrument).slice(0, 46).padEnd(48)} ${amount.padEnd(22)} ${r.isCapacity ? "capacity" : "debt"}\n` +
        // IN FULL. This sliced at 160 characters and printed Tenet's revolver
        // sentence as ending "...up to $ 1.900 " — which read as a truncation
        // in the DATA and very nearly sent a diagnosis after our sentence
        // handling. The sentence is 232 characters and ends "$ 1.900 billion
        // with a $ 200 million subfacility for standby letters of credit".
        // A report that truncates its own evidence invents a defect in the
        // thing it is reporting on.
        `        sourceLine (${line.length} chars, in full): "${line.replace(/\s+/g, " ")}"\n` +
        `        ${r.amountProvenanceNote ? `stated on the row: ${r.amountProvenanceNote}` : "NO NOTE ON THE ROW — the mismatch renders silently"}`
      );
    }
    console.log(`\n  ${company.padEnd(30)} ${pos.rows.length} row(s)   ${bad.length === 0 ? "all amounts supported by their own sentence" : `⚠ ${bad.length} unsupported`}`);
    for (const b of bad) console.log(b);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${rows} ladder rows across the book`);
  console.log(`  ${supported} supported — ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  console.log(`  ${noAmount} state no amount at all — nothing to support, not a failure`);
  console.log(`  ${unsupported} have an amount their sourceLine does NOT state${unsupported > 0 ? `, ${noted} of which say so on the row` : ""}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
