/**
 * WHY DIDN'T THE IDENTITY COLLAPSE FIRE ON CHS'S TWO ABL ENTRIES? $0 —
 * cached answers only, bust tags DERIVED and never typed.
 *
 * The ruling is Rule 49's: identity is what the filing STATES about the
 * instrument — facility class, size, maturity, same facility — never the
 * label a run happened to choose. Two entries agreeing on all of those are
 * one instrument.
 *
 * So before re-attempting a collapse, this prints the two ABL entries as they
 * actually are in each run, every field that identity could key on. A fix
 * aimed at a field that is already equal would do nothing, which is exactly
 * what the previous attempt did.
 *
 * Run: npx tsx lib/cache/s23chsabl.ts            (canonical)
 *      npx tsx lib/cache/s23chsabl.ts --run 1    (re-taste 1)
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, rowIdentityKey, rowIdentityKeyWithoutSize, matchFacility } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Community Health Systems";
const BUST_TAG = "s23-sign";
const runFlag = process.argv.indexOf("--run");
const RUN = runFlag >= 0 ? process.argv[runFlag + 1] : null;
if (RUN) process.env.CACHE_BUST = `${BUST_TAG}-${COMPANY.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${RUN}`;

const MATCH = /abl/i;

(async () => {
  console.log(`\n  CACHE_BUST: ${process.env.CACHE_BUST ?? "(none — the canonical answer)"}`);
  const r = await runAgentLoop(COMPANY);
  const spend = currentCompanySpend().totalUsd;
  const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const seq = ((dm?.scheduleSequence ?? []) as Record<string, unknown>[]).filter((e) => MATCH.test(String(e.instrument ?? e.label ?? "")));
  const facilities = (dm?.facilities ?? []) as Record<string, unknown>[];

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CHS — the ABL as the extraction actually states it`);
  console.log("=".repeat(104));

  console.log(`\n  schedule entries naming the ABL: ${seq.length}`);
  seq.forEach((e, i) => {
    const asRow = { rate: (e.rate ?? null) as string | null, maturityDate: (e.maturityDate ?? null) as string | null, amount: String(e.amount ?? "") };
    const fac = matchFacility({ name: String(e.instrument ?? e.label ?? ""), category: null }, facilities as never, { byNameOnly: true });
    console.log(`\n  [entry ${i + 1}]`);
    for (const k of ["kind", "instrument", "label", "amount", "rate", "maturityDate", "dateGranularity", "section", "periodColumn", "citedUrl"]) {
      console.log(`      ${k.padEnd(16)} ${JSON.stringify(e[k] ?? null)}`);
    }
    console.log(`      sourceLine       ${JSON.stringify(String(e.sourceLine ?? "").replace(/\s+/g, " ").slice(0, 120))}`);
    console.log(`      → identity key            ${rowIdentityKey(asRow)}`);
    console.log(`      → identity without size   ${rowIdentityKeyWithoutSize(asRow)}`);
    console.log(`      → matches facility        ${fac ? JSON.stringify(String((fac as unknown as { name: string }).name)) : "none"}`);
  });

  if (seq.length === 2) {
    const k = (e: Record<string, unknown>) => rowIdentityKey({ rate: (e.rate ?? null) as string | null, maturityDate: (e.maturityDate ?? null) as string | null, amount: String(e.amount ?? "") });
    const same = k(seq[0]) === k(seq[1]);
    console.log(`\n  THE TWO ENTRIES' IDENTITY KEYS ${same ? "ARE EQUAL" : "DIFFER"}`);
    if (!same) {
      console.log(`      entry 1: ${k(seq[0])}`);
      console.log(`      entry 2: ${k(seq[1])}`);
      console.log(`      → a collapse keyed on THIS cannot fire. Whatever differs above is what identity is`);
      console.log(`        currently reading, and the ruling says identity is the STATED FACTS — facility`);
      console.log(`        class, size, maturity, same facility — so the differing field is the one that`);
      console.log(`        must stop being part of the key, or must be resolved before the key is built.`);
    } else {
      console.log(`      → identity already agrees, so the duplication is NOT an identity-key failure and a`);
      console.log(`        fix aimed at the key would change nothing. The two rows are reaching the ladder`);
      console.log(`        by paths that never compare them.`);
    }
  }

  // AND EVERY OTHER FIELD THAT CAN PRODUCE AN ABL ROW. The first version of
  // this probe printed scheduleSequence alone, found ONE entry, and left the
  // second ladder row unexplained — so the next fix went at the wrong
  // producer. Ask every field that builds rows, not the one that seems
  // likeliest.
  for (const field of ["proseInstruments", "facilities", "priorScheduleSequence", "issuedTranches", "balanceSheetDebtCaptions"]) {
    const all = ((dm?.[field] ?? []) as Record<string, unknown>[]);
    const hits = all.filter((e) => MATCH.test(String(e.instrument ?? e.label ?? e.name ?? "")));
    console.log(`
  ${field}: ${all.length} total, ${hits.length} naming the ABL`);
    for (const h of hits) {
      console.log(`      ${JSON.stringify({ name: h.name ?? h.instrument ?? h.label, amount: h.amount ?? (h.facilitySize as { value?: string } | null)?.value, maturity: h.maturityDate ?? (h.maturity as { value?: string } | null)?.value, category: h.category })}`);
    }
  }

  const pos = assemblePosition(r, PINNED_AS_OF);
  const ablRows = pos.rows.filter((x) => MATCH.test(String(x.instrument)));
  console.log(`\n  LADDER: ${pos.rows.length} rows, ${ablRows.length} of them ABL`);
  for (const row of ablRows) {
    console.log(`      ${String((row as unknown as { status?: string }).status)} · ${row.amount} · ${row.maturityDate ?? "—"} · capacity=${row.isCapacity} · provenance=${(row as unknown as { provenance?: string }).provenance}`);
    console.log(`        sourceLine "${String(row.sourceLine).replace(/\s+/g, " ").slice(0, 110)}"`);
  }
  console.log(`\n  SPEND: $${spend.toFixed(4)}`);
})();
