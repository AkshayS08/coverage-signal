import { cachedFetch } from "./cache";
import { secFetchText } from "./http";

// Modern SEC filings are inline XBRL: every tagged numeric/text fact in the
// human-readable document is machine-readable in place, PLUS a large
// <ix:header> block (schema refs + every "hidden" fact not meant to be
// visually rendered at all) sits right at the top of <body> — on a typical
// DaVita 10-Q this hidden block alone ran ~111k characters, ten times a
// 20k-char cap, meaning the truncated text handed to the model was 100%
// header noise and never reached the actual debt schedule / financial
// tables at all. Raised alongside stripping that block below.
const MAX_CHARS = 40000;

// SEC filings are full of typographic quotes/dashes around defined terms
// (the "Company", the "Buyer") and other punctuation, almost always encoded
// as numeric HTML entities in the raw source. Decoding only a hardcoded
// handful (as this used to) leaves entities like &#8220;/&#8221; as literal
// "&#8220;" text in the cached corpus — which a model reading it renders as
// a real curly quote in its own output, so a genuinely verbatim quote can
// never match. Decode broadly: named entities, numeric decimal, and
// numeric hex, so the cached text matches what any reader (human or model)
// actually perceives the filing to say.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  sect: "§",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
      .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function urlToCacheKey(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * Fetches a filing document's plain text, cached by URL. HTML is stripped
 * (including the non-visual inline-XBRL header/hidden-facts blocks) and
 * truncated to keep per-filing prompt cost bounded — 8-Ks are short enough
 * to survive intact; 10-Qs/10-Ks get the first ~40k chars, which reaches
 * past the cover page into the actual financial-statement tables (debt
 * schedule, etc.) rather than stopping at the cover page's XBRL facts.
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
