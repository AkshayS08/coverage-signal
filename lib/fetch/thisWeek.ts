/**
 * SESSION 26 — THIS WEEK'S FILINGS, READ WITHOUT TOUCHING THE CORPUS.
 *
 * A signed name's cached answer is keyed on a fingerprint of its filing list,
 * and that list is cached for 24 hours under `edgar/submissions/...` and
 * `edgar/filings/...`. Refreshing either is what moved Cigna's fingerprint and
 * re-billed $0.5714 (Rule 75). The card's "this week" lines need the LIVE
 * list, and they must never move a signed name onto a new extraction.
 *
 * So this reads EDGAR's submissions endpoint directly: no cache read, no cache
 * write, no shared key. It returns metadata only (form, dates, 8-K item
 * numbers, URL) and reads no filing text, so it bills nothing and decides
 * nothing a filing's words would have to decide.
 *
 * Asserted by lib/cards/thisWeekFingerprint.test.ts: read the live list, then
 * preflight still finds every signed name cached.
 */
import { secFetchJson } from "./http";
import type { FilingEntry } from "./filings";

interface Submissions {
  filings: { recent: { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[]; primaryDocument: string[]; items?: string[] } };
}

export async function liveFilingsBetween(cik: string, from: string, to: string): Promise<FilingEntry[]> {
  const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
  const data = await secFetchJson<Submissions>(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const r = data.filings.recent;
  const cikNumber = Number(padded);
  return r.form
    .map((form, i) => ({
      form,
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i],
      accessionNumber: r.accessionNumber[i],
      primaryDocument: r.primaryDocument[i],
      primaryDocUrl: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`,
      items: r.items?.[i] ?? "",
    }))
    .filter((f) => f.filingDate >= from && f.filingDate <= to)
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
}
