/**
 * WHAT WOULD HAPPEN IF I SIGNED RIGHT NOW. $0 — cached answers only, writes
 * nothing.
 *
 * Six names are cleared for signature. Before any re-taste bills, this asks
 * the signer's OWN gates what they would say, so the declaration in front of
 * the spend is measured rather than predicted:
 *
 *   - is there a golden already, and at what version (first signature or
 *     re-baseline — they write different basis text, and a re-baseline with
 *     no recorded reason writes a basis that says so)
 *   - do the nine criteria hold against the answer now cached at v31
 *   - Rule 58: any row whose amount no shown sentence states
 *   - criterion 9b: what evidence exists at THIS version
 *
 * THE POINT OF RUNNING IT FIRST is Cigna. Its ladder is honestly empty, and
 * two computed criteria are written for a company that has a ladder —
 * criterion 3 needs an anchor URL and 8a needs at least one debt row. If
 * those fail, no amount of reproduction evidence writes that golden, and
 * buying re-tastes toward a signature that cannot be written is a spend that
 * was decided before it happened. Measured here, at nothing.
 *
 * Run: npx tsx lib/cache/s23signprobe.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, filingSetOf, unsupportedAmountRows, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { evidenceFor } from "./reproductionEvidence";
import { currentCompanySpend } from "../agent/costMeter";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const SIX = ["Tenet Healthcare", "DaVita", "Encompass Health", "Community Health Systems", "Cigna Group", "Molina Healthcare"];

(async () => {
  let spend = 0;
  console.log(`\n${"=".repeat(104)}`);
  console.log(`THE SIX, AGAINST THE SIGNER'S OWN GATES AT v${EXTRACTION_PROMPT_VERSION} — nothing written, nothing billed`);
  console.log("=".repeat(104));

  for (const company of SIX) {
    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const state = deriveGoldenState(result, PINNED_AS_OF);
    const path = join(GOLDEN_DIR, `${result.cik.padStart(10, "0")}.json`);
    const existing = existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as GoldenFile) : null;

    // The attestations a signer would give: all three, so the ONLY things
    // that can fail below are the computed criteria.
    const crit = evaluateGoldenCriteria(result, PINNED_AS_OF, {
      rowsCorrect: true, instrumentTypeFaithful: true, reproducedThreeTimes: true,
      by: "probe", on: PINNED_AS_OF_DAY,
    });
    const failing = crit.criteria.filter((c) => c.kind === "computed" && c.pass === false);
    const unsupported = unsupportedAmountRows(state);
    const lookup = evidenceFor(company, EXTRACTION_PROMPT_VERSION);
    const filings = filingSetOf(result);

    console.log(`\n${"─".repeat(104)}`);
    console.log(`${company}   (${result.cik})`);
    console.log("─".repeat(104));
    console.log(`  golden on disk        ${existing ? `YES — v${existing.extractionVersion}, ${existing.state.rows.length} rows, signed ${existing.signature.signedOn}  →  RE-BASELINE` : "none  →  FIRST SIGNATURE"}`);
    console.log(`  rows now at v${EXTRACTION_PROMPT_VERSION}        ${state.rows.length}`);
    console.log(`  filing set            ${filings.length} document(s)${filings.length === 0 ? "   ← Rule 44 would refuse" : ""}`);
    console.log(`  computed criteria     ${failing.length === 0 ? "all hold" : `${failing.length} DO NOT HOLD`}`);
    for (const f of failing) console.log(`      ${f.id}. ${f.name}\n          ${f.detail.replace(/\s+/g, " ").slice(0, 190)}`);
    console.log(`  Rule 58 unsupported   ${unsupported.length === 0 ? "none" : `${unsupported.length} row(s) — would refuse`}`);
    for (const u of unsupported) console.log(`      ${u.slice(0, 180)}`);
    console.log(`  9b evidence at v${EXTRACTION_PROMPT_VERSION}    ${lookup.kind}${lookup.kind !== "usable" ? ` — ${(lookup as { reason: string }).reason.replace(/\s+/g, " ").slice(0, 150)}` : ""}`);

    const blockers = [
      ...(filings.length === 0 ? ["empty filing set"] : []),
      ...failing.map((f) => `criterion ${f.id}`),
      ...(unsupported.length > 0 ? [`Rule 58 x${unsupported.length}`] : []),
    ];
    console.log(`\n  IF 9b WERE RECORDED TODAY: ${blockers.length === 0
      ? "SIGNS — every gate but 9b already holds, so the re-tastes are the only thing standing between this name and a golden."
      : `STILL REFUSES on ${blockers.join(", ")}. Re-tastes cannot clear this — 9b is not what is blocking it.`}`);
    if (existing && blockers.length === 0) {
      console.log(`  and it needs a RE-BASELINE REASON written before it signs, or its basis will say one was not recorded.`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — must be $0.0000; every name was already extracted at v${EXTRACTION_PROMPT_VERSION} by the cold pass`);
  console.log("=".repeat(104));
})();
