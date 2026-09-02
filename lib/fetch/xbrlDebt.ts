/**
 * SESSION 21, STAGE 2 — THE DENOMINATOR FROM THE COMPANY'S OWN TAGS.
 *
 * Coverage divides by "stated total debt", and until now that was the
 * model's reading of which balance-sheet lines are debt. Molina is why that
 * is not good enough: its finance-lease caption came in at v24 and out at
 * v23 and v25, moving the denominator between $3.769B and $3.953B and
 * flipping Check 2 on nothing but prompt wording.
 *
 * MEASURED BEFORE BUILT, across all ten at each anchor's own period end:
 * nine identical to the dollar, and the tenth — HCA — has no company-facts
 * data at its anchor period at all. That measurement is what shaped this
 * module, and it killed the obvious design: "XBRL or nothing" would have
 * blanked HCA's denominator and sent a company reading 101% to "coverage
 * unmeasured", trading a stable correct number for a hole.
 *
 * So XBRL is the number WHERE IT EXISTS, the model-read total stands where
 * it does not, and each says which it is. Absence degrades to the older
 * source, never to silence.
 *
 * MOLINA'S SCOPE QUESTION IS ANSWERED BY MOLINA. Its
 * FinanceLeaseLiabilityNoncurrent ($0.184B) is a SEPARATE tag from its
 * LongTermDebtNoncurrent ($3.769B) — the filer does not put leases inside
 * debt, so neither do we. Encompass and CHS tag
 * LongTermDebtAndCapitalLeaseObligations, which does include them, and their
 * totals match either way. Three filers, two conventions, no ambiguity in
 * either: the tag choice is the answer, and it is the company's.
 */
import { cachedFetch } from "./cache";
import { secFetchJson } from "./http";

interface XbrlFact {
  end: string;
  val: number;
  form: string;
  accn?: string;
}
interface CompanyFacts {
  facts: { "us-gaap"?: Record<string, { units: Record<string, XbrlFact[]> }> };
}

/**
 * Current maturities. Ordered by specificity: a filer using
 * LongTermDebtCurrent means that; DebtCurrent is the broader caption some
 * filers use for the same line.
 */
const CURRENT_TAGS = ["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"];
const NONCURRENT_TAGS = ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"];
/**
 * Used ONLY when no current tag exists. A short-term tag is a COMPONENT of a
 * current one, never an addition to it — Cigna is the measured case, where
 * CommercialPaper ($1.000B) sits inside DebtCurrent ($2.792B) and summing
 * both invented a 3.14% discrepancy that was pure arithmetic error.
 */
const SHORT_TERM_TAGS = ["ShortTermBorrowings", "OtherShortTermBorrowings", "CommercialPaper"];

/** The contractual maturity ladder the filer tags itself. 2d's floor. */
const BUCKET_TAGS: [string, string][] = [
  ["due within 12 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
  ["13–24 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
  ["25–36 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"],
  ["37–48 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
  ["49–60 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"],
  ["thereafter", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
];

export interface XbrlTaggedAmount {
  tag: string;
  value: number;
}

export interface XbrlDebtTotal {
  /** Null when the filer reports no usable debt tag at this period end. */
  total: number | null;
  /** The period end asked for — always the anchor's own, never a nearby one. */
  asOf: string;
  /** The tags summed, named so the surface can say what it added. */
  parts: XbrlTaggedAmount[];
  /** Lease liabilities the filer tags SEPARATELY from debt. Reported, never added. */
  separateLeases: XbrlTaggedAmount[];
  /** Stated when total is null, so an absence is explained rather than blank. */
  unavailableReason: string | null;
}

export interface XbrlMaturityBuckets {
  buckets: { label: string; tag: string; value: number }[];
  asOf: string;
}

function factAt(facts: CompanyFacts, tag: string, asOf: string): number | null {
  const units = facts.facts["us-gaap"]?.[tag]?.units?.["USD"];
  if (!units) return null;
  // The value as of the anchor's own period end, from a periodic filing.
  // Several filings can report the same date (a 10-K and the 10-Q that
  // followed restating it); the latest accession is the most recent word.
  const hits = units.filter((f) => f.end === asOf && (f.form === "10-Q" || f.form === "10-K"));
  if (hits.length === 0) return null;
  return hits.sort((a, c) => (c.accn ?? "").localeCompare(a.accn ?? ""))[0].val;
}

function firstTagged(facts: CompanyFacts, tags: string[], asOf: string): XbrlTaggedAmount | null {
  for (const tag of tags) {
    const value = factAt(facts, tag, asOf);
    if (value !== null) return { tag, value };
  }
  return null;
}

/**
 * TWO KINDS OF ABSENCE, AND THEY ARE NOT THE SAME FACT.
 *
 * "This filer tags no debt total at that period end" is a fact about the
 * FILER. "We could not read it" is a fact about US. The first cut of this
 * collapsed both into one silent null, and it cost the exact instability
 * Stage 2 exists to remove: a transient Blob-cache failure during the first
 * wired run dropped Cigna's denominator from its own XBRL tags to a
 * model-read caption set, on a surface that then blamed the filer — the
 * endpoint "returned nothing for this filer", when three retries a minute
 * later read $31.878B without trouble.
 *
 * So the cached read is retried once against the network directly, which
 * turns a blip into a non-event, and a genuine failure is reported as OUR
 * failure with the model-read fallback labelled accordingly.
 */
type FactsOutcome =
  | { kind: "ok"; facts: CompanyFacts }
  | { kind: "unreadable"; detail: string };

async function companyFacts(cik: string): Promise<FactsOutcome> {
  const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`;
  try {
    const { data } = await cachedFetch<CompanyFacts>(`edgar/companyfacts/CIK${padded}.json`, () => secFetchJson<CompanyFacts>(url));
    return { kind: "ok", facts: data };
  } catch (first) {
    // Once more, straight to the source — the cache layer is the part that
    // flakes, and skipping it is both the diagnosis and the fix.
    try {
      return { kind: "ok", facts: await secFetchJson<CompanyFacts>(url) };
    } catch (second) {
      return {
        kind: "unreadable",
        detail: `the company-facts endpoint could not be read (cached: ${first instanceof Error ? first.message.slice(0, 70) : String(first)}; direct: ${second instanceof Error ? second.message.slice(0, 70) : String(second)})`,
      };
    }
  }
}

/** Stated total debt from the filer's own tags, at the anchor's own period end. */
export async function fetchXbrlDebtTotal(cik: string, asOf: string): Promise<XbrlDebtTotal> {
  const empty = (reason: string): XbrlDebtTotal => ({ total: null, asOf, parts: [], separateLeases: [], unavailableReason: reason });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return empty("the anchor filing states no period end to look up");
  const outcome = await companyFacts(cik);
  // OURS, not the filer's — said in those words, because a reader deciding
  // whether to trust a denominator needs to know which of the two happened.
  if (outcome.kind === "unreadable") return empty(`WE could not read this filer's XBRL — ${outcome.detail}. This is our failure, not an absence of tagging`);
  const facts = outcome.facts;

  const current = firstTagged(facts, CURRENT_TAGS, asOf);
  const noncurrent = firstTagged(facts, NONCURRENT_TAGS, asOf);
  const shortTerm = current ? null : firstTagged(facts, SHORT_TERM_TAGS, asOf);
  const parts = [current ?? shortTerm, noncurrent].filter((p): p is XbrlTaggedAmount => p !== null);
  const separateLeases = ["FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent", "FinanceLeaseLiability"]
    .map((t) => firstTagged(facts, [t], asOf))
    .filter((l): l is XbrlTaggedAmount => l !== null);

  if (parts.length === 0) {
    // HCA, measured: it tags LongTermDebt normally, and its company-facts
    // data simply stops a quarter before its anchor. The data lags; the
    // filer is fine.
    return { ...empty(`this filer reports no debt tag at ${asOf} — its company-facts data does not reach the anchor's period end`), separateLeases };
  }
  return { total: parts.reduce((a, p) => a + p.value, 0), asOf, parts, separateLeases, unavailableReason: null };
}

/** 2d — the filer's own contractual maturity ladder, where it tags one. */
export async function fetchXbrlMaturityBuckets(cik: string, asOf: string): Promise<XbrlMaturityBuckets> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { buckets: [], asOf };
  const outcome = await companyFacts(cik);
  if (outcome.kind === "unreadable") return { buckets: [], asOf };
  const facts = outcome.facts;
  const buckets = BUCKET_TAGS.map(([label, tag]) => {
    const value = factAt(facts, tag, asOf);
    return value === null ? null : { label, tag, value };
  }).filter((b): b is { label: string; tag: string; value: number } => b !== null);
  return { buckets, asOf };
}
