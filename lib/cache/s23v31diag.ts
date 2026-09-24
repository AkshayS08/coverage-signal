/**
 * THREE DIAGNOSTICS BEFORE ANY SIGNING BILLS. $0 — schema inspection and
 * cached blob reads only.
 *
 *   1a. Is `referencedScheduleSequence` actually a populatable field in
 *       Cigna's not-located schema at v31? A field the model cannot fill
 *       explains the behaviour exactly, and it would reframe Cigna's "honest
 *       empty" from "correctly declines a stale table" to "cannot populate a
 *       field that is not there" — a different claim to put in front of a
 *       demo audience.
 *
 *   2.  Encompass 6 → 7. Which row is new, and did the corpus move?
 *   3.  CHS 13 → 12. Which row vanished, and did the corpus move?
 *
 * THE CORPUS QUESTION IS SETTLED BY THE FINGERPRINT, not by argument: v30 and
 * v31 answers live under the SAME fingerprint directory when the filing set
 * has not moved. If a v30 answer is readable at today's fingerprint, the
 * documents are unchanged and any difference is the prompt's.
 *
 * Run: npx tsx lib/cache/s23v31diag.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { verdictSchemaFor, anchorNoteShapeOf } from "../agent/claude";

interface Fig { value: string; sourceLine: string }

async function answerAt(cik: string, fp: string, version: number): Promise<Record<string, unknown>[] | null> {
  try {
    const meta = await head(`answer/${cik}/base/${fp}/v${version}.json`, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(`${meta.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
    return j.data ?? null;
  } catch { return null; }
}

const dmOf = (data: Record<string, unknown>[] | null) =>
  (data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;

/** One comparable line per schedule entry, so a diff names the row rather than the count. */
function entries(dm: Record<string, unknown> | undefined): string[] {
  const seq = (dm?.scheduleSequence ?? []) as Record<string, unknown>[];
  return seq.map((e) => `${String(e.kind ?? "row")} | ${String(e.instrument ?? e.label ?? "—")} | ${String(e.amount ?? "—")} | ${String(e.maturityDate ?? "—")}`);
}

(async () => {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`[1a] CIGNA — is referencedScheduleSequence in the not-located schema at v${EXTRACTION_PROMPT_VERSION}?`);
  console.log("=".repeat(104));

  for (const shape of ["tabular", "prose-only", "not-located"] as const) {
    const schema = verdictSchemaFor(shape) as unknown as { properties: Record<string, unknown> };
    const has = (k: string) => (k in schema.properties ? "present" : "ABSENT ");
    console.log(`\n  shape "${shape}"`);
    for (const k of ["scheduleSequence", "referencedScheduleSequence", "noteCrossReference", "referencedBalanceSheetDebtCaptions"]) {
      console.log(`      ${k.padEnd(36)} ${has(k)}`);
    }
  }
  // And the shape Cigna's anchor actually resolves to, from the real locator result.
  const notLocated = anchorNoteShapeOf(undefined);
  console.log(`\n  anchorNoteShapeOf(no anchor found) = "${notLocated}"  — the branch Cigna takes`);
  const cignaSchema = verdictSchemaFor(notLocated) as unknown as { properties: Record<string, unknown> };
  console.log(`  referencedScheduleSequence in Cigna's schema: ${"referencedScheduleSequence" in cignaSchema.properties ? "PRESENT — the model COULD fill it and did not" : "ABSENT — the model CANNOT fill it, and the empty result is structural"}`);

  // ── 2 and 3 ────────────────────────────────────────────────────────────
  for (const [label, company, was, now] of [["[2]", "Encompass Health", 6, 7], ["[3]", "Community Health Systems", 13, 12]] as const) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const fp = corpusFingerprint(f.filings);
    const v30 = await answerAt(f.cik, fp, 30);
    const v31 = await answerAt(f.cik, fp, EXTRACTION_PROMPT_VERSION);

    console.log(`\n${"=".repeat(104)}`);
    console.log(`${label} ${company} — ${was} → ${now} rows`);
    console.log("=".repeat(104));
    console.log(`\n  fingerprint now: ${fp}`);
    console.log(`  v30 answer at THIS fingerprint: ${v30 ? "READABLE — the filing set has NOT moved, so any difference is the prompt's" : "absent — the corpus moved, and the row change may be the documents"}`);
    if (!v31) { console.log(`  v31 answer: MISSING — cannot diff`); continue; }
    if (!v30) continue;

    const a = entries(dmOf(v30)), b = entries(dmOf(v31));
    console.log(`  schedule entries: ${a.length} at v30 → ${b.length} at v31`);
    const bSet = new Set(b), aSet = new Set(a);
    const gone = a.filter((x) => !bSet.has(x));
    const added = b.filter((x) => !aSet.has(x));
    console.log(`\n  ${gone.length} entry(ies) present at v30 and NOT at v31:`);
    for (const g of gone) console.log(`      − ${g}`);
    console.log(`\n  ${added.length} entry(ies) present at v31 and NOT at v30:`);
    for (const x of added) console.log(`      + ${x}`);

    const fa = ((dmOf(v30)?.facilities ?? []) as Record<string, Fig | null | string>[]).map((x) => String(x.name));
    const fb = ((dmOf(v31)?.facilities ?? []) as Record<string, Fig | null | string>[]).map((x) => String(x.name));
    console.log(`\n  facilities: ${fa.length} at v30 [${fa.join(", ")}] → ${fb.length} at v31 [${fb.join(", ")}]`);
    const pa = ((dmOf(v30)?.proseInstruments ?? []) as unknown[]).length;
    const pb = ((dmOf(v31)?.proseInstruments ?? []) as unknown[]).length;
    console.log(`  proseInstruments: ${pa} at v30 → ${pb} at v31`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $0.0000 — schema inspection and cached reads only; no model was called.`);
  console.log("=".repeat(104));
})();
