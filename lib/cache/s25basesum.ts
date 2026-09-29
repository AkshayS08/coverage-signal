import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { parseMoneyAmount } from "../events/position";
import { locatorFor, resolvedAmountUsd, governingScale } from "../agent/tableScale";
import { currentCompanySpend } from "../agent/costMeter";
const BUST = "s25-cigna";
(async () => {
  let spend = 0;
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === "2025-12-31")!;
  const { text } = await getFilingText(tenK.primaryDocUrl);
  const loc = locatorFor(text);
  for (const n of [0, 1]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const base = dm?.priorPeriodBase as { rows?: { instrument: string; amount: string; sourceLine: string; kind: string }[] } | null;
    const rows = (base?.rows ?? []).filter((x) => x.kind === "row");
    let sum = 0; const zeros: string[] = []; const unlocatable: string[] = [];
    for (const row of rows) {
      const g = governingScale(row.amount, row.sourceLine, text, loc);
      const v = resolvedAmountUsd(row.amount, row.sourceLine, text, loc, parseMoneyAmount);
      const m = v === null ? 0 : Math.abs(v) >= 1e6 ? v / 1e6 : v;
      sum += m;
      if (g.reason === "not-locatable") unlocatable.push(`${row.instrument.slice(0, 34)} "${row.amount}"`);
      if (m === 0 && !/—|–/.test(row.amount)) zeros.push(`${row.instrument.slice(0, 34)} "${row.amount}"`);
    }
    console.log(`\nsample ${n + 1}: ${rows.length} rows, sum ${Math.round(sum).toLocaleString()}M`);
    console.log(`  sourceLine NOT locatable in the 10-K: ${unlocatable.length}`);
    for (const u of unlocatable.slice(0, 6)) console.log(`      ${u}`);
    console.log(`  parsed to zero without an em-dash:    ${zeros.length}`);
    for (const z of zeros.slice(0, 6)) console.log(`      ${z}`);
  }
  console.log(`\nSPEND $${spend.toFixed(4)}`);
})();
