import type { CompanyResult, TriggerResult } from "../agent";
import { scoreTrigger } from "./score";
import { templateBriefing, type DraftedBriefing } from "./briefing";

/**
 * Score threshold separating "call this week" from "monitor". Single
 * named constant so it's easy to retune against the real score
 * distribution (score = need_value x recency; treasury tops out at 1.5,
 * credit at 1.0, both decaying toward a 0.1 floor at 24 months old).
 *
 * Calibrated against a real run of the default 8-name book: scores came
 * back as 1.48, 1.32, 1.31, 1.15, 0.99, 0.99, 0.94, 0.92 — the top 3
 * (all treasury-led) sit clearly apart from the rest. 1.2 sits in that
 * gap, so roughly the top third clear the bar as calls; everything
 * credit-only lands in monitor unless it's unusually fresh.
 */
export const CALL_THRESHOLD = 1.2;

export interface RankedCompany {
  company: string;
  cik: string;
  ticker: string;
  score: number;
  /** All fired credit/treasury triggers, highest-scoring first. */
  triggers: TriggerResult[];
  topTrigger: TriggerResult;
  briefing: DraftedBriefing;
}

export interface MonitorEntry {
  company: string;
  score: number;
  topTrigger: TriggerResult;
}

export interface RankResult {
  /** Above CALL_THRESHOLD — full ranked cards. */
  calls: RankedCompany[];
  /** Below CALL_THRESHOLD but still had a fired credit/treasury trigger — compact list. */
  monitor: MonitorEntry[];
}

/**
 * Deterministic ranker: score each CALL-verdict company by its
 * highest-scoring fired credit/treasury trigger (score = need_value x
 * recency — need_value weights treasury above credit), then splits at
 * CALL_THRESHOLD into "call this week" vs "monitor". Companies with no
 * actionable trigger, and distress-only companies, are excluded entirely —
 * distress is a relationship flag, never a sell signal.
 */
export function rankCompanies(results: CompanyResult[], now: Date = new Date()): RankResult {
  const calls: RankedCompany[] = [];
  const monitor: MonitorEntry[] = [];

  for (const result of results) {
    if (result.verdict !== "CALL") continue;

    const callTriggers = result.results.filter(
      (r) => r.fired && (r.needType === "credit" || r.needType === "treasury")
    );
    if (callTriggers.length === 0) continue;

    const scored = callTriggers
      .map((trigger) => ({ trigger, score: scoreTrigger(trigger, now) }))
      .sort((a, b) => b.score - a.score);

    const top = scored[0];

    if (top.score >= CALL_THRESHOLD) {
      calls.push({
        company: result.company,
        cik: result.cik,
        ticker: result.ticker,
        score: top.score,
        triggers: scored.map((s) => s.trigger),
        topTrigger: top.trigger,
        briefing: templateBriefing(scored.map((s) => s.trigger)),
      });
    } else {
      monitor.push({ company: result.company, score: top.score, topTrigger: top.trigger });
    }
  }

  calls.sort((a, b) => b.score - a.score);
  monitor.sort((a, b) => b.score - a.score);

  return { calls, monitor };
}
