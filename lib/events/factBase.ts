import type { CompanyResult, TriggerResult } from "../agent";
import { extractFactTokens } from "../agent/factTokens";

/**
 * One verified fact about a company — built ONLY from triggers whose quote
 * passed verification (lib/agent/verifyQuote.ts). This is the entire
 * factual universe Sonnet is allowed to draw numbers/dates/rates from when
 * narrating a card (see sonnetEventBriefing.ts) — a fact that isn't in
 * this list cannot legitimately appear in any card text, and the
 * deterministic audit (numberGuard.ts) checks exactly that.
 */
export interface VerifiedFact {
  /** Which trigger this fact came from — lets the caller find "the headline's own fact" in the list. */
  linkedTriggerId: string;
  /** Short label for the fact, e.g. the trigger name — for prompt readability, not itself a source of truth. */
  fact: string;
  /** The literal verified text backing this fact — a prose quote or a table-row snippet, exactly as shown in the UI's source-text expander. Raw, unscaled — for verification/audit, never altered. */
  verifiedText: string;
  /** Same fact as verifiedText, but with any bare table figure resolved to its scale-normalized dollar form where a governing scale declaration was found (lib/agent/scaleNormalize.ts) — this is what Sonnet is given as the stateable value, so a table cell "1,500" under a "dollars in millions" declaration reads as "$1.5 billion," not a bare number nobody can safely interpret. Identical to verifiedText when no bare figures needed normalizing. */
  normalizedText: string;
  /** Money/percent tokens found in normalizedText, as raw strings (e.g. "$1.5 billion", "5.125%"). */
  figures: string[];
  /** Date tokens found in verifiedText, as raw strings (e.g. "November 18, 2025"). */
  dates: string[];
  /** Most recent citation backing this fact, if any — EDGAR metadata, not model output. */
  sourceFiling: { form: string; date: string; url: string } | null;
}

function mostRecentCitation(citations: TriggerResult["citations"]): TriggerResult["citations"][number] | null {
  if (citations.length === 0) return null;
  return [...citations].sort((a, b) => b.date.localeCompare(a.date))[0];
}

/**
 * Every verified fact about one company — the full factual universe for
 * that company's card narrative, not just the headline's own fact. A
 * trigger that fired but whose quote failed verification (see
 * verifyQuote.ts) NEVER produces a fact here, regardless of how urgent or
 * plausible it looks — this is the gate that keeps a fabricated claim
 * (e.g. DaVita's "$1.75B due Dec 31, 2026") from ever reaching Sonnet, in
 * any card, for any company, under any framing.
 */
export function buildVerifiedFactBase(result: CompanyResult): VerifiedFact[] {
  const facts: VerifiedFact[] = [];
  for (const t of result.results) {
    if (!t.fired || !t.quoteVerified || !t.verifiedQuote) continue;
    const normalizedText = t.verifiedQuoteNormalized ?? t.verifiedQuote;
    const tokens = extractFactTokens(normalizedText);
    facts.push({
      linkedTriggerId: t.triggerId,
      fact: t.triggerName,
      verifiedText: t.verifiedQuote,
      normalizedText,
      figures: tokens.filter((tok) => tok.kind === "money" || tok.kind === "percent").map((tok) => tok.raw),
      dates: tokens.filter((tok) => tok.kind === "date").map((tok) => tok.raw),
      sourceFiling: mostRecentCitation(t.citations),
    });
  }
  return facts;
}
