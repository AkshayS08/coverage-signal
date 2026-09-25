/**
 * SESSION 23 — TWO FACILITIES SHARING SIGNIFICANT WORDS ARE TWO ROWS.
 *
 * The finding of the v30 pass. `facilityOnlyRows` asked "is this facility
 * already on the ladder?" by calling matchFacility with a ONE-ELEMENT
 * candidate list. matchFacility's word-overlap fallback is guarded by "only
 * where exactly one facility shares them" (Rule 19) — and against a list of
 * one, that condition is true by construction. The guard existed, read as
 * present, and could not fire.
 *
 * UHS paid for it: its $700 million July 2026 Delayed Draw Term Loan matched
 * its $400 million Delayed draw term loan A facility on {delayed, draw, term,
 * loan}, was marked already-present, and never reached the ladder.
 *
 * Offline, $0. The facilities below are REAL, as v30 stored them.
 */
import { facilityOnlyRows, amountProvenanceFor, amountSupportOf, noteUnsupportedAmounts, collapseSameFacilityRows } from "./position";
import { matchFacility } from "./position";
import type { FacilityRow } from "../agent/claude";
import type { TriggerResult } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ PASS — ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  ✗ FAIL — ${msg}`); }
}
const fig = (value: string, sourceLine: string) => ({ value, sourceLine });

// REAL — UHS's two delayed-draw facilities, from the v30 blob.
const ddA: FacilityRow = {
  name: "Delayed draw term loan A facility",
  category: "delayed-draw-term-loan",
  facilitySize: fig("$400 million", "initiated a new $ 400 million delayed draw term loan A which is expected to be drawn upon the closing of our acquisition of Talkspace, Inc."),
  drawn: null, lettersOfCredit: null,
  available: fig("$400 million", "$ 400 million of borrowing capacity pursuant to the terms of the delayed draw term loan A facility"),
  maturity: fig("September 26, 2029", "The maturity date for our Credit Agreement is September 26, 2029 ."),
  asOfDate: "2026-06-30", availabilityBasis: null,
};
const ddJuly: FacilityRow = {
  name: "July 2026 Delayed Draw Term Loan",
  category: "delayed-draw-term-loan",
  facilitySize: fig("$700 million", 'a new incremental delayed draw tranche A term loan facility of up to $700 million (the "July 2026 Delayed Draw Term Loan")'),
  drawn: null, lettersOfCredit: null,
  available: fig("$700 million", "The July 2026 Delayed Draw Term Loan, in an aggregate principal amount of up to $700 million, is available to be drawn down"),
  maturity: fig("364 days after funding", "will mature on the date that is 364 days after the date of funding of the July 2026 Delayed Draw Term Loan"),
  asOfDate: "2026-06-30", availabilityBasis: null,
};

const dm = (facilities: FacilityRow[]) => ({ triggerId: "debt-maturity", facilities } as unknown as TriggerResult);

console.log("=== [1] The bug, stated as the condition that allowed it ===");
{
  // The old call site's shape: one candidate, so "exactly one shares the
  // words" is true no matter what.
  const againstOne = matchFacility({ name: ddA.name, category: null }, [ddJuly], { byNameOnly: true });
  assert(againstOne === ddJuly,
    "[1a] against a ONE-ELEMENT list, the $400M row matches the $700M facility on shared words — the ambiguity guard cannot fire, which is exactly what the old call site did");

  const againstBoth = matchFacility({ name: ddA.name, category: null }, [ddA, ddJuly], { byNameOnly: true });
  assert(againstBoth === ddA,
    "[1b] against the FULL list it matches the facility it actually names — the candidate set is what lets the guard work at all");
}

console.log("\n=== [2] Two facilities, two rows ===");
{
  const rows = facilityOnlyRows([], dm([ddA, ddJuly]));
  assert(rows.length === 2,
    `[2a] REAL UHS: both delayed-draw facilities render as their own rows (got ${rows.length})`);

  const a = rows.find((r) => r.instrument === ddA.name);
  const j = rows.find((r) => r.instrument === ddJuly.name);
  assert(!!a && a.amount === "$400 million" && a.maturityDate === "2029-09-26",
    `[2b] the Eleventh Amendment facility keeps its OWN name, amount and maturity — $400M, 2029-09-26 (got ${a?.amount}, ${a?.maturityDate})`);
  assert(!!j && j.amount === "$700 million",
    `[2c] and the Twelfth Amendment facility keeps its own $700 million rather than vanishing (got ${j?.amount})`);
  assert(!!j && j.maturityDate === null,
    "[2d] its maturity is \"364 days after funding\" — a real stated maturity that is not a date, so it carries no date and can never card on one (Session 22's three outcomes)");
}

console.log("\n=== [3] The suppression it replaces, and the safe direction ===");
{
  // A row that genuinely IS one of the facilities still claims only that one.
  const existing = [{ instrument: "Delayed draw term loan A facility" }] as never;
  const rows = facilityOnlyRows(existing, dm([ddA, ddJuly]));
  assert(rows.length === 1 && rows[0].instrument === ddJuly.name,
    `[3a] with the $400M facility already on the ladder, only the $700M one is added — the row claims the facility it names and no other (got ${rows.map((r) => r.instrument).join(", ")})`);

  // Two facilities nothing can tell apart: neither is claimed, both render.
  const twinA: FacilityRow = { ...ddA, name: "revolving credit facility", facilitySize: fig("$500 million", "a revolving credit facility of $500 million") };
  const twinB: FacilityRow = { ...ddJuly, name: "revolving credit facility", facilitySize: fig("$300 million", "a revolving credit facility of $300 million") };
  const ambiguous = facilityOnlyRows([{ instrument: "revolving credit facility" }] as never, dm([twinA, twinB]));
  assert(ambiguous.length >= 1,
    `[3b] where two facilities cannot be told apart, an ambiguous match is not a match and nothing is silently dropped (got ${ambiguous.length} row(s))`);
}

// NO SUMMARY HERE. A second `${passed} passed` line used to sit at this
// point, left behind when block [4] was appended. runOffline reads the FIRST
// "N passed, M failed" it finds, so this file reported 8 assertions while
// running 14 — the suite-count drift of the session's own audit spine, inside
// a single file. One summary, at the end, after every block.
console.log("\n=== [4] RULE 58 — a row's sourceLine is the sentence that states its AMOUNT ===");
{
  // REAL UHS, as v30 stored it. The $700M facility states its size in one
  // sentence and its maturity in another, and the row used to take the
  // MATURITY sentence as provenance — rendering $700 million beside words
  // that contain no amount at all.
  const ddJulyReal: FacilityRow = {
    ...ddJuly,
    facilitySize: fig("$700 million", 'The Twelfth Amendment provides for the amendment of the Existing Credit Facility as of July 20, 2026 to add a new incremental delayed draw tranche A term loan facility of up to $700 million (the "July 2026 Delayed Draw Term Loan").'),
    available: null,
    maturity: fig("364 days after funding", "will mature on the date that is 364 days after the date of funding of the July 2026 Delayed Draw Term Loan"),
  };
  const p = amountProvenanceFor(ddJulyReal);
  assert(p.statesAmount && /\$700 million/.test(p.sourceLine),
    `[4a] REAL UHS $700M: provenance is the sentence STATING $700 million, not the maturity sentence (got "${p.sourceLine.slice(0, 70)}...")`);
  assert(!/will mature on the date that is 364 days/.test(p.sourceLine),
    "[4b] and it is specifically NOT the maturity sentence, which states no amount — the Encompass composite one field over");

  const rows = facilityOnlyRows([], dm([ddJulyReal]));
  assert(rows.length === 1 && /\$700 million/.test(String(rows[0].sourceLine)),
    `[4c] the rendered row carries it, so what a reader checks the number against actually contains the number`);
  assert(rows[0].amountProvenanceNote === undefined,
    "[4d] and no provenance note is raised, because the amount IS supported");

  // The maturity sentence is not discarded — it keeps its own home.
  const dated: FacilityRow = { ...ddJulyReal, maturity: fig("September 26, 2029", "The maturity date for our Credit Agreement is September 26, 2029 .") };
  const datedRows = facilityOnlyRows([], dm([dated]));
  assert(datedRows[0].maturityFromFacility?.sourceLine.includes("September 26, 2029") === true,
    "[4e] the maturity sentence still provides the MATURITY's provenance — it stops standing in for the amount's, it is not thrown away");

  // NEVER SILENT. A facility no sentence supports still renders, saying so.
  const unsupported: FacilityRow = {
    ...ddJulyReal,
    facilitySize: fig("$700 million", "The Company entered into the Twelfth Amendment to its Credit Agreement."),
    maturity: null,
  };
  // The note is no longer set by the builder — `noteUnsupportedAmounts` runs
  // once over the assembled ladder so EVERY builder is covered. This test
  // failed the moment that moved, which is the test doing its job.
  const bad = noteUnsupportedAmounts(facilityOnlyRows([], dm([unsupported])));
  assert(bad.length === 1 && typeof bad[0].amountProvenanceNote === "string",
    "[4f] where NO stated sentence contains the amount, the row still renders and states the problem — never suppressed, never silently mismatched");
}

console.log("\n=== [5] The never-silent guard reaches EVERY row, and knows the filing's conventions ===");
{
  // REAL HCA — all four of its ladder rows cite a table row LABEL plus an
  // interest-rate parenthetical, and no figure at all.
  assert(amountSupportOf("$ 3,890 million", "Commercial paper (average life of 38 days, weighted average rate of 4.3 %)").kind === "unsupported",
    "[5a] REAL HCA: a row label with an interest-rate parenthetical does NOT support $3,890 million — the amount is real in the table and this sentence is not what carries it");
  assert(amountSupportOf("44,200 million", "Senior unsecured notes payable through 2095 (effective interest rate of 5.1 %)").kind === "unsupported",
    "[5b] REAL HCA: and the same for its largest row, so the finding is the pattern and not one line");

  // REAL CHS and Quest — the filing's OWN zero conventions, which are not defects.
  assert(amountSupportOf("$0 million", "ABL Facility —").kind === "stated-zero",
    "[5c] REAL CHS: \"$0 million\" against a column printing an em-dash is the zero convention Rule 53 already recognises, not an unsupported amount");
  assert(amountSupportOf("$ —", "3.45 % Senior Note due June 2026 $ — $ 501").kind === "stated-zero",
    "[5d] REAL Quest: and the em-dash form of the same fact resolves too — it takes BOTH zero predicates, logged as a Rule 21 finding rather than hidden");

  // REAL CHS — the scale word comes from the column header, not the cell.
  assert(amountSupportOf("$52 million", "Other 52").kind === "scale-from-table",
    "[5e] REAL CHS: digits present, scale word supplied by the column header — supported, and named as such rather than counted as a failure");
  assert(amountSupportOf("$52 million", "Other 5,200").kind === "unsupported",
    "[5f] but a DIFFERENT number in the sentence is still unsupported — the exemption is about the missing scale word, never about the digits");
  assert(amountSupportOf("$52 million", "Other 52 thousand").kind === "unsupported",
    "[5g] and where the sentence names its OWN scale and it disagrees, that is a real disagreement, not a header supplying the unit");

  // THE GUARD RUNS OVER THE ASSEMBLED LADDER, so a schedule row cannot render
  // an unsupported amount silently the way HCA's four did.
  const rows = noteUnsupportedAmounts([
    { instrument: "Commercial paper", amount: "$ 3,890 million", sourceLine: "Commercial paper (average life of 38 days, weighted average rate of 4.3 %)" },
    { instrument: "Other", amount: "$52 million", sourceLine: "Other 52" },
  ] as never);
  assert(typeof rows[0].amountProvenanceNote === "string",
    "[5h] a SCHEDULE row with an unsupported amount now carries a note — the guard used to live inside facilityOnlyRows and never saw these");
  assert(rows[1].amountProvenanceNote === undefined,
    "[5i] and a supported one carries none, so the note means something when it appears");
}

// ============================================================================
// SESSION 23, RULE 49 ON THE LADDER — one facility, one row.
//
// CHS's ABL reached the ladder twice: the model reports it in the debt note's
// schedule AND, on some runs but not others, again as a prose instrument.
// Same facility, same $1.0 billion, same 2029-06-05. The canonical run had no
// prose entry and gave 12 rows; four other extractions had one and gave 13,
// which read as citation drift for most of a day and was a duplicate.
//
// The negative case is the one that matters, and UHS already provides it:
// two delayed-draw facilities that nearly collided on shared words. They are
// DIFFERENT facilities, so nothing about a shared amount or date may merge
// them.
// ============================================================================
console.log("\n=== RULE 49 on the ladder — two rows stating the same facts about one facility ===\n");
{
  const abl: FacilityRow = {
    name: "ABL Facility", category: "revolver",
    facilitySize: fig("$ 1.0 billion", "the lenders have extended to CHS a revolving asset-based loan facility in the maximum aggregate principal amount of $ 1.0 billion"),
    drawn: null, lettersOfCredit: null, available: null, maturity: null,
  } as unknown as FacilityRow;

  const scheduleRow = {
    instrument: "ABL Facility", amount: "$ 1.0 billion", maturityDate: "2029-06-05",
    sourceLine: "ABL Facility —", isCapacity: true, provenance: "note", status: "live",
  };
  const proseRow = {
    instrument: "ABL Facility", amount: "$1.0 billion", maturityDate: "2029-06-05",
    sourceLine: "the lenders have extended to CHS a revolving asset-based loan facility in the maximum aggregate principal amount of $ 1.0 billion",
    isCapacity: true, provenance: "note-narrative", status: "live",
  };

  const merged = collapseSameFacilityRows([scheduleRow, proseRow] as never, dm([abl]));
  assert(merged.length === 1,
    `[49a] one facility stated twice with the same amount and maturity collapses to ONE row (got ${merged.length})`);
  assert(merged[0].sourceLine.includes("maximum aggregate principal amount"),
    "[49b] and the row that SURVIVES is the one whose own sentence states its amount — the row a reader can check against the page (Rule 58), not whichever came first");
  assert(typeof (merged[0] as unknown as { mergedDuplicate?: string }).mergedDuplicate === "string",
    "[49c] NEVER SILENT: the surviving row records that it absorbed another and quotes what the other said — a merge leaving no trace is indistinguishable from a row we lost");
  assert(
    collapseSameFacilityRows([{ ...scheduleRow, amount: "$   1.0    billion" }, { ...proseRow, amount: "$1.0 billion" }] as never, dm([abl])).length === 1,
    "[49d] WHITESPACE does not prevent the merge — the same value in the same unit, spaced differently, is one transcription"
  );
  assert(
    collapseSameFacilityRows([{ ...scheduleRow, amount: "$ 1.0 billion" }, { ...proseRow, amount: "$ 1,000 million" }] as never, dm([abl])).length === 2,
    "[49e] but a different UNIT does NOT merge, even at the same money. $1.0 billion and $1,000 million are the same amount and not the same transcription — the filing printed one of them, and a row printing the other has changed what it read. This assertion started life backwards, asserting the merge, which would have quietly widened amountKey to value-only everywhere it is used"
  );
  assert(
    collapseSameFacilityRows([scheduleRow, { ...proseRow, maturityDate: "2031-06-05" }] as never, dm([abl])).length === 2,
    "[49f] REVERSE: the same facility stated at a DIFFERENT maturity is two rows — the triple is facility, amount AND maturity, and a disagreement about any of them is something new being said"
  );
  assert(
    collapseSameFacilityRows(
      [
        { instrument: "Delayed draw term loan A", amount: "$ 700 million", maturityDate: "2031-01-01", sourceLine: "x", isCapacity: true, provenance: "note", status: "live" },
        { instrument: "July 2026 Delayed Draw Term Loan", amount: "$ 700 million", maturityDate: "2031-01-01", sourceLine: "y", isCapacity: true, provenance: "note", status: "live" },
      ] as never,
      dm([ddA, ddJuly])
    ).length === 2,
    "[49g] REVERSE, and the case this file exists for: UHS's TWO delayed-draw facilities sharing an amount and a date stay TWO rows. They resolve to different facilities, and a shared figure is not a shared instrument"
  );
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
