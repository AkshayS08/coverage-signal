/**
 * SESSION 27 (Akshay, Nov 20): THE LADDER EQUATION HOLDS EXACTLY. The chart's bars, plus what the chart states it does
 * not show ("Not shown on the chart, with no single maturity: …"), equal the total-debt figure, to the dollar
 * (omissionRules.test L1). It holds on all six production cards (Nov 11). Tenet's candidate without its 2026 schedule
 * column broke it both ways and no check saw: its bars lost the $27MM and its caption moved the $679MM of leases the
 * schedule's figures include to "not shown" ($13,314MM + $679MM against $13,341MM).
 */
import { parseMoneyAmount } from "../events/position";

const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");

export function ladderEquation(card: any): { holds: boolean; totalUsd: number; barsUsd: number; notShownUsd: number; gapUsd: number } | null {
  const v = card?.v3;
  if (!v?.chart || !v?.totalDebt?.figure) return null;
  const barsUsd = v.chart.bars.reduce((a: number, b: any) => a + (b.segments ?? []).reduce((x: number, s: any) => x + (s.usd ?? 0), 0), 0);
  const notShownUsd = (v.chart.captions ?? []).filter((l: any) => /Not shown on the chart/.test(txt(l))).flatMap((l: any) => l.filter((s: any) => s.k === "computed" || s.k === "figure")).reduce((a: number, s: any) => a + (s.usd ?? parseMoneyAmount(s.printed) ?? 0), 0);
  const totalUsd = v.totalDebt.figure.usd ?? parseMoneyAmount(v.totalDebt.figure.printed) ?? 0;
  const gapUsd = barsUsd + notShownUsd - totalUsd;
  return { holds: Math.abs(gapUsd) < 0.5, totalUsd, barsUsd, notShownUsd, gapUsd };
}
