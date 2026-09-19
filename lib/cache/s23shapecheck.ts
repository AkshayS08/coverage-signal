/**
 * SESSION 23, RULE 51 — WHICH COMPANIES DOES THE WITHHOLDING CHANGE? $0.
 *
 * Reads the anchor's locator result exactly as the loop does — the
 * `debtNoteStatus` and `debtNoteTabular` that `buildExtractionText` returns,
 * not a re-derivation of them — and runs the one deciding function over it.
 *
 * Then states, per company, whether the schedule field it will be OFFERED at
 * the next cold pass differs from what it was offered before. A change on any
 * name but Cigna is a finding, not a success (Rule 41).
 *
 * Run: npx tsx lib/cache/s23shapecheck.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, readFiling } from "../agent/tools";
import { selectBaselineFilings } from "../agent/selectFilings";
import { buildExtractionText } from "../fetch/noteLocation";
import { anchorNoteShapeOf } from "../agent/claude";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  const names = process.argv.length > 2 ? process.argv.slice(2) : ALL;
  console.log(`\n${"company".padEnd(28)} ${"anchor".padEnd(18)} ${"status".padEnd(11)} ${"tabular".padEnd(9)} ${"OLD (tabular!==false)".padEnd(22)} NEW (anchorNoteShapeOf)`);
  console.log("-".repeat(122));
  let changed = 0;
  for (const c of names) {
    const f = await getRecentFilings(c, ["8-K", "10-Q", "10-K"]);
    const baseline = selectBaselineFilings(f.filings);
    // The loop builds debtNoteStatusByFiling over the BASELINE periodic
    // filings and takes the most recent by filingDate — same order here.
    const periodic = baseline
      .filter((b) => b.form === "10-Q" || b.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const a = periodic[0];
    const { text: fullText } = await readFiling(a.primaryDocUrl);
    const ex = buildExtractionText({ form: a.form, url: a.primaryDocUrl, fullText, xbrlStatedTotal: null });

    const anchor = { status: ex.debtNoteStatus, tabular: ex.debtNoteTabular };
    // The OLD behaviour, reproduced exactly: `tabular` alone, undefined
    // reading as "offer it".
    const oldOffered = anchor.tabular !== false;
    const shape = anchorNoteShapeOf(anchor);
    const newOffered = shape === "tabular";
    const diff = oldOffered !== newOffered;
    if (diff) changed++;
    console.log(
      `${c.padEnd(28)} ${`${a.form} ${a.filingDate}`.padEnd(18)} ${String(anchor.status).padEnd(11)} ` +
        `${String(anchor.tabular).padEnd(9)} ${(oldOffered ? "offered" : "withheld").padEnd(22)} ${shape} -> ${newOffered ? "offered" : "WITHHELD"}${diff ? "   <== CHANGED" : ""}`
    );
  }
  console.log("-".repeat(122));
  console.log(`  ${changed} of ${names.length} change. Any name but Cigna changing is a finding, not a success.\n`);
})();
