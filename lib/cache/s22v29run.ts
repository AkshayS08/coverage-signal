/**
 * SESSION 22, STAGE 3 — THE v29 RUN. PAID.
 *
 * Cost shape declared before the run in sessions/22/v29_declaration.md,
 * along with the result shape it is checked against. Per-company cost is
 * persisted by runAgentLoop itself (Rule 20); this reports the total and the
 * shape, so Rule 13 can be checked rather than remembered.
 *
 * Reports, per company:
 *   FACILITIES   every facility, every figure, and the sentence behind each
 *   REJECTED     every figure the guard refused, with which of the two
 *                reasons — those are different failures needing different
 *                fixes and must never be collapsed
 *   ARITHMETIC   drawn + LCs + available = size, or why it cannot be checked
 *   SENIORITY    the note-level class sentence, where one exists
 *   PROCEEDS     every stated use of an issuance's proceeds
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, parseMoneyAmount } from "../events/position";
import { facilityArithmetic } from "../agent/verifyFacility";
import { formatMoneyForDisplay } from "../events/money";
import { priorityClassLabel } from "../events/instrumentClass";
import { currentCompanySpend } from "../agent/costMeter";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

const one = (s: string, n = 150) => s.replace(/\s+/g, " ").trim().slice(0, n);

(async () => {
  let spend = 0, facilityCount = 0, figureCount = 0, rejectedCount = 0, withSeniority = 0;
  const perCompany: string[] = [];

  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const cost = currentCompanySpend().totalUsd;
    spend += cost;
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const ndi = result.results.find((t) => t.triggerId === "new-debt-issuance");
    const pos = assemblePosition(result, PINNED_AS_OF);
    const facilities = dm?.facilities ?? [];
    const docLabel = new Map<string,string>();
    for (const t of result.results) for (const c of t.citations) if (c.url) docLabel.set(c.url, `${c.form} ${c.date}`);
    const rejections = dm?.facilityRejections ?? [];

    console.log(`\n${"=".repeat(104)}\n${result.company}   ($${cost.toFixed(4)})\n${"=".repeat(104)}`);

    console.log(`  FACILITIES: ${facilities.length}`);
    for (const f of facilities) {
      facilityCount++;
      console.log(`\n    ${f.name}   [${f.category}]${f.asOfDate ? `   as of ${f.asOfDate}` : ""}`);
      for (const [label, fig] of [["size", f.facilitySize], ["drawn", f.drawn], ["LCs", f.lettersOfCredit], ["available", f.available], ["maturity", f.maturity]] as const) {
        if (!fig) { console.log(`        ${label.padEnd(10)} —`); continue; }
        figureCount++;
        console.log(`        ${label.padEnd(10)} ${fig.value}`);
        console.log(`                   "${one(fig.sourceLine)}"`);
        // EACH FIGURE NAMES ITS OWN DOCUMENT. A facility's figures routinely
        // come from different filings, and one citation for the facility
        // would hide which.
        const src = (f as { figureSources?: Record<string,string> }).figureSources?.[label === "LCs" ? "lettersOfCredit" : label === "size" ? "facilitySize" : label];
        if (src) console.log(`                   -> ${docLabel.get(src) ?? src}`);
      }
      const a = facilityArithmetic(f, parseMoneyAmount);
      console.log(`        CHECK      ${a.why}`);
    }

    if (rejections.length) {
      console.log(`\n  FIGURES REJECTED BY THE GUARD: ${rejections.length}`);
      for (const r of rejections) {
        rejectedCount++;
        console.log(`    ${r.facility}.${r.field} = ${r.value}`);
        console.log(`        ${r.reason}`);
        console.log(`        sentence given: "${one(r.sourceLine, 130)}"`);
      }
    }

    if (dm?.seniorityStatement) {
      withSeniority++;
      console.log(`\n  SENIORITY STATEMENT  applies to: ${dm.seniorityStatement.appliesTo}`);
      console.log(`    "${one(dm.seniorityStatement.statement, 220)}"`);
    }

    const uses = ndi?.proceedsUses ?? [];
    if (uses.length) {
      console.log(`\n  PROCEEDS USES: ${uses.length}`);
      for (const u of uses) console.log(`    ${u.amount ?? "(no amount stated)"} — ${u.use}`);
    }

    const unclassed = pos.rows.filter((r) => r.classification.priorityClass === null);
    console.log(`\n  LADDER: ${pos.rows.length} row(s), ${pos.rows.length - unclassed.length} with a class`);
    for (const r of pos.rows) {
      console.log(`    ${formatMoneyForDisplay(r.amount).padStart(9)}  ${priorityClassLabel(r.classification).padEnd(32)} ${(r.classification.instrumentType ?? "—").padEnd(16)} ${r.instrument.slice(0, 40)}`);
    }

    perCompany.push(`  ${company.padEnd(28)} $${cost.toFixed(4)}   facilities ${String(facilities.length).padStart(2)}   rejected ${String(rejections.length).padStart(2)}   seniority ${dm?.seniorityStatement ? "yes" : "no "}   uses ${uses.length}   rows ${pos.rows.length}`);
  }

  console.log(`\n${"=".repeat(104)}\nv29 SUMMARY\n${"=".repeat(104)}`);
  for (const p of perCompany) console.log(p);
  console.log(`\n  FACILITIES: ${facilityCount}   VERIFIED FIGURES: ${figureCount}   REJECTED FIGURES: ${rejectedCount}   SENIORITY STATEMENTS: ${withSeniority}`);
  console.log(`  TOTAL SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
