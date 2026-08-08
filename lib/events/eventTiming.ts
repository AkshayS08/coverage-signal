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

const AVG_DAYS_PER_MONTH = 30.44;

/** Whole months from `now` to `dateIso` — negative when `dateIso` is in the past. */
export function monthsBetween(dateIso: string, now: Date): number {
  const d = new Date(dateIso);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * AVG_DAYS_PER_MONTH));
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
    };
  }
  return {
    monthsToNearestFuture: null,
    alreadyPast: eventStatus === "completed",
    isPendingLive,
    dateGranularity: null,
  };
}
