import { cachedFetch, slugify } from "./cache";
import { secFetchJson } from "./http";
import { resolveCik } from "./cik";

export interface FilingEntry {
  form: string;
  filingDate: string;
  reportDate: string;
  accessionNumber: string;
  primaryDocument: string;
  primaryDocUrl: string;
  /** 8-K item codes (e.g. "1.01,2.03"), empty for non-8-K forms. Free EDGAR metadata. */
  items: string;
}

interface SubmissionsRecent {
  form: string[];
  filingDate: string[];
  reportDate: string[];
  accessionNumber: string[];
  primaryDocument: string[];
  items?: string[];
}

interface SubmissionsResponse {
  filings: {
    recent: SubmissionsRecent;
  };
}

function buildDocUrl(cikNumber: number, accessionNumber: string, primaryDocument: string): string {
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accessionNoDashes}/${primaryDocument}`;
}

async function fetchAllFilings(
  cik: string,
  cikNumber: number
): Promise<{ entries: FilingEntry[]; fromCache: boolean }> {
  const cachePath = `edgar/submissions/CIK${cik}.json`;
  const { data, fromCache } = await cachedFetch<SubmissionsResponse>(cachePath, () =>
    secFetchJson<SubmissionsResponse>(`https://data.sec.gov/submissions/CIK${cik}.json`)
  );

  const recent = data.filings.recent;
  const entries: FilingEntry[] = recent.form.map((form, i) => ({
    form,
    filingDate: recent.filingDate[i],
    reportDate: recent.reportDate[i],
    accessionNumber: recent.accessionNumber[i],
    primaryDocument: recent.primaryDocument[i],
    primaryDocUrl: buildDocUrl(cikNumber, recent.accessionNumber[i], recent.primaryDocument[i]),
    items: recent.items?.[i] ?? "",
  }));

  return { entries, fromCache };
}

export interface RecentFilingsResult {
  company: string;
  cik: string;
  ticker: string;
  filings: FilingEntry[];
  fromCache: { submissions: boolean } & Record<string, boolean>;
}

/**
 * Resolves a company name to its CIK, pulls its recent filings from EDGAR
 * (cached raw per CIK), and returns the ones matching `forms` (cached
 * separately per company + filing type so repeat runs never re-fetch).
 */
export async function getRecentFilings(
  companyName: string,
  forms: string[] = ["8-K", "10-Q"]
): Promise<RecentFilingsResult> {
  const match = await resolveCik(companyName);
  const slug = slugify(companyName);

  const { entries: all, fromCache: submissionsFromCache } = await fetchAllFilings(
    match.cik,
    match.cikNumber
  );

  const fromCache: Record<string, boolean> = { submissions: submissionsFromCache };
  const filings: FilingEntry[] = [];

  for (const form of forms) {
    const cachePath = `edgar/filings/${slug}__${slugify(form)}.json`;
    const { data, fromCache: hit } = await cachedFetch<FilingEntry[]>(cachePath, async () =>
      all
        .filter((f) => f.form === form)
        .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))
    );
    fromCache[form] = hit;
    filings.push(...data);
  }

  filings.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));

  return {
    company: match.title,
    cik: match.cik,
    ticker: match.ticker,
    filings,
    fromCache: fromCache as RecentFilingsResult["fromCache"],
  };
}
