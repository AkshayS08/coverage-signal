import { cachedFetch } from "./cache";
import { secFetchText } from "./http";

const MAX_CHARS = 20000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function urlToCacheKey(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * Fetches a filing document's plain text, cached by URL. HTML is stripped
 * and truncated to keep per-filing prompt cost bounded — 8-Ks are short
 * enough to survive intact; 10-Qs get the first ~20k chars (cover page,
 * financial statements, and the start of MD&A).
 */
export async function getFilingText(url: string): Promise<{ text: string; fromCache: boolean }> {
  const cachePath = `edgar/filing-text/${urlToCacheKey(url)}.json`;
  const { data, fromCache } = await cachedFetch<{ text: string }>(cachePath, async () => {
    const html = await secFetchText(url);
    const text = stripHtml(html).slice(0, MAX_CHARS);
    return { text };
  });
  return { text: data.text, fromCache };
}
