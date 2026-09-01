import type { DateGranularity, EventStatus } from "../agent/claude";
import type { TriggerResult } from "../agent";
import { computeTiming, computeWindowDate, daysBetween } from "./eventTiming";
import { isFreshEvent, parseQoQIncreasePercent, type TimingInfo } from "./textHeuristics";
import type { LadderRow } from "./position";

/** The card-eligibility spec's core test: dated/live AND actionable within ~12-18mo. */
export interface EligibilityResult {
  cardEligible: boolean;
  reason: string;
  timing: TimingInfo;
}

const REFI_WINDOW_MONTHS = 18;
const CASH_JUMP_THRESHOLD_PCT = 30;
/** A completed issuance only cards if it's this recent — see the proceeds test below. Single named tunable, per spec. */
export const PROCEEDS_RECENCY_DAYS = 90;

/**
 * Per-trigger card-eligibility rules (Session 11 rewrite) — pure arithmetic
 * over the structured eventDate/eventStatus/proceedsUse fields (Step 2),
 * no regex-scanning of evidence prose for timing anymore. Every bucket
 * runs the same two universal hard rules FIRST, before any per-trigger
 * logic — there are no trigger cases exempt from them:
 *
 *   - eventStatus "standing" -> TABLE, always, no exceptions.
 *   - eventStatus "completed" -> TABLE, for every trigger EXCEPT
 *     "new-debt-issuance", which instead runs the completed-issuance
 *     proceeds test (a genuinely fresh, not-fully-applied raise can still
 *     be worth a card) — see the case below.
 *
 * This is what fixes the HCA class of bug: status gates the branch BEFORE
 * any date is even looked at, so a redeemed note's now-irrelevant former
 * due date can never be reached, let alone mistaken for an upcoming
 * maturity.
 *
 * Session 18 D2: a third universal restriction, alongside the two above —
 * `cashAmount: null` never cards, for any trigger reached by this function.
 * (Not "any trigger" without qualification: "debt-maturity" no longer comes
 * through here at all — see evaluateRowEligibility below, which is governed
 * by D1/the position instead.) This is what stops a pharmacy launch, a JV
 * formation, or a held-for-sale classification from carding just because
 * the disclosure happens to mention money with no amount actually stated
 * for THIS event.
 */
/**
 * Session 18 (post-v16) — THE ONE D2 EXEMPTION: a named discrete capex
 * project cards with or without a stated amount.
 *
 * Found by reverse assertion R1, which exists precisely to tell
 * discrimination apart from blanket suppression. UHS discloses Miller
 * Medical Plaza — 80,000 rentable square feet, completion December 2026, a
 * 10-year master flex lease — and D2 held it to the table for want of a
 * dollar figure. Verified against the filing text at zero cost: there is no
 * figure to capture. No money appears within 700 characters of any mention
 * of the project, in either the 10-Q or the 10-K. The only money near the
 * Medical Center is MD&A operating expense ($61M salaries, $4M running
 * costs), which is not a project cost and is correctly not bound to it. So
 * D2 was suppressing a real financing conversation over a number the filing
 * never printed — a building under construction is a term-loan discussion
 * whether or not its cost is disclosed.
 *
 * SCOPED TO THE TRIGGER, NEVER THE COMPANY, and deliberately narrow to
 * capex-program. Measured across the whole book, three fired triggers have a
 * projectName with a null cashAmount, and a blanket "named project cards"
 * rule would card all three:
 *   - UHS capex-program        "…Miller Medical Plaza"                  <- must card (R1)
 *   - Cigna new-subsidiary     "Evernorth EnGuide Pharmacy"             <- must NOT (item 7)
 *   - Quest new-subsidiary     "Michigan laboratory testing JV entity"  <- must NOT (item 8)
 * Neither cashAmount nor projectName separates them; only what the trigger
 * IS does. A capex programme is a capital deployment with a financing need
 * by construction; an entity formation is not, which is exactly why items 7
 * and 8 hold those to the table. Every other trigger still requires an
 * amount, so this cannot widen anything else.
 *
 * Still structural, not a vocabulary guard: it reads whether a discrete
 * project was NAMED, never what the name says. A capex line with no named
 * project (routine period spend — item 10's HCA/Quest/Tenet/DaVita figures)
 * is untouched and stays a table line, which is the distinction item 10 and
 * R1 draw between them.
 */
function namedProjectExemptFromD2(trigger: TriggerResult): boolean {
  return trigger.triggerId === "capex-program" && trigger.projectName !== null && trigger.projectName.trim() !== "";
}

/**
 * SESSION 19, ITEM 2c — A DATED PROJECT IS NEVER `standing`.
 *
 * `standing` means an undated recurring disclosure — a programme the company
 * runs every year with no particular date attached. A project with a STATED
 * completion date is not that. It is upcoming before that date and completed
 * after it, and which one it is follows from the date and today, with
 * nothing left to judge.
 *
 * Deliberately in CODE, not in extraction. The model copies the date the
 * filing prints and stops there — item 2c's prompt says so explicitly — for
 * the same reason every other derived value in this pipeline is derived
 * here: a status is a comparison against `now`, `now` is not in the filing,
 * and a cached extraction would freeze whatever `now` happened to be on the
 * day it ran. One filer's medical office building is "scheduled to be
 * completed in December 2026"; that is `upcoming` today and `completed` in
 * January, from the same extracted string.
 *
 * A bare year is compared at its END (December 31), the same worst-case
 * convention eventTiming.ts uses for windowing — a project stated as
 * completing "in 2027" is not finished until 2027 is.
 */
export function statusFromProjectCompletion(
  completionDate: string | null,
  granularity: DateGranularity | null,
  now: Date
): EventStatus | null {
  if (!completionDate) return null;
  const iso =
    granularity === "year" || /^\d{4}$/.test(completionDate)
      ? `${completionDate.slice(0, 4)}-12-31`
      : completionDate.length === 7
        ? `${completionDate}-28`
        : completionDate;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return at >= now.getTime() ? "upcoming" : "completed";
}

export function evaluateEligibility(trigger: TriggerResult, now: Date = new Date()): EligibilityResult {
  const { eventStatus, eventDate, dateGranularity, triggerId } = trigger;
  const timing = computeTiming(eventStatus, eventDate, dateGranularity, now);

  if (eventStatus === "standing") {
    return { cardEligible: false, reason: "standing condition, no dated change", timing };
  }
  if (eventStatus === "completed" && triggerId !== "new-debt-issuance") {
    return { cardEligible: false, reason: "already completed — nothing left to win", timing };
  }
  if (trigger.cashAmount === null && !namedProjectExemptFromD2(trigger)) {
    return { cardEligible: false, reason: "no stated cash amount for this event — held to table", timing };
  }

  switch (triggerId) {
    // --- Treasury / deposits ---
    case "asset-sale":
    case "ipo-secondary":
      return { cardEligible: true, reason: "dated capital event", timing };

    case "new-subsidiary":
      // INTERNAL/rarely-disclosed; when it does fire it's reporting one
      // specific formation event, which is inherently dated.
      return { cardEligible: true, reason: "dated entity-formation event", timing };

    case "large-cash-balance": {
      const qoq = parseQoQIncreasePercent(trigger.evidence);
      if (qoq !== null && qoq > CASH_JUMP_THRESHOLD_PCT) {
        return { cardEligible: true, reason: `cash up ${qoq.toFixed(0)}% QoQ`, timing };
      }
      return { cardEligible: false, reason: "standing cash level or QoQ jump uncomputable", timing };
    }

    // --- New debt / financing need ---
    case "new-debt-issuance": {
      // Session 15 Part D fix: the proceeds test must run for BOTH
      // "completed" AND "just_announced" issuances — the diagnosed bug
      // (UHS's Aug 11 2026 $1.1B notes, proceedsUse "refinancing_only")
      // was that this branch only ever consulted proceedsUse once the
      // raise had settled, so an underwriting-agreement-stage issuance
      // with proceeds already fully committed to refinancing carded
      // unconditionally — proceedsUse was computed and available, just
      // never read. Only "upcoming" (a not-yet-priced planned issuance,
      // with nothing for the proceeds classifier to have found) still
      // takes the old unconditional-true path below.
      if (eventStatus === "completed" || eventStatus === "just_announced") {
        const windowDate = computeWindowDate(eventDate, dateGranularity);
        if (trigger.proceedsUse === "partly_unapplied" && windowDate) {
          // daysBetween(date, now) is positive when `date` is in the FUTURE
          // (see eventTiming.ts) — the issuance's own windowDate is in the
          // past by the time either status reaches this branch (a
          // completed issuance's settlement date, or a just_announced
          // issuance's own announcement date), so negate it to get "days
          // ago" as a positive number.
          const daysAgo = -daysBetween(windowDate, now);
          if (daysAgo >= 0 && daysAgo <= PROCEEDS_RECENCY_DAYS) {
            return { cardEligible: true, reason: `proceeds partly unapplied, issued ${daysAgo}d ago`, timing };
          }
          return {
            cardEligible: false,
            reason: `proceeds partly unapplied but issued ${daysAgo}d ago — beyond the ${PROCEEDS_RECENCY_DAYS}d window`,
            timing,
          };
        }
        if (trigger.proceedsUse === "refinancing_only") {
          return { cardEligible: false, reason: "proceeds fully applied to refinancing — nothing left to win", timing };
        }
        return { cardEligible: false, reason: `${eventStatus} issuance, use of proceeds not disclosed`, timing };
      }
      // upcoming: a not-yet-priced planned issuance — proceeds can't be
      // evaluated yet, since there's nothing in the filing yet for the
      // proceeds classifier to have found.
      return { cardEligible: true, reason: "dated capital event", timing };
    }

    case "acquisition-announced":
      // Runs the universal test via timing.isPendingLive (computed
      // centrally in eventTiming.ts — this case does no recency math of
      // its own): a just-announced deal cards while it's still recent,
      // and stops once it ages past PENDING_LIVE_MAX_AGE_DAYS with no
      // other qualifying date. Previously unconditional true — the same
      // omission already fixed for new-debt-issuance/capex-program, just
      // reached through eventStatus persisting indefinitely instead of an
      // explicit unconditional return.
      return timing.isPendingLive
        ? { cardEligible: true, reason: "financing need from announced deal", timing }
        : { cardEligible: false, reason: "acquisition announced, but beyond the pending-live window — no longer recent", timing };

    case "capex-program":
      // isFreshEvent is already wired for dividend-buyback/floating-rate-debt/
      // international-expansion below — this trigger previously had no
      // freshness check at all (the single largest source of false
      // positives found in the Step 1 audit: "each year"/"actively pursue"
      // standing programs carding unconditionally).
      {
        // Session 19, item 2c: a project with a stated completion date has a
        // derived status and is never `standing`. Applied here, before the
        // freshness heuristic, because a dated project does not need one —
        // "is it recurring boilerplate" is the question you ask when there
        // is no date to ask a better one.
        const derived = statusFromProjectCompletion(trigger.projectCompletionDate, trigger.projectCompletionGranularity, now);
        if (derived === "upcoming") return { cardEligible: true, reason: "project with a stated completion date still ahead", timing };
        if (derived === "completed") return { cardEligible: false, reason: "project completed — its stated completion date has passed", timing };
      }
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "capex program newly announced", timing }
        : { cardEligible: false, reason: "ongoing/recurring capex program", timing };

    case "revolver-near-capacity":
      return { cardEligible: false, reason: "standing revolver utilization", timing };

    case "dividend-buyback":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly increased/announced authorization", timing }
        : { cardEligible: false, reason: "ongoing/unchanged program", timing };

    // --- Refi (debt maturity) — Session 18: MOVED OUT of this function
    // entirely. A debtSchedule with N rows needs N independent
    // eligibility decisions (one tranche can be 6 months out and cardable
    // while its neighbor is 3 years out), which a single TriggerResult ->
    // single EligibilityResult call can never express. See
    // evaluateRowEligibility below, called once per LadderRow from the
    // assembled position (lib/events/position.ts) instead. If this
    // function is ever called with triggerId "debt-maturity", that's a
    // wiring bug upstream — falls through to the default "no card rule"
    // case below rather than silently reusing stale single-fact logic.

    // --- FX / rate hedging ---
    case "floating-rate-debt":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly issued floating-rate debt", timing }
        : { cardEligible: false, reason: "standing floating-rate exposure", timing };

    case "international-expansion":
      return isFreshEvent(trigger.evidence)
        ? { cardEligible: true, reason: "newly disclosed foreign revenue", timing }
        : { cardEligible: false, reason: "standing international exposure", timing };

    case "commodity-exposure":
    case "fx-exposure":
      return { cardEligible: false, reason: "standing exposure, no dated change", timing };

    default:
      return { cardEligible: false, reason: "no card rule for this trigger", timing };
  }
}

/**
 * Session 18 D1 + the refi card test, per LADDER ROW instead of per
 * trigger — debt-maturity's replacement for the deleted switch case above.
 * Same date-window logic, byte-for-byte: dated + ≤18mo out + not a
 * bare-year row cards; everything else stays table-only. What changed is
 * only what the gate is ALLOWED TO LOOK AT — D1 (only a `live` row is even
 * considered; `retired`/`unconfirmed` never reach the date test) runs
 * first, reusing the position layer's own status instead of guessing from
 * a citation or an evidence sentence.
 */
export function evaluateRowEligibility(row: LadderRow, now: Date = new Date()): EligibilityResult {
  const timing = computeTiming("upcoming", row.maturityDate, row.dateGranularity, now);

  // SESSION 21, ITEM 1A — CAPACITY NEVER CARDS.
  //
  // A committed but undrawn facility renders on the ladder, because
  // headroom is a fact an RM wants beside a maturity. It is not a
  // refinancing conversation: there is nothing to refinance until it is
  // drawn. Decided on the flag the position set from debtContribution, so
  // the ladder, the coverage figure and this gate all read one decision.
  if (row.isCapacity) {
    return { cardEligible: false, reason: "committed but undrawn — capacity, not a maturity to refinance", timing };
  }

  if (row.status === "retired") {
    return { cardEligible: false, reason: "retired — redeemed by a later issuance", timing };
  }
  if (row.status === "unconfirmed") {
    return { cardEligible: false, reason: "unconfirmed — dropped from the newest filing with no redemption explaining it, held to table", timing };
  }
  // C1 — the filing states this tranche at nil. Real, worth rendering, and
  // not a refinancing conversation: there is nothing left to refinance.
  if (row.status === "repaid") {
    return { cardEligible: false, reason: "repaid — the filing states a nil balance for this tranche", timing };
  }
  // D3 — the stated maturity has already passed. Never live, never cardable.
  // The explanation, where the corpus carries one, rides on the row itself
  // (retiredBy) rather than being asserted here.
  if (row.status === "matured") {
    return {
      cardEligible: false,
      reason: row.retiredBy
        ? "matured — the stated maturity date has passed, and an issuance in the corpus names this tranche"
        : "matured — the stated maturity date has passed, with nothing in the corpus stating how it was repaid",
      timing,
    };
  }

  if (timing.monthsToNearestFuture === null) {
    // SESSION 21, ITEM 1C — A DATE IN THE PAST IS NOT A MISSING DATE.
    //
    // computeTiming returns null for BOTH "the filing states no maturity"
    // and "the maturity it states has already gone by", and this branch
    // reported both as "no verifiable date". Measured on the worked
    // example: UHS's $700M 1.65% notes card on 2026-09-01 and, on
    // 2026-09-02, leave the card surface entirely under a reason saying the
    // date could not be verified — when the filing states it exactly and
    // the note has simply matured with nothing in the corpus confirming
    // repayment. That is the most callable item in the book disappearing
    // behind a false explanation, which is Rule 3 twice over: suppressed,
    // and mislabelled on the way out.
    //
    // The two cases are told apart by whether a date was stated at all. A
    // matured instrument is still held to the table here — Session 22's
    // Tier 2 is what gives it a pending state — but it says what it is.
    if (row.maturityDate) {
      return {
        cardEligible: false,
        reason: `matured ${row.maturityDate} — the stated maturity has passed and nothing in the corpus confirms repayment; held to table pending an 8-K`,
        timing,
      };
    }
    return { cardEligible: false, reason: "approaching maturity, but the filing states no date for it — held to table", timing };
  }
  if (timing.monthsToNearestFuture > REFI_WINDOW_MONTHS) {
    return { cardEligible: false, reason: "maturity 18+ months out", timing };
  }
  if (timing.dateGranularity === "year") {
    // D1 (Session 18, post-stage-2) — THE SAME ARITHMETIC THAT EXCLUDES ALSO
    // INCLUDES.
    //
    // A bare year has no disclosed month, so the code applies December 31 as
    // its window date (eventTiming.ts's computeWindowDate) — the latest date
    // the year could mean. That convention is what makes EXCLUSION safe: if
    // even the latest possible date is outside the window, every possible
    // date is. Held to the table on that basis, a bare-year row could never
    // card at all, which over-suppresses in exactly the mirror-image case:
    // if the EARLIEST possible date is also inside the window, then every
    // possible date is inside, and the row is cardable on the year alone.
    //
    // The check above has already established December 31 is within the
    // window. All that remains is January 1 — if any part of the year is
    // already past, the year is only partly inside and it stays table-only.
    //
    // Pure arithmetic on two dates the calendar defines. No month is
    // recovered, nothing is inferred, and nothing is presented as a date the
    // filing stated.
    const year = String(row.maturityDate ?? "").slice(0, 4);
    const yearStartsInFuture = /^\d{4}$/.test(year) && daysBetween(`${year}-01-01`, now) >= 0;
    if (yearStartsInFuture) {
      return { cardEligible: true, reason: `matures during ${year} — the whole year falls inside the ${REFI_WINDOW_MONTHS}-month window, so no month is needed`, timing };
    }
    return { cardEligible: false, reason: `bare-year maturity (${row.maturityDate}) — only part of that year falls inside the window and no month is stated, held to table`, timing };
  }
  return { cardEligible: true, reason: `maturity ~${timing.monthsToNearestFuture}mo out`, timing };
}
