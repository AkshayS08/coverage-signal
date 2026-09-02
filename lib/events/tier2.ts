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
  parseAmount: (raw: string) => number | null;
}): Tier2 {
  const { anchor, anchorCapturedFace, postAnchorIssuances, maturedUnconfirmed, confirmedRepayments, parseAmount } = params;
  const events: Tier2Event[] = [];

  for (const row of postAnchorIssuances) {
    const value = parseAmount(row.amount);
    events.push({
      kind: "issuance",
      date: row.issuedOn?.date ?? null,
      effect: value,
      instrument: row.instrument,
      sourceLine: row.sourceLine,
      citedUrl: row.issuedOn?.citedUrl ?? row.citedUrl,
      note: `priced after the anchor — ADDS ${value === null ? "an unstated amount" : money(value)} to the position`,
    });
  }

  for (const r of confirmedRepayments) {
    events.push({
      kind: "repayment",
      date: r.date,
      effect: r.amount === null ? null : -Math.abs(r.amount),
      instrument: r.instrument,
      sourceLine: r.sourceLine,
      citedUrl: r.citedUrl,
      note: `repayment confirmed by the filing — SUBTRACTS ${r.amount === null ? "an unstated amount" : money(Math.abs(r.amount))} against this tranche`,
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
      instrument: row.instrument,
      sourceLine: row.sourceLine,
      citedUrl: row.citedUrl,
      note: `PENDING — matured ${row.maturityDate ?? "(date unstated)"} and still carried at ${row.amount}; no 8-K in the corpus confirms repayment, so nothing is subtracted. It leaves the ladder when a filing says it has, not before`,
    });
  }

  const netted = events.reduce((a, e) => a + (e.effect ?? 0), 0);
  const rolledTotal = anchorCapturedFace === null || events.length === 0 ? null : anchorCapturedFace + netted;
  return {
    events,
    rolledTotal,
    rolledLabel:
      rolledTotal === null
        ? null
        : `adjusted for events since ${anchor?.reportDate ?? "the anchor"}, unverified against a balance sheet until the next 10-Q`,
    anchorDate: anchor?.reportDate ?? null,
  };
}
