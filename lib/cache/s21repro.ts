/**
 * SESSION 21 — THE REPRODUCIBILITY TEST (Rule 23).
 *
 * A hand-verified state is a golden-file candidate only after it reproduces
 * on independent re-asks. UHS's 98% was verified against the filing and then
 * did not survive the next extraction, which is how Rule 23 was learned.
 *
 * CACHE_BUST forces the model to be re-asked at the SAME prompt version on
 * the SAME filings — the only lever that measures the model rather than the
 * pipeline. Billed, deliberately.
 *
 * ALL RUNS ARE REPORTED. Not the best of three.
 *
 * Run: npx tsx lib/cache/s21repro.ts "Universal Health Services" 3
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { computeCoverage } from "../events/coverage";

(async () => {
  const company = process.argv[2] ?? "Universal Health Services";
  const runs = Number(process.argv[3] ?? 3);
  const seen: string[] = [];

  for (let i = 1; i <= runs; i++) {
    process.env.CACHE_BUST = `s21-repro-${i}`;
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const cov = computeCoverage(dm);
    const instruments = [
      ...(dm?.scheduleSequence ?? []).filter((e) => e.kind === "row").map((e) => `ROW ${e.label}=${e.amount}`),
      ...(dm?.proseInstruments ?? []).map((p) => `PROSE ${p.name}=${p.amount}[${p.amountBasis}]`),
    ].sort();
    const pct = cov.statedTotalDebt ? Math.round((cov.capturedFace / cov.statedTotalDebt) * 100) : null;
    const signature = JSON.stringify({
      rows: dm?.scheduleSequence.length ?? 0,
      prose: (dm?.proseInstruments ?? []).length,
      capturedFace: cov.capturedFace,
      statedTotalDebt: cov.statedTotalDebt,
      pct,
      residual: cov.residualFraction === null ? null : Number((cov.residualFraction * 100).toFixed(2)),
      passes: cov.residualPasses,
      instruments,
    });
    seen.push(signature);
    console.log(`\n===== RUN ${i} =====`);
    console.log(`  rows ${dm?.scheduleSequence.length ?? 0} · prose ${(dm?.proseInstruments ?? []).length}`);
    console.log(`  captured $${(cov.capturedFace / 1e9).toFixed(3)}B of $${((cov.statedTotalDebt ?? 0) / 1e9).toFixed(3)}B = ${pct}%  residual ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"}  passes=${cov.residualPasses}`);
    for (const inst of instruments) console.log(`    ${inst}`);
  }

  const distinct = [...new Set(seen)];
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${runs} independent re-asks at the same version on the same filings: ${distinct.length} distinct result(s).`);
  console.log(
    distinct.length === 1
      ? "  => REPRODUCIBLE. The state is a golden-file candidate."
      : "  => NOT REPRODUCIBLE. This is one observation per run, not a verified state. Report the variance; do not re-run hoping."
  );
})();
