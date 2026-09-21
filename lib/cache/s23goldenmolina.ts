/**
 * WHAT THE PROMOTION DID TO MOLINA'S GOLDEN. $0, writes nothing.
 *
 * Two questions, and they have different answers:
 *
 *   1. Did the FIELD change? Yes — that is why we are here. Printed first,
 *      from the golden's own captured input against the promoted answer, so
 *      a signature is given against the bytes rather than against a summary.
 *
 *   2. Did the SIGNED STATE change? GoldenState pins rows, coverage, tier2
 *      and cards. It does not carry facility figures. So "the golden is
 *      superseded" is a claim that has to be measured, not inferred from a
 *      field having moved — and the tool that re-signs refuses on exactly
 *      this comparison.
 *
 * Run: npx tsx lib/cache/s23goldenmolina.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF, PINNED_AS_OF_DAY } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, type GoldenFile, type GoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const PATH = join(process.cwd(), "baselines", "golden", "0001179929.json");
interface Fig { value: string; sourceLine: string }
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

function facilitiesOf(result: { results: { triggerId: string; facilities?: unknown }[] }) {
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  return (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
}

const rowKey = (r: GoldenState["rows"][number]) => r.instrument;

(async () => {
  const g = JSON.parse(readFileSync(PATH, "utf-8")) as GoldenFile;
  const fresh = await runAgentLoop(g.state.company);
  const spend = currentCompanySpend().totalUsd;

  console.log(`\n${"=".repeat(100)}`);
  console.log(`MOLINA — the golden signed at v${g.extractionVersion} on ${g.signature.signedOn}, against the answer now canonical at v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(100));

  console.log(`\n[1] THE FIELD — the golden's own CAPTURED input against what the canonical key now serves\n`);
  const pinnedFacs = facilitiesOf(g.sourceResult as never);
  const freshFacs = facilitiesOf(fresh as never);
  for (const name of [...new Set([...pinnedFacs, ...freshFacs].map((x) => String(x.name)))]) {
    const p = pinnedFacs.find((x) => String(x.name) === name);
    const f = freshFacs.find((x) => String(x.name) === name);
    console.log(`  ${name}`);
    for (const field of FIELDS) {
      const pv = (p?.[field] as Fig | null)?.value ?? "—";
      const fv = (f?.[field] as Fig | null)?.value ?? "—";
      console.log(`    ${field.padEnd(16)} golden: ${String(pv).padEnd(22)} now: ${String(fv).padEnd(22)}${pv !== fv ? "  ← CHANGED" : ""}`);
      if (pv !== fv) {
        console.log(`      golden's sentence: ${(p?.[field] as Fig | null)?.sourceLine ?? "(no figure — the field was null)"}`);
        console.log(`      now's sentence:    ${(f?.[field] as Fig | null)?.sourceLine ?? "(no figure)"}`);
      }
    }
  }

  console.log(`\n[2] THE SIGNED STATE — every field the golden actually pins\n`);
  const freshState = deriveGoldenState(fresh, PINNED_AS_OF);
  const verdict = compareToGolden(g.state, freshState);
  console.log(`  rows: ${g.state.rows.length} signed, ${freshState.rows.length} now`);

  const byKey = new Map(freshState.rows.map((r) => [rowKey(r), r]));
  const rowDiffs: string[] = [];
  for (const p of g.state.rows) {
    const f = byKey.get(rowKey(p));
    if (!f) { rowDiffs.push(`MISSING: ${rowKey(p)}`); continue; }
    byKey.delete(rowKey(p));
    for (const field of ["amount", "maturityDate", "dateGranularity", "provenance", "isCapacity", "sourceLine"] as const) {
      if (String(p[field]) !== String(f[field])) rowDiffs.push(`${rowKey(p)}.${field}:\n        was "${String(p[field])}"\n        now "${String(f[field])}"`);
    }
  }
  for (const k of byKey.keys()) rowDiffs.push(`UNEXPECTED: ${k}`);
  console.log(`  ${rowDiffs.length === 0 ? "no row field moved" : `${rowDiffs.length} row field(s) moved:`}`);
  for (const d of rowDiffs) console.log(`      ${d}`);

  const covDiffs: string[] = [];
  for (const k of ["denominatorSource", "statedTotalDebt", "capturedFace", "statedBridge", "residualPercent", "residualPasses"] as const) {
    const a = (g.state.coverage as Record<string, unknown>)[k];
    const b = (freshState.coverage as Record<string, unknown>)[k];
    if (String(a) !== String(b)) covDiffs.push(`coverage.${k}: ${String(a)} -> ${String(b)}`);
  }
  console.log(`  ${covDiffs.length === 0 ? "coverage unchanged" : `${covDiffs.length} coverage field(s) moved:`}`);
  for (const d of covDiffs) console.log(`      ${d}`);
  console.log(`  cards: ${g.state.cards.length} signed, ${freshState.cards.length} now`);

  console.log(`\n[3] THE COMPARATOR THE SIGNATURE WAS MADE UNDER: ${verdict.kind.toUpperCase()}`);
  if (verdict.kind === "diverged") for (const d of verdict.divergences) console.log(`      ${d}`);
  if (verdict.kind === "not-applicable") console.log(`      ${verdict.reason}`);

  console.log(`\n[4] THE FILING SET — what the signature pins against what EDGAR lists now\n`);
  const added = freshState.filingSet.filter((u) => !g.state.filingSet.includes(u));
  const removed = g.state.filingSet.filter((u) => !freshState.filingSet.includes(u));
  console.log(`  signed against ${g.state.filingSet.length} document(s); ${freshState.filingSet.length} now`);
  for (const a of added) console.log(`      + ${a}`);
  for (const r of removed) console.log(`      - ${r}   (pinned by the signature, no longer in the set)`);

  console.log(`\n  SPEND: $${spend.toFixed(4)}   as-of ${PINNED_AS_OF_DAY}`);
})();
