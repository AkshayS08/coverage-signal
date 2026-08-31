/**
 * SESSION 20 (1c) — THE REVIEW QUEUE.
 *
 * One page listing every flag across both books in one place: company, what
 * is flagged, why, and where to look. Flags already render on the surfaces
 * they belong to — a walk that will not tie says so on its own ladder, a
 * suppressed card leaves its line stated — but they render SCATTERED, one
 * company at a time, so reviewing a book means opening ten places and
 * remembering what you found.
 *
 * NO NEW DATA. This collects what already renders. If something appears
 * here that appears nowhere else, that is a bug in this file, not a feature:
 * the review queue must never become the only place a problem is visible,
 * because then the primary surface is lying by omission.
 */
import type { CompanyTableBlock } from "./portfolioTable";
import type { CompanyResult } from "../agent";

export type FlagKind =
  | "walk-does-not-tie"
  | "anchor-does-not-tie"
  | "coverage-incomplete"
  | "rows-not-verified"
  | "no-schedule-located"
  | "card-suppressed"
  | "read-failure"
  | "failed-fetch"
  | "period-gap";

export interface FlaggedItem {
  company: string;
  kind: FlagKind;
  /** What is flagged, in the same words the primary surface uses. */
  what: string;
  /** Why it is flagged — the reason a reviewer needs to decide what to do. */
  why: string;
  /** Where to look: the surface this already renders on. */
  where: string;
}

/** Ordered most-actionable first: a wrong position outranks a missing card. */
const KIND_RANK: Record<FlagKind, number> = {
  "failed-fetch": 0,
  "rows-not-verified": 1,
  "walk-does-not-tie": 2,
  "anchor-does-not-tie": 3,
  "coverage-incomplete": 4,
  "no-schedule-located": 5,
  "read-failure": 6,
  "card-suppressed": 7,
  "period-gap": 8,
};

/**
 * Collects one company's flags from what its rendered block already states.
 * Reads the block, never the raw trigger — the queue must agree with the
 * page, and reading a different source is how the two drift apart.
 */
export function flagsForCompany(table: CompanyTableBlock, result: CompanyResult): FlaggedItem[] {
  const out: FlaggedItem[] = [];
  const ladder = table.refiLadder;

  if (ladder?.rowsNotVerifiedAsTranscribed) {
    out.push({
      company: table.company,
      kind: "rows-not-verified",
      what: "the ladder's rows are not verified as a complete transcription",
      why: ladder.completenessStatement || "the note's own total and the rows below it do not agree",
      where: "refi ladder — completeness line",
    });
  } else if (ladder?.hasData && ladder.walkCheck && !ladder.walkCheck.pass) {
    out.push({
      company: table.company,
      kind: "walk-does-not-tie",
      what: "Check 1 (internal walk) does not tie",
      why: ladder.completenessStatement || "the rows and adjustments do not reconcile to the note's stated subtotal",
      where: "refi ladder — completeness line",
    });
  }

  if (ladder?.hasData && ladder.balanceSheetCheck && !ladder.balanceSheetCheck.pass) {
    out.push({
      company: table.company,
      kind: "anchor-does-not-tie",
      what: "Check 2 (balance-sheet anchor) does not tie",
      why: ladder.completenessStatement || "no subtotal matched the balance-sheet debt captions",
      where: "refi ladder — completeness line",
    });
  }

  // SESSION 20, STAGE 4 — COVERAGE IS A FLAG, NOT ONLY A LINE.
  //
  // "Does this ladder describe the company's debt" is the question the other
  // two checks cannot ask, so a ladder that ties internally and to the
  // balance sheet while missing an entire term loan reaches this queue only
  // through here. Both halves are flagged, separately, because they mean
  // different things: an unexplained residual is a size problem, a stated
  // category with nothing captured is a whole instrument nobody has.
  if (ladder?.hasData && ladder.coverage && ladder.coverage.statedTotalDebt !== null && (ladder.coverage.residualPasses === false || ladder.coverage.categoriesMissing.length > 0)) {
    out.push({
      company: table.company,
      kind: "coverage-incomplete",
      what:
        ladder.coverage.residualPasses === false
          ? "coverage: the ladder does not account for the anchor's stated total debt"
          : "coverage: an instrument the note states is not captured",
      why: ladder.coverage.line,
      where: "refi ladder — coverage line",
    });
  }
  // And a ladder that cannot be measured at all says so rather than passing
  // silently: no anchor caption means the denominator is missing.
  if (ladder?.hasData && ladder.coverage && ladder.coverage.statedTotalDebt === null) {
    out.push({
      company: table.company,
      kind: "coverage-incomplete",
      what: "coverage is unmeasured — no balance-sheet debt caption from the anchor",
      why: ladder.coverage.line,
      where: "refi ladder — coverage line",
    });
  }

  const debtMaturity = result.results.find((t) => t.triggerId === "debt-maturity");
  if (debtMaturity?.fired && (debtMaturity.scheduleSequence?.length ?? 0) === 0) {
    out.push({
      company: table.company,
      kind: "no-schedule-located",
      what: "debt-maturity fired but no schedule was located",
      why: debtMaturity.columnReadFailure
        ? "the located region's columns could not be read consistently"
        : "no filing carried a locatable debt-schedule note",
      where: "refi ladder — empty, with its reason stated",
    });
  }

  for (const bucket of Object.values(table.buckets)) {
    for (const line of bucket) {
      if (line.periodGapNote) {
        out.push({
          company: table.company,
          kind: "period-gap",
          what: line.description.slice(0, 90),
          why: line.periodGapNote,
          where: "portfolio table — the line's own gap note",
        });
      }
    }
  }

  if (table.cardCount === 0 && table.emptyStateLine) {
    out.push({
      company: table.company,
      kind: "card-suppressed",
      what: "no card this week",
      why: table.emptyStateLine,
      where: "company header — empty-state line",
    });
  }

  return out;
}

/** A company that could not be assessed at all. Its flag comes from the run, not from a block it never produced. */
export function flagForFailedFetch(company: string, message: string): FlaggedItem {
  return {
    company,
    kind: "failed-fetch",
    what: "could not be assessed",
    why: message,
    where: "book header — counted as an attempt (1b)",
  };
}

export interface FlaggedItemsPage {
  items: FlaggedItem[];
  /** Companies represented, so the page can say what it covers rather than implying the whole book. */
  companiesFlagged: number;
  companiesAssessed: number;
  headline: string;
}

export function buildFlaggedItemsPage(
  blocks: { table: CompanyTableBlock; result: CompanyResult }[],
  failures: { company: string; message: string }[] = []
): FlaggedItemsPage {
  const items = [
    ...failures.map((f) => flagForFailedFetch(f.company, f.message)),
    ...blocks.flatMap((b) => flagsForCompany(b.table, b.result)),
  ].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.company.localeCompare(b.company));

  const companiesFlagged = new Set(items.map((i) => i.company)).size;
  const companiesAssessed = blocks.length + failures.length;
  // Never "0 flags" as a bare number: a clean book and an unrun book look
  // identical that way, and one of them is a lie.
  const headline =
    items.length === 0
      ? `No flags — ${companiesAssessed} compan${companiesAssessed === 1 ? "y" : "ies"} assessed, every check resolved.`
      : `${items.length} flag${items.length === 1 ? "" : "s"} across ${companiesFlagged} of ${companiesAssessed} compan${companiesAssessed === 1 ? "y" : "ies"}.`;

  return { items, companiesFlagged, companiesAssessed, headline };
}
