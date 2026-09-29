/**
 * THE DERIVED ROLL, AGAINST REAL CACHED DATA. $0.
 *
 * The first roll this build computed had its two movements typed in by hand.
 * This one reads them out of the filings — every event from a sentence, every
 * placement from its own date — and the number it produces is only worth
 * anything if it matches without being told to.
 *
 * Prints the placement of every derived event, including all four of Cigna's
 * 8-K tranches, which the hand roll never mentioned and which must therefore
 * be either in the base or after the anchor. Which one is proven, not assumed.
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
import { deriveRollEvents, rollForward } from "../events/rollForward";
import { rolledVerdict, ROLL_BAND_USD } from "../events/rolledPosition";
import { locatorFor, resolvedAmountUsd } from "../agent/tableScale";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Cigna Group";
const BASE_DATE = "2025-12-31";
const usd = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(3)}B` : `$${Math.round(n / 1e6)}M`);

(async () => {
  let spend = 0;
  const r = await runAgentLoop(COMPANY);
  spend += currentCompanySpend().totalUsd;
  const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const nd = r.results.find((t) => t.triggerId === "new-debt-issuance") as unknown as Record<string, unknown> | undefined;
  const anchorDate = (dm?.debtScheduleSourceFiling as { reportDate?: string } | undefined)?.reportDate ?? "2026-06-30";

  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === BASE_DATE)!;
  const { text: tenKText } = await getFilingText(tenK.primaryDocUrl);
  const baseLoc = locatorFor(tenKText);

  const base = JSON.parse(readFileSync(join(process.cwd(), "baselines", "referenced-notes", `${f.cik}-${BASE_DATE}-v1.json`), "utf-8")) as {
    rows: { instrument: string; amount: string; sourceLine: string; kind: string }[];
  };

  // BOTH TOTALS FROM THE FILER'S OWN TAGS — never typed.
  const baseTag = await fetchXbrlDebtTotal(f.cik, BASE_DATE);
  const anchorTag = await fetchXbrlDebtTotal(f.cik, anchorDate);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — the roll, DERIVED. base ${BASE_DATE} → anchor ${anchorDate}`);
  console.log("=".repeat(104));
  console.log(`\n  base total   ${usd(baseTag.total ?? 0)}   from ${baseTag.parts.map((p) => p.tag).join(" + ")}`);
  console.log(`  anchor total ${usd(anchorTag.total ?? 0)}   from ${anchorTag.parts.map((p) => p.tag).join(" + ")}`);

  const events = deriveRollEvents({
    baseDate: BASE_DATE,
    anchorDate,
    noteRetirements: (dm?.noteRetirements ?? []) as never,
    issuedTranches: (nd?.issuedTranches ?? []) as never,
    issuanceDate: (nd?.eventDate as string | null) ?? null,
    intendedRedemptions: (nd?.redeems ?? []) as never,
    anchorBalances: (dm?.proseInstruments ?? []) as never,
    baseRows: base.rows.filter((x) => x.kind === "row"),
    parse: parseMoneyAmount,
    resolveBase: (amount, sourceLine) => resolvedAmountUsd(amount, sourceLine, tenKText, baseLoc, parseMoneyAmount),
  });

  console.log(`\n${"─".repeat(104)}\n  EVERY DERIVED EVENT, PLACED BY ITS OWN DATE\n${"─".repeat(104)}`);
  for (const e of events) {
    console.log(`\n  [${e.placement.toUpperCase()}]  ${e.kind}  ${e.instrument}`);
    console.log(`      ${e.statedAs}${e.approximate ? "   (APPROXIMATE — the filing's own hedge)" : ""}   dated ${e.date ?? "—"}`);
    console.log(`      counts: ${e.placement === "delta" ? usd(e.amountUsd) : "$0 — " + e.why.slice(0, 92)}`);
    console.log(`      "${e.sourceLine.replace(/\s+/g, " ").slice(0, 118)}"`);
  }

  const rolled = rollForward(baseTag.total ?? 0, events, base.rows);
  console.log(`\n${"─".repeat(104)}\n  THE ROLL\n${"─".repeat(104)}`);
  console.log(`      base                      ${usd(baseTag.total ?? 0)}`);
  for (const e of rolled.counted) console.log(`      ${e.amountUsd < 0 ? "less" : "plus"} ${e.instrument.slice(0, 44).padEnd(46)} ${usd(e.amountUsd)}`);
  console.log(`      rolled                    ${usd(rolled.total)}`);
  console.log(`      anchor stated             ${usd(anchorTag.total ?? 0)}`);
  console.log(`      residual                  ${usd(rolled.total - (anchorTag.total ?? 0))}  against ±${usd(ROLL_BAND_USD)}`);
  console.log(`      approximate share         ${usd(rolled.approximateUsd)} — the only thing the band may absorb`);
  console.log(`      in-base events            ${rolled.inBase.length}, of which MISSING from the transcription: ${rolled.missingFromBase.length === 0 ? "none" : rolled.missingFromBase.map((e) => e.instrument).join(", ")}`);
  console.log(`      excluded                  ${rolled.excluded.length} (${rolled.excluded.map((e) => e.instrument).join(", ") || "none"})`);

  const rowsOnly = base.rows.filter((x) => x.kind === "row");
  const baseComputed = rowsOnly.reduce((a, x) => a + (resolvedAmountUsd(x.amount, x.sourceLine, tenKText, baseLoc, parseMoneyAmount) ?? 0), 0);
  const v = rolledVerdict({
    baseStatedTotal: baseTag.total,
    baseComputedTotal: baseComputed,
    anchorStatedTotal: anchorTag.total,
    rolledTotal: rolled.total,
    baseAsOf: BASE_DATE, anchorAsOf: anchorDate, baseNote: "10-K Note 7",
  });
  console.log(`\n      base transcription sums to ${usd(baseComputed)} against a stated ${usd(baseTag.total ?? 0)}`);
  console.log(`\n      VERDICT: ${v.kind.toUpperCase()}`);
  console.log(`      ${v.statement}`);
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
})();
