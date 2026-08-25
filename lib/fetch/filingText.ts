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
//
// Session 18: this used to be a hard 40,000-char cap applied HERE, at fetch
// time — meaning the CACHED text was already truncated, permanently, with
// no way to recover what was cut. That was fine when every trigger's fact
// lived in the first ~40k chars (true for single-sentence MD&A claims), but
// diagnosed live against real filings this session: a full per-tranche debt
// schedule sits anywhere from ~23k to ~613k chars into these companies'
// 10-Qs/10-Ks — ALL 30 of the 10 companies' baseline 10-Q/10-K filings
// exceeded the old 40k cap. Fetching and caching the FULL stripped text
// (still bounded by SANITY_CEILING_CHARS below, just to stop a genuinely
// pathological document from being cached unbounded) lets
// lib/fetch/debtNoteLocator.ts do the actual windowing downstream, at
// corpus-assembly time, where it can also serve verification (which needs
// the full text, not just whatever window was sent to the model) — see
// runAgentLoop in lib/agent/loop.ts.
const SANITY_CEILING_CHARS = 1_000_000;

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
 * Fetches a filing document's plain text, cached by URL, PERMANENTLY
 * (ttlMs: null) — unlike the filing LIST (which changes as companies file
 * new documents, see cache.ts's FILING_CACHE_TTL_MS), the text at a fixed
 * filing URL can never legitimately change once published. Re-fetching it
 * on a schedule would only add SEC load and latency for identical bytes;
 * only a genuinely new URL entering the filing list ever causes a fetch
 * here. HTML is stripped (including the non-visual inline-XBRL
 * header/hidden-facts blocks); the FULL stripped text is cached (see
 * SANITY_CEILING_CHARS above for why this is no longer truncated to 40k
 * here) — callers that need a bounded excerpt for the model prompt build it
 * downstream via lib/fetch/debtNoteLocator.ts's buildExtractionText.
 *
 * Cache path is versioned ("v2") so every filing-text entry cached under
 * the OLD 40k-truncated regime is cleanly orphaned rather than silently
 * replayed as if it were the full document — the same "bump a version
 * stamp, never delete" pattern lib/cache/promptVersion.ts already uses for
 * the answer/wording caches.
 */
export async function getFilingText(url: string): Promise<{ text: string; fromCache: boolean }> {
  const cachePath = `edgar/filing-text-v2/${urlToCacheKey(url)}.json`;
  const { data, fromCache } = await cachedFetch<{ text: string }>(
    cachePath,
    async () => {
      const html = await secFetchText(url);
      const text = stripHtml(html).slice(0, SANITY_CEILING_CHARS);
      return { text };
    },
    null
  );
  return { text: data.text, fromCache };
}
