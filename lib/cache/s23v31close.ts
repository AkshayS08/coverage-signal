/**
 * THE LAST THREE READS BEFORE SIGNING. $0 — cached blobs and schema only.
 *
 *   1. CIGNA — is referencedScheduleSequence a field the model HAD and
 *      declined, or a field that was not there? These are different bugs and
 *      they point at different fixes: a present field the model will not fill
 *      is a PROMPT problem; an absent one is a CODE problem.
 *
 *      Proved from Cigna's OWN DATA rather than by reading the builder. The
 *      three referenced fields are added and removed as one branch — the
 *      not-located path keeps all three, every other path deletes all three.
 *      So a populated `noteCrossReference` in Cigna's answer is proof that
 *      Cigna was handed the not-located schema, and therefore proof that
 *      `referencedScheduleSequence` was on it. Data, not inspection.
 *
 *   2. ENCOMPASS — its new 7th row is only good news if it came from the
 *      ANCHOR. A gained row pulled from an older filing is the off-anchor
 *      substitution this whole session removed, wearing a better disguise.
 *
 *   3. CHS — the facility section in full, not the row count. The question is
 *      whether folding the $1.0B ABL capacity into the facility line keeps
 *      the borrowing-base story legible or buries it.
 *
 * Run: npx tsx lib/cache/s23v31close.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { verdictSchemaFor } from "../agent/claude";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { checkRevolverArithmetic } from "../events/coverage";
import { borrowingBaseOf } from "../agent/borrowingBase";
import { currentCompanySpend } from "../agent/costMeter";

interface Fig { value: string; sourceLine: string }
const REFERENCED_TRIO = ["noteCrossReference", "referencedScheduleSequence", "referencedBalanceSheetDebtCaptions"] as const;

async function blobOf(cik: string, fp: string, v: number) {
  const meta = await head(`answer/${cik}/base/${fp}/v${v}.json`, { token: process.env.BLOB_READ_WRITE_TOKEN });
  return (await (await fetch(`${meta.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
}
const dmOf = (j: { data?: Record<string, unknown>[] }) =>
  (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;

(async () => {
  let spend = 0;

  // ── 1. CIGNA ─────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(104)}\n[1] CIGNA — present-and-declined, or absent?\n${"=".repeat(104)}`);
  const notLocated = verdictSchemaFor("not-located") as unknown as { properties: Record<string, unknown> };
  const tabular = verdictSchemaFor("tabular") as unknown as { properties: Record<string, unknown> };
  const allThreeOnNotLocated = REFERENCED_TRIO.every((k) => k in notLocated.properties);
  const noneOnTabular = REFERENCED_TRIO.every((k) => !(k in tabular.properties));
  console.log(`\n  the three referenced fields move as ONE branch:`);
  console.log(`      all three present on "not-located"   ${allThreeOnNotLocated}`);
  console.log(`      all three absent on "tabular"        ${noneOnTabular}`);
  console.log(`      → so any ONE of them appearing in an answer proves the other two were on that answer's schema`);

  const cg = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const cj = await blobOf(cg.cik, corpusFingerprint(cg.filings), EXTRACTION_PROMPT_VERSION);
  const cdm = dmOf(cj);
  const xref = cdm?.noteCrossReference as { statement?: string } | null;
  const refSeq = (cdm?.referencedScheduleSequence ?? []) as unknown[];
  console.log(`\n  Cigna's v${EXTRACTION_PROMPT_VERSION} answer:`);
  console.log(`      noteCrossReference           ${xref ? "POPULATED" : "null"}`);
  console.log(`      referencedScheduleSequence   ${refSeq.length} entries`);
  console.log(`\n  VERDICT: ${xref && allThreeOnNotLocated
    ? "THE FIELD WAS PRESENT AND THE MODEL DECLINED IT. Cigna returned a populated noteCrossReference, which only the not-located schema carries, and that schema carries referencedScheduleSequence with it. This is a PROMPT problem, not a code one — the v31 candidate stays prompt-side."
    : "the field was NOT on Cigna's schema — this is a CODE problem and the v31 candidate is misfiled"}`);

  // ── 2. ENCOMPASS ─────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(104)}\n[2] ENCOMPASS — is the new 7th row anchor-sourced?\n${"=".repeat(104)}`);
  const eh = await getRecentFilings("Encompass Health", ["8-K", "10-Q", "10-K"]);
  const ej = await blobOf(eh.cik, corpusFingerprint(eh.filings), EXTRACTION_PROMPT_VERSION);
  const edm = dmOf(ej);
  const anchor = edm?.debtScheduleSourceFiling as { form?: string; date?: string; url?: string } | undefined;
  console.log(`\n  anchor the schedule was read from: ${anchor?.form} ${anchor?.date}`);
  console.log(`  ${anchor?.url}`);
  const seq = (edm?.scheduleSequence ?? []) as Record<string, unknown>[];
  const newRow = seq.find((e) => /5\.875/.test(String(e.instrument ?? "")));
  if (!newRow) console.log(`\n  the 5.875% row is NOT in the schedule — look again`);
  else {
    console.log(`\n  the new row:`);
    console.log(`      instrument   ${String(newRow.instrument)}`);
    console.log(`      amount       ${String(newRow.amount)}`);
    console.log(`      maturity     ${String(newRow.maturityDate)}`);
    console.log(`      citedUrl     ${String(newRow.citedUrl ?? "—")}`);
    console.log(`      sourceLine   "${String(newRow.sourceLine ?? "").replace(/\s+/g, " ")}"`);
    const fromAnchor = String(newRow.citedUrl ?? "") === String(anchor?.url ?? "");
    console.log(`\n  VERDICT: ${fromAnchor
      ? "ANCHOR-SOURCED. The row is cited to the same filing the rest of the schedule was read from — a gained row, not an off-anchor pull."
      : "NOT the anchor. This row came from a different filing and is an off-anchor pull, which is the thing this session removed."}`);
  }

  // ── 3. CHS ───────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(104)}\n[3] CHS — the facility section in full\n${"=".repeat(104)}`);
  const r = await runAgentLoop("Community Health Systems");
  spend += currentCompanySpend().totalUsd;
  const pos = assemblePosition(r, PINNED_AS_OF);
  const facs = ((r.results.find((t) => t.triggerId === "debt-maturity") as unknown as { facilities?: unknown })?.facilities ?? []) as Record<string, Fig | null | string>[];
  const v = (f: Fig | null | undefined) => (f ? f.value : "—");
  for (const f of facs) {
    const bb = borrowingBaseOf(f as never);
    const ar = checkRevolverArithmetic(f as never);
    console.log(`\n  ${String(f.name)}`);
    console.log(`      size        ${v(f.facilitySize as Fig | null)}`);
    console.log(`      drawn       ${v(f.drawn as Fig | null)}`);
    console.log(`      LCs         ${v(f.lettersOfCredit as Fig | null)}`);
    console.log(`      available   ${v(f.available as Fig | null)}`);
    console.log(`      matures     ${v(f.maturity as Fig | null)}`);
    console.log(`      ${bb ? `BORROWING-BASE LIMITED (${bb.signal}) — ${bb.limitedBy}` : "no stated limit on availability"}`);
    if (bb) console.log(`        its sentence: "${bb.statement.replace(/\s+/g, " ").slice(0, 180)}"`);
    if (ar.checked) console.log(`      check: ${ar.kind}${ar.impliedBaseMillions !== undefined ? ` — implied base ~$${Math.round(ar.impliedBaseMillions)}M` : ""}`);
    if (ar.checked && ar.note) console.log(`        ${ar.note.replace(/\s+/g, " ").slice(0, 190)}`);
  }
  console.log(`\n  and the ABL's LADDER row(s):`);
  for (const row of pos.rows.filter((x) => /abl/i.test(String(x.instrument)))) {
    console.log(`      ${String(row.instrument).padEnd(28)} ${String(row.amount ?? "—").padEnd(18)} ${row.maturityDate ?? "—"}   ${row.isCapacity ? "capacity" : "debt"}`);
  }
  console.log(`\n  ladder rows total: ${pos.rows.length}`);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
