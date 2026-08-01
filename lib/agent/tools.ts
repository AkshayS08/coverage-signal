import { getRecentFilings, getFilingText } from "../fetch";

export { getRecentFilings };

/** Reads a specific filing's text (cached). This is the loop's "dig" action. */
export async function readFiling(url: string): Promise<{ text: string; fromCache: boolean }> {
  return getFilingText(url);
}

export interface NewsResult {
  headlines: string[];
}

/** Stub — no news source wired up yet (later session). Always returns empty. */
export async function searchNews(company: string): Promise<NewsResult> {
  void company;
  return { headlines: [] };
}
