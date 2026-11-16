/**
 * SESSION 27 (Akshay, Nov 14, 2026): SERVED FROM ITS LAST BUILD BETWEEN TRIGGERS — the read set's date, decided once.
 *
 * A refresh trigger is a new 10-Q or 10-K, or an 8-K carrying Item 1.01, 1.02, 2.03, 2.04 or 8.01 (decision 1, Oct 29).
 * Between triggers a card's read set is the one its last build read (baselines/builds.json): a later filing that is not
 * a trigger is listed in the header, not read, until the next trigger. Where a trigger has come since the last build,
 * the read set is taken as of that trigger.
 *
 * THE 8-K RULE (Nov 14): a read set's 8-Ks are only those carrying debt items (1.01, 1.02, 2.03, 2.04, 7.01, 8.01) in
 * the read window (selectEightKsV2), none if there are none (no fallback).
 *
 * WHICH RULE A BUILD READS UNDER (Akshay, Nov 16): the new rule applies from each name's FIRST BUILD AFTER THE DECISION,
 * never by the trigger filing's date. A read set that is a recorded build keeps the rule that build recorded
 * (eightKRule); any new build — a trigger since the last build, or a name never built — reads under the new rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REFRESH_TRIGGER_ITEMS = ["1.01", "1.02", "2.03", "2.04", "8.01"];
export const DEBT_ITEMS_V2 = ["1.01", "1.02", "2.03", "2.04", "7.01", "8.01"];
export type EightKRule = 1 | 2;

type F = { form: string; filingDate: string; items?: string | null };
const hasItem = (f: F, set: string[]) => String(f.items ?? "").split(",").some((i) => set.includes(i.trim()));
export const isTrigger = (f: F): boolean => f.form === "10-Q" || f.form === "10-K" || (f.form === "8-K" && hasItem(f, REFRESH_TRIGGER_ITEMS));

type Build = { readSetAsOf: string; eightKRule: EightKRule };
let BUILDS: Record<string, Build[]> | null = null;
function builds(): Record<string, Build[]> {
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

/**
 * The 8-K rule of the build a read set is taken for: the recorded build's own rule when it is served from one (a recorded
 * build that names none is an error, never a default); the new rule for a new build.
 */
export function eightKRuleFor(cik: string, filings: F[], asOf: string): EightKRule {
  const d = readSetDateFor(cik, filings, asOf);
  const rec = (builds()[pad(cik)] ?? []).find((b) => b.readSetAsOf === d);
  if (!rec) return 2;
  if (rec.eightKRule !== 1 && rec.eightKRule !== 2) throw new Error(`baselines/builds.json: ${pad(cik)}'s build of ${d} names no 8-K rule`);
  return rec.eightKRule;
}

/** The filing list as the read set may see it. */
export function frozenFilings<T extends F>(cik: string, filings: T[], asOf: string): T[] {
  const d = readSetDateFor(cik, filings, asOf);
  return filings.filter((f) => f.filingDate <= d);
}

/** The start of a card's moves window: Jan 1 of its anchor period's year (the card's fyStart). One home. */
export function movesWindowStart(anchorReportDate: string): string {
  return `${anchorReportDate.slice(0, 4)}-01-01`;
}

/**
 * The 8-K rule of Nov 14, with its read window (Nov 14, readWindow.test): debt-item 8-Ks filed since the EARLIER of
 * the latest 10-K's filing date and the start of the card's moves window, newest first; none if none.
 */
export function selectEightKsV2<T extends F & { reportDate?: string }>(filings: T[]): T[] {
  const byDate = [...filings].sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));
  const tenK = byDate.find((f) => f.form === "10-K");
  const anchor = byDate.find((f) => f.form === "10-Q" || f.form === "10-K");
  const starts = [tenK?.filingDate, anchor?.reportDate ? movesWindowStart(anchor.reportDate) : undefined].filter((x): x is string => !!x).sort();
  const from = starts[0] ?? "";
  return byDate.filter((f) => f.form === "8-K" && hasItem(f, DEBT_ITEMS_V2) && f.filingDate >= from);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** A move's stated date as a span: a day, or a whole month. */
function spanOf(date: string): [string, string] | null {
  const d = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s*(\\d{4})`).exec(date);
  if (d) { const iso = `${d[3]}-${String(MONTHS.indexOf(d[1]) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`; return [iso, iso]; }
  const m = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{4})`).exec(date);
  if (m) { const mo = MONTHS.indexOf(m[1]) + 1, start = `${m[2]}-${String(mo).padStart(2, "0")}-01`; return [start, addDays(new Date(Date.UTC(+m[2], mo, 0)).toISOString().slice(0, 10), 0)]; }
  return null;
}

/**
 * FACT RETENTION (Nov 14): a move's full statement is the debt-item 8-K filed within a week of it (an 8-K is due within
 * four business days). Every such 8-K must be in the read set; each one that is not is a gap.
 */
export function retentionGaps(moves: { date: string; what: string }[], filings: (F & { accessionNumber: string })[], readSet: Set<string>): string[] {
  const out: string[] = [];
  for (const mv of moves) {
    const span = spanOf(mv.date);
    if (!span) continue;
    for (const f of filings) {
      if (f.form !== "8-K" || !hasItem(f, DEBT_ITEMS_V2) || f.filingDate < span[0] || f.filingDate > addDays(span[1], 7)) continue;
      if (!readSet.has(f.accessionNumber)) out.push(`${mv.what} (${mv.date}): its 8-K of ${f.filingDate} (Items ${f.items}) is not read`);
    }
  }
  return out;
}
