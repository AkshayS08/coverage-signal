import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";
const BUST = "s25-cigna";
(async () => {
  let spend = 0;
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const pi = (dm?.proseInstruments ?? []) as Record<string, unknown>[];
    const nr = (dm?.noteRetirements ?? []) as Record<string, unknown>[];
    console.log(`\nsample ${n + 1}: proseInstruments=${pi.length}, noteRetirements=${nr.length}`);
    for (const p of pi) console.log(`    [${String(p.category)}] "${String(p.name).slice(0, 46)}" amount=${String(p.amount)} basis=${String(p.amountBasis)} asOf=${String(p.asOfDate)}`);
    for (const x of nr) console.log(`    retirement: ${String(x.instrument).slice(0, 46)} ${String(x.amount)} @${String(x.eventDate)}`);
  }
  console.log(`\nSPEND $${spend.toFixed(4)}`);
})();
