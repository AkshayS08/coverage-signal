/**
 * SESSION 21, STAGE 4 — THE TWO RULES, PINNED.
 *
 * (A) AN EVENT WITH NO AMOUNT IN ITS OWN CONFIRMING FILING renders with its
 *     date, its source, and the words "amount not stated in the confirming
 *     filing", and nets nothing.
 *
 * (B) A ROW THE NOTE'S OWN SUBTOTAL NEVER COUNTS stays a row and states its
 *     exclusion on the surface.
 *
 * UHS is the named example for (A) and DaVita for (B), and NEITHER is used
 * as the fixture here. Both rules are pinned on shapes, because a suite
 * built on the instance proves only that the instance was fixed — the same
 * separation proseNoteRouting.test.ts makes with "Meridian Health Partners".
 * The live book is asserted separately, on what is actually there rather
 * than on what the brief expected.
 *
 * Run: npx tsx lib/events/unsizedEvent.test.ts
 */
import { buildTier2 } from "./tier2";
import { parseMoneyAmount, rowsOutsideSubtotal } from "./position";
import type { LadderRow } from "./position";
import type { VerifiedSequenceEntry } from "../agent/loop";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const ANCHOR = { form: "10-Q", date: "2026-08-07", reportDate: "2026-06-30", url: "https://sec.gov/anchor.htm" };
const row = (o: Partial<LadderRow>): LadderRow =>
  ({ instrument: "x", rate: null, seniority: null, amount: "$100 million", maturityDate: null, dateGranularity: null,
     sourceLine: "s", citedUrl: "u", id: "i", status: "live", provenance: "note", ...o } as LadderRow);

/** The exact words the surface owes a reader. Asserted as a literal, not paraphrased. */
const UNSIZED = "amount not stated in the confirming filing";

console.log("\n=== [1] A CONFIRMED REPAYMENT WITH NO AMOUNT IN ITS OWN FILING ===");
{
  const t = buildTier2({
    anchor: ANCHOR,
    anchorCapturedFace: 4_741_000_000,
    postAnchorIssuances: [],
    maturedUnconfirmed: [],
    confirmedRepayments: [{
      instrument: "revolving credit facility",
      amount: null,
      date: "2026-08-21",
      sourceLine: "the Issuer repaid the outstanding borrowings under its revolving credit facility",
      citedUrl: "https://sec.gov/8k.htm",
    }],
    parseAmount: parseMoneyAmount,
  });
  const e = t.events[0];
  assert(t.events.length === 1 && e.kind === "repayment",
    "[1a] IT RENDERS. An event whose amount its filing does not state is still an event, and dropping it would hide a real movement behind a missing figure");
  assert(e.date === "2026-08-21" && e.citedUrl === "https://sec.gov/8k.htm" && e.sourceLine.length > 0,
    "[1b] with its date, its source filing, and the verbatim sentence that confirms it");
  assert(e.note.includes(UNSIZED),
    `[1c] and the gap stated in those words on the surface — "${UNSIZED}" — not left for a reader to infer from a blank (${e.note})`);
  assert(e.effect === null && e.nets === "unsized",
    "[1d] IT NETS NOTHING. The confirmation is established; the size is not, and the only figure available lives in a filing that does not state this repayment");
  assert(t.rolledTotal === 4_741_000_000,
    `[1e] so the rolled total is the anchor position UNMOVED — never reduced by a figure joined across filings (got ${t.rolledTotal})`);
  assert((t.rolledLabel ?? "").includes("EXCLUDES 1 whose confirming filing states no amount"),
    `[1f] and the total NAMES what it left out. A roll-forward that silently omits a real event reads as complete when it is not (${t.rolledLabel})`);
}

console.log("\n=== [2] The same rule on an issuance — it is about the amount, not the direction ===");
{
  const t = buildTier2({
    anchor: ANCHOR, anchorCapturedFace: 1_000_000_000,
    postAnchorIssuances: [row({ instrument: "senior notes", amount: "an unstated amount",
      issuedOn: { date: "2026-08-21", citedUrl: "https://sec.gov/8k.htm" }, provenance: "pricing-8-K" })],
    maturedUnconfirmed: [], confirmedRepayments: [], parseAmount: parseMoneyAmount,
  });
  assert(t.events[0].effect === null && t.events[0].nets === "unsized" && t.events[0].note.includes(UNSIZED),
    "[2a] an issuance with no readable amount ADDS NOTHING and says why — the old wording claimed it 'ADDS an unstated amount', which describes an arithmetic that did not happen");
  assert(t.rolledTotal === 1_000_000_000, `[2b] the position is unmoved in this direction too (got ${t.rolledTotal})`);
}

console.log("\n=== [3] UNSIZED AND UNCONFIRMED ARE DIFFERENT REASONS, AND BOTH ARE SAID ===");
{
  const t = buildTier2({
    anchor: ANCHOR, anchorCapturedFace: 1_000_000_000,
    postAnchorIssuances: [], maturedUnconfirmed: [],
    confirmedRepayments: [{ instrument: "a", amount: null, date: "2026-08-21", sourceLine: "s", citedUrl: "u" }],
    pendingIntentions: [{ instrument: "b", amount: null, date: "2026-08-21", sourceLine: "s2", citedUrl: "u2" }],
    parseAmount: parseMoneyAmount,
  });
  const rep = t.events.find((e) => e.kind === "repayment")!;
  const pend = t.events.find((e) => e.kind === "pending")!;
  assert(rep.nets === "unsized" && pend.nets === "unconfirmed",
    "[3a] the repayment nets zero because we do not know HOW MUCH; the intention nets zero because we do not know THAT IT HAPPENED. Collapsing them into one 'didn't count' state would hide which filing is needed to resolve it");
  assert(pend.note.includes(UNSIZED),
    `[3b] an intention that is ALSO unsized still says so — 'unconfirmed' binds the arithmetic, it does not excuse the surface from stating the second gap (${pend.note})`);
  assert((t.rolledLabel ?? "").includes("1 whose confirming filing states no amount") &&
         (t.rolledLabel ?? "").includes("1 that no filing confirms as done"),
    `[3c] and the rolled total counts them SEPARATELY (${t.rolledLabel})`);
}

console.log("\n=== [4] A sized event is untouched — this rule fires on absence, never on presence ===");
{
  const t = buildTier2({
    anchor: ANCHOR, anchorCapturedFace: 1_000_000_000,
    postAnchorIssuances: [], maturedUnconfirmed: [],
    confirmedRepayments: [{ instrument: "a", amount: 225_000_000, date: "2026-08-21", sourceLine: "s", citedUrl: "u" }],
    parseAmount: parseMoneyAmount,
  });
  assert(t.events[0].effect === -225_000_000 && t.events[0].nets === null && !t.events[0].note.includes(UNSIZED),
    "[4a] a repayment its own filing sizes still subtracts, and carries no unsized language");
  assert(t.rolledTotal === 775_000_000 && !(t.rolledLabel ?? "").includes("EXCLUDES"),
    `[4b] and the rolled total excludes nothing, so it says nothing about exclusions (got ${t.rolledTotal} / ${t.rolledLabel})`);
}

// ============================================================================
// (B) A ROW THE NOTE'S OWN SUBTOTAL NEVER COUNTS
// ============================================================================

const seq = (o: { kind: string; label: string; amount: string; section?: string | null }): VerifiedSequenceEntry =>
  ({ section: null, sourceLine: "s", periodColumn: null, ...o } as unknown as VerifiedSequenceEntry);

console.log("\n=== [5] The shape the rule exists for: a row after the last subtotal ===");
{
  const out = rowsOutsideSubtotal([
    seq({ kind: "row", label: "Term Loan A", amount: "$1,000 million" }),
    seq({ kind: "row", label: "Senior Notes", amount: "$2,000 million" }),
    seq({ kind: "subtotal", label: "Total debt", amount: "$3,000 million" }),
    seq({ kind: "row", label: "Financing lease obligations", amount: "$160 million" }),
  ]);
  assert(out.length === 1 && out[0].label === "Financing lease obligations",
    `[5a] the trailing row is REPORTED. Check 1 ties at $3,000M and says nothing about it — a row nothing checks is the exact failure a passing walk cannot see (got ${out.length})`);
  assert(out[0].why.includes("vouched for by nothing"),
    `[5b] with the reason stated on the surface, not left as a bare flag (${out[0].why})`);
  assert(out[0].amount === "$160 million",
    "[5c] and it keeps its amount, because the rule leaves it a ROW — it stays in the ladder and in coverage, with its exclusion stated, never relocated to prose where the walk could no longer see it");
}

console.log("\n=== [6] A section nothing ever closes ===");
{
  const out = rowsOutsideSubtotal([
    seq({ kind: "row", label: "Term Loan", amount: "$1,000 million", section: "Credit Facilities" }),
    seq({ kind: "subtotal", label: "Total credit facilities", amount: "$1,000 million", section: "Credit Facilities" }),
    seq({ kind: "row", label: "Other notes", amount: "$50 million", section: "Other" }),
  ]);
  assert(out.length === 1 && out[0].section === "Other",
    `[6a] a row in a section no later subtotal closes, and no rollup follows — reported (got ${JSON.stringify(out.map((r) => r.section))})`);
  assert(out[0].why.includes("Other"),
    `[6b] and the line NAMES the section, so a reader can find it in the filing (${out[0].why})`);
}

console.log("\n=== [7] What must NOT be reported — the ordinary conventions every filer uses ===");
{
  const rollup = rowsOutsideSubtotal([
    seq({ kind: "row", label: "Term Loan", amount: "$1,000 million", section: "Credit Facilities" }),
    seq({ kind: "row", label: "Senior Notes", amount: "$2,000 million", section: "Notes" }),
    seq({ kind: "subtotal", label: "Total debt", amount: "$3,000 million" }),
  ]);
  assert(rollup.length === 0,
    `[7a] a section-null ROLLUP folds every still-open section before it checks, so it covers both rows — this is the shape nine of ten real ladders have, and flagging it would flag the book (got ${rollup.length})`);

  const currentPortion = rowsOutsideSubtotal([
    seq({ kind: "row", label: "Senior Notes", amount: "$3,000 million" }),
    seq({ kind: "subtotal", label: "Total debt", amount: "$3,000 million" }),
    seq({ kind: "adjustment", label: "Less current portion", amount: "$(117) million" }),
  ]);
  assert(currentPortion.length === 0,
    "[7b] an ADJUSTMENT after the final subtotal is the current-portion split — deliberately outside the total it modifies. DaVita, Encompass and Quest all print one, and only `row` entries are reported");

  assert(rowsOutsideSubtotal([]).length === 0 && rowsOutsideSubtotal(undefined).length === 0,
    "[7c] a filer with no ladder at all reports nothing here — its problem is that it has no ladder, and Cigna's empty-with-reason line already says so");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
