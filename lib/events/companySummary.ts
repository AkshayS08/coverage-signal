import { BUCKET_LABELS, type Bucket } from "./buckets";
import type { CompanyPortfolio, EventRecord, FlashCard } from "./buildEvents";
import { compactLabelWithTiming } from "./labels";

export interface PortfolioSummary {
  /** "Call this week: <reason>" when this company has a flash card, else "No immediate action". */
  actionLine: string;
  /** One bullet per bucket that has any signal — plain language, not prose. Never repeats the flash card's own text. */
  bullets: string[];
}

const BUCKET_ORDER: Bucket[] = ["treasury", "new_debt", "refi", "hedging"];

function eventPhrase(event: EventRecord): string {
  // All triggers in one dedup cluster share the cluster's own combined
  // timing (see buildEvents.ts's combineTiming) — reused per-trigger here
  // since this is a single label for the whole cluster, not per-trigger.
  const labels = event.triggers.map((t) => compactLabelWithTiming(t.triggerId, t.triggerName, event.timing)).join(" + ");
  if (event.cardEligible) return `${labels} — this week`;
  if (event.bucket === "hedging") return `${labels} — standing, worth flagging for a hedging conversation`;
  return `${labels} — standing`;
}

/**
 * Deterministic portfolio-table summary: an action line plus one bullet per
 * bucket that has any signal, in plain language. Built entirely from data
 * buildEvents already computed — no model call, and deliberately does NOT
 * reuse the flash card's own What/Why/Angle text; this is the fuller
 * portfolio view, a bulleted state-of-the-company read, not a repeat of
 * the card.
 */
export function buildPortfolioSummary(portfolio: CompanyPortfolio, card: FlashCard | null): PortfolioSummary {
  const actionLine = card
    ? `Call this week: ${compactLabelWithTiming(card.headlineTrigger.triggerId, card.headlineTrigger.triggerName, card.timing)}`
    : "No immediate action";

  const bullets = BUCKET_ORDER.filter((b) => portfolio.buckets[b].length > 0).map(
    (b) => `${BUCKET_LABELS[b]}: ${portfolio.buckets[b].map(eventPhrase).join("; ")}.`
  );

  return { actionLine, bullets };
}
