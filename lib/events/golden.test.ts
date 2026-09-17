/**
 * SESSION 21, STAGE 6 — THE GOLDEN CHECK.
 *
 * A run whose filing set matches a golden file's must reproduce it, and any
 * divergence fails BY NAME.
 *
 * This is offline and needs no network and no model: each golden file carries
 * the CompanyResult it was signed from, so the suite re-derives the state
 * from that captured input and compares it to the signed one. That makes it a
 * regression test on the DERIVATION — position assembly, coverage, Tier 2,
 * the derived lines — which is the layer that actually changes between
 * sessions. A live run's own filing set is checked against the same files in
 * the live acceptance path.
 *
 * The comparator's own behaviour is pinned here too, on synthetic
 * divergences, because a comparator that reports "something changed" is worse
 * than none: nobody acts on it, and after two of those the failures get
 * ignored.
 *
 * Run: npx tsx lib/events/golden.test.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { compareToGolden, deriveGoldenState, filingSetOf, type GoldenFile, type GoldenState } from "./golden";
import { EXTRACTION_PROMPT_VERSION } from "../cache/promptVersion";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");

console.log("\n=== [1] EVERY SIGNED GOLDEN FILE REPRODUCES FROM ITS OWN CAPTURED INPUT ===");
{
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];
  assert(files.length > 0,
    `[1a] there is at least one signed golden file (found ${files.length} in baselines/golden). A suite that silently passes on an empty directory proves nothing`);

  for (const f of files) {
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as GoldenFile;
    const name = golden.state.company;

    assert(!!golden.signature?.signedBy && golden.signature.signedBy !== "(unnamed)" && !!golden.signature.basis,
      `[1b:${name}] carries a signature with a named signer and a stated basis — an unsigned pin is a snapshot, not a golden file`);

    // A CAPTURED INPUT FROM AN OLDER SCHEMA IS NOT A DIVERGENCE.
    //
    // The file pins a derivation over a captured CompanyResult. When the
    // EXTRACTION schema moves, the same bytes answer a different question —
    // v28 carries one `revolver`, v29 reads a `facilities` array — and
    // comparing across that boundary reports a difference that no fix
    // addresses. Same disposition as a moved filing set (Rule 30): the pin
    // does not apply, say so, and re-sign against the new capture.
    if ((golden.extractionVersion ?? 0) !== EXTRACTION_PROMPT_VERSION) {
      console.log(`  — SKIPPED [1c:${name}] — captured at extraction v${golden.extractionVersion ?? "(unrecorded)"}, code is v${EXTRACTION_PROMPT_VERSION}. The pin does not apply across a schema change; re-sign against a v${EXTRACTION_PROMPT_VERSION} capture.`);
    } else {
      const actual = deriveGoldenState(golden.sourceResult, new Date(`${golden.state.asOf}T00:00:00Z`));
      const verdict = compareToGolden(golden.state, actual);
      assert(verdict.kind === "matches",
        `[1c:${name}] REPRODUCES EXACTLY from its captured input${verdict.kind === "diverged" ? ` — DIVERGED:\n      ${verdict.divergences.join("\n      ")}` : verdict.kind === "not-applicable" ? ` — ${verdict.reason}` : ""}`);
    }

    assert(golden.state.filingSet.length > 0 && filingSetOf(golden.sourceResult).join("|") === golden.state.filingSet.join("|"),
      `[1d:${name}] the pinned filing set is the one its captured result was actually built from`);
  }
}

// ---------------------------------------------------------------------------
// The comparator itself, on synthetic states.
// ---------------------------------------------------------------------------

const base = (): GoldenState => ({
  company: "Meridian Health Partners", cik: "1",
  anchor: { form: "10-Q", date: "2026-08-07", reportDate: "2026-06-30", url: "https://sec.gov/a.htm" },
  filingSet: ["https://sec.gov/a.htm", "https://sec.gov/b.htm"],
  asOf: "2026-09-04",
  rows: [
    { instrument: "4.50% Notes due 2028", amount: "$396.9 million", maturityDate: "2028-02-01", dateGranularity: "day",
      status: "live", provenance: "note", isCapacity: false, sourceLine: "4.50 % Notes due 2028 396.9" },
    { instrument: "revolver", amount: "$1.0 billion", maturityDate: null, dateGranularity: null,
      status: "live", provenance: "note-narrative", isCapacity: true, sourceLine: "revolver 1.0" },
  ],
  coverage: { denominatorSource: "xbrl", statedTotalDebt: 2634000000, capturedFace: 2634000000, statedBridge: 0, residualPercent: 0, residualPasses: true },
  tier2: [],
  rowsOutsideSubtotal: 0,
  cards: [{ triggerId: "debt-maturity", bucket: "refi", headlineRowId: "r1",
    derived: [{ kind: "months-to-maturity", text: "17 months out — matures 2028-02-01.", computed: "17 months", inputs: ["4.50 % Notes due 2028 396.9"], fieldInputs: [] }],
    withheld: [] }],
});

console.log("\n=== [2] A MOVED FILING SET IS NOT A FAILURE — the pin no longer applies ===");
{
  const a = base();
  a.filingSet = [...a.filingSet, "https://sec.gov/new8k.htm"];
  a.rows[0].amount = "$0";
  const v = compareToGolden(base(), a);
  assert(v.kind === "not-applicable" && v.added.includes("https://sec.gov/new8k.htm"),
    `[2a] a new 8-K on EDGAR returns NOT-APPLICABLE and names the document, even though the ladder also changed. A golden file claims "same documents in, same answer out" and makes no claim about a different corpus (${v.kind})`);
  assert(v.kind === "not-applicable" && v.reason.includes("re-signed"),
    "[2b] and it says what to do — re-sign against the new corpus, never compare against it. A stale pin must read as stale rather than as red");

  const b = base();
  b.filingSet = ["https://sec.gov/a.htm"];
  const v2 = compareToGolden(base(), b);
  assert(v2.kind === "not-applicable" && v2.removed.includes("https://sec.gov/b.htm"),
    "[2c] a document that has disappeared from the corpus is reported the same way, and named");
}

console.log("\n=== [3] DIVERGENCE FAILS BY NAME ===");
{
  const a = base();
  a.rows[0].amount = "$792.0 million";
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes('rows["4.50% Notes due 2028"].amount') && x.includes("$396.9 million") && x.includes("$792.0 million")),
    `[3a] a changed amount names the ROW, the FIELD, the expected value and the actual one — "the ladder changed" is not actionable (${JSON.stringify((v as { divergences: string[] }).divergences)})`);
}
{
  const a = base();
  a.rows = [a.rows[1]];
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes('rows["4.50% Notes due 2028"]: MISSING')),
    "[3b] a row that vanished is named as MISSING, not counted away — a dropped tranche is the failure this whole project exists to catch");
}
{
  const a = base();
  a.rows.push({ instrument: "surprise notes", amount: "$1", maturityDate: null, dateGranularity: null, status: "live", provenance: "note", isCapacity: false, sourceLine: "s" });
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes('rows["surprise notes"]: UNEXPECTED')),
    "[3c] REVERSE: a row that appeared is named too. A pin holds in both directions, or it only catches shrinkage");
}
{
  const a = base();
  a.coverage.denominatorSource = "model-read";
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes("coverage.denominatorSource")),
    "[3d] a denominator that silently changed provenance diverges — the figure can be identical and the claim behind it different, which is the Cigna case that forced FactsOutcome");
}
{
  const a = base();
  a.cards[0].derived[0].text = "18 months out — matures 2028-02-01.";
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes('derived["months-to-maturity"].text')),
    "[3e] a derived line whose arithmetic moved diverges by kind — the lines are part of the signed state, not decoration on it");
}
{
  const a = base();
  a.cards[0].withheld = [{ kind: "liquidity", unverified: ["$824 million"] }];
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes("withheld")),
    "[3f] AND SO DOES A NEWLY WITHHELD LINE. A line the guard starts rejecting is a change in what the tool can support, and a pin that ignored it would go green while the output quietly lost a line");
}
{
  const a = base();
  a.tier2 = [{ kind: "issuance", date: "2026-08-21", effect: 600000000, nets: null, instrument: "x" }];
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes("tier2.count")),
    "[3g] a Tier 2 event appearing against an unchanged filing set diverges — with the same documents in, there is nothing new for it to have come from");
}

console.log("\n=== [4] An unchanged state matches, and matching is the only silent outcome ===");
{
  assert(compareToGolden(base(), base()).kind === "matches",
    "[4a] identical states match");
  const a = base();
  a.asOf = "2026-10-01";
  const v = compareToGolden(base(), a);
  assert(v.kind === "diverged" && v.divergences.some((x) => x.includes("asOf")),
    "[4b] even the as-of date is pinned — every month count in the state was measured against it, so a state compared at a different clock is not the same state");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }

// ===========================================================================
// THE NINE CRITERIA, ASSERTED BY NAME.
//
// A golden file is written only when all nine hold. Each is asserted here by
// its own id, on a fixture built to fail exactly that one — because a suite
// that only ever sees a passing state proves the criteria are present, not
// that any of them bites.
// ===========================================================================
import { evaluateGoldenCriteria } from "./goldenCriteria";
import type { CompanyResult } from "../agent";

const byId = (r: ReturnType<typeof evaluateGoldenCriteria>, id: string) => r.criteria.find((c) => c.id === id)!;

console.log("\n=== [5] THE NINE CRITERIA — each asserted by name, on the signed UHS file ===");
{
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];
  for (const f of files) {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as GoldenFile & { criteria?: unknown };
    const name = g.state.company;
    // Same boundary as [1c]: criteria are EVALUATED over the captured input,
    // so a capture from an older extraction schema is being asked a question
    // it was not built to answer. Skipped and named, never reported as a
    // criterion that stopped holding.
    if ((g.extractionVersion ?? 0) !== EXTRACTION_PROMPT_VERSION) {
      console.log(`  — SKIPPED [5:${name}] — captured at extraction v${g.extractionVersion ?? "(unrecorded)"}, code is v${EXTRACTION_PROMPT_VERSION}`);
      continue;
    }
    const att = (g as { attestation?: { rowsCorrect?: boolean; instrumentTypeFaithful?: boolean; reproducedThreeTimes?: boolean; by?: string; on?: string } }).attestation ?? {};
    const r = evaluateGoldenCriteria(g.sourceResult, new Date(`${g.state.asOf}T00:00:00Z`), att);

    assert(r.criteria.length === 12 && ["1","2","3","4","5","6","7","8a","8b","8c","9a","9b"].every((id) => r.criteria.some((c) => c.id === id)),
      `[5a:${name}] all nine criteria are evaluated, with 8 and 9 split into their separable parts (got ${r.criteria.map((c) => c.id).join(",")})`);

    assert(r.criteria.every((c) => c.defends.length > 0),
      "[5b] every criterion names the failure it defends against — the list is nine real defects, not a generic checklist");

    assert(r.criteria.filter((c) => c.kind === "attested").map((c) => c.id).join(",") === "1,8c,9b",
      `[5c] criteria 1, 8c and 9b are ATTESTED, not computed. The tool comparing its own output to itself proves nothing about whether it matches a filing, and claiming otherwise on the one artifact meant to carry confidence is worse than claiming nothing (got ${r.criteria.filter((c) => c.kind === "attested").map((c) => c.id).join(",")})`);

    assert(!r.allHold || r.criteria.every((c) => c.pass === true),
      `[5d:${name}] allHold is true ONLY when every criterion passes — a golden file with an unmet criterion is not a golden file under its own definition`);

    // The amendment's positive half, on whichever signed file is prose-only.
    const c4 = r.criteria.find((c) => c.id === "4")!;
    if (c4.detail.includes("prints NO subtotal")) {
      assert(c4.pass === true && c4.detail.includes("TRIANGULATES"),
        `[5e:${name}] A PROSE-ONLY NOTE SATISFIES CRITERION 4 BY TRIANGULATION — its balance-sheet captions against the filer's own XBRL tag. That is a stronger tie than a subtotal, not a weaker one: a subtotal is the note checked against itself, triangulation is two independent statements by the filer agreeing (${c4.detail})`);
    }

    assert(Array.isArray((g as { criteria?: unknown }).criteria) && ((g as { criteria: unknown[] }).criteria).length === 12,
      `[5f:${name}] the file CARRIES ITS OWN NINE CRITERIA as evaluated at signing, so a later reader need not re-derive why this state was pinnable, and an amended criterion is visible in the wording recorded`);
  }
}

console.log("\n=== [6] Each criterion bites — a fixture built to fail exactly one ===");
{
  const empty = { company: "Meridian", cik: "1", results: [] } as unknown as CompanyResult;
  const r = evaluateGoldenCriteria(empty, new Date("2026-09-06T00:00:00Z"));

  assert(byId(r, "1").pass === null && byId(r, "1").kind === "attested",
    "[6a] criterion 1 with no attestation is NULL, never a silent pass — an unchecked ladder must not read as a checked one");
  assert(byId(r, "3").pass === false && byId(r, "3").detail.includes("no anchor"),
    "[6c] criterion 3 fails with no anchor to cite against — defends against one position assembled from three filings and three dates");
  assert(byId(r, "4").pass === false && byId(r, "4").detail.includes("prints NO subtotal") && byId(r, "4").detail.includes("DOES NOT TRIANGULATE"),
    `[6d] criterion 4, AS AMENDED: with no subtotals the triangulation test applies, and with nothing to triangulate against it fails and says which half failed. As first written this criterion read "the note's own subtotals tie", which permanently excluded every prose-only filer including the one already signed — a criterion that can never hold for a shape that really exists is not strict, it is blind to that shape (${byId(r, "4").detail})`);
  assert(byId(r, "5").pass === false && byId(r, "5").detail.includes("no denominator"),
    "[6e] criterion 5 fails when there is no denominator at all — a coverage percentage whose denominator nobody could name");
  assert(byId(r, "8a").pass === false,
    "[6f] criterion 8a fails with no per-instrument rows — an aggregate disclosure must not be pinned as though it were a tranche ladder");
  assert(byId(r, "9b").pass === null,
    "[6g] criterion 9b is NULL until three independent re-asks are attested. Warm re-runs prove the pipeline is deterministic and say nothing about the model — Rule 23, learned when a hand-verified 98% did not survive the next extraction");
  assert(r.allHold === false && r.failing.length > 0,
    `[6h] and the whole thing does not hold, naming what failed (${r.failing.join(" | ")})`);
}

console.log("\n=== [7] AN AMOUNT IS COMPARED BY VALUE AND UNIT, NOT BY ITS WHITESPACE ===");
{
  const spaced = base();
  spaced.rows[0].amount = "$ 396.9 million";
  const tight = base();
  tight.rows[0].amount = "$396.9 million";
  const v = compareToGolden(spaced, tight);
  assert(v.kind === "matches",
    `[7a] WHITESPACE IS NOT A TRANSCRIPTION. "$ 396.9 million" and "$396.9 million" are the same figure with a space moved, and string equality called that a divergence — which blocks a signature over nothing and trains its reader to wave divergences through, the one thing a signature surface must never do (${v.kind === "diverged" ? v.divergences.join(" | ") : v.kind})`);

  const comma = base();
  comma.rows[0].amount = "$ 1,500 million";
  const noComma = base();
  noComma.rows[0].amount = "$1500 million";
  assert(compareToGolden(comma, noComma).kind === "matches",
    "[7b] and grouping commas are not a transcription either — same value, same unit");

  // THE UNIT IS THE HALF THAT KEEPS THIS HONEST.
  const billions = base();
  billions.rows[0].amount = "$1.5 billion";
  const millions = base();
  millions.rows[0].amount = "$1,500 million";
  const unitMoved = compareToGolden(billions, millions);
  assert(unitMoved.kind === "diverged",
    `[7c] BUT A CHANGED UNIT IS A CHANGED TRANSCRIPTION, even at the same value. "$1.5 billion" and "$1,500 million" are the same money; the filing printed ONE of them, and a run that starts printing the other has changed what it read. Comparing by value alone would have passed this (${unitMoved.kind})`);

  const moved = base();
  moved.rows[0].amount = "$ 396.9 million";
  const wrong = base();
  wrong.rows[0].amount = "$ 386.9 million";
  assert(compareToGolden(moved, wrong).kind === "diverged",
    "[7d] and a changed digit still diverges — the tolerance is for whitespace, never for a figure");

  const stated = base();
  stated.rows[0].amount = "(no amount stated)";
  const alsoStated = base();
  alsoStated.rows[0].amount = "(no amount stated)";
  assert(compareToGolden(stated, alsoStated).kind === "matches",
    "[7e] a non-numeric amount falls back to exact comparison and still matches itself");
  const unparseable = base();
  unparseable.rows[0].amount = "(no amount stated)";
  const parseable = base();
  parseable.rows[0].amount = "$ 396.9 million";
  assert(compareToGolden(unparseable, parseable).kind === "diverged",
    "[7f] AND A COMPARISON THAT CANNOT READ ITS INPUTS NEVER REPORTS THEM EQUAL — one side unparseable falls back to exact string comparison rather than defaulting to a pass");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
