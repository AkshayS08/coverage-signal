/**
 * SESSION 21, STAGE 3 — the tier rules, pinned.
 *
 * Run: npx tsx lib/events/tier2.test.ts
 */
import { buildTier2, isPostAnchorSource } from "./tier2";
import { parseMoneyAmount } from "./position";
import type { LadderRow } from "./position";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const ANCHOR = { form: "10-Q", date: "2026-08-07", reportDate: "2026-06-30", url: "https://sec.gov/uhs-20260630.htm" };
const row = (o: Partial<LadderRow>): LadderRow =>
  ({ instrument: "x", rate: null, seniority: null, amount: "$100 million", maturityDate: null, dateGranularity: null,
     sourceLine: "s", citedUrl: "u", id: "i", status: "live", provenance: "note", ...o } as LadderRow);

console.log("\n=== [1] IDENTITY FIRST — a document that IS the anchor is never Tier 2 ===");
{
  assert(isPostAnchorSource("https://sec.gov/8k.htm", "2026-08-21", ANCHOR),
    "[1a] a different document, dated after the anchor's period — Tier 2");
  assert(!isPostAnchorSource(ANCHOR.url, "2026-08-07", ANCHOR),
    "[1b] THE ANCHOR ITSELF, whose FILING DATE (Aug 7) is after its own PERIOD END (Jun 30) — not Tier 2. A date-only test promotes every 10-Q into Tier 2, and measured on the book it would have wrongly promoted HCA, Encompass and Quest, whose redemptions are described in the anchor's own note");
  assert(!isPostAnchorSource("https://sec.gov/old8k.htm", "2025-11-18", ANCHOR),
    "[1c] a different document dated BEFORE the anchor's period is already inside the anchor's balance sheet — not an event since it");
}

console.log("\n=== [2] REAL: UHS — nets, never stacks, and pending subtracts nothing ===");
{
  const t = buildTier2({
    anchor: ANCHOR,
    anchorCapturedFace: 4_741_000_000,
    postAnchorIssuances: [
      row({ instrument: "5.500% Senior Secured Notes due 2031", amount: "$600,000,000", issuedOn: { date: "2026-08-21", citedUrl: "https://sec.gov/8k.htm" }, provenance: "pricing-8-K" }),
      row({ instrument: "6.000% Senior Secured Notes due 2036", amount: "$500,000,000", issuedOn: { date: "2026-08-21", citedUrl: "https://sec.gov/8k.htm" }, provenance: "pricing-8-K" }),
    ],
    maturedUnconfirmed: [row({ instrument: "1.65% Senior Secured Notes due 2026", amount: "$700 million", maturityDate: "2026-09-01", status: "matured" })],
    confirmedRepayments: [],
    parseAmount: parseMoneyAmount,
  });
  assert(t.events.length === 3 && t.events.filter((e) => e.kind === "issuance").length === 2,
    "[2a] two post-anchor issuances and one pending item, each its own line");
  assert(t.events.find((e) => e.kind === "pending")?.effect === null,
    "[2b] THE PENDING STATE SUBTRACTS NOTHING — the $700M matured with no filing confirming repayment, so it stays on the ladder and stays counted. Debt is not removed because a maturity date went by");
  assert(t.rolledTotal === 5_841_000_000,
    `[2c] the rolled total NETS: $4.741B + $600M + $500M = $5.841B, with the pending item contributing zero (got ${t.rolledTotal})`);
  assert((t.rolledLabel ?? "").includes("unverified against a balance sheet until the next 10-Q"),
    `[2d] and it carries its label, always — a roll-forward has no balance sheet behind it and must never read like one (${t.rolledLabel})`);
  assert(t.events.every((e) => e.sourceLine.length > 0 && e.citedUrl.length > 0),
    "[2e] every Tier 2 line carries its own verbatim source and the filing it came from");
}

console.log("\n=== [3] A confirmed repayment subtracts against its own tranche ===");
{
  const t = buildTier2({
    anchor: ANCHOR,
    anchorCapturedFace: 1_000_000_000,
    postAnchorIssuances: [],
    maturedUnconfirmed: [],
    confirmedRepayments: [{ instrument: "revolving credit facility", amount: 225_000_000, date: "2026-08-21", sourceLine: "the repayment of the outstanding borrowings under the Issuer's revolving credit facility", citedUrl: "https://sec.gov/8k.htm" }],
    parseAmount: parseMoneyAmount,
  });
  assert(t.events[0].effect === -225_000_000 && t.rolledTotal === 775_000_000,
    `[3a] a confirmed repayment is negative and nets against the anchor position (got ${t.events[0].effect} / ${t.rolledTotal})`);
}

console.log("\n=== [4] No Tier 2 means no Tier 2 — nothing is invented to fill it ===");
{
  const t = buildTier2({ anchor: ANCHOR, anchorCapturedFace: 1_000_000_000, postAnchorIssuances: [], maturedUnconfirmed: [], confirmedRepayments: [], parseAmount: parseMoneyAmount });
  assert(t.events.length === 0 && t.rolledTotal === null && t.rolledLabel === null,
    "[4a] a company with no post-anchor event renders no Tier 2 and no rolled total — nine of the ten are in this state, and a roll-forward of nothing would only invite a reader to trust a second number");
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
