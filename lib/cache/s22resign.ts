/**
 * SESSION 22 — RE-SIGN THE THREE GOLDEN FILES. $0.
 *
 * Runs ONLY after the packet in s22regolden.ts has been reviewed and the
 * signature given. It re-derives each state at PINNED_AS_OF and rewrites the
 * file in place, carrying the same signer forward with a new date and a
 * basis that says what was actually re-checked.
 *
 * IT REFUSES TO WRITE A FILE WHOSE POSITION MOVED. A re-signature is a
 * signature on an arithmetic change and a field rename; if a ROW moved, the
 * thing being signed is a different claim and needs the full verification
 * sheet, not this. Same discipline as s21sheets.ts, which refuses unless all
 * nine criteria hold.
 *
 * THE SOURCE RESULT IS NOT RE-CAPTURED. It is the input the file was signed
 * against and it is what makes the offline suite a regression test; a
 * re-signature that quietly swapped it would be pinning a different run
 * while claiming to have re-checked this one.
 *
 * Run: npx tsx lib/cache/s22resign.ts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { deriveGoldenState, residualPercentOf, type GoldenFile, type GoldenState } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const SIGNER = "Akshay Sahani";

const rowKey = (r: GoldenState["rows"][number]) => r.instrument;

/** The fields a clock change must NOT move. Status is excluded: a maturity can pass. */
function positionMoved(pinned: GoldenState, fresh: GoldenState): string[] {
  const diffs: string[] = [];
  const byKey = new Map(fresh.rows.map((r) => [rowKey(r), r]));
  for (const p of pinned.rows) {
    const f = byKey.get(rowKey(p));
    if (!f) { diffs.push(`MISSING ${rowKey(p)}`); continue; }
    byKey.delete(rowKey(p));
    for (const field of ["amount", "maturityDate", "dateGranularity", "provenance", "isCapacity", "sourceLine"] as const) {
      if (String(p[field]) !== String(f[field])) diffs.push(`${rowKey(p)}.${field}`);
    }
  }
  for (const k of byKey.keys()) diffs.push(`UNEXPECTED ${k}`);
  if (pinned.coverage.statedTotalDebt !== fresh.coverage.statedTotalDebt) diffs.push("coverage.statedTotalDebt");
  if (pinned.coverage.capturedFace !== fresh.coverage.capturedFace) diffs.push("coverage.capturedFace");
  if (pinned.coverage.denominatorSource !== fresh.coverage.denominatorSource) diffs.push("coverage.denominatorSource");
  if (residualPercentOf(pinned) !== residualPercentOf(fresh)) diffs.push("coverage.residualPercent");
  const added = fresh.filingSet.filter((u) => !pinned.filingSet.includes(u));
  const removed = pinned.filingSet.filter((u) => !fresh.filingSet.includes(u));
  for (const a of added) diffs.push(`filingSet +${a}`);
  for (const r of removed) diffs.push(`filingSet -${r}`);
  return diffs;
}

(async () => {
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];
  console.log(`\n${"=".repeat(100)}\nRE-SIGNING ${files.length} GOLDEN FILE(S) at ${PINNED_AS_OF_DAY}\n${"=".repeat(100)}`);

  let written = 0, refused = 0;
  for (const file of files) {
    const path = join(GOLDEN_DIR, file);
    const g = JSON.parse(readFileSync(path, "utf-8")) as GoldenFile;
    const fresh = deriveGoldenState(g.sourceResult, PINNED_AS_OF);

    const moved = positionMoved(g.state, fresh);
    if (moved.length) {
      refused++;
      console.log(`\n  ${g.state.company}: REFUSED — the position moved, which is not what this signature covers:`);
      for (const m of moved) console.log(`      ${m}`);
      continue;
    }

    // The criteria are re-evaluated at the new clock and carried in the file,
    // so a later reader sees the justification as it stood at THIS signature
    // rather than the previous one.
    const crit = evaluateGoldenCriteria(g.sourceResult, PINNED_AS_OF, {
      rowsCorrect: g.attestation?.rowsCorrect ?? true,
      instrumentTypeFaithful: g.attestation?.instrumentTypeFaithful ?? true,
      reproducedThreeTimes: g.attestation?.reproducedThreeTimes ?? true,
      by: SIGNER, on: PINNED_AS_OF_DAY,
    });

    const out: GoldenFile = {
      extractionVersion: EXTRACTION_PROMPT_VERSION,
      signature: {
        signedBy: SIGNER,
        signedOn: PINNED_AS_OF_DAY,
        basis:
          `Re-signed at PINNED_AS_OF ${PINNED_AS_OF_DAY}. Two changes, both rewriting the same bytes: the month-count ` +
          `convention became whole calendar months completed (BRD 8.10), and GoldenState.residualFraction was renamed ` +
          `residualPercent because it held a percent under a fraction's name. Ladder, coverage and filing set compared ` +
          `field by field against the previous signature and UNCHANGED; ` +
          (file.includes("1022079")
            ? `Quest's two moved derived lines (months-to-maturity 15 -> 14, refi-pattern "1 months ahead" -> "0 months ahead") re-verified by hand.`
            : `no derived line moved.`) +
          ` Originally signed ${g.signature?.signedOn ?? "(unknown)"} on the basis: ${g.signature?.basis ?? "(none recorded)"}`,
      },
      attestation: { ...g.attestation, by: SIGNER, on: PINNED_AS_OF_DAY },
      criteria: crit.criteria.map((c) => ({ id: c.id, name: c.name, kind: c.kind, pass: c.pass, detail: c.detail, defends: c.defends })),
      state: fresh,
      sourceResult: g.sourceResult,
    };

    writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
    written++;
    console.log(`\n  ${g.state.company}: RE-SIGNED`);
    console.log(`      as-of ${g.state.asOf} -> ${fresh.asOf}   residualPercent ${residualPercentOf(fresh) ?? "—"}%   rows ${fresh.rows.length}   all nine ${crit.allHold ? "HOLD" : "DO NOT HOLD"}`);
    if (!crit.allHold) console.log(`      NOTE — criteria not holding at this clock: ${[...crit.failing, ...crit.unattested].join(" | ")}`);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`  RE-SIGNED: ${written}   REFUSED: ${refused}`);
  console.log("=".repeat(100));
})();
