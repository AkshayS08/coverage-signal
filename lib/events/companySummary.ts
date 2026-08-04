import type { CompanyPortfolio } from "./buildEvents";

export interface DraftedCompanySummary {
  text: string;
  /** "card" = reused from that company's own flash-card summary, no extra Sonnet call. */
  source: "sonnet" | "template" | "card";
}

/**
 * Deterministic fallback — no model call. Only used for companies with NO
 * card-eligible event (companies that do have one reuse that card's own
 * drafted summary instead — see page.tsx), so this only needs to describe
 * a "nothing urgent, here's the state of things" picture.
 */
export function templateCompanySummary(portfolio: CompanyPortfolio): DraftedCompanySummary {
  const allEvents = Object.values(portfolio.buckets).flat();
  if (allEvents.length === 0) {
    return { text: "No credit or treasury signals fired this run.", source: "template" };
  }
  const names = allEvents.slice(0, 3).map((e) => e.triggers[0].triggerName);
  return {
    text: `Standing signals this quarter: ${names.join(", ")}. Nothing dated or near-term enough to clear the card threshold.`,
    source: "template",
  };
}
