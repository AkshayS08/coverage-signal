import { cachedFetch, slugify } from "./cache";
import { secFetchJson } from "./http";

const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const COMPANY_TICKERS_CACHE_PATH = "edgar/company_tickers.json";

interface RawTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

type RawTickerMap = Record<string, RawTickerEntry>;

export interface CikMatch {
  cik: string; // zero-padded to 10 digits, as EDGAR's submissions API expects
  cikNumber: number;
  title: string;
  ticker: string;
}

const SUFFIX_WORDS =
  /\b(inc|incorporated|corp|corporation|co|company|holdings|holding|ltd|plc|llc|group)\b/g;

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(SUFFIX_WORDS, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadTickerEntries(): Promise<RawTickerEntry[]> {
  const { data } = await cachedFetch<RawTickerMap>(COMPANY_TICKERS_CACHE_PATH, () =>
    secFetchJson<RawTickerMap>(COMPANY_TICKERS_URL)
  );
  return Object.values(data);
}

/** Resolves a company name to its SEC CIK via EDGAR's company_tickers.json, cached by name. */
export async function resolveCik(companyName: string): Promise<CikMatch> {
  const cachePath = `edgar/cik/${slugify(companyName)}.json`;

  const { data } = await cachedFetch<CikMatch>(cachePath, async () => {
    const entries = await loadTickerEntries();
    const target = normalize(companyName);

    let match =
      entries.find((e) => normalize(e.title) === target) ??
      entries.find((e) => {
        const title = normalize(e.title);
        return title.startsWith(target) || target.startsWith(title);
      });

    if (!match) {
      const targetTokens = target.split(" ").filter(Boolean);
      match = entries.find((e) => {
        const titleTokens = normalize(e.title).split(" ").filter(Boolean);
        return targetTokens.every((tok) => titleTokens.includes(tok));
      });
    }

    if (!match) {
      throw new Error(
        `Could not resolve "${companyName}" to a CIK in EDGAR's company_tickers.json`
      );
    }

    return {
      cik: String(match.cik_str).padStart(10, "0"),
      cikNumber: match.cik_str,
      title: match.title,
      ticker: match.ticker,
    };
  });

  return data;
}
