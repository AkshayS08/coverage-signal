/**
 * THE ROLL WITH THE BALANCE READ FROM THE ANCHOR'S OWN SENTENCE. $0.
 *
 * The model's asOfDate field is consulted and REPORTED, but the balance is
 * taken from the sentence that predicates it. Re-run across all three cached
 * samples: the question is whether the roll now ties 3/3.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { derivePlacedMovements, toRollDeltas, statedBalanceAt } from "../events/rollDeltas";
import { computeRollTie, toleranceFor } from "../events/rollForward";
import { locatorFor, tableCellMillions } from "../agent/tableScale";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { currentCompanySpend } from "../agent/costMeter";

const BUST = "s25-cigna";
const BASE_DATE = "2025-12-31";
interface Row { instrument: string; amount: string; sourceLine: string; kind: string }

(async () => {
  let spend = 0;
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === BASE_DATE)!;
  const anchorQ = f.filings.find((x) => /^10-Q$/i.test(x.form) && x.reportDate === "2026-06-30")!;
  const { text: tenKText } = await getFilingText(tenK.primaryDocUrl);
  const { text: anchorText } = await getFilingText(anchorQ.primaryDocUrl);
  const tenKLoc = locatorFor(tenKText);
  const baseTag = await fetchXbrlDebtTotal(f.cik, BASE_DATE);
  const anchorTag = await fetchXbrlDebtTotal(f.cik, "2026-06-30");

  console.log(`\n${"=".repeat(96)}\nTHE ROLL, balance taken from the sentence that predicates it\n${"=".repeat(96)}`);
  let ties = 0;
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const nd = r.results.find((t) => t.triggerId === "new-debt-issuance") as unknown as Record<string, unknown> | undefined;
    const rows = (((dm?.priorPeriodBase as { rows?: Row[] } | null)?.rows) ?? []).filter((x) => x.kind === "row");
    const millions = (a: string, s: string) => tableCellMillions(a, s, tenKText, tenKLoc);

    // THE SENTENCE, not the field.
    const cp = statedBalanceAt(anchorText, /commercial paper/i, ["June 30, 2026"]);
    const modelField = ((dm?.proseInstruments ?? []) as Record<string, unknown>[]).find((p) => String(p.category) === "commercial-paper");
    const fieldAsOf = String(modelField?.asOfDate ?? "—"), fieldAmt = String(modelField?.amount ?? "null");

    const anchorBalances = cp
      ? [{ name: "Commercial paper program", amount: cp.amountText, amountBasis: "outstanding", asOfDate: "2026-06-30", sourceLine: cp.sourceLine, citedUrl: anchorQ.primaryDocUrl }]
      : [];
    const movements = derivePlacedMovements({
      baseDate: BASE_DATE, anchorDate: "2026-06-30",
      noteRetirements: (dm?.noteRetirements ?? []) as never,
      issuedTranches: (nd?.issuedTranches ?? []) as never,
      issuanceDate: (nd?.eventDate as string | null) ?? null,
      intendedRedemptions: (nd?.redeems ?? []) as never,
      anchorBalances: anchorBalances as never,
      baseRows: rows, parseMillions: millions,
    });
    const deltas = toRollDeltas(movements).map((d) =>
      /Commercial paper/i.test(d.label) && cp ? { ...d, statedApproximate: cp.approximate } : d
    );
    const tie = computeRollTie(Math.round((baseTag.total ?? 0) / 1e6), deltas, Math.round((anchorTag.total ?? 0) / 1e6));
    if (tie.ties) ties++;
    console.log(`\n  sample ${n + 1}${n === 0 ? " (canonical)" : " (re-taste)"}`);
    console.log(`      model field:  asOf=${fieldAsOf}  amount=${fieldAmt}`);
    console.log(`      sentence:     "${(cp?.sourceLine ?? "NONE FOUND").slice(0, 96)}"`);
    console.log(`      agreement:    ${fieldAsOf === "2026-06-30" ? "field agrees with the sentence" : `DISAGREE — field says ${fieldAsOf}, sentence says 2026-06-30. THE SENTENCE WINS.`}`);
    console.log(`      approximate:  ${cp?.approximate} (${cp?.corroborating} sentence(s) state this balance at this date)`);
    console.log(`      deltas ${deltas.length}: ${deltas.map((d) => `${d.label.slice(0, 26)} ${d.amountMillions}M${d.statedApproximate ? "~" : ""}`).join(" | ")}`);
    console.log(`      rolled ${tie.computedMillions.toLocaleString()}M  residual ${tie.residualMillions}M  tolerance ±${toleranceFor(deltas)}M  TIES: ${tie.ties}`);
  }
  console.log(`\n${"=".repeat(96)}\n  ROLL TIES: ${ties}/3\n  SPEND: $${spend.toFixed(4)}\n${"=".repeat(96)}`);
})();
