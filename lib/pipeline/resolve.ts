/**
 * SESSION 27, STAGE 2 — STEP 1, FIND THE COMPANY (pipeline_design §1).
 *
 * A name, a ticker or a CIK, against EDGAR's company_tickers.json (the list itself cached as today). Every match is
 * collected — a CIK directly, a ticker by exact match, a name by exact, prefix and all-tokens match — and more than
 * one is returned to choose from. Nothing is cached per query: a guess is never made permanent (the old resolveCik's
 * fault, lib/fetch/cik.ts). $0.
 */
import { cachedFetch } from "../fetch/cache";
import { secFetchJson } from "../fetch/http";

export interface CompanyMatch { cik: string; title: string; ticker: string }
export type Resolution = { kind: "one"; match: CompanyMatch } | { kind: "choose"; matches: CompanyMatch[] } | { kind: "none"; reason: string };
type Entry = { cik_str: number; ticker: string; title: string };

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|holdings|holding|ltd|plc|llc|group)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(SUFFIX, "").replace(/\s+/g, " ").trim();
const toMatch = (e: Entry): CompanyMatch => ({ cik: String(e.cik_str).padStart(10, "0"), title: e.title, ticker: e.ticker });

/** Pure: every registrant the query can mean. */
export function matchCompany(query: string, entries: Entry[]): Resolution {
  const q = query.trim();
  if (!q) return { kind: "none", reason: "Enter a company name, ticker or CIK" };
  if (/^\d{1,10}$/.test(q)) {
    const hit = entries.find((e) => e.cik_str === Number(q));
    return hit ? { kind: "one", match: toMatch(hit) } : { kind: "none", reason: `No SEC registrant has CIK ${q.padStart(10, "0")}` };
  }
  const tick = entries.filter((e) => e.ticker.toLowerCase() === q.toLowerCase());
  const target = norm(q);
  const tokens = target.split(" ").filter(Boolean);
  const byName = target ? entries.filter((e) => {
    const t = norm(e.title);
    return t === target || t.startsWith(target) || (tokens.length > 0 && tokens.every((tok) => t.split(" ").includes(tok) || t.split(" ").some((w) => w.startsWith(tok))));
  }) : [];
  // One registrant can list several tickers (share classes): one CIK is one match.
  const seen = new Map<string, CompanyMatch>();
  for (const e of [...tick, ...byName]) if (!seen.has(String(e.cik_str))) seen.set(String(e.cik_str), toMatch(e));
  const all = [...seen.values()];
  if (all.length === 1) return { kind: "one", match: all[0] };
  if (all.length > 1) return { kind: "choose", matches: all.slice(0, 25) };
  return { kind: "none", reason: `No SEC registrant matches "${q}"` };
}

/** The company list (cached as a whole, as before), then every match. */
export async function resolveCompany(query: string): Promise<Resolution> {
  const { data } = await cachedFetch<Record<string, Entry>>("edgar/company_tickers.json", () => secFetchJson<Record<string, Entry>>("https://www.sec.gov/files/company_tickers.json"));
  return matchCompany(query, Object.values(data));
}
