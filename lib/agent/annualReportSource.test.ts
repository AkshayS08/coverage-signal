/**
 * SESSION 24, FIX 5 — THE THREE BRANCHES, ON FIXTURES.
 *
 * Offline, $0, and deliberately NOT keyed to the three companies that
 * motivated it. DaVita, Cigna and HCA are named in the assertion text because
 * each is a real instance of a branch, but the inputs below are constructed:
 * a suite built on today's measured shapes would go green the moment a
 * locator change moved one of them, and would have proved only that those
 * three companies still have the shapes they had.
 *
 * Run: npx tsx lib/agent/annualReportSource.test.ts
 */
import { annualReportGate, withholdAnnualReportRows } from "./annualReportSource";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const TENK = "https://sec.gov/x-20251231.htm";
const TENQ = "https://sec.gov/x-20260630.htm";
const isAnnual = (u: string) => u === TENK;
const rows = () => [
  { instrument: "4.5% Notes due 2030", citedUrl: TENQ },
  { instrument: "5.0% Notes due 2033", citedUrl: TENK },
  { instrument: "Revolver", citedUrl: TENQ },
];

console.log("\n=== [1] TABULAR — the anchor has its own table ===");
{
  const g = annualReportGate("tabular", false);
  assert(g.enforced && !g.mayRead,
    "[1a] DAVITA'S BRANCH: an anchor with its own debt table may not read a prior-period annual report at all");
  const { kept, withheld } = withholdAnnualReportRows(rows(), isAnnual, g);
  assert(kept.length === 2 && withheld.length === 1 && withheld[0].entry.instrument === "5.0% Notes due 2033",
    `[1b] and a ladder row citing the 10-K is WITHHELD while the anchor's own rows are kept (kept ${kept.length}, withheld ${withheld.length})`);
  assert(withheld[0].reason.includes("has its own debt disclosure"),
    "[1c] NEVER SILENT: the withheld row carries the reason, so the page states an omission rather than showing a shorter ladder");
  assert(annualReportGate("tabular", true).mayRead === false,
    "[1d] AND A CROSS-REFERENCE DOES NOT UNLOCK IT. The direction only matters where the anchor has no note of its own — otherwise a filer's routine 'see our Form 10-K' would license substituting the tidier table");
}

console.log("\n=== [2] NOT-LOCATED AND DIRECTED — the labelled base only ===");
{
  const g = annualReportGate("not-located", true);
  assert(g.enforced && g.mayRead && g.asLabeledBaseOnly,
    "[2a] CIGNA'S BRANCH: no locatable note AND a verified cross-reference — the referenced table may be read");
  assert(g.reason.includes("LABELLED PRIOR-PERIOD BASE") && g.reason.includes("never the anchor's"),
    "[2b] and the permission is explicitly bounded: the prior period's base, carrying that filing's period, not the anchor's");
  const { kept, withheld } = withholdAnnualReportRows(rows(), isAnnual, g);
  assert(kept.length === 2 && withheld.length === 1,
    `[2c] A LADDER ROW CITING IT IS STILL WITHHELD. Being allowed to read a table as the prior-period base is not being allowed to put its rows on the current ladder — that IS the substitution this rule exists to stop (kept ${kept.length}, withheld ${withheld.length})`);
}

console.log("\n=== [3] NOT-LOCATED, UNDIRECTED — and PROSE-ONLY ===");
{
  const g = annualReportGate("not-located", false);
  assert(g.enforced && !g.mayRead,
    "[3a] HCA'S BRANCH: no locatable note and nothing directing the reader anywhere — two documents both existing is not a reference from one to the other");
  assert(g.reason.includes("abbreviated note is ordinary"),
    "[3b] and it says why: an abbreviated note is an ordinary thing for a 10-Q to have, not an invitation to substitute");
  const p = annualReportGate("prose-only", false);
  assert(p.enforced && !p.mayRead,
    "[3c] PROSE-ONLY is the anchor's own disclosure too — stated in sentences is still stated, and a table elsewhere does not outrank it");
  assert(withholdAnnualReportRows(rows(), isAnnual, p).withheld.length === 1,
    "[3d] so a prose-only anchor withholds an annual-report row exactly as a tabular one does");
}

console.log("\n=== [4] NOT-RECORDED — the gate does not run ===");
{
  const g = annualReportGate("not-recorded", false);
  assert(!g.enforced,
    "[4a] an answer cached before the shape was stored has NO input for this gate, so it does not run");
  assert(g.reason.includes("NOT re-derived"),
    "[4b] and the shape is explicitly not re-derived — today's locator answering about an extraction made under another one is a different fact wearing the same name");
  const { kept, withheld } = withholdAnnualReportRows(rows(), isAnnual, g);
  assert(kept.length === 3 && withheld.length === 0,
    `[4c] nothing is withheld on an unenforced answer — the honest outcome is "not checked", never a silent trim (kept ${kept.length})`);
  assert(annualReportGate("not-recorded", true).enforced === false,
    "[4d] and a cross-reference does not make it enforceable either: the missing input is the SHAPE");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
