/**
 * SESSION 22 — THE RE-SIGNATURE PACKET. $0. WRITES NOTHING.
 *
 * Three files are re-signed in one pass, for two reasons that rewrite the
 * same bytes:
 *
 *   1. THE MONTH CONVENTION changed, so any pinned derived month count was
 *      signed under arithmetic that no longer runs.
 *   2. THE UNIT RENAME. `GoldenState.residualFraction` held a PERCENT while
 *      `CoverageResult.residualFraction` holds a fraction — one name, two
 *      units, Rule 21. It is now `residualPercent`, which rewrites every
 *      pinned file, so it rides with the signature rather than causing a
 *      second one.
 *
 * AND THE CLOCK MOVES TOO. The previous packet re-derived at each file's own
 * as-of to isolate the convention. This one re-derives at PINNED_AS_OF,
 * because that is what the files are being re-signed AT — presenting a state
 * at one clock and signing it at another is how a signature comes to mean
 * something other than what was read.
 *
 * Which makes the ladder comparison the important half: a clock change is
 * allowed to move month counts and card timing; it is NOT allowed to move a
 * row. Every row is compared field by field and the result is printed either
 * way, because "unchanged" is worth nothing unless the comparison behind it
 * is shown.
 *
 * Run: npx tsx lib/cache/s22regolden.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { deriveGoldenState, residualPercentOf, type GoldenFile, type GoldenState } from "../events/golden";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");

const rowKey = (r: GoldenState["rows"][number]) => r.instrument;

function compareRows(pinned: GoldenState, fresh: GoldenState): string[] {
  const diffs: string[] = [];
  const byKey = new Map(fresh.rows.map((r) => [rowKey(r), r]));
  for (const p of pinned.rows) {
    const f = byKey.get(rowKey(p));
    if (!f) { diffs.push(`MISSING: ${rowKey(p)}`); continue; }
    byKey.delete(rowKey(p));
    for (const field of ["amount", "maturityDate", "dateGranularity", "provenance", "isCapacity", "sourceLine"] as const) {
      if (String(p[field]) !== String(f[field])) diffs.push(`${rowKey(p)}.${field}: "${String(p[field])}" -> "${String(f[field])}"`);
    }
    // Status is reported separately because the CLOCK is allowed to move it —
    // a tranche can mature between two as-of dates — and that is a different
    // kind of change from an amount moving.
    if (p.status !== f.status) diffs.push(`${rowKey(p)}.status: ${p.status} -> ${f.status}   [clock-driven, expected when a maturity passes]`);
  }
  for (const k of byKey.keys()) diffs.push(`UNEXPECTED: ${k}`);
  return diffs;
}

(async () => {
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];
  console.log(`\n${"=".repeat(100)}`);
  console.log(`GOLDEN RE-SIGNATURE PACKET — re-derived at PINNED_AS_OF ${PINNED_AS_OF_DAY}. Held for signature; nothing is written.`);
  console.log("=".repeat(100));

  for (const file of files) {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf-8")) as GoldenFile;
    const pinned = g.state;
    const fresh = deriveGoldenState(g.sourceResult, PINNED_AS_OF);

    console.log(`\n${"-".repeat(100)}`);
    console.log(`${pinned.company}   (${file})`);
    console.log(`  signed by ${g.signature?.signedBy ?? "(unsigned)"} at as-of ${pinned.asOf}  ->  re-signing at ${PINNED_AS_OF_DAY}`);
    console.log(`  anchor ${pinned.anchor?.form ?? "(none)"} ${pinned.anchor?.date ?? ""}   filing set ${pinned.filingSet.length} document(s)`);
    console.log("-".repeat(100));

    // FILING SET FIRST. If the corpus moved, none of the rest is a
    // comparison at all — it is two different questions (Rule 30).
    const added = fresh.filingSet.filter((u) => !pinned.filingSet.includes(u));
    const removed = pinned.filingSet.filter((u) => !fresh.filingSet.includes(u));
    if (added.length || removed.length) {
      console.log(`\n  FILING SET MOVED — this is not a re-signature, it is a fresh signature:`);
      for (const a of added) console.log(`    + ${a}`);
      for (const r of removed) console.log(`    - ${r}`);
    } else {
      console.log(`\n  FILING SET  unchanged — the same ${pinned.filingSet.length} documents the file was signed against`);
    }

    const rowDiffs = compareRows(pinned, fresh);
    console.log(`\n  LADDER  ${pinned.rows.length} row(s), each compared on amount, maturity, granularity, provenance, capacity flag, source line and status`);
    if (rowDiffs.length === 0) console.log(`    UNCHANGED — every field of every row identical at the new clock`);
    else for (const d of rowDiffs) console.log(`    !! ${d}`);

    const covSame =
      pinned.coverage.denominatorSource === fresh.coverage.denominatorSource &&
      pinned.coverage.statedTotalDebt === fresh.coverage.statedTotalDebt &&
      pinned.coverage.capturedFace === fresh.coverage.capturedFace &&
      pinned.coverage.statedBridge === fresh.coverage.statedBridge &&
      pinned.coverage.residualPasses === fresh.coverage.residualPasses &&
      residualPercentOf(pinned) === residualPercentOf(fresh);
    console.log(`\n  COVERAGE  ${covSame ? "UNCHANGED" : "MOVED"}`);
    console.log(`    ${fresh.coverage.denominatorSource}, stated $${((fresh.coverage.statedTotalDebt ?? 0) / 1e9).toFixed(3)}B, captured $${(fresh.coverage.capturedFace / 1e9).toFixed(3)}B, residual ${residualPercentOf(fresh) ?? "—"}%, passes=${fresh.coverage.residualPasses}`);
    console.log(`    field rename: residualFraction -> residualPercent — same value (${residualPercentOf(pinned) ?? "—"}%), the name now matches the unit`);

    let moved = 0;
    console.log(`\n  DERIVED  (only lines that moved)`);
    for (const pc of pinned.cards) {
      const fc = fresh.cards.find((c) => c.headlineRowId === pc.headlineRowId && c.triggerId === pc.triggerId);
      if (!fc) { console.log(`    !! card ${pc.triggerId}/${pc.headlineRowId} no longer produced at this clock`); moved++; continue; }
      for (const pd of pc.derived) {
        const fd = fc.derived.find((d) => d.kind === pd.kind);
        if (!fd) { console.log(`    !! ${pd.kind}: line no longer produced`); moved++; continue; }
        if (fd.text === pd.text && String(fd.computed) === String(pd.computed)) continue;
        moved++;
        console.log(`\n    ${pd.kind}`);
        console.log(`      WAS  ${pd.text}`);
        console.log(`      NOW  ${fd.text}`);
      }
      const kinds = new Set(pc.derived.map((d) => d.kind));
      for (const fd of fc.derived) if (!kinds.has(fd.kind)) { console.log(`    !! ${fd.kind}: NEW line not in the signed state`); moved++; }
    }
    for (const fc of fresh.cards) {
      if (!pinned.cards.some((c) => c.headlineRowId === fc.headlineRowId && c.triggerId === fc.triggerId)) {
        console.log(`    !! NEW card ${fc.triggerId}/${fc.headlineRowId} at this clock`); moved++;
      }
    }
    if (moved === 0) console.log(`    UNCHANGED — no derived line moved`);

    const held = rowDiffs.length === 0 && covSame && added.length === 0 && removed.length === 0;
    console.log(`\n  TO SIGN: ${held
      ? (moved === 0
          ? "position and derivation both identical — this re-signature changes only the as-of and the field name"
          : `position identical, ${moved} derived line(s) moved — check the arithmetic; the ladder needs no re-checking`)
      : "POSITION MOVED — do not sign on the strength of this packet; the differences above are the thing to look at"}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`  ${files.length} file(s) presented. NOTHING WAS WRITTEN.`);
  console.log("=".repeat(100));
})();
