/**
 * SESSION 26 — CRITERION 8b RE-DERIVED FROM PRINTED HEADINGS ONLY. $0.
 *
 * A row's priority class may be read only from a heading the anchor's table
 * PRINTS before the row's block (card_spec v2.0 §3.5; Akshay, Oct 15 and 17,
 * 2026). The signed goldens' stored results predate that rule: their recorded
 * `section` / `seniority` strings fed 8b whether printed or not (audit-spine
 * instance 12).
 *
 * For each golden this script:
 *   1. records on each stored row the heading its anchor table prints
 *      (`printedHeading`), from the anchor's own text in the committed card
 *      snapshot — the same function the loop now runs, so the stored result
 *      equals what the loop reproduces. Nothing else in the result changes;
 *      the script checks that byte for byte, field by field.
 *   2. re-derives the state and all criteria from that result;
 *   3. REFUSES unless the signed position reproduces (compareToGolden, the
 *      comparison goldenThroughLoop applies) and every other criterion is
 *      unchanged — this signature covers a class-source change, nothing else.
 *      The stored state is kept as signed: no state field carries a class;
 *   4. re-signs ONLY where 8b's text changed, with the reason recorded.
 *      A golden whose 8b is unchanged is left untouched on disk.
 *
 * Dry run by default. Run: npx tsx lib/cache/s26resign8b.ts [--write]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareToGolden, deriveGoldenState, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { annotatePrintedHeadings } from "../events/printedHeadings";
import { createTextLocator } from "../agent/verifyQuote";

const ROOT = process.cwd();
const GOLDEN_DIR = join(ROOT, "baselines", "golden");
const WRITE = process.argv.includes("--write");
const SIGNER = "Akshay Sahani";

/** Strip the one new field: what remains must be the stored result exactly. */
function withoutPrintedHeading(result: unknown): string {
  return JSON.stringify(result, (k, v) => (k === "printedHeading" ? undefined : v));
}

let resigned = 0, unchanged = 0, refused = 0;
for (const file of readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json"))) {
  const path = join(GOLDEN_DIR, file);
  const g = JSON.parse(readFileSync(path, "utf-8")) as GoldenFile;
  const name = g.state.company;
  const result = JSON.parse(JSON.stringify(g.sourceResult));
  const dm = result.results.find((r: any) => r.triggerId === "debt-maturity");
  const anchorUrl: string | undefined = dm?.debtScheduleSourceFiling?.url;
  let snapText: string | null = null;
  try {
    const snap = JSON.parse(readFileSync(join(ROOT, "lib", "cards", "inputs", `${g.state.cik}.json`), "utf-8"));
    snapText = anchorUrl ? snap.docs?.[anchorUrl]?.text ?? null : null;
  } catch { /* a golden with no card snapshot has no anchor text here */ }
  if (!snapText) { console.log(`\n  ${name}: SKIPPED — no anchor text held for it (no card snapshot); its 8b is not re-derived here`); continue; }
  const loc = createTextLocator(snapText);
  dm.scheduleSequence = annotatePrintedHeadings(dm.scheduleSequence ?? [], snapText, (l) => loc.find(l));
  if (withoutPrintedHeading(result) !== JSON.stringify(g.sourceResult)) { refused++; console.log(`\n  ${name}: REFUSED — annotating changed more than printedHeading`); continue; }

  const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
  const fresh = deriveGoldenState(result, asOf);
  // The project's own comparison, the one goldenThroughLoop applies: the signed position must reproduce.
  const verdict = compareToGolden(g.state, fresh);
  const moved = verdict.kind === "matches" ? [] : verdict.kind === "diverged" ? verdict.divergences : [verdict.reason];
  const att = { rowsCorrect: g.attestation?.rowsCorrect ?? true, instrumentTypeFaithful: g.attestation?.instrumentTypeFaithful ?? true, reproducedThreeTimes: g.attestation?.reproducedThreeTimes ?? true, by: SIGNER, on: g.state.asOf };
  const crit = evaluateGoldenCriteria(result, asOf, att);
  const old8b = g.criteria.find((c) => c.id === "8b");
  const new8b = crit.criteria.find((c) => c.id === "8b");
  const otherMoved = crit.criteria.filter((c) => c.id !== "8b").filter((c) => { const o = g.criteria.find((x) => x.id === c.id); return !o || o.pass !== c.pass || o.detail !== c.detail; }).map((c) => c.id);
  const rows = (dm.scheduleSequence as any[]).filter((e) => e.kind === "row");
  const printed = [...new Set(rows.map((e) => e.printedHeading).filter(Boolean))];
  const recordedNotPrinted = [...new Set(rows.flatMap((e) => [e.section, e.seniority]).filter((h: string | null) => h && !printed.includes(h.replace(/[:—–-]+$/, "").trim())))];

  console.log(`\n  ${name}`);
  console.log(`      printed headings: ${printed.length ? printed.map((p) => `"${p}"`).join("; ") : "none"}`);
  console.log(`      recorded, not printed: ${recordedNotPrinted.length ? recordedNotPrinted.map((p) => `"${p}"`).join("; ") : "none"}`);
  console.log(`      8b was: ${old8b?.pass ? "PASS" : "FAIL"} — ${old8b?.detail}`);
  console.log(`      8b now: ${new8b?.pass ? "PASS" : "FAIL"} — ${new8b?.detail}`);
  if (moved.length) { refused++; console.log(`      REFUSED — the position moved: ${moved.join(", ")}`); continue; }
  if (otherMoved.length) { refused++; console.log(`      REFUSED — other criteria moved too: ${otherMoved.join(", ")}`); continue; }
  if (old8b?.detail === new8b?.detail && old8b?.pass === new8b?.pass) { unchanged++; console.log(`      8b unchanged — not re-signed`); continue; }

  const basis =
    `Re-signed in Session 26 (Oct 17, 2026) for criterion 8b only. Reason: a row's priority class is now read only from a ` +
    `heading the anchor's table PRINTS before the row's block (card_spec v2.0 §3.5; Akshay's rulings of Oct 15 and Oct 17, 2026); ` +
    `the stored answer's recorded headings fed the class whether printed or not (audit-spine instance 12). ` +
    `Printed headings: ${printed.length ? printed.map((p) => `"${p}"`).join("; ") : "none"}. Recorded but not printed, so no longer a class source: ` +
    `${recordedNotPrinted.length ? recordedNotPrinted.map((p) => `"${p}"`).join("; ") : "none"}. ` +
    `8b was "${old8b?.detail}"; now "${new8b?.detail}". ` +
    `The stored result gains one field per row, printedHeading, computed in code from the anchor's own text (the loop now records the same); ` +
    `nothing else in it changed. Position, coverage, filing set and every other criterion compared and UNCHANGED. ` +
    `Previously signed ${g.signature?.signedOn ?? "(unknown)"} on the basis: ${g.signature?.basis ?? "(none recorded)"}`;
  if (WRITE) {
    const out: GoldenFile = {
      ...g,
      signature: { signedBy: SIGNER, signedOn: g.state.asOf, basis },
      criteria: crit.criteria.map((c) => ({ id: c.id, name: c.name, kind: c.kind, pass: c.pass, detail: c.detail, defends: c.defends })),
      sourceResult: result,
    };
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
  }
  resigned++;
  console.log(`      ${WRITE ? "RE-SIGNED" : "WOULD RE-SIGN (dry run)"}`);
}
console.log(`\n  ${WRITE ? "re-signed" : "would re-sign"}: ${resigned}   8b unchanged: ${unchanged}   refused: ${refused}${WRITE ? "" : "   (dry run — pass --write)"}`);
