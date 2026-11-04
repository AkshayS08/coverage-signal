/**
 * SESSION 27 (Akshay, Nov 3, 2026) — NEVER PRICE OR EXTRACT ON A FILING LIST OLDER THAN THE REQUEST.
 *
 * The filing list is cached for 24 hours (FILING_CACHE_TTL_MS). On Nov 3 that let Encompass's refresh be priced on a
 * list cached two hours before its Q3 10-Q appeared, anchoring on the Aug 7 10-Q. Before any billed build or pricing,
 * the list is verified newer than the request, or re-fetched from EDGAR ($0, nothing written to the shared cache) and
 * compared: a filing EDGAR lists on or before the request (and the pinned read-set date, if any) that the list lacks
 * refuses the build, by name. (pipeline_design.md, Stage 2.)
 */
import type { FilingEntry } from "./filings";
import { getRecentFilings } from "./filings";
import { liveFilingsBetween } from "./thisWeek";

type Listed = Pick<FilingEntry, "form" | "filingDate" | "accessionNumber">;
const FORMS = new Set(["8-K", "10-Q", "10-K"]);

/** Whether a cached filing list may be priced or extracted on, for a request made at requestAt. Pure. */
export function filingListVerdict(x: { cachedAt: string | null; requestAt: string; cached: Listed[]; live: Listed[] | null; asOf?: string | null }): { ok: boolean; reason: string } {
  if (x.cachedAt && x.cachedAt >= x.requestAt) return { ok: true, reason: `the list was fetched at ${x.cachedAt}, after the request (${x.requestAt})` };
  if (!x.live) return { ok: false, reason: `the list was fetched at ${x.cachedAt ?? "an unknown time"}, before the request (${x.requestAt}), and was not re-fetched from EDGAR` };
  const cutoff = [x.requestAt.slice(0, 10), x.asOf ?? "9999-12-31"].sort()[0];
  const have = new Set(x.cached.map((f) => f.accessionNumber));
  const missing = x.live.filter((f) => FORMS.has(f.form) && f.filingDate <= cutoff && !have.has(f.accessionNumber));
  return missing.length
    ? { ok: false, reason: `EDGAR lists ${missing.map((f) => `${f.form} ${f.filingDate}`).join(", ")}, filed on or before the request, which the filing list (fetched ${x.cachedAt ?? "earlier"}) lacks` }
    : { ok: true, reason: `re-fetched from EDGAR: the list holds every 8-K, 10-Q and 10-K filed through ${cutoff}` };
}

/** Refuses (throws) unless the filing list a build or pricing will read is current for a request made at requestAt. */
export async function assertFilingListCurrent(companyName: string, requestAt: string = new Date().toISOString()): Promise<void> {
  const r = await getRecentFilings(companyName, ["8-K", "10-Q", "10-K"]);
  const cik = r.cik;
  const live = await liveFilingsBetween(cik, "2000-01-01", requestAt.slice(0, 10));
  const v = filingListVerdict({ cachedAt: null, requestAt, cached: r.filings, live, asOf: process.env.READ_SET_AS_OF ?? null });
  if (!v.ok) throw new Error(`STALE FILING LIST for ${companyName}: ${v.reason}. Nothing priced or billed; re-run after the list is current.`);
}
