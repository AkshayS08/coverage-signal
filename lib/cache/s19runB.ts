/**
 * THROWAWAY — Session 19 run B, extraction only. Deleted before the final
 * commit, per the session-16/17/18 convention for one-run scripts.
 *
 * Why extraction is run SEPARATELY from narration this time: the standing
 * order is that a narration re-bill is priced and listed before it is spent.
 * captureBookSnapshot() narrates inline, so running it first would spend the
 * narration money before the attribution diff that justifies it exists. This
 * runs the extraction half, writes the same `result` and `table` objects the
 * snapshot serializes, and stops. The full baseline is captured afterwards,
 * by which point extraction is warm and only narration bills.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync, mkdirSync } from "node:fs";
import { runAgentLoop } from "../agent";
import { buildEvents, buildVerifiedFactBase, buildCompanyTableBlock } from "../events";
import { currentCompanySpend, formatCompanyCostLine, formatUsd } from "../agent/costMeter";

const BOTH_BOOKS = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

async function main() {
  const outputs: unknown[] = [];
  let totalUsd = 0;
  let totalCalls = 0;
  const perCompany: string[] = [];

  for (const company of BOTH_BOOKS) {
    const result = await runAgentLoop(company);
    const spend = currentCompanySpend();
    totalUsd += spend.totalUsd;
    totalCalls += spend.totalCalls;
    perCompany.push(`${company.padEnd(28)} ${formatUsd(spend.totalUsd).padStart(9)}  ${String(spend.totalCalls).padStart(2)} calls`);
    console.error(`\n=== ${company} ===`);
    console.error(formatCompanyCostLine(spend));

    const { flashCardCandidates } = buildEvents([result]);
    buildVerifiedFactBase(result); // same call the snapshot makes; discarded here
    const table = buildCompanyTableBlock(result, flashCardCandidates);
    outputs.push({ company, result, cardIds: flashCardCandidates.map((c) => c.id), table });
  }

  mkdirSync("baselines", { recursive: true });
  writeFileSync("baselines/_s19-run-b2-extraction.json", JSON.stringify(outputs, null, 2), "utf8");

  console.error("\n\n================ RUN B EXTRACTION ================");
  for (const line of perCompany) console.error(line);
  console.error(`${"TOTAL".padEnd(28)} ${formatUsd(totalUsd).padStart(9)}  ${totalCalls} calls`);
}

main().catch((e) => { console.error(e); process.exit(1); });
