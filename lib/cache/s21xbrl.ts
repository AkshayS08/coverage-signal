/**
 * SESSION 21, STAGE 2A/2B — MEASUREMENT ONLY. Nothing is switched.
 *
 * Molina's stated total moved $184M with prompt wording (its finance-lease
 * caption in or out), because the denominator every coverage figure divides
 * by is currently the model's reading of which balance-sheet lines are debt.
 * The rule Session 21 proposes is that it comes from the company's own XBRL
 * tags instead. This measures that against the current denominator for all
 * ten BEFORE anything changes, and classifies each difference.
 *
 * Free: SEC company-facts is a public JSON endpoint, throttled through the
 * same client every other SEC read uses, and cached. Zero model calls.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { secFetchJson } from "../fetch/http";
import { getRecentFilings } from "../fetch";
import { computeCoverage } from "../events/coverage";
import type { CompanyResult } from "../agent";

interface Fact { end: string; val: number; form: string; fy?: number; fp?: string; frame?: string; accn?: string }
interface CompanyFacts { facts: { "us-gaap"?: Record<string, { units: Record<string, Fact[]> }> } }

/**
 * The standard tags. Filers differ in which they use — the point of reading
 * several is that a company's own choice of tag is a fact about the company,
 * not something to guess at.
 */
const CURRENT_TAGS = ["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"];
const NONCURRENT_TAGS = ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"];
const SHORT_TERM_TAGS = ["ShortTermBorrowings", "OtherShortTermBorrowings", "CommercialPaper"];
/** Lease liabilities — reported separately so a scope difference is nameable rather than merely a gap. */
const LEASE_TAGS = ["FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent", "FinanceLeaseLiability"];

function pick(facts: CompanyFacts, tags: string[], asOf: string): { tag: string; val: number } | null {
  for (const tag of tags) {
    const units = facts.facts["us-gaap"]?.[tag]?.units?.["USD"];
    if (!units) continue;
    // The value AS OF the anchor's period end, from a periodic filing.
    const hit = units.filter((f) => f.end === asOf && (f.form === "10-Q" || f.form === "10-K")).sort((a, b) => (b.accn ?? "").localeCompare(a.accn ?? ""))[0];
    if (hit) return { tag, val: hit.val };
  }
  return null;
}

const b = (n: number | null) => (n === null ? "—" : `$${(n / 1e9).toFixed(3)}B`);

(async () => {
  const book = JSON.parse(readFileSync(process.argv[2] ?? "baselines/s21-stage1b.json", "utf8")) as { company: string; result: CompanyResult }[];
  const rows: string[] = [];
  for (const { company, result } of book) {
    const dm = result.results.find((r) => r.triggerId === "debt-maturity");
    const cov = computeCoverage(dm);
    const anchor = dm?.debtScheduleSourceFiling;
    const asOf = anchor?.reportDate ?? "";
    const f = await getRecentFilings(company, ["10-Q"]);
    const cik = String(f.cik).padStart(10, "0");
    let facts: CompanyFacts;
    try {
      facts = await secFetchJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    } catch (e) {
      rows.push(`${company.padEnd(26)} XBRL FETCH FAILED — ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`);
      continue;
    }
    const cur = pick(facts, CURRENT_TAGS, asOf);
    const non = pick(facts, NONCURRENT_TAGS, asOf);
    const st = pick(facts, SHORT_TERM_TAGS, asOf);
    const lease = LEASE_TAGS.map((t) => pick(facts, [t], asOf)).filter(Boolean) as { tag: string; val: number }[];

    // A SHORT-TERM TAG IS A COMPONENT, NOT AN ADDITION, WHEN A CURRENT TAG
    // EXISTS. Cigna is the case: its DebtCurrent is $2.792B and its
    // CommercialPaper is $1.000B, and the commercial paper is INSIDE the
    // current figure — its balance sheet prints "Short-term debt 2,792" and
    // nothing else. Adding both double-counted $1.000B and reported a 3.14%
    // "unexplained" difference that was entirely mine.
    const parts = cur ? [cur.val, non?.val] : [st?.val, non?.val];
    const xbrlTotal = parts.filter((v): v is number => typeof v === "number").reduce((a, v) => a + v, 0) || null;
    const model = cov.statedTotalDebt;
    const diff = xbrlTotal !== null && model !== null ? xbrlTotal - model : null;
    const pct = diff !== null && model ? Math.abs(diff) / model : null;

    let verdict: string;
    if (xbrlTotal === null) verdict = "NO XBRL TOTAL at this period end";
    else if (model === null) verdict = "no model denominator to compare";
    else if (Math.abs(diff ?? 0) < 1e6) verdict = "IDENTICAL";
    else {
      const leaseMatch = lease.find((l) => Math.abs(Math.abs(diff ?? 0) - l.val) < 1e6);
      verdict = leaseMatch
        ? `SCOPE — differs by exactly ${b(leaseMatch.val)}, the company's own ${leaseMatch.tag}`
        : `UNEXPLAINED — ${b(diff)} (${((pct ?? 0) * 100).toFixed(2)}%)`;
    }
    rows.push(
      `${company.padEnd(26)} ${(anchor?.form ?? "?") + " " + asOf}  model ${b(model).padEnd(9)} xbrl ${b(xbrlTotal).padEnd(9)} ${verdict}\n` +
        `${"".padEnd(26)}   tags: cur=${cur ? `${cur.tag} ${b(cur.val)}` : "none"}; noncur=${non ? `${non.tag} ${b(non.val)}` : "none"}; st=${st ? `${st.tag} ${b(st.val)}` : "none"}` +
        (lease.length ? `; leases=${lease.map((l) => `${l.tag} ${b(l.val)}`).join(", ")}` : "")
    );
  }
  console.log("\n=== XBRL total vs the model-read denominator, at each company's own anchor period ===\n");
  for (const r of rows) console.log(r);
})();
