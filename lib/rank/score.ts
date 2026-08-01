import type { TriggerResult } from "../agent";

/**
 * need_value weights — treasury/deposit triggers rank above credit (the
 * "insider skew" from the taxonomy: the bank sees treasury opportunities a
 * lending-first RM would miss). Distress triggers never score — they're
 * relationship flags, not sell opportunities, and are excluded from ranking
 * entirely (see rankCompanies).
 */
const NEED_VALUE: Record<TriggerResult["needType"], number> = {
  treasury: 1.5,
  credit: 1.0,
  distress: 0,
};

/**
 * Linear decay from 1.0 (today) to a 0.1 floor at 24 months old. Filings
 * older than 2 years still count for something (a trend can still matter)
 * but are heavily discounted relative to something filed this quarter.
 * Missing/unparseable dates get a neutral 0.5 rather than being excluded.
 */
export function recencyScore(dateStr: string | undefined, now: Date = new Date()): number {
  if (!dateStr) return 0.5;
  const filingDate = new Date(dateStr);
  if (Number.isNaN(filingDate.getTime())) return 0.5;
  const monthsAgo = (now.getTime() - filingDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const decayed = 1 - monthsAgo / 24;
  return Math.max(0.1, Math.min(1, decayed));
}

function mostRecentCitationDate(trigger: TriggerResult): string | undefined {
  const dates = trigger.citations.map((c) => c.date).filter((d) => d.length > 0);
  if (dates.length === 0) return undefined;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

/** score = need_value x recency. Confidence is deliberately not a factor. */
export function scoreTrigger(trigger: TriggerResult, now: Date = new Date()): number {
  const needValue = NEED_VALUE[trigger.needType];
  const recency = recencyScore(mostRecentCitationDate(trigger), now);
  return needValue * recency;
}
