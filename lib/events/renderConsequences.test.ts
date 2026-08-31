/**
 * SESSION 19 STEP 4 — the render consequences, and the status word.
 *
 * Run: npx tsx lib/events/renderConsequences.test.ts
 */
import { buildCompanyTableBlock } from "./portfolioTable";
import type { CompanyResult, TriggerResult, VerifiedEventInstance } from "../agent";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const NOW = new Date("2026-08-30T00:00:00Z");
const URL_A = "https://example.com/a";

function trigger(over: Partial<TriggerResult> & { triggerId: string }): TriggerResult {
  return {
    triggerName: "synthetic", fired: true, dataAvailable: true, evidence: "synthetic evidence stating $1 million",
    mappedNeed: "n", needType: "credit", confidence: 1,
    citations: [{ form: "10-Q", date: "2026-07-01", reportDate: "2026-06-30", url: URL_A }],
    quoteVerified: true, verifiedQuote: "synthetic evidence stating $1 million", verifiedQuoteNormalized: null,
    quoteMatchType: "literal", quoteHasFigure: true, eventDate: null, dateGranularity: null,
    eventStatus: "standing", proceedsUse: null, scheduleSequence: [], priorScheduleSequence: [],
    balanceSheetDebtCaptions: [], debtScheduleSourceFiling: null, redeems: null, issuedTranches: [],
    cashAmount: "$1 million", projectName: null, projectCompletionDate: null, projectCompletionGranularity: null,
    eventInstances: [], noteRetirements: [],
    ...over,
  } as TriggerResult;
}
function company(results: TriggerResult[]): CompanyResult {
  return { company: "Synthetic Co", cik: "1", ticker: "SYN", results, verdict: null, relationshipFlags: [] } as unknown as CompanyResult;
}
const inst = (description: string, over: Partial<VerifiedEventInstance> = {}): VerifiedEventInstance => ({
  description, amount: null, eventDate: null, dateGranularity: null,
  eventStatus: "completed", sourceLine: description, citedUrl: URL_A, ...over,
});

console.log("\n=== [1] Multiple facts of one kind render as separate lines ===");
{
  const t = trigger({
    triggerId: "asset-sale", eventStatus: "completed", eventDate: "2026-04-01",
    eventInstances: [
      inst("Sale of Crestwood Medical Center in Huntsville, Alabama", { amount: "$459 million", eventDate: "2026-04-01" }),
      inst("Sale of four hospitals in Arkansas", { amount: "$110 million", eventDate: "2026-06-01" }),
    ],
  });
  const table = buildCompanyTableBlock(company([t]), [], NOW);
  const lines = (table.buckets.treasury ?? []);
  assert(lines.length === 2, `[1a] THE FIX: two divestitures render as TWO lines, not one (got ${lines.length})`);
  assert(lines.some((l) => l.text.includes("Crestwood")) && lines.some((l) => l.text.includes("Arkansas")),
    "[1b] and BOTH are named — the scalar slot used to hold one, and swapped which one between runs");
  assert(lines[0].factKey !== lines[1].factKey,
    "[1c] distinct factKeys, or the cross-bucket dedup collapses the lines this change exists to separate");
  assert(lines.every((l) => l.citations.length > 0 && l.citations[0].url === URL_A),
    "[1d] each line carries its OWN source — separate lines mean separate provenance");
}

console.log("\n=== [2] One conversation, not several cards ===");
{
  const t = trigger({
    triggerId: "asset-sale", eventStatus: "completed", eventDate: "2026-04-01",
    eventInstances: [inst("Sale A", { amount: "$459 million" }), inst("Sale B", { amount: "$110 million" })],
  });
  const table = buildCompanyTableBlock(company([t]), [{ id: "x", headlineTrigger: { triggerId: "asset-sale" } }] as never, NOW);
  const lines = table.buckets.treasury ?? [];
  const carded = lines.filter((l) => l.cardEligible);
  assert(carded.length <= 1,
    `[2a] at most ONE instance is card-eligible — several facts of one kind on one company are one conversation (got ${carded.length})`);
}

console.log("\n=== [3] A single-instance trigger is unchanged ===");
{
  const t = trigger({ triggerId: "asset-sale", eventStatus: "completed", eventDate: "2026-04-01", eventInstances: [inst("Only sale")] });
  const lines = buildCompanyTableBlock(company([t]), [], NOW).buckets.treasury ?? [];
  assert(lines.length === 1, `[3a] one instance renders exactly as before — the split is for MULTIPLE facts (got ${lines.length})`);
}

console.log("\n=== [4] The status word comes from the derivation, not eventStatus ===");
{
  const dated = trigger({
    triggerId: "capex-program", eventStatus: "standing",
    projectName: "Miller Medical Plaza", projectCompletionDate: "2026-12-01", projectCompletionGranularity: "month",
  });
  const line = (buildCompanyTableBlock(company([dated]), [], NOW).buckets.new_debt ?? [])[0];
  assert(!!line && !line.text.includes("ongoing"),
    `[4a] THE FIX: a project with a stated completion date never prints "ongoing" — 2c was enforced at the gate and violated at the render, for the same fact`);
  assert(!!line && line.text.includes("December 2026"),
    `[4b] and it states the filing's OWN date rather than the category "upcoming" (got ${line?.text.slice(-60)})`);

  const past = trigger({
    triggerId: "capex-program", eventStatus: "standing",
    projectName: "Florida Coast", projectCompletionDate: "2025-09-01", projectCompletionGranularity: "month",
  });
  const pline = (buildCompanyTableBlock(company([past]), [], NOW).buckets.new_debt ?? [])[0];
  assert(!!pline && !pline.text.includes("ongoing"),
    "[4c] a project whose stated date has PASSED is completed, never standing — the rule runs in both directions");

  const undated = trigger({ triggerId: "capex-program", eventStatus: "standing", projectName: "Some programme" });
  const uline = (buildCompanyTableBlock(company([undated]), [], NOW).buckets.new_debt ?? [])[0];
  assert(!!uline && uline.text.includes("ongoing"),
    "[4d] REVERSE: an UNDATED recurring disclosure still reads ongoing — `standing` is reserved for exactly this, and the rule must not eat it");
}

console.log("\n=== [5] A trigger-level date is attributed to its OWN instance, never to all of them ===");
{
  const t = trigger({
    triggerId: "capex-program", eventStatus: "standing",
    projectName: "Project Nova", projectCompletionDate: "2031", projectCompletionGranularity: "year",
    eventInstances: [
      inst("Project Nova - modernize Order to Cash", { eventStatus: "standing" }),
      inst("Automation and AI initiatives", { eventStatus: "standing" }),
    ],
  });
  const lines = buildCompanyTableBlock(company([t]), [], NOW).buckets.new_debt ?? [];
  const nova = lines.find((l) => l.text.includes("Project Nova"))!;
  const auto = lines.find((l) => l.text.includes("Automation"))!;
  assert(!!nova && nova.text.includes("2031"),
    "[5a] the instance the date NAMES carries it");
  assert(!!auto && !auto.text.includes("2031"),
    "[5b] and the instance it does not name does NOT — applying a trigger-level date to every instance is exactly the conflation that put UHS's Plaza date on the Medical Center's name");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
