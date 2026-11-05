/**
 * SESSION 27 (Akshay, Nov 4, 2026) — A PRICING SUMMARY NAMES THE RUN IT PRICED (pricingSummary.test.ts).
 * Built from the priced rows, never a fixed string; checked by summaryNamesRun.
 */
const COMPANIES = ["Tenet", "DaVita", "CHS", "Community Health", "Molina", "Encompass", "Cigna", "UHS", "Universal Health"];
const short = (company: string) => COMPANIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(company)) ?? company;

export function pricingSummary(rows: { company: string; declared: number }[]): string {
  const total = rows.reduce((a, r) => a + r.declared, 0);
  return `Priced: ${rows.map((r) => `${r.company} $${r.declared.toFixed(2)}`).join("; ")}. Declared in all: $${total.toFixed(2)}, worst case, before any call.`;
}

/** What the summary gets wrong about the run: a company it names that was not priced, one priced it omits, a wrong total. */
export function summaryNamesRun(summary: string, rows: { company: string; declared: number }[]): string[] {
  const out: string[] = [];
  const priced = rows.map((r) => short(r.company));
  for (const c of COMPANIES) if (new RegExp(`\\b${c}\\b`, "i").test(summary) && !priced.some((p) => p.toLowerCase() === short(c).toLowerCase() || p.toLowerCase() === c.toLowerCase())) out.push(`names ${c}, which this run did not price`);
  for (const r of rows) if (!new RegExp(`\\b${short(r.company)}\\b`, "i").test(summary)) out.push(`omits ${r.company}, which it priced`);
  const total = rows.reduce((a, r) => a + r.declared, 0).toFixed(2);
  if (!summary.includes(`$${total}`)) out.push(`does not state the declared total $${total}`);
  return out;
}
