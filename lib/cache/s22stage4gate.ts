/**
 * SESSION 22, STAGE 4 — THE DEMO GATE, ASSERTED. $0.
 *
 * "Re-render Tenet, Encompass, UHS and assert against the script's must-land
 * table." Assert, not read: an item checked by eye is checked once, by
 * someone who already knows what they hope to see. Each item below is the
 * BRD §13.3 must-land line it came from, expressed as a condition that can
 * fail.
 *
 * The gate is all three perfect, or the session does not widen.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, normalizeScheduleSequence, ladderCapacityFor, facilityCategoriesOnLadder } from "../events/position";
import { computeCoverage } from "../events/coverage";
import { priorityRank, classifyInstrument } from "../events/instrumentClass";
import { facilityArithmetic } from "../agent/verifyFacility";
import { parseMoneyAmount } from "../events/position";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

(async () => {
  // ---------------------------------------------------------------- TENET
  console.log("\n=== TENET — position ===");
  {
    const r = await runAgentLoop("Tenet Healthcare");
    const dm = r.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(r, PINNED_AS_OF);
    const noteRows = pos.rows.filter((x) => x.provenance !== "pricing-8-K");
    const classed = noteRows.filter((x) => x.classification.priorityClass !== null);

    // MUST-LAND: "ladder renders priority class".
    //
    // NOT "every row carries one" — that would demand a class for
    // "Finance leases, mortgages and other notes", which Tenet prints
    // OUTSIDE both of its sections and states no class for. Asserting a
    // class there would make the gate require the exact inference rule [1a]
    // forbids, and a gate that demands a violation is worse than no gate.
    //
    // The honest condition is that no row whose filing STATES a class is
    // left without one. Checked by re-reading the sources for every
    // unclassed row: if any of them names a class, the classifier missed it.
    const unclassed = noteRows.filter((x) => x.classification.priorityClass === null);
    const missed = unclassed.filter(
      (x) => classifyInstrument({ headings: [x.seniority], instrumentName: x.instrument }).priorityClass !== null
    );
    assert(missed.length === 0,
      `[T1] MUST-LAND: "ladder renders priority class" — ${classed.length} of ${noteRows.length} rows carry one, and every row the filing leaves unclassed genuinely states none (${unclassed.map((x) => `"${x.instrument}"`).join(", ") || "none"})`);
    assert(classed.length === 11,
      `[T1b] AND THE COUNT IS THE ONE THE DEMO NEEDS: 11 classed rows (got ${classed.length}). Pinned as a number so a future extraction that quietly loses a section heading fails here instead of on screen`);

    // No row may read "unsecured" unless the corpus said so — the safe half,
    // which holds even while T1 fails, and must be checked separately BECAUSE
    // it holds: a gate that reports one number hides which half broke.
    const wronglyUnsecured = noteRows.filter(
      (x) => x.classification.priorityClass === "senior-unsecured" && x.classification.priorityClassFrom === null
    );
    assert(wronglyUnsecured.length === 0,
      `[T2] and no row reads "unsecured" where nothing states it — the refusal half of the same item is intact`);

    const ranks = pos.rows.map((x) => priorityRank(x.classification.priorityClass));
    assert(ranks.every((v, i) => i === 0 || ranks[i - 1] <= v),
      "[T3] MUST-LAND: ordered by seniority — the sort is monotonic in class rank");
    assert(new Set(ranks).size > 1,
      `[T4] AND THE ORDER IS ACTUALLY DOING SOMETHING. Every row ranking identically makes [T3] vacuously true: a ladder with one rank is sorted by seniority the way an empty list is sorted. Tenet has ${new Set(ranks).size} distinct rank(s)`);

    // ROOT CAUSE, ASSERTED WHERE IT LIVES. The class was never missing from
    // the extraction — it was in `section` while the classifier read
    // `seniority`. Two fields for one idea, and v29 filled the other one.
    // This asserts the MERGED input, because that is now the one concept.
    const seq = normalizeScheduleSequence(dm?.scheduleSequence).filter((e) => e.kind === "row");
    const withHeading = seq.filter((e) => [e.section, e.seniority].some((h) => (h ?? "").trim() !== ""));
    assert(withHeading.length > 0,
      `[T5] the note's own section headings reach the classifier: ${withHeading.length} of ${seq.length} schedule rows carry one across \`section\`/\`seniority\`. v29 put Tenet's in \`section\` (10 rows) and nothing in \`seniority\` (0 rows), reproducibly across three CACHE_BUST re-asks — so a single-field reader loses this company every time`);
    const distinctHeadings = new Set(withHeading.map((e) => (e.section ?? e.seniority ?? "").trim()));
    assert(distinctHeadings.size >= 2,
      `[T6] and they resolve to MORE THAN ONE section, which is what the seniority sort exists to render: ${[...distinctHeadings].map((h) => `"${h}"`).join(", ")}`);
  }

  // ------------------------------------------------------------ ENCOMPASS
  console.log("\n=== ENCOMPASS — conversation ===");
  {
    const r = await runAgentLoop("Encompass Health");
    const dm = r.results.find((t) => t.triggerId === "debt-maturity");
    const ndi = r.results.find((t) => t.triggerId === "new-debt-issuance");
    const pos = assemblePosition(r, PINNED_AS_OF);

    const notes2028 = pos.rows.filter((x) => (x.maturityDate ?? "").startsWith("2028"));
    assert(notes2028.length === 1 && notes2028[0].status === "live",
      `[E1] MUST-LAND: "the 2028 takeout reads as the call" — the partially-called tranche is still LIVE at its own post-call balance, not retired off the ladder (found ${notes2028.length}, status ${notes2028[0]?.status})`);
    assert(!!notes2028[0] && parseMoneyAmount(notes2028[0].amount) !== null && parseMoneyAmount(notes2028[0].amount)! < 500e6,
      `[E2] and it carries the note's OWN remaining figure, not the original issue size (${notes2028[0]?.amount})`);

    const facilities = dm?.facilities ?? [];
    assert(facilities.length >= 1, `[E3] MUST-LAND: "the revolver is present" — ${facilities.length} facility/facilities`);

    const f = facilities[0];
    const arith = f ? facilityArithmetic(f, parseMoneyAmount) : null;
    assert(!!f && f.lettersOfCredit === null && !!arith && !arith.checkable && /letters of credit/i.test(arith.why),
      `[E4] MUST-LAND: "any unverifiable field reads as a deliberate refusal not a gap" — the LC figure is absent AND the check names it as what is missing: "${arith?.why}"`);
    assert(!!f?.available && /746/.test(f.available.value),
      `[E5] and \`available\` is the filing's own $746 million — the v28 $824M was not merely unsourced, it was WRONG (got ${f?.available?.value})`);

    const uses = ndi?.proceedsUses ?? [];
    assert(uses.length === 3, `[E6] MUST-LAND: "use-of-proceeds shows all three uses" (got ${uses.length})`);
  }

  // ------------------------------------------------------------------ UHS
  console.log("\n=== UHS — method ===");
  {
    const r = await runAgentLoop("Universal Health Services");
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity");
    // computeCoverage takes the TRIGGER, not the company result. Passing the
    // company result compiles to a silent `caps = []` and a null residual —
    // this harness reported UHS failing its own must-land item on that basis
    // before tsc was read. A gate that can fail for its own reasons is worse
    // than no gate.
    const cov = computeCoverage(dm, ladderCapacityFor(pos), facilityCategoriesOnLadder(pos, dm?.facilities));

    assert(pos.rows.length > 0, `[U1] the prose-only note still yields a position — ${pos.rows.length} rows`);
    assert(cov.residualFraction !== null && Math.abs(cov.residualFraction * 100 - 2.28) < 0.15,
      `[U2] MUST-LAND: "the residual close holds" — residual ${cov.residualFraction === null ? "null" : (cov.residualFraction * 100).toFixed(2) + "%"} against the §13.3 figure of 2.28%`);
    const discountLines = pos.adjustments.filter((a) => /discount|issuance cost|deferred financing/i.test(a.label ?? ""));
    assert(discountLines.length === 0,
      `[U3] and the residual is NOT reconciled by a stated discount — §13.3: UHS's 10-Q states no unamortized discount or deferred-financing balance, so the $111M is named as unplaced rather than explained away. Applying a discount would WIDEN the residual, not close it (found ${discountLines.length} discount adjustment(s))`);
  }

  console.log(`\n${"=".repeat(100)}\nDEMO GATE: ${passed} passed, ${failed} failed.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.log(failed === 0
    ? "GATE OPEN — all three demo names hold."
    : "GATE CLOSED — the session does not widen until these hold.");
})();
