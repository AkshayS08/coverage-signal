/**
 * RULE 68 — A CALL CANNOT BILL WITHOUT REACHING THE LEDGER.
 *
 * `recordUsage` accumulates spend in process memory. `persistCompanySpend`
 * writes the line to baselines/cost-log.jsonl. Those are two steps, and every
 * billing path in this codebase took both because every billing path went
 * through `runAgentLoop`, which persists at the end.
 *
 * Then Session 24 added a second billing path — the referenced-note call — in
 * a harness that called the first and not the second. Two real Haiku calls
 * billed $0.0376 while the ledger read $0.0000, AND THAT $0.0000 WAS REPORTED
 * as the budget position. The spend was real; the record was not.
 *
 * The ledger is the only thing that makes a budget measurable. A path that
 * bills outside it does not merely under-report — it makes every later total
 * wrong by a silent amount, and the error compounds because nothing ever
 * reconciles against an outside source.
 *
 * So scoping and persisting are ONE operation. `withCostScope` persists in a
 * `finally`, which means a call that throws still reaches the ledger — the
 * case that matters most, because a failed expensive call is exactly the one
 * a caller is least likely to hand-record afterwards.
 */
import { beginCompanyCostScope, currentCompanySpend, persistCompanySpend, type CompanySpend } from "./costMeter";

/**
 * Run `fn` inside a named cost scope and persist whatever it spent, whether it
 * returns or throws. The spend is handed back alongside the result so a caller
 * never has to reach for `currentCompanySpend()` after the scope has moved on.
 */
export async function withCostScope<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; spend: CompanySpend }> {
  beginCompanyCostScope(label);
  try {
    const result = await fn();
    const spend = currentCompanySpend();
    persistCompanySpend(spend);
    return { result, spend };
  } catch (e) {
    // THE THROWING CASE IS THE POINT. A call that failed after the tokens were
    // consumed has still been paid for, and it is the one a human is least
    // likely to remember to record by hand.
    persistCompanySpend(currentCompanySpend());
    throw e;
  }
}
