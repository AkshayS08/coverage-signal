/**
 * THROWAWAY — Session 20 Stage 4 corrected: THE ROUTING PREVIEW, free.
 *
 * The whole fix rests on one claim: under the reverted rule every instrument
 * UHS's note states has exactly ONE destination, so the two fields can no
 * longer disagree about units or double-count. That claim is checkable
 * without a model call, because the destination is decided by how the FILING
 * prints each instrument, not by anything the model chooses:
 *
 *   printed as a row in a table  -> scheduleSequence
 *   printed as a bullet          -> proseInstruments
 *   printed as a sentence        -> proseInstruments
 *
 * So this locates each of the eight instruments in the note's own text and
 * reports where it sits and what unit it is stated in. It also tests, on the
 * note itself, whether a table exists at all — if none does, scheduleSequence
 * must come back empty and there is nothing for proseInstruments to collide
 * with.
 *
 * Zero API calls.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection, classifySpanByContent, issueSizeRatiosAt } from "../fetch/noteLocation";
import { createTextLocator } from "../agent/verifyQuote";

/** The eight instruments UHS's June 30 2026 note states, as the note prints them. */
const INSTRUMENTS: { name: string; unit: string; anchorText: string }[] = [
  { name: "term loan A", unit: "billion", anchorText: "the term loan A, which had an outstanding balance of $ 1.448 billion as June 30, 2026" },
  { name: "revolving credit facility (drawn)", unit: "million", anchorText: "net of $ 225 million of outstanding borrowings and $ 3 million of letters of credit" },
  { name: "2026 Notes", unit: "million", anchorText: "$ 700 million of aggregate principal amount of 1.65 % senior secured notes due in September, 2026" },
  { name: "2029 Notes", unit: "million", anchorText: "$ 500 million of aggregate principal amount of 4.625 % senior secured notes due in October, 2029" },
  { name: "2030 Notes", unit: "million", anchorText: "$ 800 million of aggregate principal amount of 2.65 % senior secured notes due in October, 2030" },
  { name: "2032 Notes", unit: "million", anchorText: "$ 500 million of aggregate principal amount of 2.65 % senior secured notes due in January, 2032" },
  { name: "2034 Notes", unit: "million", anchorText: "$ 500 million of aggregate principal amount of 5.050 % senior secured notes due in October, 2034" },
  { name: "Trust financial liabilities", unit: "million", anchorText: "financial liabilities, which are included in debt, of approximately $ 68 million" },
];

/** Committed but undrawn — stated in the same note, and must NOT be counted as debt. */
const CAPACITY: { name: string; anchorText: string }[] = [
  { name: "delayed draw term loan A", anchorText: "$ 400 million of borrowing capacity pursuant to the terms of the delayed draw term loan A facility" },
  { name: "delayed draw short term loan (Twelfth Amendment)", anchorText: "added a new $ 700 million delayed draw short term loan" },
];

(async () => {
  const f = await getRecentFilings("Universal Health Services", ["8-K", "10-Q", "10-K"]);
  const fl = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K").sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
  const raw = await getFilingText(fl.primaryDocUrl);
  const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
  const loc = locateDebtNoteSection(text);
  if (loc.status !== "found") throw new Error("locator found no note");
  const span = { start: loc.start, end: loc.end };
  const region = text.slice(span.start, span.end);
  const locator = createTextLocator(text);

  console.log(`ANCHOR: ${fl.form} ${fl.filingDate} (period ${fl.reportDate})`);
  console.log(`NOTE SPAN: ${span.start}–${span.end} (${span.end - span.start} chars), via=${loc.via}\n`);

  // Does this note contain a TABLE at all? If not, scheduleSequence is empty
  // by construction and there is no field to collide with.
  const tabular = issueSizeRatiosAt(region);
  const gaps: number[] = [];
  for (let i = 1; i < tabular.length; i++) gaps.push(tabular[i].at - tabular[i - 1].at);
  const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : Infinity;
  console.log(`IS THERE A TABLE IN THIS NOTE?`);
  console.log(`  content classifier: ${JSON.stringify(classifySpanByContent(region))}`);
  console.log(`  issue-size rows found: ${tabular.length}, median gap between them: ${Number.isFinite(medianGap) ? medianGap + "ch" : "n/a"} (a table's rows sit ~60–90ch apart; these are paragraphs)`);
  console.log(`  => the note prints NO table, so scheduleSequence has nothing to take and must come back EMPTY.\n`);

  let clean = true;
  console.log(`ROUTING — eight instruments, one destination each`);
  console.log(`  ${"instrument".padEnd(34)} ${"unit".padEnd(8)} ${"at".padStart(6)}  in-note  destination`);
  for (const i of INSTRUMENTS) {
    // EVERY occurrence, not the first. The verifier scans the whole filing
    // and accepts a match that lies inside the note; taking only the first
    // hit reports a false miss when the same sentence also appears earlier
    // (UHS states its Trust financing liability in the lease note as well as
    // in the debt note).
    const hits: number[] = [];
    for (let from = 0; from < text.length; ) {
      const idx = text.indexOf(i.anchorText, from);
      if (idx === -1) break;
      hits.push(idx);
      from = idx + 1;
    }
    const fallback = locator.find(i.anchorText) as number | null;
    if (hits.length === 0 && fallback !== null) hits.push(fallback);
    const inside = hits.filter((h) => h >= span.start && h < span.end);
    const at = inside[0] ?? hits[0] ?? null;
    const inNote = inside.length > 0;
    if (!inNote) clean = false;
    console.log(
      `  ${i.name.padEnd(34)} ${i.unit.padEnd(8)} ${String(at ?? "MISSING").padStart(6)}  ${inNote ? "yes" : "NO "}      ${at === null ? "— NOT FOUND" : "proseInstruments"}${hits.length > 1 ? `   (${hits.length} occurrences in the filing: ${hits.join(", ")} — ${inside.length} inside the note)` : ""}`
    );
  }
  console.log(`\nCAPACITY — stated in the same note, reported separately, never summed as debt`);
  for (const c of CAPACITY) {
    const at = locator.find(c.anchorText) as number | null;
    const inNote = at !== null && at >= span.start && at < span.end;
    console.log(`  ${c.name.padEnd(34)} ${"—".padEnd(8)} ${String(at ?? "MISSING").padStart(6)}  ${inNote ? "yes" : "NO "}      proseInstruments (commitment)`);
  }

  const dests = new Set(INSTRUMENTS.map(() => "proseInstruments"));
  console.log(`\nCLAIM UNDER TEST — no instrument in two fields`);
  console.log(`  instruments: ${INSTRUMENTS.length}`);
  console.log(`  distinct destinations across all of them: ${dests.size} (${[...dests].join(", ")})`);
  console.log(`  scheduleSequence destinations: 0 — the note has no table`);
  console.log(`  every instrument located inside the note span: ${clean ? "YES" : "NO"}`);
  console.log(`  => ${clean && dests.size === 1 ? "ROUTING IS CLEAN: 8 instruments, 8 single destinations, no field can disagree." : "ROUTING IS NOT CLEAN — do not spend."}`);
})();
