/**
 * SESSION 19 — THE VERIFIER ACTUALLY WALKS THE NEW ARRAYS.
 *
 * The prompt holds every eventInstance and noteRetirement sourceLine to the
 * quote standard. A prompt cannot enforce that; only the walk can. These
 * assertions exist because a field present in the schema and the prompt but
 * absent from the verifier's walk is the same drift item 1a killed on the
 * guard side, one layer over — the model would be asked for verifiable text
 * and nothing would ever check it.
 *
 * Offline and free: synthetic filing text, no network, no model.
 *
 * Run: npx tsx lib/agent/instanceVerification.test.ts
 */
import { verifyEventInstances, verifyNoteRetirements } from "./loop";
import type { EventInstanceRow, NoteRetirementRow } from "./claude";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const URL = "https://example.com/10q";
const silent = () => {};

// A filing with a debt note in the MIDDLE and unrelated prose either side.
// The note span is what bounds a retirement claim (Rule 5).
const BEFORE = "A".repeat(4000) + " The Company repurchased $999 million of its 9.999% Phantom Notes due 2099. " + "B".repeat(4000);
const NOTE =
  "8. Long-term Debt. 4.25 % Senior Notes due December 15, 2027 $ 1,067 . " +
  "During the three and six months ended June 30, 2026, the Company repurchased $ 118 million and $ 1,147 million, respectively, of its par value Senior Notes due 2027. ";
const AFTER = "C".repeat(4000) + " On April 1, 2026 the Company completed the sale of Crestwood Medical Center for $ 459 million in cash. " + "D".repeat(2000);
const TEXT = BEFORE + NOTE + AFTER;
const NOTE_SPAN = { start: BEFORE.length, end: BEFORE.length + NOTE.length };

const textByUrl = new Map([[URL, TEXT]]);
const noteSpans = new Map([[URL, NOTE_SPAN]]);

function main() {
  console.log("=== eventInstance / noteRetirement verification ===\n");

  // ==========================================================================
  // 1. eventInstances — each entry's OWN sourceLine is verified literally.
  // ==========================================================================
  {
    const rows: EventInstanceRow[] = [
      { description: "Crestwood sale", amount: "$ 459 million", eventDate: "2026-04-01", dateGranularity: "day", eventStatus: "completed",
        sourceLine: "On April 1, 2026 the Company completed the sale of Crestwood Medical Center for $ 459 million in cash." },
      { description: "an event nobody filed", amount: "$ 777 million", eventDate: null, dateGranularity: null, eventStatus: "completed",
        sourceLine: "The Company completed the sale of an imaginary hospital for $ 777 million." },
    ];
    const out = verifyEventInstances(rows, [URL], textByUrl, silent, "asset sale");
    assert(out.length === 1, `[1a] the entry whose sourceLine IS in the filing survives; the one that is not is DROPPED (kept ${out.length} of 2)`);
    assert(out[0]?.description === "Crestwood sale", "[1b] ...and it is the real one that survived");
    assert(out[0]?.citedUrl === URL, "[1c] ...carrying the filing it verified against, so a later reader can check it");
    assert(
      !out.some((r) => r.description === "an event nobody filed"),
      "[1d] REGRESSION: an unverifiable instance is never trusted — this is the whole reason the walk exists rather than the prompt alone"
    );
  }

  // ==========================================================================
  // 2. eventInstances — a null amount is not a scale failure.
  // ==========================================================================
  {
    const rows: EventInstanceRow[] = [
      { description: "a formation with no figure", amount: null, eventDate: null, dateGranularity: null, eventStatus: "completed",
        sourceLine: "On April 1, 2026 the Company completed the sale of Crestwood Medical Center for $ 459 million in cash." },
    ];
    const out = verifyEventInstances(rows, [URL], textByUrl, silent, "new subsidiary");
    assert(out.length === 1, "[2a] an instance stating NO amount still verifies — an acquisition or a formation often names no figure");
    assert(out[0]?.amount === null, `[2b] ...and its amount is still null afterwards, not a placeholder leaked from the scale check (got ${JSON.stringify(out[0]?.amount)})`);
  }

  // ==========================================================================
  // 3. noteRetirements — BOUNDED TO THE NOTE (Rule 5).
  //
  // Both sourceLines below are genuinely present in the filing. Only one is
  // inside the located debt note. A claim about what the NOTE says must be
  // found in the note; "somewhere in 180,000 characters" is the unbounded
  // search Rule 5 exists to forbid.
  // ==========================================================================
  {
    const rows: NoteRetirementRow[] = [
      { instrument: "Senior Notes due 2027", amount: "$ 118 million", eventDate: null, dateGranularity: null,
        sourceLine: "During the three and six months ended June 30, 2026, the Company repurchased $ 118 million and $ 1,147 million, respectively, of its par value Senior Notes due 2027." },
      { instrument: "Phantom Notes due 2099", amount: "$999 million", eventDate: null, dateGranularity: null,
        sourceLine: "The Company repurchased $999 million of its 9.999% Phantom Notes due 2099." },
    ];
    const out = verifyNoteRetirements(rows, [URL], textByUrl, silent, "debt maturity", noteSpans);
    assert(out.length === 1, `[3a] only the retirement stated INSIDE the located note survives (kept ${out.length} of 2)`);
    assert(out[0]?.instrument === "Senior Notes due 2027", "[3b] ...and it is the one the note actually states");
    assert(
      !out.some((r) => r.instrument.includes("Phantom")),
      "[3c] REGRESSION: text that is really in the filing but OUTSIDE the note is dropped — Rule 5, a guard's reach is bounded by the thing it guards"
    );
  }

  // ==========================================================================
  // 4. REVERSE — without the note bound, the same out-of-note text passes.
  //    Proves the bound is what rejected it, not the literal match.
  // ==========================================================================
  {
    const rows: NoteRetirementRow[] = [
      { instrument: "Phantom Notes due 2099", amount: "$999 million", eventDate: null, dateGranularity: null,
        sourceLine: "The Company repurchased $999 million of its 9.999% Phantom Notes due 2099." },
    ];
    const unbounded = verifyEventInstances(
      rows.map((r) => ({ description: r.instrument, amount: r.amount, eventDate: null, dateGranularity: null, eventStatus: "completed" as const, sourceLine: r.sourceLine })),
      [URL], textByUrl, silent, "control"
    );
    assert(
      unbounded.length === 1,
      "[4a] REVERSE: the same text passes the UNBOUNDED walk — so [3c] rejected it for being outside the note, not for failing the literal match"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  } else {
    console.log("\nALL INSTANCE-VERIFICATION TESTS PASSED");
  }
}

main();
