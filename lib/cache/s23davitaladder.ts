/**
 * RUN 2's LADDER, REBUILT FROM ITS OWN CACHED ANSWER. $0.
 *
 * DaVita's 9b failed 9, 17, 9, and every row-bearing extraction field is the
 * same in all three runs — same instruments, same values, same counts. The
 * only thing that moved is HOW the amounts and dates were written: run 2
 * emitted no unit word ("$ 1,975,000") and US-format dates ("11/24/2030"),
 * where runs 1 and 3 emitted "$ 1,975,000 thousand" and "2030-11-24".
 *
 * So the eight extra rows are made by OUR assembly, not by an extra
 * document, and the status on each row says which pass made them. If they
 * are `unconfirmed`, the prior-period entries failed to match the current
 * ones and were re-added — a comparison that works on one spelling of a date
 * and not another.
 *
 * Set CACHE_BUST to the run's tag before running, so this reads that run's
 * answer and bills nothing:
 *   CACHE_BUST=s23-sign-DaVita-1 npx tsx lib/cache/s23davitaladder.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = process.argv[2] ?? "DaVita";

/**
 * THE BUST TAG IS DERIVED, NEVER TYPED.
 *
 * Pass `--run 1` or `--run 2` and this composes the tag exactly as
 * s23sign9b.ts composed it when it wrote the blob. Hand-typing it cost
 * $0.2773 on CHS ("CommunityHeal" for "CommunityHealt") and then, after that
 * was written into the build log as a lesson, another $0.4492 on Tenet
 * ("TenetHealthca" for "TenetHealthcar"). Both times the miss looked exactly
 * like a cache expiry and was a typo in a slice(0, 14).
 *
 * A harness that makes the mistake impossible is worth more than a note
 * saying not to make it.
 */
const BUST_TAG = "s23-sign";
const runFlag = process.argv.indexOf("--run");
const RUN = runFlag >= 0 ? process.argv[runFlag + 1] : null;
if (RUN) {
  process.env.CACHE_BUST = `${BUST_TAG}-${COMPANY.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${RUN}`;
}

(async () => {
  if (RUN) console.log(`\n  derived CACHE_BUST: ${process.env.CACHE_BUST}`);
  const r = await runAgentLoop(COMPANY);
  const spend = currentCompanySpend().totalUsd;
  const pos = assemblePosition(r, PINNED_AS_OF);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — CACHE_BUST="${process.env.CACHE_BUST ?? "(none: the canonical answer)"}" — ${pos.rows.length} ladder rows`);
  console.log("=".repeat(104));

  const byStatus = new Map<string, number>();
  for (const row of pos.rows) {
    const s = String((row as unknown as { status?: string }).status ?? "—");
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    console.log(`  ${s.padEnd(12)} ${row.instrument.slice(0, 46).padEnd(48)} ${row.amount.padEnd(26)} ${row.maturityDate ?? "—"}`);
  }
  console.log(`\n  by status: ${[...byStatus].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
})();
