/**
 * "REPAID" ON A FACILITY THAT WAS NEVER DRAWN. $0 — cached answers only.
 *
 * C1 (position.ts) turns any live row whose amount parses to zero into
 * `repaid`, and for an amortizing tranche the filing reports at nil that is
 * exactly right: the obligation is gone.
 *
 * A COMMITTED FACILITY AT ZERO IS A DIFFERENT FACT. Nothing is owed and
 * everything is still available — the commitment stands, the money can be
 * drawn tomorrow, and an RM looking at the page needs to see capacity, not a
 * retired line. Calling that "repaid" is the same category error Rule 48
 * names: a number read as an answer to a question it was not answering.
 *
 * SURFACED BY CHS, whose v29 golden carried the ABL as capacity with no
 * stated amount. v31 recovered the stated zero — a real improvement, Rule 53's
 * copula fix doing its job — and the improvement fed straight into C1, which
 * flipped a live $1.0 billion commitment to `repaid` and dropped its capacity
 * flag. A fix improving one layer and breaking the next is the reason this is
 * asked of the WHOLE BOOK rather than of the name that showed it.
 *
 * Run: npx tsx lib/cache/s23zerorevolver.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, ladderCapacityFor, parseMoneyAmount } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/**
 * Does the row NAME a committed facility? Deliberately a narrow, stated-word
 * test rather than a guess: a scan that judges by a broader standard than the
 * page has reported a false finding three times this session.
 */
const FACILITY_WORDED = /\b(revolv\w*|revolver|ABL|asset-based|credit facility|line of credit|commercial paper|delayed draw|term loan)\b/i;

(async () => {
  let spend = 0;
  const hits: string[] = [];
  console.log(`\n${"=".repeat(104)}`);
  console.log(`ZERO-BALANCE ROWS AND WHAT THE LADDER CALLS THEM — v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(104));

  for (const company of ALL) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const zeros = pos.rows.filter((x) => parseMoneyAmount(x.amount) === 0);
    // ladderCapacityFor returns an ARRAY of capacity lines, not a total. The
    // first draft ran Number() over it and printed "$0M" for an empty array
    // and "$NaNM" for a non-empty one — a reading that inverted the meaning
    // of the column it was printing, and would have said CHS had capacity
    // where it has none.
    const cap = ladderCapacityFor(pos);
    const capTotal = cap.reduce((a, c) => a + (c.amount ?? 0), 0);
    console.log(`\n  ${company.padEnd(28)} ${String(pos.rows.length).padStart(2)} rows · ${zeros.length} at zero · ${cap.length} capacity row(s)${cap.length ? ` totalling $${(capTotal / 1e6).toLocaleString()}M` : ""}`);
    for (const c of cap) console.log(`      capacity: ${c.label} — ${c.amount === null ? "no amount parsed" : `$${(c.amount / 1e6).toLocaleString()}M`} (${c.category})`);
    for (const z of zeros) {
      const status = (z as unknown as { status?: string }).status ?? "—";
      const facilityWorded = FACILITY_WORDED.test(z.instrument);
      const wrong = facilityWorded && status === "repaid";
      console.log(`      ${z.instrument}`);
      console.log(`          amount ${z.amount} · status ${status} · capacity ${z.isCapacity}${wrong ? "   ← a COMMITTED FACILITY called repaid" : ""}`);
      console.log(`          sentence "${String(z.sourceLine).replace(/\s+/g, " ").slice(0, 140)}"`);
      if (wrong) hits.push(`${company} — ${z.instrument}: status "repaid", isCapacity ${z.isCapacity}, on a row the filing words as a committed facility`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${hits.length === 0
    ? "No committed facility anywhere in the book is classed `repaid` at a zero balance."
    : `${hits.length} committed facility(ies) classed \`repaid\` at a zero balance:`}`);
  for (const h of hits) console.log(`      ${h}`);
  console.log(`\n  SPEND: $${spend.toFixed(4)} — cached answers only.`);
  console.log("=".repeat(104));
})();
