/**
 * SESSION 27 (Akshay, Nov 16): CARD FACTS ARE VALID ONLY FOR THE READ SET THEY WERE READ FROM — NOT JUST THE ANCHOR.
 *
 * A read set is the documents a build read (its base read set). EDGAR filings do not change once filed, so their URLs
 * name them; the key is over those URLs, not the extraction fingerprint (which also covers the extraction prompt version
 * and the dig's candidates, which the facts stage does not read). One key, used by the facts cache key, the facts a
 * stage writes (CardFacts.readSet), adopted facts (factsForBuild), the card (buildCard) and the badge. Pure.
 */
import { createHash } from "node:crypto";
import type { CardFacts } from "./types";

/** The key of a set of documents: their URLs, sorted, once each. */
export function readSetDocsKey(urls: string[]): string {
  return createHash("sha256").update([...new Set(urls)].sort().join("\n")).digest("hex").slice(0, 24);
}

/** The read set a result was built from (its recorded base reads), or null where none was recorded. */
export function factsReadSetOf(result: { recordedReadSet?: { url: string; via: string }[] }): string | null {
  const base = (result.recordedReadSet ?? []).filter((r) => r.via === "base").map((r) => r.url);
  return base.length ? readSetDocsKey(base) : null;
}

/** May a card built from this result show these facts? Same anchor, and read over the same read set. */
export function factsValidFor(facts: CardFacts | null | undefined, result: { recordedReadSet?: { url: string; via: string }[] }, anchorUrl: string): boolean {
  if (!facts || facts.anchorUrl !== anchorUrl || !facts.readSet) return false;
  return facts.readSet === factsReadSetOf(result);
}
