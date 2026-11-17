/**
 * SESSION 27 (Akshay, Nov 16): WHAT EACH ADOPTED FACTS FILE WAS READ FROM — the card input its facts stage ran on, at the
 * commit that first wrote that facts content (traced Nov 16), and the documents that input put before the model.
 *
 * Before the one deciding function, the facts input held the anchor, the card input's later filings, its debt-item 8-Ks
 * since the latest 10-K, and the 10-K note the anchor directs to, each only where the card input held its text. A facts
 * file records only those documents (factsDocs.test S7), never the build's full read set.
 *
 * Cigna's (Oct 16) source input recorded no read set and is not listed: its facts name no read set.
 */
import { execSync } from "node:child_process";
import { readSetDocsKey, factsReadSetOf } from "../factsValidity";

export const ADOPTED_FACTS_SOURCES: { cik: string; commit: string; path: string }[] = [
  { cik: "0000070318", commit: "90df520", path: "sessions/27/refresh/0000070318_input.json" },
  { cik: "0000785161", commit: "e7db1bf", path: "sessions/27/refresh/0000785161_input.json" },
  { cik: "0000927066", commit: "0ec837a", path: "sessions/27/refresh/0000927066_input.json" },
  { cik: "0001108109", commit: "90df520", path: "sessions/27/refresh/0001108109_input.json" },
  { cik: "0001179929", commit: "ee071dd", path: "sessions/27/molina_review_input.json" },
];

/** The documents the pre-Nov 16 facts input put before the model, from that card input alone. */
export function heldByOldFactsInput(snap: any): string[] {
  const dm = snap.result.results.find((r: any) => r.triggerId === "debt-maturity");
  const has = (u: string | undefined) => !!u && !!snap.docs[u];
  const urls = [dm.debtScheduleSourceFiling.url];
  for (const f of snap.laterFilings ?? []) if (has(f.url)) urls.push(f.url);
  for (const f of snap.debtEightKs ?? []) if (has(f.url)) urls.push(f.url);
  if (has(dm.priorPeriodBase?.filingUrl)) urls.push(dm.priorPeriodBase.filingUrl);
  return [...new Set(urls)];
}

const cache = new Map<string, any>();
const sourceInput = (commit: string, path: string) => {
  const k = `${commit}:${path}`;
  if (!cache.has(k)) cache.set(k, JSON.parse(execSync(`git show ${k}`, { encoding: "utf-8", maxBuffer: 256e6 })));
  return cache.get(k);
};

export function adoptedFactsSources() {
  return ADOPTED_FACTS_SOURCES.map((s) => ({
    ...s,
    heldUrls: () => heldByOldFactsInput(sourceInput(s.commit, s.path)),
    fullReadSetKey: () => factsReadSetOf(sourceInput(s.commit, s.path).result)!,
    heldKey: () => readSetDocsKey(heldByOldFactsInput(sourceInput(s.commit, s.path))),
  }));
}
