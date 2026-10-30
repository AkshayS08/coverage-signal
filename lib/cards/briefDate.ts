/**
 * SESSION 27 (Akshay, Oct 30, 2026) — THE BRIEF DATE AND ITS WEEK, BY RULE.
 *
 * The brief date was a constant ("2026-10-15") in every entry point. It is now
 * today's date where EDGAR keeps time (New York), unless a date is given. The
 * header's week, the "this week" filing status, the 18-month window's end and
 * every "months away" count derive from it in buildCard.
 *
 * The brief week runs from the day after the name's previous brief through
 * the brief date; a name's first brief is the trailing seven days.
 */
import { addDays } from "./format";

/** Today's date in New York, as YYYY-MM-DD. */
export function briefDateFor(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The brief date an entry point uses: the one given on its command line, else today's. */
export function briefDateArg(argv: string[] = process.argv): string {
  return argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? briefDateFor();
}

export function briefWeek(briefDate: string, previousBrief: string | null): { from: string; to: string } {
  return { from: previousBrief ? addDays(previousBrief, 1) : addDays(briefDate, -6), to: briefDate };
}
