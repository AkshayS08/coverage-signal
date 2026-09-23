/**
 * THE $700M FACILITY: EXTRACTED-AND-DROPPED, OR NEVER EXTRACTED? $0.
 *
 * UHS run 3 assembled 9 ladder rows where runs 1 and 2 assembled 10, and the
 * missing one is the $700 million July 2026 Delayed Draw Term Loan. Those are
 * two completely different findings and the symptom is identical:
 *
 *   present in the RAW extraction, absent from the assembled ladder
 *       → an ASSEMBLY PATH defect. Same symptom class as position.ts:603,
 *         different site. Book-wide, because nothing about it is UHS's.
 *
 *   absent from the RAW extraction
 *       → model variance, a one-time drop like Molina's `drawn`.
 *         Characterised per name, not a code defect.
 *
 * So this reads the blob BEFORE ladder construction — the bytes the model
 * returned — and prints them beside what the ladder ended up with. Reading
 * the assembled result to answer a question about extraction is the layer
 * mistake this session keeps finding; the blob is the only place the answer
 * actually is.
 *
 * Run: npx tsx lib/cache/s23vanish.ts [bust-tag]
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Universal Health Services";
const TAG = process.argv[2] ?? "s23-9b-v2";
const RUNS = 3;
// THE FACILITY, NOT ANY ROW HOLDING 700. A first version matched /700/ on
// the amount alone, which also matched the 1.65% Senior Secured Notes due
// 2026 — a $700 million BOND — and printed "assembled ladder HAS it" for run
// 3, where the delayed-draw facility is absent. A marker that matches the
// wrong row makes the verdict line say the opposite of the finding.
const TARGET = /delayed\s*draw/i;
const isTarget = (name: string, amount: string) => TARGET.test(name) && /700/.test(amount);

interface Fig { value: string; sourceLine: string }

(async () => {
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  let spend = 0;

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — the RAW extraction against the ASSEMBLED ladder, run by run`);
  console.log("=".repeat(104));

  for (let i = 1; i <= RUNS; i++) {
    const key = baseAnswerKey(f.cik, `${fp}-bust${TAG}-UniversalHealt-${i}`);
    const meta = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
    const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
    const prose = (dm?.proseInstruments ?? []) as Record<string, unknown>[];
    const seq = (dm?.scheduleSequence ?? []) as Record<string, unknown>[];

    // The assembled ladder, from the same cached answer.
    process.env.CACHE_BUST = `${TAG}-UniversalHealt-${i}`;
    const result = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);

    console.log(`\n${"-".repeat(104)}`);
    console.log(`RUN ${i}   raw: ${facs.length} facilities, ${prose.length} prose instruments, ${seq.length} schedule entries   →   assembled: ${pos.rows.length} ladder rows`);
    console.log("-".repeat(104));

    console.log(`\n  RAW facilities as the model returned them:`);
    for (const x of facs) {
      const size = (x.facilitySize as Fig | null)?.value ?? "—";
      const mark = isTarget(String(x.name), size) ? " ← the $700M delayed-draw facility" : "";
      console.log(`      ${String(x.name).slice(0, 56).padEnd(58)} size ${String(size).padEnd(18)}${mark}`);
    }
    const rawHas = facs.some((x) => isTarget(String(x.name), String((x.facilitySize as Fig | null)?.value ?? "")));

    console.log(`\n  ASSEMBLED ladder rows:`);
    for (const r of pos.rows) {
      const mark = isTarget(String(r.instrument), String(r.amount ?? "")) ? " ← the $700M delayed-draw row" : "";
      console.log(`      ${String(r.instrument).slice(0, 56).padEnd(58)} ${String(r.amount ?? "—").padEnd(18)}${mark}`);
    }
    const ladderHas = pos.rows.some((r) => isTarget(String(r.instrument), String(r.amount ?? "")));

    console.log(`\n  VERDICT: raw extraction ${rawHas ? "HAS" : "does NOT have"} the $700M facility; assembled ladder ${ladderHas ? "HAS" : "does NOT have"} it.`);
    if (rawHas && !ladderHas) console.log(`  → ASSEMBLY PATH DEFECT. The model returned it and ladder construction dropped it silently.`);
    else if (!rawHas) console.log(`  → NEVER EXTRACTED. Model variance for this run, not a code defect.`);
    else console.log(`  → carried through correctly.`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
