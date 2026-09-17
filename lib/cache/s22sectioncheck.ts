/**
 * SESSION 22, STAGE 4 (gate) — DID v29 LOSE THE NOTE'S SECTION HEADINGS? $0.
 *
 * Stage 2 measured 33 of 85 rows already carrying a class read from the debt
 * note's own section heading, and Tenet was the worked example: its note
 * prints "Senior secured first lien notes:" and "Senior unsecured notes:" as
 * separate sections, and the class-then-maturity sort exists because that
 * structure was visible in the source and gone from the render.
 *
 * At v29 every one of Tenet's fifteen sequence entries carries
 * `seniority: null`, so ten note rows read "class not stated on this row"
 * while the filing prints the class above them. That is a demo name failing
 * its own must-land item.
 *
 * This asks the only question that scopes it: across the whole book, how many
 * rows still carry a section heading, and which companies lost theirs. A
 * count is not a cause — see the report — but Tenet-only and book-wide are
 * different failures needing different fixes, and they must not be collapsed.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { normalizeScheduleSequence } from "../events/position";

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  let rowsTotal = 0, withHeading = 0;
  const lines: string[] = [];
  for (const company of BOOK) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const rows = normalizeScheduleSequence(dm?.scheduleSequence).filter((e) => e.kind === "row");
    const withSen = rows.filter((e) => e.seniority !== null && e.seniority.trim() !== "");
    rowsTotal += rows.length;
    withHeading += withSen.length;
    const headings = [...new Set(withSen.map((e) => e.seniority!.trim()))];
    lines.push(
      `  ${company.padEnd(28)} ${String(withSen.length).padStart(2)} of ${String(rows.length).padStart(2)} note rows carry a section heading` +
      (headings.length ? `   ${headings.map((h) => `"${h}"`).join(", ")}` : "")
    );
  }
  console.log(`\n${"=".repeat(100)}\nSECTION HEADINGS ON SCHEDULE ROWS (v29)\n${"=".repeat(100)}`);
  for (const l of lines) console.log(l);
  console.log(`\n  BOOK: ${withHeading} of ${rowsTotal} schedule rows carry a heading.`);
  console.log(`  Stage 2 measured 33 of 85 rows classed FROM a heading at v28, Tenet among them.`);
})();
