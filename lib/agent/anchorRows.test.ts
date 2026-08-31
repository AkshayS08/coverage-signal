/**
 * SESSION 20 — THE ANCHOR FILING IS THE POSITION, ACROSS FILINGS.
 *
 * BRD 6.0's authority rule was written about EVENTS: an 8-K wins only when
 * it post-dates the note. It said nothing about where a SCHEDULE ROW may
 * come from, and UHS found the gap: its v20 ladder carried a December 2025
 * carrying amount transcribed from the 10-K, under a source attribution
 * naming the June 2026 10-Q, and it carded.
 *
 * Every existing guard passed it. The sourceLine verified literally, the
 * amount corroborated, the note bound held — all against the wrong filing,
 * because nothing required the row's filing and the position's filing to be
 * the same one.
 *
 * Run: npx tsx lib/agent/anchorRows.test.ts
 */
import { rowsOnAnchor } from "./loop";
import type { VerifiedSequenceEntry } from "./loop";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const ANCHOR = "https://sec.gov/uhs-20260630.htm";
const TEN_K = "https://sec.gov/uhs-20251231.htm";

function row(over: Partial<VerifiedSequenceEntry> & { label: string }): VerifiedSequenceEntry {
  return {
    kind: "row", rate: null, seniority: null, amount: "$100 million",
    maturityDate: "2030-01-01", dateGranularity: "day",
    sourceLine: `s: ${over.label}`, citedUrl: ANCHOR, section: null, periodColumn: null, ...over,
  } as VerifiedSequenceEntry;
}

console.log("\n=== [1] REAL: UHS's 10-K row is dropped from the current ladder ===");
{
  const entries = [
    row({ label: "1.65% Senior Secured Notes due 2026", amount: "$699,887 thousands", citedUrl: TEN_K }),
  ];
  const { kept, dropped } = rowsOnAnchor(entries, ANCHOR);
  assert(kept.length === 0 && dropped.length === 1,
    `[1a] THE RULE: a row cited from the 10-K is not the anchor's position and is dropped (kept ${kept.length}, dropped ${dropped.length})`);
}

console.log("\n=== [2] The anchor's own rows are untouched ===");
{
  const entries = [row({ label: "A" }), row({ label: "B" }), row({ label: "C" })];
  const { kept, dropped } = rowsOnAnchor(entries, ANCHOR);
  assert(kept.length === 3 && dropped.length === 0,
    "[2a] REVERSE: rows citing the anchor all survive — the rule removes a source, not a ladder");
}

console.log("\n=== [3] A two-column note is not a violation ===");
{
  // A 10-Q debt table routinely prints June 30 AND December 31 columns. Both
  // are the ANCHOR's own text, so both cite the anchor. The rule must not
  // mistake a comparative column for a foreign filing.
  const entries = [
    row({ label: "4.375% Notes due 2028", amount: "$800 million" }),
    row({ label: "4.375% Notes due 2028 (prior column)", amount: "$800 million" }),
  ];
  const { kept, dropped } = rowsOnAnchor(entries, ANCHOR);
  assert(kept.length === 2 && dropped.length === 0,
    "[3a] comparative columns inside the anchor's own table cite the anchor and are kept");
}

console.log("\n=== [4] Mixed: only the foreign rows go ===");
{
  const entries = [
    row({ label: "on-anchor A" }),
    row({ label: "stale from 10-K", citedUrl: TEN_K }),
    row({ label: "on-anchor B" }),
  ];
  const { kept, dropped } = rowsOnAnchor(entries, ANCHOR);
  assert(kept.length === 2 && dropped.length === 1 && dropped[0].label === "stale from 10-K",
    `[4a] the drop is per-row, not per-ladder — a good ladder is not thrown away for one bad row (kept ${kept.length})`);
}

console.log("\n=== [5] No anchor means no rule to apply ===");
{
  const entries = [row({ label: "A", citedUrl: TEN_K })];
  const { kept, dropped } = rowsOnAnchor(entries, null);
  assert(kept.length === 1 && dropped.length === 0,
    "[5a] with no anchor identified there is nothing to be off — the rule abstains rather than dropping everything");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
