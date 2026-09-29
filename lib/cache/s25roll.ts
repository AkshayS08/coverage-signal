/**
 * THE DERIVED ROLL, AGAINST REAL CACHED DATA. $0.
 *
 * The deltas are derived here (lib/events/rollDeltas.ts) and the ARITHMETIC is
 * done by lib/events/rollForward.ts — the Session 23 module that already owns
 * the base tie, the roll tie, the tolerance band and the firing conjunction.
 * Nothing in this harness re-implements any of those.
 *
 * Run: npx tsx lib/cache/s25roll.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { parseMoneyAmount } from "../events/position";
import { derivePlacedMovements, toRollDeltas, inBaseButMissing, statesApproximation } from "../events/rollDeltas";
import { computeRollTie, toleranceFor } from "../events/rollForward";
import { locatorFor, resolvedAmountUsd } from "../agent/tableScale";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Cigna Group";
const BASE_DATE = "2025-12-31";

(async () => {
  const r = await runAgentLoop(COMPANY);
  const spend = currentCompanySpend().totalUsd;
  const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const nd = r.results.find((t) => t.triggerId === "new-debt-issuance") as unknown as Record<string, unknown> | undefined;
  const anchorDate = (dm?.debtScheduleSourceFiling as { reportDate?: string } | undefined)?.reportDate ?? "2026-06-30";

  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === BASE_DATE)!;
  const { text: tenKText } = await getFilingText(tenK.primaryDocUrl);
  const baseLoc = locatorFor(tenKText);
  const base = JSON.parse(
    readFileSync(join(process.cwd(), "baselines", "referenced-notes", `${f.cik}-${BASE_DATE}-v1.json`), "utf-8")
  ) as { rows: { instrument: string; amount: string; sourceLine: string; kind: string }[] };

  const baseTag = await fetchXbrlDebtTotal(f.cik, BASE_DATE);
  const anchorTag = await fetchXbrlDebtTotal(f.cik, anchorDate);

  /** Millions, resolved through Rule 67's one deciding function. */
  const millions = (amount: string, sourceLine: string): number | null => {
    const v = resolvedAmountUsd(amount, sourceLine, tenKText, baseLoc, parseMoneyAmount);
    if (v !== null && Math.abs(v) >= 1e6) return v / 1e6;
    const raw = parseMoneyAmount(amount);
    return raw === null ? null : raw >= 1e6 ? raw / 1e6 : raw;
  };

  const movements = derivePlacedMovements({
    baseDate: BASE_DATE,
    anchorDate,
    noteRetirements: (dm?.noteRetirements ?? []) as never,
    issuedTranches: (nd?.issuedTranches ?? []) as never,
    issuanceDate: (nd?.eventDate as string | null) ?? null,
    intendedRedemptions: (nd?.redeems ?? []) as never,
    anchorBalances: (dm?.proseInstruments ?? []) as never,
    baseRows: base.rows.filter((x) => x.kind === "row"),
    parseMillions: millions,
  });

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — the roll, DERIVED. base ${BASE_DATE} → anchor ${anchorDate}`);
  console.log("=".repeat(104));
  console.log(`\n  base   $${Math.round((baseTag.total ?? 0) / 1e6).toLocaleString()}M  from ${baseTag.parts.map((p) => p.tag).join(" + ")}`);
  console.log(`  anchor $${Math.round((anchorTag.total ?? 0) / 1e6).toLocaleString()}M  from ${anchorTag.parts.map((p) => p.tag).join(" + ")}`);

  console.log(`\n${"─".repeat(104)}\n  EVERY MOVEMENT, PLACED BY ITS OWN DATE\n${"─".repeat(104)}`);
  for (const m of movements) {
    console.log(`\n  [${m.placement.toUpperCase()}]  ${m.kind}  ${m.instrument}`);
    console.log(`      ${m.statedAs}${statesApproximation(m.sourceLine) ? "   (APPROXIMATE — the filing's own hedge)" : ""}   dated ${m.date ?? "—"}`);
    console.log(`      counts: ${m.placement === "delta" ? `$${m.amountMillions.toLocaleString()}M` : `$0 — ${m.why.slice(0, 86)}`}`);
  }

  const deltas = toRollDeltas(movements);
  const missing = inBaseButMissing(movements, base.rows);
  const tie = computeRollTie(
    Math.round((baseTag.total ?? 0) / 1e6),
    deltas,
    Math.round((anchorTag.total ?? 0) / 1e6)
  );

  console.log(`\n${"─".repeat(104)}\n  THE ROLL — arithmetic by rollForward.ts, deltas derived here\n${"─".repeat(104)}`);
  console.log(`      base                      $${Math.round((baseTag.total ?? 0) / 1e6).toLocaleString()}M`);
  for (const d of deltas) {
    console.log(`      ${d.amountMillions < 0 ? "less" : "plus"} ${d.label.slice(0, 44).padEnd(46)} $${d.amountMillions.toLocaleString()}M${d.statedApproximate ? "  (approximate)" : ""}`);
  }
  console.log(`      rolled                    $${tie.computedMillions.toLocaleString()}M`);
  console.log(`      anchor stated             $${(tie.statedMillions ?? 0).toLocaleString()}M`);
  console.log(`      residual                  $${tie.residualMillions}M   tolerance ±$${toleranceFor(deltas)}M`);
  console.log(`      TIES: ${tie.ties}`);
  console.log(`      ${tie.detail}`);
  console.log(`\n      in-base movements: ${movements.filter((m) => m.placement === "in-base").length}, MISSING from the transcription: ${missing.length === 0 ? "none" : missing.map((m) => m.instrument).join(", ")}`);
  console.log(`      excluded: ${movements.filter((m) => m.placement !== "delta" && m.placement !== "in-base").map((m) => m.instrument).join(", ") || "none"}`);
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
})();
