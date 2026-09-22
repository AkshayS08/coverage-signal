/**
 * IS THE UNIT SWING A NORMALIZER GAP OR A REAL TRANSCRIPTION CHANGE? $0.
 *
 * UHS run 1 renders the term loan at `$1.448 billion`; run 3 at
 * `$1,448 million`. Identical quantities, so "are they equal?" is the wrong
 * question and answers nothing.
 *
 * THE DECIDING QUESTION IS WHETHER EACH RUN COPIED ITS OWN SENTENCE.
 *
 *   - if run 3's sourceLine PRINTS "1,448 million", run 3 copied faithfully
 *     from a sentence that says that — a document choice, the same class as
 *     the two sentence choices this gate already tolerates
 *   - if run 3's sourceLine prints "1.448 billion" and the ROW says
 *     "1,448 million", the model RE-EXPRESSED the filing's figure. Every
 *     figure in this schema is copied, never computed, so that is a real
 *     transcription change and Session 22's [7c] ruling stands.
 *
 * Normalizing the comparison would make the first case sign and would HIDE
 * the second, which is why the question has to be settled before the
 * normalizer is touched.
 *
 * It then sweeps every company's cached runs for the same shape, because a
 * wall UHS hits is a wall Tenet, CHS and Encompass may hit too, and that is
 * worth knowing before three refreshes are billed against it.
 *
 * Run: npx tsx lib/cache/s23unitswing.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState } from "../events/golden";
import { currentCompanySpend } from "../agent/costMeter";

const SCALE = /\b(thousand|million|billion|trillion)s?\b/i;

/** The digits and scale a string actually prints, for comparing FORM not value. */
function formOf(s: string): { digits: string; scale: string } | null {
  const m = s.match(/([\d][\d,.]*)\s*(thousand|million|billion|trillion)s?/i);
  if (!m) return null;
  return { digits: m[1], scale: m[2].toLowerCase() };
}

/**
 * THREE OUTCOMES, because a table cell printing bare digits is not the same
 * as a sentence naming a different scale.
 *
 * The first version of this returned yes/no, and reported 64 of 90 rows as
 * "re-expressed" — nearly the whole book. Almost all of them were table rows
 * like Tenet's "5.125 % due 2027 1,500", where the digits ARE the sentence's
 * and the scale word comes from the column header. That is the established
 * `scale-from-table` convention Rule 58 already names, and flagging it as
 * re-expression is a scan judging by a stricter standard than the page —
 * the same mistake, for the third time this session.
 *
 * RE-EXPRESSION IS NARROW AND SPECIFIC: the sentence states this quantity
 * WITH A SCALE WORD, and the row prints a DIFFERENT scale word. That is the
 * model converting units rather than copying, and it is the only shape that
 * breaks "every figure is copied, never computed".
 */
type FormVerdict = "faithful" | "scale-from-table" | "re-expressed" | "no-scale-in-row";

function sentencePrintsForm(amount: string, sentence: string): FormVerdict {
  const a = formOf(amount);
  if (!a) return "no-scale-in-row";
  const bare = a.digits.replace(/,/g, "");
  const scaled = [...sentence.matchAll(/([\d][\d,.]*)\s*(thousand|million|billion|trillion)s?/gi)];
  for (const m of scaled) {
    if (m[1].replace(/,/g, "") === bare) {
      return m[2].toLowerCase() === a.scale ? "faithful" : "re-expressed";
    }
  }
  // The digits alone, with the unit supplied by the column header.
  const bareTokens: string[] = sentence.replace(/,/g, "").match(/\d[\d.]*/g) ?? [];
  if (bareTokens.includes(bare)) return "scale-from-table";
  // THE QUANTITY EXPRESSED AT ANOTHER SCALE — 1,448 against a sentence that
  // says 1.448 billion. This is the UHS case and must not fall through to
  // "not found", which would read as a provenance problem rather than a
  // conversion.
  for (const m of scaled) {
    const v = Number(m[1].replace(/,/g, ""));
    const mult: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
    const rowValue = Number(bare) * (mult[a.scale] ?? 1);
    if (Number.isFinite(v) && Math.abs(v * (mult[m[2].toLowerCase()] ?? 1) - rowValue) < 1) return "re-expressed";
  }
  return "no-scale-in-row";
}

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

(async () => {
  // ── Q1: UHS's three runs, row by row ──────────────────────────────────
  console.log(`\n${"=".repeat(104)}`);
  console.log(`Q1 — UHS's three cached runs: does each row's own sentence print the form the row shows?`);
  console.log("=".repeat(104));

  const perRun: Map<string, { amount: string; sourceLine: string }>[] = [];
  let spend = 0;
  for (let i = 1; i <= 3; i++) {
    process.env.CACHE_BUST = `s23-9b-UniversalHealt-${i}`;
    const r = await runAgentLoop("Universal Health Services");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const s = deriveGoldenState(r, PINNED_AS_OF);
    const m = new Map<string, { amount: string; sourceLine: string }>();
    // Keyed by the amount's DIGITS, so a rename does not hide the row.
    for (const row of s.rows) {
      const f = formOf(String(row.amount ?? ""));
      if (!f) continue;
      m.set(f.digits.replace(/,/g, ""), { amount: String(row.amount), sourceLine: String(row.sourceLine ?? "") });
    }
    perRun.push(m);
  }

  const keys = [...new Set(perRun.flatMap((m) => [...m.keys()]))].sort();
  let reExpressed = 0, faithful = 0;
  for (const k of keys) {
    const forms = perRun.map((m) => m.get(k)?.amount ?? "(absent)");
    if (new Set(forms.map((f) => formOf(f)?.scale ?? f)).size === 1) continue;
    console.log(`\n  digits ${k} — the runs print it in DIFFERENT unit forms:`);
    for (let i = 0; i < perRun.length; i++) {
      const e = perRun[i].get(k);
      if (!e) { console.log(`      run ${i + 1}: (absent)`); continue; }
      const verdict = sentencePrintsForm(e.amount, e.sourceLine);
      if (verdict === "re-expressed") reExpressed++; else faithful++;
      console.log(`      run ${i + 1}: row shows ${e.amount.padEnd(18)} its sentence prints that form? ${verdict.toUpperCase()}`);
      console.log(`              "${e.sourceLine.replace(/\s+/g, " ").slice(0, 150)}"`);
    }
  }
  console.log(`\n  ${faithful} run(s) copied their own sentence's form; ${reExpressed} RE-EXPRESSED it.`);
  console.log(`  ${reExpressed > 0
    ? "→ REAL TRANSCRIPTION CHANGE. A figure was re-expressed, not copied. [7c] stands and normalizing would hide it."
    : "→ NORMALIZER GAP. Every run copied its own sentence faithfully; the runs chose different sentences."}`);

  // ── Q2: the same shape, everywhere the canonical book states a scale ───
  console.log(`\n${"=".repeat(104)}`);
  console.log(`Q2 — every canonical ladder row: does its own sentence print the form the row shows?`);
  console.log("=".repeat(104));
  let rows = 0, ok = 0, mismatched = 0, noScale = 0;
  const byVerdict: Record<string, number> = {};
  for (const company of ALL) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const s = deriveGoldenState(r, PINNED_AS_OF);
    const bad: string[] = [];
    for (const row of s.rows) {
      rows++;
      const amount = String(row.amount ?? "");
      const line = String(row.sourceLine ?? "");
      if (!SCALE.test(amount)) { noScale++; continue; }
      const v = sentencePrintsForm(amount, line);
      if (v === "faithful" || v === "scale-from-table") { ok++; byVerdict[v] = (byVerdict[v] ?? 0) + 1; continue; }
      if (v === "no-scale-in-row") { noScale++; continue; }
      mismatched++;
      bad.push(`      ${String(row.instrument).slice(0, 44).padEnd(46)} ${amount.padEnd(20)}\n        "${line.replace(/\s+/g, " ").slice(0, 140)}"`);
    }
    console.log(`\n  ${company.padEnd(30)} ${bad.length === 0 ? "every scaled amount printed as its sentence prints it" : `⚠ ${bad.length} re-expressed`}`);
    for (const b of bad) console.log(b);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${rows} rows · ${ok} faithful (${byVerdict["faithful"] ?? 0} same form, ${byVerdict["scale-from-table"] ?? 0} unit from the column header) · ${noScale} no scale to compare · ${mismatched} RE-EXPRESSED`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
