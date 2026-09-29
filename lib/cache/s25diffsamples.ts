import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";
const BUST = "s25-cigna";
(async () => {
  let spend = 0;
  const got: Record<string, { instrument: string; amount: string; kind: string }[]> = {};
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const b = dm?.priorPeriodBase as { rows?: { instrument: string; amount: string; kind: string }[] } | null;
    got[`s${n + 1}`] = b?.rows ?? [];
  }
  const kinds = (rs: { kind: string }[]) => rs.reduce((a: Record<string, number>, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
  for (const k of Object.keys(got)) console.log(`${k}: ${got[k].length} entries, kinds ${JSON.stringify(kinds(got[k]))}`);
  console.log("\n--- commercial paper row, per sample ---");
  for (const k of Object.keys(got)) {
    const cp = got[k].filter((r) => /commercial paper/i.test(r.instrument));
    console.log(`  ${k}: ${cp.length ? cp.map((c) => `[${c.kind}] "${c.instrument}" = "${c.amount}"`).join(" | ") : "ABSENT"}`);
  }
  console.log("\n--- first 6 'row' entries, sample 1 vs sample 2 ---");
  const r1 = got.s1.filter((r) => r.kind === "row"), r2 = got.s2.filter((r) => r.kind === "row");
  for (let i = 0; i < 6; i++) console.log(`  ${i}: s1 "${r1[i]?.instrument}" = ${r1[i]?.amount}\n     s2 "${r2[i]?.instrument}" = ${r2[i]?.amount}`);
  console.log(`\nSPEND $${spend.toFixed(4)}`);
})();
