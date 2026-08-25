import type { CompanyResult, TriggerResult } from "../agent";
import type { DebtScheduleFilingRef } from "../agent/claude";
import type { CompanySpend } from "../agent/costMeter";
import type { ScheduleCompletenessResult } from "../fetch/scheduleCompleteness";
import {
  computeBalanceSheetCheck,
  computeWalkChecksum,
  type BalanceSheetCheckResult,
  type WalkChecksumResult,
} from "./position";

/**
 * Session 18 — the per-company extraction report: Check 1, Check 2,
 * completeness, drops, and spend for one company, in one place.
 *
 * Why this is a permanent module and not a throwaway script. Every
 * per-company report this session has been assembled inside a disposable
 * `session18extract*.ts` runner and deleted before commit, per the
 * Session 16/17 throwaway convention. That convention is right for a
 * one-off DIFF, but wrong here: this report is how a full run states
 * whether it worked at all, so deleting it means the next run either has
 * no report or gets a hand-rebuilt one that quietly differs from the last.
 * Both checks, the completeness cross-check and the row accounting are all
 * already permanent, exported, tested code — only the ASSEMBLY of them was
 * disposable, which is exactly the wrong half to throw away.
 *
 * Pure and offline by construction: it reads only fields already on
 * `CompanyResult` (all of which are rebuilt for free from a cached answer)
 * and recomputes both checks with the same exported functions
 * lib/events/position.ts uses for rendering, so the report and the cards
 * can never disagree about whether a company reconciled.
 *
 * The one thing this file exists to make impossible: reading "passed" as
 * "complete." See CompanyExtractionVerdict.
 */

/**
 * Deliberately FOUR outcomes, not a boolean, because "passed both checks"
 * and "transcribed the whole table" are different claims and this project
 * has already been burnt by conflating them: HCA passed Check 1 and
 * Check 2 on a transcription that stopped before the source section's last
 * two subtotals. Both checks are self-consistent over whatever WAS
 * captured — the walk ties against the rows it has, and the balance-sheet
 * anchor ties against a subtotal it has — so neither can see a table that
 * ends early. `pass-partial` is that exact state, named, so a passing
 * company can never silently read as a complete one.
 *
 *   - "no-schedule"  — no locatable debt note; nothing was checked. Not a
 *                      failure, and deliberately not lumped in with one.
 *   - "pass"         — both checks tie AND the completeness cross-check
 *                      found nothing left over.
 *   - "pass-partial" — both checks tie, but the source section appears to
 *                      contain entries the transcription never reached.
 *   - "fail"         — at least one check did not tie.
 */
export type CompanyExtractionVerdict = "pass" | "pass-partial" | "fail" | "no-schedule";

export interface CompanyExtractionReport {
  company: string;
  verdict: CompanyExtractionVerdict;
  /** Which filing the ladder was transcribed from. Null exactly when verdict is "no-schedule". */
  baseFiling: DebtScheduleFilingRef | null;
  /** Check 1 — the internal walk. Recomputed here, never re-derived by hand. */
  check1: WalkChecksumResult;
  /** Check 2 — the balance-sheet anchor. Reported SEPARATELY from Check 1 and never blended with it: Check 1 is scale-invariant, so a uniformly mis-scaled table still ties there and only Check 2 catches it. A single combined "reconciled" bit would erase that distinction. */
  check2: BalanceSheetCheckResult;
  /** Null when there was no locatable section to cross-check against. */
  completeness: ScheduleCompletenessResult | null;
  /** Summed across every trigger, so a drop in `issuedTranches` counts as loudly as one in the ladder. */
  rowsExtracted: number;
  rowsVerified: number;
  rowsDropped: number;
  /** Null when no spend was captured for this company (e.g. rebuilding a report from a cached answer, where zero calls were made and zero is not the same as "not measured"). */
  spendUsd: number | null;
  apiCalls: number | null;
  /**
   * The specific reason(s) this company is not a clean "pass" — named, in
   * the report itself, never left for a reader to reconstruct from a
   * console log. Empty exactly when verdict is "pass".
   */
  causes: string[];
}

function debtMaturityTrigger(result: CompanyResult): TriggerResult | undefined {
  return result.results.find((r) => r.triggerId === "debt-maturity");
}

/** Compact money for a report line — these are full dollar values, so thousands separators alone are unreadable at $45,828,000,000. */
function briefUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function buildExtractionReport(result: CompanyResult, spend?: CompanySpend | null): CompanyExtractionReport {
  const dm = debtMaturityTrigger(result);
  const check1 = computeWalkChecksum(dm?.scheduleSequence);
  const check2 = computeBalanceSheetCheck(dm?.balanceSheetDebtCaptions, dm?.scheduleSequence);
  const completeness = dm?.scheduleCompleteness ?? null;

  // Summed across EVERY trigger, not just debt-maturity: the 13 others
  // contribute zero by construction (rowsExtracted is 0 for them), so this
  // stays a faithful total while still catching a drop in
  // new-debt-issuance's issuedTranches, which would otherwise be invisible.
  const rowsExtracted = result.results.reduce((n, r) => n + r.rowsExtracted, 0);
  const rowsVerified = result.results.reduce((n, r) => n + r.rowsVerified, 0);

  const causes: string[] = [];

  // A company with no locatable schedule is reported as such and NOT as a
  // failure — the two need different fixes (find the table vs. fix the
  // transcription), so collapsing them would misdirect the next session.
  const hasSchedule = (dm?.scheduleSequence.length ?? 0) > 0;
  let verdict: CompanyExtractionVerdict;
  if (!dm || !hasSchedule) {
    verdict = "no-schedule";
    causes.push(
      dm?.debtScheduleSourceFiling
        ? `a debt note was located in ${dm.debtScheduleSourceFiling.form} ${dm.debtScheduleSourceFiling.date} but no entry survived transcription/verification`
        : "no filing had a locatable debt-note section"
    );
  } else {
    if (!check1.pass) {
      if (check1.subtotalChecks.length === 0) {
        causes.push(`CHECK 1: no subtotal was transcribed at all, so the walk has nothing to reconcile against (${check1.rowCount} row(s) captured)`);
      } else {
        for (const c of check1.subtotalChecks.filter((s) => !s.tie)) {
          const where = c.section ? `section "${c.section}"` : "top-level rollup";
          causes.push(
            `CHECK 1: ${where} subtotal ${c.label ? `"${c.label}"` : "(unlabeled)"} claims ${briefUsd(c.claimedAmount)} but its rows sum to ${briefUsd(c.runningSum)} — ${briefUsd(c.gap)} unaccounted`
          );
        }
      }
    }
    if (!check2.pass) {
      if (check2.captionCount === 0) causes.push("CHECK 2: no balance-sheet debt caption was captured, so the ladder has no independent anchor");
      else if (check2.nearestGap === null) causes.push(`CHECK 2: ${check2.captionCount} caption(s) summing to ${briefUsd(check2.captionSum)}, but no subtotal to compare against`);
      else causes.push(`CHECK 2: balance-sheet captions sum to ${briefUsd(check2.captionSum)}, nearest subtotal is ${briefUsd(check2.nearestGap)} away`);
    }

    if (!check1.pass || !check2.pass) verdict = "fail";
    else if (completeness?.checked && !completeness.complete) verdict = "pass-partial";
    else verdict = "pass";
  }

  // Completeness is reported for every company regardless of verdict — a
  // failing company's incompleteness is still worth naming, and a passing
  // one's is the whole point of pass-partial.
  if (completeness?.checked && !completeness.complete) {
    for (const t of completeness.missingLabeledTotals) causes.push(`COMPLETENESS: source section contains an untranscribed labeled total — "${t}"`);
    if (completeness.trailingUnconsumedText) causes.push(`COMPLETENESS: source section has trailing untranscribed numeric content — "${completeness.trailingUnconsumedText}"`);
  }

  // Drops are reported independently of the verdict, because they are the
  // MECHANISM behind most Check 1 failures rather than a separate outcome —
  // a dropped row makes the walk fail, and naming both together is what
  // turns "does not tie" into an actionable cause.
  const rowsDropped = rowsExtracted - rowsVerified;
  if (rowsDropped > 0) {
    causes.push(`DROPS: ${rowsDropped} of ${rowsExtracted} extracted entr${rowsDropped === 1 ? "y was" : "ies were"} dropped — failed sourceLine verification, wrong period column, or indeterminate amount scale`);
  }

  return {
    company: result.company,
    verdict,
    baseFiling: dm?.debtScheduleSourceFiling ?? null,
    check1,
    check2,
    completeness,
    rowsExtracted,
    rowsVerified,
    rowsDropped,
    spendUsd: spend ? spend.totalUsd : null,
    apiCalls: spend ? spend.totalCalls : null,
    causes,
  };
}

const VERDICT_MARK: Record<CompanyExtractionVerdict, string> = {
  pass: "PASS",
  // Spelled out rather than marked with a symbol, because the whole reason
  // this verdict exists is that a skim-reader treated a passing company as
  // a complete one.
  "pass-partial": "PASS (PARTIAL TRANSCRIPTION)",
  fail: "FAIL",
  "no-schedule": "NO SCHEDULE",
};

/** One company's report as report lines. Plain text, no ANSI — this goes to a console trace, a run log and a written report alike. */
export function formatExtractionReport(report: CompanyExtractionReport): string[] {
  const lines: string[] = [];
  const filing = report.baseFiling ? `${report.baseFiling.form} ${report.baseFiling.date}` : "no base filing";
  lines.push(`${report.company} — ${VERDICT_MARK[report.verdict]} (${filing})`);

  const c1 = report.check1;
  lines.push(
    `  check 1 (internal walk):   ${c1.pass ? "tie" : "DOES NOT TIE"} — ${c1.subtotalChecks.length} subtotal(s) over ${c1.rowCount} row(s) + ${c1.adjustmentCount} adjustment(s)`
  );
  const c2 = report.check2;
  // The gap is stated whether or not it tied, so "tie" can be read as "how
  // close", not just a bit — a tie at the tolerance edge and a tie at
  // exactly zero are different levels of confidence.
  const c2gap = c2.nearestGap === null ? "no comparison possible" : `${briefUsd(c2.nearestGap)} from nearest subtotal`;
  lines.push(`  check 2 (balance sheet):   ${c2.pass ? "tie" : "DOES NOT TIE"} — ${c2.captionCount} caption(s) summing ${briefUsd(c2.captionSum)}, ${c2gap}`);

  const comp = report.completeness;
  lines.push(
    `  completeness:              ${
      !comp || !comp.checked
        ? "not checked (no locatable source section)"
        : comp.complete
          ? `complete — ${comp.subtotalsTranscribed} subtotal(s), nothing left unconsumed`
          : `INCOMPLETE — ${comp.subtotalsTranscribed} subtotal(s) transcribed, ${comp.labeledTotalCandidatesInSource} labeled total(s) in source`
    }`
  );
  lines.push(`  rows:                      ${report.rowsVerified} verified of ${report.rowsExtracted} extracted${report.rowsDropped > 0 ? ` — ${report.rowsDropped} DROPPED` : ""}`);
  lines.push(
    `  cost:                      ${
      report.spendUsd === null
        ? "not measured"
        : report.apiCalls === 0
          ? "$0.0000 — 0 API calls (fully cached)"
          : `${report.spendUsd < 0.01 ? `$${report.spendUsd.toFixed(4)}` : `$${report.spendUsd.toFixed(2)}`} across ${report.apiCalls} API call(s)`
    }`
  );
  for (const cause of report.causes) lines.push(`  → ${cause}`);
  return lines;
}

export interface BookExtractionSummary {
  reports: CompanyExtractionReport[];
  passCount: number;
  passPartialCount: number;
  failCount: number;
  noScheduleCount: number;
  /** Null when no company measured its spend — never rendered as $0.00, which would read as a free run rather than an unmeasured one. */
  totalUsd: number | null;
  /** Both checks tying, over the companies that HAD a schedule to check. Companies with no locatable schedule are excluded from the denominator rather than counted as failures — they are a locator problem, not a reconciliation one, and folding them in would make the headline number measure two different things at once. */
  tieRate: { tied: number; of: number } | null;
}

export function summarizeBook(reports: CompanyExtractionReport[]): BookExtractionSummary {
  const withSchedule = reports.filter((r) => r.verdict !== "no-schedule");
  const measured = reports.filter((r) => r.spendUsd !== null);
  return {
    reports,
    passCount: reports.filter((r) => r.verdict === "pass").length,
    passPartialCount: reports.filter((r) => r.verdict === "pass-partial").length,
    failCount: reports.filter((r) => r.verdict === "fail").length,
    noScheduleCount: reports.filter((r) => r.verdict === "no-schedule").length,
    totalUsd: measured.length > 0 ? measured.reduce((n, r) => n + (r.spendUsd ?? 0), 0) : null,
    tieRate: withSchedule.length > 0 ? { tied: withSchedule.filter((r) => r.check1.pass && r.check2.pass).length, of: withSchedule.length } : null,
  };
}

export function formatBookSummary(summary: BookExtractionSummary): string[] {
  const lines: string[] = [];
  for (const r of summary.reports) lines.push(...formatExtractionReport(r), "");
  const tie = summary.tieRate ? `${summary.tieRate.tied}/${summary.tieRate.of}` : "n/a";
  lines.push(`BOOK: ${summary.passCount} pass, ${summary.passPartialCount} pass-partial, ${summary.failCount} fail, ${summary.noScheduleCount} no-schedule`);
  // "Both checks tie" is stated separately from "pass" because pass-partial
  // companies tie too — the two numbers differ by exactly the partial
  // transcriptions, and that difference is the thing worth seeing.
  lines.push(`  both checks tie: ${tie} of the companies with a locatable schedule`);
  lines.push(`  total spend: ${summary.totalUsd === null ? "not measured" : `$${summary.totalUsd.toFixed(2)}`}`);
  return lines;
}
