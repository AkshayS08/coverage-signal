import type { CompanyResult, TriggerResult } from "../agent";
import { scoreTrigger } from "./score";
import { templateOpener } from "./opener";

export interface RankedCompany {
  company: string;
  cik: string;
  ticker: string;
  score: number;
  /** All fired credit/treasury triggers, highest-scoring first. */
  triggers: TriggerResult[];
  topTrigger: TriggerResult;
  opener: string;
  confidence: number;
}

/**
 * Deterministic ranker: score each CALL-verdict company by its
 * highest-scoring fired credit/treasury trigger (score = need_value x
 * recency x confidence — need_value weights treasury above credit).
 * Companies with no actionable trigger, and distress-only companies,
 * are excluded — distress is a relationship flag, never a sell signal.
 */
export function rankCompanies(results: CompanyResult[], now: Date = new Date()): RankedCompany[] {
  const ranked: RankedCompany[] = [];

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

    ranked.push({
      company: result.company,
      cik: result.cik,
      ticker: result.ticker,
      score: top.score,
      triggers: scored.map((s) => s.trigger),
      topTrigger: top.trigger,
      opener: templateOpener(top.trigger),
      confidence: top.trigger.confidence,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
