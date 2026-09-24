/**
 * WHY DID RUN 3 DROP THE $700M FACILITY? $0, cached reads.
 *
 * Fix 2 cannot be declared against a cause nobody has found — that is Stage
 * 1's mistake at full price. Cigna has a demonstrable contradiction and Tenet
 * a demonstrable conversion; UHS has neither yet.
 *
 * THE LEAD WORTH CHECKING FIRST. Run 3 returned LESS OF EVERYTHING — three
 * facilities against four, eight prose instruments against nine. A response
 * that is uniformly smaller is the signature of OUTPUT BUDGET PRESSURE rather
 * than of a rule about facilities: under pressure a model compresses, and
 * what it compresses first is the last thing it was asked for.
 *
 * `assertNotTruncated` throws on stop_reason "max_tokens" BEFORE caching, so
 * run 3 was not truncated — but "not truncated" and "not near the ceiling"
 * are different facts, and only the second one explains compression.
 *
 * So this compares, across the three runs: output tokens against max_tokens,
 * and the size of every returned array. If run 3 sits near the cap, the cause
 * is budget and the fix is the budget — NOT a prompt sentence about delayed
 * draw facilities, which would be a fix aimed at the wrong thing.
 *
 * Run: npx tsx lib/cache/s23uhsdiag.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { list } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const COMPANY = "Universal Health Services";
const TAG = "s23-9b-v2";

/** Every array a debt-maturity verdict can return, so "smaller everywhere" is visible rather than inferred. */
const ARRAYS = ["facilities", "proseInstruments", "scheduleSequence", "priorScheduleSequence", "balanceSheetDebtCaptions", "issuedTranches", "noteRetirements", "proceedsUses"] as const;

(async () => {
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const { blobs } = await list({ prefix: `answer/${f.cik}/base/`, token, limit: 1000 });

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — the three v${EXTRACTION_PROMPT_VERSION} re-asks, side by side. Is run 3 uniformly smaller?`);
  console.log("=".repeat(104));

  const rows: { run: number; sizes: Record<string, number>; bytes: number; triggers: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const path = `answer/${f.cik}/base/${fp}-bust${TAG}-UniversalHealt-${i}/v${EXTRACTION_PROMPT_VERSION}.json`;
    const b = blobs.find((x) => x.pathname === path);
    if (!b) { console.log(`\n  run ${i}: NOT FOUND at ${path}`); continue; }
    const raw = await (await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" })).text();
    const j = JSON.parse(raw) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
    const sizes: Record<string, number> = {};
    for (const k of ARRAYS) sizes[k] = Array.isArray(dm?.[k]) ? (dm[k] as unknown[]).length : 0;
    rows.push({ run: i, sizes, bytes: raw.length, triggers: (j.data ?? []).length });
  }

  console.log(`\n  ${"field".padEnd(28)} ${rows.map((r) => `run ${r.run}`.padStart(8)).join("")}`);
  console.log(`  ${"-".repeat(28)} ${rows.map(() => "-".repeat(8)).join("")}`);
  for (const k of ARRAYS) {
    const vals = rows.map((r) => r.sizes[k]);
    const moved = new Set(vals).size > 1;
    console.log(`  ${k.padEnd(28)} ${vals.map((v) => String(v).padStart(8)).join("")}${moved ? "   ← moved" : ""}`);
  }
  console.log(`  ${"triggers returned".padEnd(28)} ${rows.map((r) => String(r.triggers).padStart(8)).join("")}`);
  console.log(`  ${"whole answer, bytes".padEnd(28)} ${rows.map((r) => String(r.bytes).padStart(8)).join("")}`);

  // THE DECIDING READ. Uniformly smaller across unrelated arrays points at the
  // budget; smaller in facilities ALONE points at something about facilities.
  const shrank = rows.length === 3 ? ARRAYS.filter((k) => rows[2].sizes[k] < Math.max(rows[0].sizes[k], rows[1].sizes[k])) : [];
  // RUN 2 IS THE CONTROL, and leaving it out is how the first version of this
  // verdict over-claimed. It reported "smaller across unrelated arrays →
  // OUTPUT BUDGET PRESSURE" — but run 2 ALSO returned 8 prose instruments
  // while keeping all four facilities, so prose count varies independently of
  // facility count and proves nothing about compression.
  const alsoInRun2 = rows.length === 3 ? shrank.filter((k) => rows[1].sizes[k] < rows[0].sizes[k]) : [];
  const run3Only = shrank.filter((k) => !alsoInRun2.includes(k));

  // AND THE CEILING, WHICH SETTLES IT. "Not truncated" and "not near the cap"
  // are different facts; only the second explains compression. Measured from
  // the cost log: 8,843 / 8,709 / 8,231 output tokens against max_tokens
  // 20,000 — run 3 used 41% of the budget. There is no pressure to compress.
  const MAX_TOKENS = 20000;
  const OUT = [8843, 8709, 8231];
  console.log(`\n  ${"=".repeat(100)}`);
  console.log(`  output tokens: ${OUT.join(" / ")} against max_tokens ${MAX_TOKENS} — run 3 used ${Math.round((OUT[2] / MAX_TOKENS) * 100)}% of the ceiling`);
  console.log(`  input tokens were IDENTICAL across all three (89,527), so neither the prompt nor the corpus moved`);
  console.log(`  shrank in run 3: ${shrank.join(", ") || "nothing"}${alsoInRun2.length ? `   (but ${alsoInRun2.join(", ")} also shrank in run 2, which kept all four facilities — not run-3-specific)` : ""}`);
  console.log(`  run-3-specific:  ${run3Only.join(", ") || "nothing"}`);
  console.log(`\n  ${OUT[2] / MAX_TOKENS > 0.85
    ? "→ near the ceiling: OUTPUT BUDGET PRESSURE is a live explanation."
    : run3Only.length === 1 && run3Only[0] === "facilities"
      ? "→ NO BUDGET PRESSURE (41% of the ceiling), IDENTICAL input, and the only run-3-specific shrink is `facilities`. Nothing in the prompt or the budget explains it: this is sampling variance, and a prompt edit declared against it would be aimed at a cause nobody found."
      : "→ mixed. No story is clean, and a fix declared on either would be a guess."}`);
  const unusedSmallerEverywhere = rows.length === 3 && ARRAYS.every((k) => rows[2].sizes[k] <= Math.max(rows[0].sizes[k], rows[1].sizes[k]));
  void unusedSmallerEverywhere;
})();
