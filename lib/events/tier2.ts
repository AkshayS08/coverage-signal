/**
 * SESSION 21, STAGE 3 — TWO TIERS, NEVER BLENDED.
 *
 * The ladder answers one question — what does this company owe — and it has
 * been answering it from two incompatible dates at once. Tier 1 is the
 * anchor: a balance sheet, at a period end, with a total to check against.
 * Tier 2 is what has happened since. Both are real, and averaging them
 * produces a position that is true at no date at all.
 *
 * THE COVERAGE PERCENTAGE BELONGS ONLY TO TIER 1, and that is not a
 * presentation choice. Coverage divides captured face by STATED TOTAL DEBT,
 * and stated total debt comes from a balance sheet. There is no balance
 * sheet for "the anchor plus three weeks", so there is no denominator, so
 * there is no percentage. A Tier 2 total is a roll-forward and says so:
 * unverified until the next 10-Q.
 *
 * WHAT MAKES AN EVENT TIER 2 IS STRUCTURAL, and it is not "the citation is
 * newer than the anchor's period". Every 10-Q is filed after its own period
 * end, so that test puts a company's own anchor filing in Tier 2 — measured
 * across the book, it would have wrongly promoted HCA, Encompass and Quest,
 * whose redemptions are described in the anchor's own debt note. The test is
 * the one the Encompass fix already established: IDENTITY FIRST. An event is
 * Tier 2 when its source document is NOT the anchor and post-dates the
 * anchor's period of report.
 *
 * NETS, NEVER STACKS. An issuance adds its stated amount; a repayment
 * subtracts against the exact named tranche; an intended-but-unconfirmed
 * repayment subtracts NOTHING and stays on the ladder marked pending. Debt
 * is not removed because somebody said they meant to pay it.
 *
 * SESSION 21, STAGE 4 — AN EVENT WITH NO AMOUNT IN ITS OWN FILING.
 *
 * A filing can state that something happened without stating how much. UHS
 * is the worked example: two 8-Ks say the underwriters' affiliates "will
 * receive a portion of the proceeds of the transactions as a result of the
 * repayment of the outstanding borrowings under the Issuer's revolving
 * credit facility", and neither prints a figure. The $225 million is in a
 * DIFFERENT filing, the 10-Q, where it describes a June 30 BALANCE and not
 * an August repayment.
 *
 * So the event is real and its size is not. Both halves render:
 *
 *   THE EVENT   date, instrument, and the verbatim sentence that states it.
 *   THE GAP     "amount not stated in the confirming filing", said on the
 *               surface in those words.
 *   THE EFFECT  nothing. It nets zero, because the only figure available
 *               lives in another document and joining them is a stitch, not
 *               a reading.
 *
 * TWO REASONS AN EVENT CAN NET ZERO, AND THEY ARE NOT THE SAME REASON.
 * "unsized" means we do not know how much. "unconfirmed" means we do not
 * know that it happened. An event can be both. The `nets` field says which,
 * and the rolled total names both counts rather than quietly presenting a
 * partial roll-forward as the whole of what has moved.
 */
import type { LadderRow } from "./position";
import type { DebtScheduleFilingRef } from "../agent/claude";

export type Tier2Kind = "issuance" | "repayment" | "pending";

export interface Tier2Event {
  kind: Tier2Kind;
  /** The date the filing states for the event. */
  date: string | null;
  /** Signed dollars against the anchor position. Null when the event moves no verified amount — a pending repayment is exactly that. */
  effect: number | null;
  /**
   * WHY this event moves nothing, when it moves nothing. Null when it does
   * move something. Never collapsed into a single "didn't count" state:
   *
   *   "unsized"       the confirming filing states no amount. The event is
   *                   established; its size is not, and no figure is
   *                   borrowed from another document to supply one.
   *   "unconfirmed"   no filing states it as done. An intention is not a
   *                   completion, and a matured tranche nobody has
   *                   confirmed paid is still owed.
   *
   * An unconfirmed event that also states no amount reports "unconfirmed":
   * it would net zero on that ground even with a figure attached.
   */
  nets: null | "unsized" | "unconfirmed";
  /** The instrument, as the filing names it. */
  instrument: string;
  /** Verbatim, from the filing that states it. Every Tier 2 line carries its own source. */
  sourceLine: string;
  citedUrl: string;
  /** What this line means, in the reader's terms. */
  note: string;
}

export interface Tier2 {
  events: Tier2Event[];
  /** Anchor captured face plus the net of every event with a verified effect. Null when Tier 1 has no measurable base. */
  rolledTotal: number | null;
  /** The label the rolled total must always carry. */
  rolledLabel: string | null;
  /** The anchor this rolls forward FROM. */
  anchorDate: string | null;
}

/**
 * IDENTITY FIRST. A document that IS the anchor cannot describe an event
 * "since" the anchor, whatever its filing date says — see this module's own
 * header for the three companies that test would otherwise have promoted.
 */
export function isPostAnchorSource(
  citedUrl: string | null | undefined,
  citationDate: string | null | undefined,
  anchor: DebtScheduleFilingRef | null | undefined
): boolean {
  if (!anchor?.url || !citedUrl || !citationDate) return false;
  if (citedUrl === anchor.url) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(citationDate) || !/^\d{4}-\d{2}-\d{2}$/.test(anchor.reportDate ?? "")) return false;
  return citationDate > (anchor.reportDate as string);
}

const money = (n: number): string =>
  Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(3).replace(/\.?0+$/, "")}B` : `$${Math.round(n / 1e6)}M`;

/**
 * Builds Tier 2 from rows the position already assembled and from the
 * matured-but-unexplained rows Tier 1 is holding.
 *
 * `postAnchorIssuances` are ladder rows whose provenance is a pricing 8-K
 * that post-dates the anchor. `maturedUnconfirmed` are Tier 1 rows whose
 * stated maturity has passed with nothing in the corpus confirming
 * repayment — the pending state, which exists because a matured obligation
 * nobody has confirmed paid is the most callable thing a book can contain
 * and the least safe thing to drop.
 */
export function buildTier2(params: {
  anchor: DebtScheduleFilingRef | null | undefined;
  anchorCapturedFace: number | null;
  postAnchorIssuances: LadderRow[];
  maturedUnconfirmed: LadderRow[];
  confirmedRepayments: { instrument: string; amount: number | null; date: string | null; sourceLine: string; citedUrl: string }[];
  /** Intentions stated by a filing that post-dates the anchor. They subtract nothing — an intention is not a completion — and they render so a reader knows one exists. */
  pendingIntentions?: { instrument: string; amount: string | null; date: string | null; sourceLine: string; citedUrl: string }[];
  parseAmount: (raw: string) => number | null;
}): Tier2 {
  const { anchor, anchorCapturedFace, postAnchorIssuances, maturedUnconfirmed, confirmedRepayments, parseAmount } = params;
  const pendingIntentions = params.pendingIntentions ?? [];
  const events: Tier2Event[] = [];

  for (const row of postAnchorIssuances) {
    const value = parseAmount(row.amount);
    events.push({
      kind: "issuance",
      date: row.issuedOn?.date ?? null,
      effect: value,
      nets: value === null ? "unsized" : null,
      instrument: row.instrument,
      sourceLine: row.sourceLine,
      citedUrl: row.issuedOn?.citedUrl ?? row.citedUrl,
      note:
        value === null
          ? `priced after the anchor — amount not stated in the confirming filing, so NOTHING IS ADDED. The issuance is stated; its size is not, and no figure is taken from another document to supply one`
          : `priced after the anchor — ADDS ${money(value)} to the position`,
    });
  }

  for (const r of confirmedRepayments) {
    events.push({
      kind: "repayment",
      date: r.date,
      effect: r.amount === null ? null : -Math.abs(r.amount),
      nets: r.amount === null ? "unsized" : null,
      instrument: r.instrument,
      sourceLine: r.sourceLine,
      citedUrl: r.citedUrl,
      // The confirmed-but-unsized line. It says the repayment happened and
      // says it cannot size it, in one line, and subtracts nothing — the
      // tranche stays on the ladder at its full anchor balance rather than
      // being reduced by a figure that came from somewhere else.
      note:
        r.amount === null
          ? `repayment confirmed by this filing — amount not stated in the confirming filing, so NOTHING IS SUBTRACTED and this tranche is still carried in full. Sizing it would mean taking a figure from a document that does not state this repayment`
          : `repayment confirmed by the filing — SUBTRACTS ${money(Math.abs(r.amount))} against this tranche`,
    });
  }

  for (const i of pendingIntentions) {
    events.push({
      kind: "pending",
      date: i.date,
      effect: null,
      // BOTH can be true and "unconfirmed" is the binding one: this nets
      // zero because nothing says it happened, which holds whether or not a
      // figure is attached. The unsized half is still SAID, in the note.
      nets: "unconfirmed",
      instrument: i.instrument,
      sourceLine: i.sourceLine,
      citedUrl: i.citedUrl,
      note: `PENDING — the filing states an INTENTION to repay${i.amount ? ` ${i.amount}` : ""}, not a repayment. Nothing is subtracted; it moves only when a filing says it happened${i.amount ? "" : `. And amount not stated in the confirming filing, so there is no figure to move even once it is confirmed`}`,
    });
  }

  for (const row of maturedUnconfirmed) {
    events.push({
      kind: "pending",
      date: row.maturityDate,
      // NOTHING. This is the whole point of the pending state: the tranche
      // is still on the ladder and still counted, because no filing says it
      // was paid.
      effect: null,
      nets: "unconfirmed",
      instrument: row.instrument,
      sourceLine: row.sourceLine,
      citedUrl: row.citedUrl,
      note: `PENDING — matured ${row.maturityDate ?? "(date unstated)"} and still carried at ${row.amount}; no 8-K in the corpus confirms repayment, so nothing is subtracted. It leaves the ladder when a filing says it has, not before`,
    });
  }

  const netted = events.reduce((a, e) => a + (e.effect ?? 0), 0);
  const rolledTotal = anchorCapturedFace === null || events.length === 0 ? null : anchorCapturedFace + netted;

  // SESSION 21, STAGE 4 — THE ROLL-FORWARD SAYS WHAT IT LEFT OUT.
  //
  // A total built from events, some of which moved nothing, is not the whole
  // of what has moved — and a reader has no way to see that from the number.
  // The two reasons are named separately because they are different
  // problems: an unsized event needs a filing that prints the figure, an
  // unconfirmed one needs a filing that says it happened.
  const unsized = events.filter((e) => e.nets === "unsized").length;
  const unconfirmed = events.filter((e) => e.nets === "unconfirmed").length;
  const omitted = [
    unsized > 0 ? `${unsized} whose confirming filing states no amount` : null,
    unconfirmed > 0 ? `${unconfirmed} that no filing confirms as done` : null,
  ].filter((x): x is string => x !== null);

  return {
    events,
    rolledTotal,
    rolledLabel:
      rolledTotal === null
        ? null
        : `adjusted for events since ${anchor?.reportDate ?? "the anchor"}, unverified against a balance sheet until the next 10-Q` +
          (omitted.length > 0
            ? ` — and it EXCLUDES ${omitted.join(" and ")}, listed above and each moving nothing, so this is not the whole of what has moved`
            : ""),
    anchorDate: anchor?.reportDate ?? null,
  };
}
