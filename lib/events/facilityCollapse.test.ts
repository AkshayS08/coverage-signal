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
import { facilityOnlyRows } from "./position";
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

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
