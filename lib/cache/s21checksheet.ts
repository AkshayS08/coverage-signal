/**
 * SESSION 21, STAGE 6 — THE CHECK SHEET.
 *
 * The four things a person needs open beside the filing, and nothing else:
 * every ladder row with its amount and the verbatim line it came from, the
 * stated total in dollars with the captions behind it, the note's own
 * printed subtotals, and coverage.
 *
 * Separate from verificationSheet.ts on purpose. That one shows everything
 * the tool holds, including Tier 2, the derived lines and their inputs, and
 * is long. This one is what a signature is actually checked against, so it
 * is short enough to read line by line without skipping — which is the only
 * way a signature means anything.
 *
 * Also RE-CONFIRMS THE CORPUS. The filing-list cache turns over every 24
 * hours, so a sheet read two days after it was printed may describe a corpus
 * that has moved. Each sheet states its filing set and this script diffs it
 * against the set recorded when the sheets were generated.
 *
 * Warm cache only; $0. Nothing is written.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { assemblePosition, computeWalkChecksum, normalizeScheduleSequence, parseMoneyAmount } from "../events/position";
import { computeCoverage } from "../events/coverage";
import { filingSetOf } from "../events/golden";
import { createTextLocator } from "../agent/verifyQuote";
import { getFilingText } from "../fetch";

const ASOF = new Date("2026-09-06T00:00:00Z");
const one = (s: string, n = 220) => s.replace(/\s+/g, " ").trim().slice(0, n);
const usd = (n: number | null) => (n === null ? "—" : "$" + n.toLocaleString("en-US"));

/** Filing sets as recorded when the sheets were generated on 2026-09-04. */
const RECORDED: Record<string, number> = {
  "DaVita": 5, "HCA Healthcare": 5, "Tenet Healthcare": 6,
  "Quest Diagnostics": 5, "Centene Corporation": 2, "Molina Healthcare": 4,
};

(async () => {
  const book = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RECORDED);
  const out: string[] = [];
  const drift: string[] = [];

  for (const company of book) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(result, ASOF);
    const cov = computeCoverage(dm);
    const seq = normalizeScheduleSequence(dm?.scheduleSequence);
    const walk = computeWalkChecksum(dm?.scheduleSequence);
    const anchor = dm?.debtScheduleSourceFiling ?? null;
    const files = filingSetOf(result);
    if (RECORDED[company] !== undefined && RECORDED[company] !== files.length) {
      drift.push(`${company}: ${RECORDED[company]} document(s) on 2026-09-04, ${files.length} now`);
    }

    // NEVER A SILENT CATCH. A locator that failed to build reports every line
    // as unplaceable, which on a signature sheet reads as six missing facts
    // rather than one failed fetch — the reader cannot tell the difference,
    // and the difference is everything.
    let loc: { find(n: string): number | null } | null = null;
    let locFailure: string | null = null;
    if (!anchor?.url) locFailure = "this filer has no anchor filing";
    else {
      try {
        const raw = await getFilingText(anchor.url);
        const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
        if (typeof text !== "string" || text.length === 0) locFailure = `anchor text came back empty (${typeof text})`;
        else loc = createTextLocator(text);
      } catch (e) { locFailure = `could not fetch the anchor text: ${e instanceof Error ? e.message : String(e)}`; }
    }
    const at = (s: string) => {
      if (locFailure) return `CANNOT PLACE — ${locFailure}`;
      const i = loc!.find(s);
      return i === null ? "NOT FOUND in the anchor — check this line before signing" : `char ${i.toLocaleString("en-US")}`;
    };

    out.push("");
    out.push("#".repeat(104));
    out.push(`#  ${result.company}   (CIK ${result.cik})`);
    out.push(`#  ANCHOR: ${anchor ? `${anchor.form} filed ${anchor.date}, period ${anchor.reportDate}` : "none"}`);
    out.push(`#  ${anchor?.url ?? "-"}`);
    out.push(`#  filing set: ${files.length} document(s)`);
    out.push("#".repeat(104));

    // --- 1. LADDER --------------------------------------------------------
    const debtRows = pos.rows.filter((r) => !r.isCapacity);
    const capRows = pos.rows.filter((r) => r.isCapacity);
    out.push("");
    out.push(`1. LADDER — ${debtRows.length} row(s) counted as debt${capRows.length ? `, plus ${capRows.length} counted as capacity` : ""}`);
    out.push("-".repeat(104));
    let sum = 0;
    for (const r of pos.rows) {
      const v = parseMoneyAmount(r.amount);
      if (!r.isCapacity && v !== null) sum += v;
      out.push(`  ${r.instrument}`);
      out.push(`      amount   ${r.amount}   =   ${usd(v)}${r.isCapacity ? "   [CAPACITY — not summed as debt]" : ""}`);
      out.push(`      matures  ${r.maturityDate ?? "(none stated)"}${r.dateGranularity ? ` (${r.dateGranularity})` : ""}   status ${r.status}   source ${r.provenance}`);
      out.push(`      says     "${one(r.sourceLine)}"`);
      out.push(`      at       ${at(r.sourceLine)}`);
    }
    out.push("-".repeat(104));
    out.push(`  SUM OF ROWS COUNTED AS DEBT:  ${usd(sum)}`);

    // --- 2. THE NOTE'S OWN SUBTOTALS -------------------------------------
    const subtotals = seq.filter((e) => e.kind === "subtotal");
    const adjustments = seq.filter((e) => e.kind === "adjustment");
    out.push("");
    out.push(`2. THE NOTE'S OWN PRINTED SUBTOTALS — ${subtotals.length}`);
    out.push("-".repeat(104));
    if (subtotals.length === 0) out.push("  (this filer's note prints no subtotal — there is nothing to walk the rows into)");
    for (const s of subtotals) {
      const c = walk.subtotalChecks.find((x) => x.label === s.label && x.claimedAmount === parseMoneyAmount(s.amount));
      out.push(`  ${s.label ?? "(unlabelled)"}${s.section ? `   [section: ${s.section}]` : ""}`);
      out.push(`      note states  ${s.amount}   =   ${usd(parseMoneyAmount(s.amount))}`);
      if (c) out.push(`      our rows sum ${usd(c.runningSum)}   gap ${usd(c.gap)}   ${c.tie ? "TIES" : "DOES NOT TIE"}`);
      out.push(`      says         "${one(s.sourceLine)}"`);
    }
    for (const a of adjustments) {
      out.push(`  [adjustment] ${a.label ?? "(unlabelled)"}: ${a.amount}   =   ${usd(parseMoneyAmount(a.amount))}`);
      out.push(`      says         "${one(a.sourceLine)}"`);
    }
    out.push(`  CHECK 1 (do the rows walk into the printed subtotals): ${walk.pass ? "PASS" : subtotals.length === 0 ? "NOT RUN" : "FAIL"}`);

    // --- 3. STATED TOTAL DEBT --------------------------------------------
    const captions = dm?.balanceSheetDebtCaptions ?? [];
    out.push("");
    out.push(`3. STATED TOTAL DEBT — the denominator`);
    out.push("-".repeat(104));
    out.push(`  SOURCE: ${cov.denominatorSource === "xbrl" ? "the filer's own XBRL tags" : cov.denominatorSource === "model-read" ? "the balance-sheet captions as read (this filer tags no usable XBRL total)" : "none"}`);
    out.push(`  STATED TOTAL DEBT:  ${usd(cov.statedTotalDebt)}`);
    if (cov.denominatorDisagreement) out.push(`  DISAGREEMENT: ${cov.denominatorDisagreement}`);
    out.push("");
    out.push(`  The anchor's own balance-sheet debt captions (${captions.length}):`);
    let capSum = 0;
    for (const c of captions) {
      const v = parseMoneyAmount(c.amount);
      if (v !== null) capSum += v;
      out.push(`      ${c.label}:  ${c.amount}   =   ${usd(v)}   [column: ${c.periodColumn ?? "-"}]`);
      out.push(`          says  "${one(c.sourceLine, 160)}"`);
      out.push(`          at    ${at(c.sourceLine)}`);
    }
    if (captions.length > 0) out.push(`      CAPTIONS SUM TO:  ${usd(capSum)}`);

    // --- 4. COVERAGE ------------------------------------------------------
    out.push("");
    out.push("4. COVERAGE");
    out.push("-".repeat(104));
    out.push(`  captured face (rows above)            ${usd(cov.capturedFace)}`);
    out.push(`  the note's own bridge lines           ${usd(cov.statedBridge)}   (discount / issuance costs, subtracted before judging)`);
    out.push(`  stated total debt                     ${usd(cov.statedTotalDebt)}`);
    out.push(`  unexplained remainder                 ${usd(cov.residual)}   = ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"}   ${cov.residualPasses === null ? "" : cov.residualPasses ? "(under the 2.5% line)" : "(ABOVE the 2.5% line)"}`);
    out.push(`  captured / stated                     ${cov.statedTotalDebt ? Math.round((cov.capturedFace / cov.statedTotalDebt) * 100) + "%" : "—"}`);
    for (const c of cov.capacity) out.push(`  capacity, NOT counted as debt         ${c.label}: ${c.amount === null ? "(no amount stated)" : usd(c.amount)} — ${c.basisNote}`);
    for (const m of cov.categoriesMissing ?? []) out.push(`  FLAG — stated but not captured        ${m}`);
    out.push("");
    out.push(`  AS RENDERED: ${cov.line}`);
  }

  for (const l of out) console.log(l);
  console.log("");
  console.log("=".repeat(104));
  console.log(drift.length === 0
    ? `CORPUS UNCHANGED since the sheets were generated on 2026-09-04 — every filing set is the same size it was.`
    : `CORPUS MOVED since 2026-09-04:\n  ${drift.join("\n  ")}`);
  console.log("No golden file has been written.");
})();
