/**
 * Session 15b Part A golden tests — the evidence condenser. Runs entirely
 * OFFLINE against the cached fixture (__fixtures__/session11-facts.json),
 * same convention as eligibility.test.ts/narrationIntegrity.test.ts: real
 * citations/evidence, only the field under test pinned when a synthetic
 * case is needed.
 *
 * These assertions exist because Step 0 of this session (a raw evidence
 * dump for both acceptance books, before any renderer code was written)
 * found three real bugs a plausible-looking first implementation had:
 * sentence-splitting on "Alan B. Miller"/"U.K." abbreviations, picking a
 * figure-less lead sentence over a later figure-bearing one (Cigna's
 * dividend line dropped its own $1.56 amount), and counting unrelated
 * "as of"/redemption dates as if they were additional debt tranches. Each
 * has a live regression test below.
 *
 * Run: npx tsx lib/events/evidenceCondense.test.ts (or npm test)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyResult } from "../agent";
import { buildVerifiedFactBase, type VerifiedFact } from "./factBase";
import { condenseDebtMaturity, condenseFirstSentence, condenseEvidenceDescription } from "./evidenceCondense";

interface Fixture {
  generatedAt: string;
  companies: CompanyResult[];
}

const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, "__fixtures__/session11-facts.json"), "utf8"));

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ PASS — ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL — ${label}`);
    failed++;
    failures.push(label);
  }
}

function factFor(ticker: string, triggerId: string): VerifiedFact {
  const c = fixture.companies.find((c) => c.ticker === ticker);
  if (!c) throw new Error(`fixture missing ${ticker}`);
  const facts = buildVerifiedFactBase(c);
  const f = facts.find((f) => f.linkedTriggerId === triggerId);
  if (!f) throw new Error(`fixture missing ${ticker}/${triggerId} as a verified fact`);
  return f;
}

console.log(`=== Session 15b golden tests (evidence condenser) ===\n`);

// --- 1. Rule 1: debt-maturity selects the clause matching the trigger's
// OWN eventDate — never positional. Tenet's real evidence lists 10
// tranches in one string; the eligible one (Nov 2027, matching eventDate)
// is neither first-by-accident-only nor guessable without date-matching. ---
{
  const tenet = factFor("THC", "debt-maturity");
  const condensed = condenseDebtMaturity(tenet);
  assert(
    /November 2027/.test(condensed) && /\$1\.5 billion/.test(condensed),
    `[1a] Tenet debt-maturity picks the November 2027 / $1.5 billion clause matching eventDate=${tenet.eventDate} (condensed: ${JSON.stringify(condensed)})`
  );
  assert(!/June 2028|April 2029|June 2033/.test(condensed), `[1b] Tenet's condensed line does NOT lead with a different (non-matching) tranche`);
  assert(/\+9 more tranches? to 2033/.test(condensed), `[1c] Tenet's line correctly counts the other 9 due-dated tranches, max year 2033 (condensed: ${JSON.stringify(condensed)})`);
}

// --- 2. Rule 1's mandated no-guess fallback: when no evidence clause
// contains a date matching eventDate, render a date-only line — never the
// first clause, never a fabricated figure. SYNTHETIC: no real fact in the
// current book fails to find its own eventDate in evidence (that's what
// factGuard.ts already guarantees upstream), so this pins a controlled
// case with evidence text that deliberately omits the matching date. ---
{
  const real = factFor("UHS", "debt-maturity");
  const controlled: VerifiedFact = { ...real, evidence: "Some other unrelated tranche due March 2019 was mentioned.", eventDate: "2026", dateGranularity: "year" };
  const condensed = condenseDebtMaturity(controlled);
  assert(
    condensed === "notes due 2026",
    `[2] SYNTHETIC: no evidence clause matches eventDate -> date-only fallback, never the unrelated first clause (condensed: ${JSON.stringify(condensed)})`
  );
}

// --- 3. Rule 3 / generic condenser: prefers the first sentence containing
// a MONEY figure over an earlier figure-less scene-setter. Real bug found
// live during this session's own verification pass, on a company outside
// this fixture's 8-company book (Cigna's dividend-buyback evidence opens
// with "Quarterly cash dividends are being paid." — no figure — before
// the sentence stating "$1.56 per share."). SYNTHETIC here because this
// fixture's own book doesn't happen to reproduce that exact shape; pinned
// onto a real HCA fact (same figure-binding rules, only evidence text
// swapped) rather than hand-built from nothing. ---
{
  const real = factFor("HCA", "dividend-buyback");
  const controlled: VerifiedFact = {
    ...real,
    evidence: "Quarterly cash dividends are being paid. On July 22, 2026, the Board declared a dividend of $1.56 per share.",
  };
  const condensed = condenseFirstSentence(controlled);
  assert(/\$1\.56/.test(condensed), `[3] SYNTHETIC: a figure-less opening sentence is skipped in favor of the later sentence stating the actual figure (condensed: ${JSON.stringify(condensed)})`);
}

// --- 4. Rule 3: 2+ "as of <date>" periods -> keep only the MOST RECENT
// period's sentence. Real fixture case: DaVita's revolver states June 30
// utilization, then March 31, then a trend comment with neither. ---
{
  const davita = factFor("DVA", "revolver-near-capacity");
  const condensed = condenseFirstSentence(davita);
  assert(/June 30, 2026/.test(condensed) && /\$65 million/.test(condensed), `[4a] DaVita revolver keeps the June 30 (most recent) period (condensed: ${JSON.stringify(condensed)})`);
  assert(!/March 31, 2026/.test(condensed), `[4b] DaVita revolver drops the earlier March 31 period entirely — Rule 3, never render the comparison`);
}

// --- 5. Never a bare line: condenseEvidenceDescription always returns
// non-empty text, even for a fact with no evidence at all. ---
{
  const real = factFor("UHS", "capex-program");
  const noEvidence: VerifiedFact = { ...real, evidence: null };
  const condensed = condenseEvidenceDescription(noEvidence);
  assert(condensed.length > 0 && /no figure disclosed/.test(condensed), `[5] a fact with no evidence at all falls back to an honest, non-empty "no figure disclosed" line (condensed: ${JSON.stringify(condensed)})`);
}

// --- 6. Sentence-splitter abbreviation guard: "Alan B. Miller Medical
// Center" and "its U.K. operations" must not truncate mid-name. Real bugs
// found live in the FIRST implementation, both from UHS's real evidence. ---
{
  const capex = factFor("UHS", "capex-program");
  const condensed = condenseFirstSentence(capex);
  assert(!/^Alan B\.$/.test(condensed.trim()), `[6a] UHS capex-program does not truncate to "Alan B." (condensed: ${JSON.stringify(condensed)})`);

  const intl = factFor("UHS", "international-expansion");
  const condensedIntl = condenseFirstSentence(intl);
  assert(!/U\.K\.$/.test(condensedIntl.trim()), `[6b] UHS international-expansion does not truncate mid-"U.K." (condensed: ${JSON.stringify(condensedIntl)})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
} else {
  console.log("\nALL SESSION 15b EVIDENCE-CONDENSER GOLDEN TESTS PASSED");
}
