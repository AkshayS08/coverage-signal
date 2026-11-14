/**
 * SESSION 27 (Akshay, Nov 14, 2026): SERVED FROM ITS LAST BUILD BETWEEN TRIGGERS — the read set's date, decided once.
 *
 * A refresh trigger is a new 10-Q or 10-K, or an 8-K carrying Item 1.01, 1.02, 2.03, 2.04 or 8.01 (decision 1, Oct 29).
 * Between triggers a card's read set is the one its last build read (baselines/builds.json): a later filing that is not
 * a trigger is listed in the header, not read, until the next trigger. Where a trigger has come since the last build,
 * the read set is taken as of that trigger.
 *
 * THE 8-K RULE (Nov 14): from a trigger on or after Nov 14, a read set's 8-Ks are only those carrying debt items
 * (1.01, 1.02, 2.03, 2.04, 7.01, 8.01) filed since the latest 10-K, and none if there are none (no fallback). Answers
 * built under the earlier rule are served until the name's next trigger.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REFRESH_TRIGGER_ITEMS = ["1.01", "1.02", "2.03", "2.04", "8.01"];
export const DEBT_ITEMS_V2 = ["1.01", "1.02", "2.03", "2.04", "7.01", "8.01"];
export const READ_SET_RULE_V2_FROM = "2026-11-14";

type F = { form: string; filingDate: string; items?: string | null };
const hasItem = (f: F, set: string[]) => String(f.items ?? "").split(",").some((i) => set.includes(i.trim()));
export const isTrigger = (f: F): boolean => f.form === "10-Q" || f.form === "10-K" || (f.form === "8-K" && hasItem(f, REFRESH_TRIGGER_ITEMS));

let BUILDS: Record<string, { readSetAsOf: string }[]> | null = null;
function builds(): Record<string, { readSetAsOf: string }[]> {
  if (!BUILDS) {
    try { BUILDS = JSON.parse(readFileSync(join(process.cwd(), "baselines", "builds.json"), "utf-8")).builds ?? {}; } catch { BUILDS = {}; }
  }
  return BUILDS!;
}
const pad = (cik: string) => String(cik).padStart(10, "0");

/** The latest trigger filed on or before `asOf`, or null. */
export function lastTriggerDate(filings: F[], asOf: string): string | null {
  return filings.filter((f) => f.filingDate <= asOf && isTrigger(f)).map((f) => f.filingDate).sort().pop() ?? null;
}

/** The date a read set is taken as of: the last build's, unless a trigger has come since; then that trigger's. */
export function readSetDateFor(cik: string, filings: F[], asOf: string): string {
  const trig = lastTriggerDate(filings, asOf);
  const last = (builds()[pad(cik)] ?? []).map((b) => b.readSetAsOf).filter((d) => d <= asOf).sort().pop() ?? null;
  if (last && (!trig || trig <= last)) return last;
  return trig ?? asOf;
}

/** The filing list as the read set may see it. */
export function frozenFilings<T extends F>(cik: string, filings: T[], asOf: string): T[] {
  const d = readSetDateFor(cik, filings, asOf);
  return filings.filter((f) => f.filingDate <= d);
}

/** The 8-K rule of Nov 14: debt-item 8-Ks filed since the latest 10-K, newest first; none if none. */
export function selectEightKsV2<T extends F>(filings: T[]): T[] {
  const byDate = [...filings].sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));
  const tenK = byDate.find((f) => f.form === "10-K");
  return byDate.filter((f) => f.form === "8-K" && hasItem(f, DEBT_ITEMS_V2) && (!tenK || f.filingDate >= tenK.filingDate));
}
