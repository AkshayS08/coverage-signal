/**
 * SESSION 20 (1c) — the review queue.
 *
 * Run: npx tsx lib/events/flaggedItems.test.ts
 */
import { buildFlaggedItemsPage, flagsForCompany } from "./flaggedItems";
import type { CompanyTableBlock } from "./portfolioTable";
import type { CompanyResult } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

function block(over: Partial<CompanyTableBlock> = {}): CompanyTableBlock {
  return {
    company: "Synthetic Co", cik: "1", ticker: "SYN", cardCount: 1,
    headerLine: "1 card this week", emptyStateLine: null,
    buckets: { treasury: [], new_debt: [], refi: [], hedging: [] },
    refiLadder: { hasData: true, walkCheck: { pass: true }, balanceSheetCheck: { pass: true },
      completenessStatement: "ties", rowsNotVerifiedAsTranscribed: false } as never,
    relationshipFlags: [], triggersRun: 15, triggersNoSignalCount: 8, ...over,
  } as CompanyTableBlock;
}
function result(over: Record<string, unknown> = {}): CompanyResult {
  return { company: "Synthetic Co", cik: "1", ticker: "SYN",
    results: [{ triggerId: "debt-maturity", fired: true, scheduleSequence: [{ kind: "row" }], columnReadFailure: false }],
    verdict: null, relationshipFlags: [], ...over } as unknown as CompanyResult;
}

console.log("\n=== [1] A clean company contributes nothing ===");
{
  assert(flagsForCompany(block(), result()).length === 0,
    "[1a] a book with every check resolved produces an empty queue, not a queue of reassurances");
}

console.log("\n=== [2] Each failing check is its own flag ===");
{
  const f = flagsForCompany(block({
    refiLadder: { hasData: true, walkCheck: { pass: false }, balanceSheetCheck: { pass: false },
      completenessStatement: "walk does not tie — $320M", rowsNotVerifiedAsTranscribed: false } as never,
  }), result());
  const kinds = f.map((x) => x.kind);
  assert(kinds.includes("walk-does-not-tie") && kinds.includes("anchor-does-not-tie"),
    "[2a] Check 1 and Check 2 are SEPARATE flags — they are reported separately everywhere else and must not merge here");
  assert(f.every((x) => x.why.length > 0 && x.where.length > 0),
    "[2b] every flag carries its reason and where to look — a queue entry without both is not actionable");
}

console.log("\n=== [3] An untranscribed ladder outranks its own walk failure ===");
{
  const f = flagsForCompany(block({
    refiLadder: { hasData: true, walkCheck: { pass: false }, balanceSheetCheck: { pass: true },
      completenessStatement: "TRANSCRIPTION NOT VERIFIED — rows sum 62% short",
      rowsNotVerifiedAsTranscribed: true } as never,
  }), result());
  assert(f.filter((x) => x.kind === "walk-does-not-tie").length === 0 && f.some((x) => x.kind === "rows-not-verified"),
    "[3a] rows that are not a verified transcription are reported ONCE, as that — the walk failing is the symptom, not a second finding");
}

console.log("\n=== [4] A company that could not be assessed is in the queue ===");
{
  const page = buildFlaggedItemsPage([{ table: block(), result: result() }], [{ company: "DaVita", message: "socket hang up" }]);
  assert(page.items[0]?.kind === "failed-fetch",
    "[4a] a failed fetch sorts FIRST — a company with no answer outranks a company with an imperfect one");
  assert(page.companiesAssessed === 2,
    `[4b] the assessed count counts ATTEMPTS, matching 1b's rule on the primary surface (got ${page.companiesAssessed})`);
}

console.log("\n=== [5] The headline never lets a clean book read like an unrun one ===");
{
  const clean = buildFlaggedItemsPage([{ table: block(), result: result() }]);
  assert(clean.headline.includes("assessed") && clean.headline.includes("No flags"),
    `[5a] zero flags states how many companies produced that zero — a bare "0 flags" describes an unrun book equally well (got ${clean.headline})`);
  const dirty = buildFlaggedItemsPage([{ table: block({ cardCount: 0, emptyStateLine: "no actionable events" }), result: result() }]);
  assert(/1 flag across 1 of 1 compan/.test(dirty.headline), `[5b] and a flagged book names its coverage (got ${dirty.headline})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
