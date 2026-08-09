/**
 * Shared, SDK-free types/helpers for the portfolio-table per-company
 * summary (Session 12 Part B). Split out of sonnetPortfolioSummary.ts —
 * which pulls in the Anthropic SDK — the same way DraftedEventBriefing
 * lives in eventBriefing.ts rather than sonnetEventBriefing.ts, so the
 * client bundle (app/page.tsx) can import the type without dragging the
 * SDK along.
 */
export interface DraftedPortfolioSummary {
  /** 2-4 sentences of plain prose. Empty when source is "failed" — the UI renders the failure banner in its place, never blank-but-styled-as-normal prose. */
  summary: string;
  source: "sonnet" | "failed";
  /** Present only when source is "failed" — the stage/reason a caller should log and a banner should display. */
  failureReason?: string;
}

/**
 * The loud-failure result: no synthesized or deterministic prose, just a
 * clearly-flagged failure the UI renders as a banner in place of the
 * summary. Same contract as eventBriefing.ts's failedEventBriefing — never
 * a silent degrade to template-style output.
 */
export function failedPortfolioSummary(company: string, reason: string): DraftedPortfolioSummary {
  console.error(`[portfolioSummary] NARRATION FAILURE — company=${company} reason=${reason}`);
  return { summary: "", source: "failed", failureReason: reason };
}
