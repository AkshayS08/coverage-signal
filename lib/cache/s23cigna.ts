/**
 * CIGNA'S SIX ROWS. $0 — cached answer only.
 *
 * The demo story on record is "honestly empty — the anchor note cannot be
 * located, so the ladder renders empty with that reason rather than filling
 * itself from an older filing." The run log says exactly that. But the
 * signing probe derives SIX rows for Cigna, four of which fail Rule 58.
 *
 * Both cannot be the story. Either the page shows an empty ladder and the six
 * rows live somewhere a signature still pins, or the page shows six rows and
 * "honestly empty" describes the anchor schedule rather than what an RM sees.
 * The difference is the whole demo claim, so it is read off the data rather
 * than argued from the log line.
 *
 * Printed: where each row came from, what sentence carries it, which filing
 * it is cited to, and whether that sentence states the row's own amount.
 *
 * Run: npx tsx lib/cache/s23cigna.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, amountSupportOf } from "../events/position";
import { deriveGoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";

(async () => {
  const r = await runAgentLoop("Cigna Group");
  const spend = currentCompanySpend().totalUsd;
  const pos = assemblePosition(r, PINNED_AS_OF);
  const state = deriveGoldenState(r, PINNED_AS_OF);
  const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const anchor = dm?.debtScheduleSourceFiling as { form?: string; date?: string; url?: string } | undefined;

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA at v${EXTRACTION_PROMPT_VERSION} — what the anchor gave, and what the ladder actually renders`);
  console.log("=".repeat(104));

  console.log(`\n  anchor                     ${anchor?.form ?? "—"} ${anchor?.date ?? ""}`);
  console.log(`  anchor scheduleSequence    ${((dm?.scheduleSequence ?? []) as unknown[]).length} entries   ← the "honestly empty" claim is about THIS`);
  console.log(`  proseInstruments           ${((dm?.proseInstruments ?? []) as unknown[]).length}`);
  console.log(`  facilities                 ${((dm?.facilities ?? []) as unknown[]).length}`);
  console.log(`  referencedScheduleSequence ${((dm?.referencedScheduleSequence ?? []) as unknown[]).length}`);
  console.log(`\n  pos.rows (the anchor position a signature pins)   ${pos.rows.length}`);
  console.log(`  goldenState.rows                                  ${state.rows.length}`);
  console.log(`  tier2 events (kept OUT of the ladder)             ${(pos.tier2?.events ?? []).length}`);
  console.log(`  issuancesInsideAggregate                          ${pos.issuancesInsideAggregate.length}`);

  console.log(`\n${"─".repeat(104)}\n  THE ROWS AN RM WOULD SEE\n${"─".repeat(104)}`);
  for (const row of pos.rows) {
    // A LADDER ROW CARRIES ITS OWN sourceLine. The first version of this
    // harness handed the row to `amountProvenanceFor`, which takes a
    // FACILITY — so every sentence printed empty and the report was one
    // step from claiming Cigna's rows cite nothing at all. Same layer
    // mistake this session has now made in four different harnesses:
    // asking the right question of the wrong object.
    const support = amountSupportOf(row.amount, row.sourceLine);
    console.log(`\n  ${row.instrument}`);
    console.log(`      amount        ${row.amount}`);
    console.log(`      maturity      ${row.maturityDate ?? "—"} (${row.dateGranularity ?? "—"})`);
    console.log(`      status        ${(row as unknown as { status?: string }).status ?? "—"}   capacity=${row.isCapacity}`);
    console.log(`      provenance    ${(row as unknown as { provenance?: string }).provenance ?? "—"}`);
    console.log(`      citedUrl      ${row.citedUrl}`);
    console.log(`      amount support ${support.kind.toUpperCase()}${support.kind === "unsupported" ? "   ← Rule 58 refuses a signature over this" : ""}`);
    console.log(`      sentence      "${String(row.sourceLine).replace(/\s+/g, " ")}"`);
  }

  if ((pos.tier2?.events ?? []).length > 0) {
    console.log(`\n${"─".repeat(104)}\n  TIER 2 — after the anchor, deliberately not on the ladder\n${"─".repeat(104)}`);
    for (const t of pos.tier2.events) console.log(`      ${t.kind} | ${t.instrument ?? "—"}`);
  }

  console.log(`\n${"─".repeat(104)}\n  COVERAGE\n${"─".repeat(104)}`);
  console.log(`      denominator   ${state.coverage.denominatorSource}`);
  console.log(`      statedTotal   ${state.coverage.statedTotalDebt}`);
  console.log(`      captured      ${state.coverage.capturedFace}`);
  console.log(`      residual      ${state.coverage.residualPercent}%   passes=${state.coverage.residualPasses}`);

  // ── IS THIS v31's DOING? ─────────────────────────────────────────────
  //
  // Asked because "blocked" and "newly blocked" are different reports. v30
  // and v31 answers live under the SAME fingerprint directory when the filing
  // set has not moved, so the v30 answer is readable and the comparison is
  // free.
  console.log(`\n${"─".repeat(104)}\n  DID v31 DO THIS? — the same rows at v30\n${"─".repeat(104)}`);
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  const tranchesAt = async (v: number) => {
    try {
      const meta = await head(`answer/${f.cik}/base/${fp}/v${v}.json`, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const j = (await (await fetch(`${meta.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
      const nd = (j.data ?? []).find((x) => x.triggerId === "new-debt-issuance") as Record<string, unknown> | undefined;
      return ((nd?.issuedTranches ?? []) as Record<string, unknown>[]).map(
        (t) => `${String(t.instrument)} | ${String(t.amount)} | ${amountSupportOf(String(t.amount ?? ""), String(t.sourceLine ?? "")).kind}\n          "${String(t.sourceLine ?? "").replace(/\s+/g, " ")}"`
      );
    } catch { return null; }
  };
  const t30 = await tranchesAt(30), t31 = await tranchesAt(EXTRACTION_PROMPT_VERSION);
  console.log(`  v30 answer at this fingerprint: ${t30 ? "readable — the filing set has not moved" : "absent"}`);
  for (const [v, list] of [[30, t30], [EXTRACTION_PROMPT_VERSION, t31]] as const) {
    console.log(`\n  v${v} issuedTranches (${list?.length ?? "—"}):`);
    for (const l of list ?? []) console.log(`      ${l}`);
  }
  console.log(`\n  VERDICT: ${t30 && t31 && t30.join("\n") === t31.join("\n")
    ? "IDENTICAL at v30 and v31 — this is not a v31 regression. It is a standing defect that was never surfaced because Cigna has never carried a golden, so nothing ever ran Rule 58 over it."
    : "the tranches MOVED between v30 and v31 — read them above"}`);

  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
})();
