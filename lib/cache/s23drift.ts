/**
 * THE TWO 9b FAILURES, DIAGNOSED AGAINST THE RUNS THAT PRODUCED THEM. $0 —
 * every run is already cached under its own CACHE_BUST key, so the busted
 * blobs are read back rather than re-bought.
 *
 *   DAVITA — 9, 17, 9 rows. Run 2 cited dva-20251231.htm, the 10-K, which
 *     the other two did not. The question is WHERE those eight extra rows
 *     went: if run 2's anchor moved to the 10-K, that is anchor selection.
 *     If the anchor stayed the 10-Q and the 10-K's rows were written into
 *     its schedule, that is the model merging two filings into one field —
 *     document control, and the same root as Cigna's referenced-table
 *     behaviour. The two have different fixes, so they are told apart by the
 *     period column and the citation on each row rather than by argument.
 *
 *   CHS — 12, 13, 13 rows. Both re-tastes dropped cyh-20260401.htm relative
 *     to the canonical run and both gained a row. Which citation set is
 *     right is the question a re-baseline cannot be made without: the
 *     canonical answer is what the page serves, and it is the minority.
 *
 * Run: npx tsx lib/cache/s23drift.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const BUST_TAG = "s23-sign";

async function answerAt(cik: string, fp: string): Promise<Record<string, unknown>[] | null> {
  try {
    const meta = await head(`answer/${cik}/base/${fp}/v${EXTRACTION_PROMPT_VERSION}.json`, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(`${meta.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
    return j.data ?? null;
  } catch { return null; }
}
const dmOf = (d: Record<string, unknown>[] | null) =>
  (d ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;

async function runsOf(company: string) {
  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const base = corpusFingerprint(f.filings);
  const tag = company.replace(/[^a-z0-9]/gi, "").slice(0, 14);
  const out: { label: string; dm: Record<string, unknown> | undefined }[] = [
    { label: "run 1 (canonical)", dm: dmOf(await answerAt(f.cik, base)) },
  ];
  for (const i of [1, 2]) {
    out.push({ label: `run ${i + 1} (re-taste)`, dm: dmOf(await answerAt(f.cik, `${base}-bust${BUST_TAG}-${tag}-${i}`)) });
  }
  return out;
}

const entries = (dm: Record<string, unknown> | undefined) =>
  ((dm?.scheduleSequence ?? []) as Record<string, unknown>[]);

(async () => {
  // ── DAVITA ───────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(104)}\nDAVITA — 9, 17, 9. Where did the eight extra rows come from?\n${"=".repeat(104)}`);
  // EVERY ROW-BEARING FIELD, not the one I assumed. The first version of this
  // harness counted `scheduleSequence` alone, found 13 entries in all three
  // runs, and would have reported DaVita as stable — while the ladder it
  // actually renders went 9, 17, 9. Eight rows cannot arrive from a field
  // that did not move, so the field that moved is a different one.
  const ROW_FIELDS = ["scheduleSequence", "priorScheduleSequence", "referencedScheduleSequence", "proseInstruments", "issuedTranches", "balanceSheetDebtCaptions", "facilities"] as const;
  for (const r of await runsOf("DaVita")) {
    if (!r.dm) { console.log(`\n  ${r.label}: blob not readable`); continue; }
    console.log(`\n  ${r.label}`);
    for (const f of ROW_FIELDS) {
      const n = ((r.dm[f] ?? []) as unknown[]).length;
      console.log(`      ${f.padEnd(28)} ${n}`);
    }
    const seq = entries(r.dm);
    const periods = new Map<string, number>();
    for (const e of seq) periods.set(String(e.periodColumn ?? "—"), (periods.get(String(e.periodColumn ?? "—")) ?? 0) + 1);
    console.log(`      schedule period columns:     ${[...periods].map(([k, n]) => `"${k}" x${n}`).join("  |  ")}`);
    const prior = ((r.dm.priorScheduleSequence ?? []) as Record<string, unknown>[]);
    const pp = new Map<string, number>();
    for (const e of prior) pp.set(String(e.periodColumn ?? "—"), (pp.get(String(e.periodColumn ?? "—")) ?? 0) + 1);
    if (prior.length) console.log(`      PRIOR period columns:        ${[...pp].map(([k, n]) => `"${k}" x${n}`).join("  |  ")}`);
    console.log(`      citations on this trigger:   ${(((r.dm.citations ?? []) as { url?: string }[]).map((c) => String(c.url ?? "").split("/").pop()).join(", ")) || "—"}`);
  }
  // THE COUNTS MATCH. SO COMPARE THE CONTENT.
  //
  // Identical field counts are not identical fields, and the ladder went 9,
  // 17, 9 off inputs that look the same at this resolution. The unconfirmed
  // pass re-adds a PRIOR entry that fails to match any CURRENT row, and row
  // identity includes the amount — so an amount whose STRING moves between
  // runs while its value does not is enough to make thirteen prior entries
  // stop matching thirteen current ones and arrive on the ladder twice.
  const dav = await runsOf("DaVita");
  console.log(`\n  ${"─".repeat(96)}\n  THE SAME FIELDS, COMPARED BY CONTENT\n  ${"─".repeat(96)}`);
  for (const field of ["scheduleSequence", "priorScheduleSequence"] as const) {
    const lines = dav.map((r) => ((r.dm?.[field] ?? []) as Record<string, unknown>[]).map(
      (e) => `${String(e.instrument ?? e.label ?? "—")} | ${String(e.amount ?? "—")} | ${String(e.maturityDate ?? "—")}`
    ));
    console.log(`\n  ${field}:`);
    const n = Math.max(...lines.map((l) => l.length));
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const vals = [...new Set(lines.map((l) => l[i] ?? "(absent this run)"))];
      if (vals.length === 1) continue;
      moved++;
      console.log(`      entry ${i + 1} differs between runs:`);
      for (let j = 0; j < lines.length; j++) console.log(`          ${dav[j].label.padEnd(20)} ${lines[j][i] ?? "(absent this run)"}`);
    }
    if (moved === 0) console.log(`      every entry identical across all three runs`);
    else console.log(`      ${moved} of ${n} entries differ`);
  }

  // ── CHS ──────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(104)}\nCHS — 12 canonical, 13 and 13 on the re-tastes. Which set is right?\n${"=".repeat(104)}`);
  const chs = await runsOf("Community Health Systems");
  const keyOf = (e: Record<string, unknown>) => `${String(e.kind ?? "row")} | ${String(e.instrument ?? e.label ?? "—")} | ${String(e.amount ?? "—")} | ${String(e.maturityDate ?? "—")}`;
  const sets = chs.map((r) => ({ label: r.label, keys: entries(r.dm).map(keyOf) }));
  for (const s of sets) console.log(`\n  ${s.label}: ${s.keys.length} schedule entries`);

  const canonical = new Set(sets[0].keys);
  for (let i = 1; i < sets.length; i++) {
    const onlyLater = sets[i].keys.filter((k) => !canonical.has(k));
    const onlyCanonical = sets[0].keys.filter((k) => !new Set(sets[i].keys).has(k));
    console.log(`\n  ${sets[0].label} vs ${sets[i].label}`);
    console.log(`      ${onlyLater.length} entry(ies) ONLY in ${sets[i].label}:`);
    for (const k of onlyLater) console.log(`          + ${k}`);
    console.log(`      ${onlyCanonical.length} entry(ies) ONLY in ${sets[0].label}:`);
    for (const k of onlyCanonical) console.log(`          − ${k}`);
  }
  const bothRetastesAgree = sets.length === 3 && sets[1].keys.slice().sort().join("\n") === sets[2].keys.slice().sort().join("\n");
  console.log(`\n  the two re-tastes agree with each other: ${bothRetastesAgree ? "YES — 2 of 3 runs give the same answer, and it is not the one the page serves" : "NO — all three differ, which is a wider instability than a 2-1 split"}`);

  console.log(`\n${"=".repeat(104)}\n  SPEND: $0.0000 — every run read back from the key it was already written to.\n${"=".repeat(104)}`);
})();
