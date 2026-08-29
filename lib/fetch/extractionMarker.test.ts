/**
 * SESSION 19 (run B diagnosis) — EVERY BRANCH MARKS ITS INPUT IDENTICALLY.
 *
 * buildExtractionText has two branches: a note inside the first LEAD_CHARS,
 * and a note past it. Only the second one told the model where the note was.
 * Molina's note sits at 37,461 with a confusable fair-value table at 28,783,
 * both inside the lead — so Molina took the silent branch, and v17 blended
 * the two tables for three of five tranches.
 *
 * Run: npx tsx lib/fetch/extractionMarker.test.ts
 */
import { buildExtractionText } from "./debtNoteLocator";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** A debt note dense enough for the locator to find, with a heading. */
function note(tag: string): string {
  return (
    `7. Debt The following table summarizes our outstanding debt obligations: ` +
    `June 30, 2026 December 31, 2025 (In millions) Non-current long-term debt: ` +
    `4.375 % ${tag} Notes due June 15, 2028 $ 800 $ 800 ` +
    `3.875 % ${tag} Notes due November 15, 2030 650 650 ` +
    `6.500 % ${tag} Notes due February 15, 2031 850 850 ` +
    `3.875 % ${tag} Notes due May 15, 2032 750 750 ` +
    `6.250 % ${tag} Notes due January 15, 2033 750 750 ` +
    `Deferred debt issuance costs ( 31 ) ( 34 ) Total $ 3,769 $ 3,766 `
  );
}

const MARKER = "the debt-schedule note was located at character offset";
const CLOSE = "end of the located debt-schedule note";
const FILLER = "Filler narrative sentence about operations and segments. ";

console.log("\n=== [1] EARLY note — the branch that was silent ===");
{
  // Note at ~37k, filing 110k: Molina's exact shape.
  const before = FILLER.repeat(640);           // ~37k chars
  const after = FILLER.repeat(1250);           // pushes total past the cap
  const fullText = before + note("EARLY") + after;
  const r = buildExtractionText({ form: "10-Q", url: "u", fullText });

  assert(r.debtNoteStatus === "found", `[1a] the locator finds an early note (status=${r.debtNoteStatus})`);
  assert(r.text.includes(MARKER), "[1b] THE FIX: an early note's input now carries the marker");
  assert(r.text.includes(CLOSE), "[1c] and its closing delimiter, so the note has a stated END as well as a start");
  assert(r.text.includes("6.250 % EARLY Notes due January 15, 2033"), "[1d] the note's own text survives the splice intact");
  assert(r.text.indexOf(MARKER) < r.text.indexOf("6.250 % EARLY"), "[1e] the marker precedes the note rather than trailing it");
  assert(r.text.indexOf("4.375 % EARLY") === r.text.lastIndexOf("4.375 % EARLY"),
    "[1f] the note appears ONCE — delimited in place, never appended as a second copy");
}

console.log("\n=== [2] LATE note — the branch that already worked ===");
{
  const before = FILLER.repeat(900);           // ~52k, past LEAD_CHARS
  const fullText = before + note("LATE") + FILLER.repeat(100);
  const r = buildExtractionText({ form: "10-Q", url: "u", fullText });

  assert(r.debtNoteStatus === "found", `[2a] the locator finds a late note (status=${r.debtNoteStatus})`);
  assert(r.text.includes(MARKER), "[2b] the late branch still carries the marker");
  assert(r.text.includes(CLOSE), "[2c] and the same closing delimiter");
}

console.log("\n=== [3] The two branches agree — the rule itself ===");
{
  const early = buildExtractionText({ form: "10-Q", url: "u", fullText: FILLER.repeat(640) + note("E") + FILLER.repeat(1250) });
  const late = buildExtractionText({ form: "10-Q", url: "u", fullText: FILLER.repeat(900) + note("L") + FILLER.repeat(100) });
  const marks = (t: string) => [t.includes(MARKER), t.includes(CLOSE)].join(",");
  assert(marks(early.text) === marks(late.text),
    `[3a] THE RULE: both branches mark the input identically — a marker present only when one branch happens to run is an accident, not a design (early=${marks(early.text)} late=${marks(late.text)})`);
  assert(early.noteSpan !== undefined && late.noteSpan !== undefined,
    "[3b] both branches still report noteSpan, which is what bounds verification");
}

console.log("\n=== [4] Branches with nothing to mark are unchanged ===");
{
  const short = buildExtractionText({ form: "10-Q", url: "u", fullText: "a short filing" });
  assert(short.debtNoteStatus === "under_cap" && !short.text.includes(MARKER),
    "[4a] a filing under the cap is passed through unmarked — there is no located span to delimit");
  const eightK = buildExtractionText({ form: "8-K", url: "u", fullText: FILLER.repeat(1200) });
  assert(eightK.debtNoteStatus === "not_applicable" && !eightK.text.includes(MARKER),
    "[4b] an 8-K is never located and never marked");
  const noNote = buildExtractionText({ form: "10-Q", url: "u", fullText: FILLER.repeat(1200) });
  assert(noNote.debtNoteStatus === "not_found" && !noNote.text.includes(MARKER),
    "[4c] no located note means no marker — the marker asserts a fact, so it is never printed speculatively");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
