import type { DateGranularity, EventStatus } from "../agent/claude";
import type { TimingInfo } from "./textHeuristics";

/**
 * Pure date arithmetic over the STRUCTURED eventDate/eventStatus fields
 * (Session 11, Step 2) — replaces the old regex scan over evidence prose
 * (textHeuristics.ts's retired extractTimingInfo). No model call, no text
 * parsing, no guessing which date in a paragraph belongs to which fact:
 * eventDate is already the fact-guarded date for THIS fact specifically, so
 * this module only ever does "is this date in the future, and by how much."
 */

/**
 * SESSION 22, STAGE 1 — THE MONTH-COUNT CONVENTION, NAMED.
 *
 * Every month count in this build is WHOLE CALENDAR MONTHS COMPLETED: from
 * date A to date B, how many times one calendar month can be added to A
 * without passing B, clamping to the last day where the target month is
 * shorter. Negative when B precedes A.
 *
 * This replaces dividing elapsed days by an average month length and
 * rounding, which was wrong in two directions at once. It rounded, so a
 * tranche maturing three days ago read as "0 months out" with no sign to
 * tell a reader it had already gone (Rule 28's second worked example). And
 * it was an approximation nobody had named, so Encompass's 2026-05-29
 * issuance against a 2028-02-01 maturity printed "20 months" where
 * month-boundary counting says 21 — with nothing stating which the surface
 * meant. Under this convention it is 20, and 20 is what "20 months and 3
 * days have to pass" means.
 *
 * AND A COUNT NEVER DECIDES A WINDOW. `isWithinMonths` compares two dates,
 * so no rounding can carry a row across the 18-month boundary in either
 * direction. The count is for reading; the comparison is for deciding.
 */

/** A + n calendar months, clamped to the last day when the target month is shorter. */
function addMonths(base: Date, n: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  d.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds());
  return d;
}

/** Whole calendar months from `now` to `dateIso` — negative when `dateIso` is in the past. See the convention above. */
export function monthsBetween(dateIso: string, now: Date): number {
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return 0;
  const forward = target.getTime() >= now.getTime();
  const [from, to] = forward ? [now, target] : [target, now];
  let n = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // One calendar month too far when the day-of-month has not yet come round.
  if (n > 0 && addMonths(from, n).getTime() > to.getTime()) n--;
  return forward ? n : -n;
}

/**
 * Does `dateIso` fall on or before `months` calendar months after `now`?
 * The window gate — a comparison of two dates, never a comparison of counts.
 */
export function isWithinMonths(dateIso: string, now: Date, months: number): boolean {
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= addMonths(now, months).getTime();
}

/** "17 months" / "1 month" / "0 months". The count is the unit's own plural rule, nothing more. */
export function monthsLabel(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "month" : "months"}`;
}

/** Whole days from `now` to `dateIso` — negative when `dateIso` is in the past. */
export function daysBetween(dateIso: string, now: Date): number {
  const d = new Date(dateIso);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function isValidIsoDate(dateIso: string): boolean {
  return !Number.isNaN(new Date(dateIso).getTime());
}

/**
 * A "just_announced" fact only reads as live/pending for this many days
 * after its own eventDate — single named tunable, same pattern as
 * eligibility.ts's PROCEEDS_RECENCY_DAYS. Past this window, isPendingLive
 * goes false regardless of how the model still labels the status; nothing
 * in this pipeline relabels an old "just_announced" fact to "completed" on
 * its own, so without an age check it stays "live" forever. Confirmed
 * live: DaVita's Feb 2, 2026 acquisition agreement was still eventStatus
 * "just_announced" in an early-August fixture build (~186 days later) and
 * carded unconditionally — the same unconditional-true shape already
 * fixed once for new-debt-issuance/capex-program, just reached through
 * eventStatus persistence instead of an explicit `return {cardEligible:
 * true}`.
 */
export const PENDING_LIVE_MAX_AGE_DAYS = 90;

function isWithinPendingLiveWindow(eventDate: string | null, now: Date): boolean {
  if (!eventDate || !isValidIsoDate(eventDate)) return false;
  const ageDays = -daysBetween(eventDate, now); // daysBetween is positive for FUTURE dates; negate for age-in-days
  return ageDays >= 0 && ageDays <= PENDING_LIVE_MAX_AGE_DAYS;
}

/**
 * The date used for card-window arithmetic and sort order ONLY — never for
 * display. Day/month granularity already has a real, filing-disclosed
 * "YYYY-MM-DD", so windowDate is just eventDate itself. Year granularity
 * (a bare "2026", no month disclosed anywhere) has no real day to use, so
 * this applies a fixed, code-chosen worst-case convention — December 31 of
 * that year — purely so the fact can still be ordered/windowed at all.
 * This is fundamentally different from the model inventing a day: it's a
 * single, deterministic, clearly-labeled convention applied uniformly by
 * CODE, never presented as something the filing said. Callers building
 * user-facing text must branch on dateGranularity and never surface this
 * value directly — see eligibility.ts's debt-maturity case and
 * buildEvents.ts's describeFreshness.
 */
export function computeWindowDate(eventDate: string | null, granularity: DateGranularity | null): string | null {
  if (!eventDate || !granularity) return null;
  if (granularity === "year") {
    return /^\d{4}$/.test(eventDate) ? `${eventDate}-12-31` : null;
  }
  return eventDate;
}

/**
 * The gate's sole source of "when" and "is this future/past/live" — built
 * entirely from eventDate + eventDateGranularity + eventStatus, all
 * already fact-guarded/labeled by extraction (Step 2). A null or
 * unparseable eventDate falls back to eventStatus alone: "completed"
 * reads as already-past, "just_announced" reads as live-now-no-fixed-date
 * (subject to the pending-live age window below), everything else has no
 * computable timing at all (matches the spec's "eventDate: null -> cannot
 * card on a date rule" default).
 *
 * isPendingLive is computed ONCE, here, as eventStatus === "just_announced"
 * AND eventDate within PENDING_LIVE_MAX_AGE_DAYS — this is the ONLY place
 * that age check happens. Trigger cases in eligibility.ts read the result;
 * none of them do their own recency math for this signal.
 */
export function computeTiming(
  eventStatus: EventStatus,
  eventDate: string | null,
  granularity: DateGranularity | null,
  now: Date
): TimingInfo {
  const isPendingLive = eventStatus === "just_announced" && isWithinPendingLiveWindow(eventDate, now);

  const windowDate = computeWindowDate(eventDate, granularity);
  if (windowDate && isValidIsoDate(windowDate)) {
    const days = daysBetween(windowDate, now);
    if (days >= 0) {
      return {
        monthsToNearestFuture: monthsBetween(windowDate, now),
        alreadyPast: false,
        isPendingLive,
        dateGranularity: granularity,
        windowDate,
      };
    }
    // The date itself has passed — but for "just_announced" that's the
    // NORMAL case (an announcement's own date is essentially always in the
    // past by the time anyone evaluates "now" against it; eventStatus, not
    // the date's tense, is what says whether it's still live) — alreadyPast
    // stays keyed to status alone, unaffected by the pending-live age
    // window (a stale-but-still-"just_announced" fact hasn't necessarily
    // concluded, it's just no longer recent enough to read as "live" for
    // card purposes — two different questions).
    return {
      monthsToNearestFuture: null,
      alreadyPast: eventStatus !== "just_announced",
      isPendingLive,
      dateGranularity: granularity,
      windowDate,
    };
  }
  return {
    monthsToNearestFuture: null,
    alreadyPast: eventStatus === "completed",
    isPendingLive,
    dateGranularity: null,
    windowDate: null,
  };
}
