/**
 * SESSION 19, ITEM 2d — THE proceedsUse INPUT, BOUNDED.
 *
 * This call answers a three-way enum with a 200-token budget and was, until
 * now, the single most expensive thing in a cold pass. Measured across the
 * live book: 1,304,830 characters, about 326,208 input tokens, roughly 59%
 * of a full-book bill.
 *
 * WHERE IT ACTUALLY GOES, measured rather than assumed. The cited filings —
 * the pricing 8-Ks, whose entire subject is the issuance — total 217,390
 * characters across eight companies. The other 1,087,440, EIGHTY-THREE
 * PERCENT of the input, is one supplementary document: loop.ts appends each
 * company's most recent 10-Q whole, because use-of-proceeds language is
 * "routinely in Liquidity and Capital Resources". One filer's 10-Q is
 * 327,767 characters on its own.
 *
 * THE BOUND, and why each half of it is where it is:
 *
 *   A cited filing under WHOLE_FILING_CHARS is sent WHOLE. Every pricing
 *   8-K in the book measures 4,361 to 17,071 characters; the threshold sits
 *   above all of them. Windowing a document whose whole subject is this
 *   issuance would save almost nothing and would introduce an anchor-miss
 *   risk on the one source most likely to carry the answer.
 *
 *   Anything larger — a supplementary 10-Q, or a cited filing that happens
 *   to BE a 10-Q — is reduced to regions around the issuance's own
 *   discriminating figures, with PROCEEDS_CONTEXT_CHARS on each side.
 *   Measured: where the issuance is locatable in a large filing, the
 *   use-of-proceeds sentence sits +695, +762 and +1,224 characters from it.
 *   3,000 each way is over twice the largest observed distance, and the
 *   window is centred on the anchor rather than starting at it because a
 *   filing can state the use before the announcement as easily as after.
 *
 *   MAX_PROCEEDS_REGIONS caps a pathological filing that names the same
 *   figures many times. Regions are merged when they overlap, so the cap
 *   bounds total size rather than arbitrarily dropping a later mention.
 *
 * WHAT HAPPENS WHEN THERE IS NO ANCHOR, stated because it is the honest
 * failure mode: a large SUPPLEMENTARY filing contributes nothing. It is
 * supplementary — the cited filing is the primary source and is still sent
 * whole — and sending 327,767 characters on the chance that an unanchored
 * sentence is in there is the cost this item exists to remove. If that
 * flips a company's classification, that is a finding to report with both
 * values and the input diff, never a reason to widen the bound until the
 * answer comes back the way it used to.
 */
import { discriminatingDigitGroups } from "./verifyQuote";

/** Every pricing 8-K in the live book is smaller than this; all of them are sent whole. */
export const WHOLE_FILING_CHARS = 20_000;
/** Each side of an anchor. Over twice the largest measured anchor-to-answer distance. */
export const PROCEEDS_CONTEXT_CHARS = 3_000;
/** Caps a filing that repeats the same figures; regions merge before this bites. */
export const MAX_PROCEEDS_REGIONS = 4;

export interface BoundedFilingInput {
  /** The text actually sent for this filing — whole, excerpted, or empty. */
  text: string;
  /** How it was bounded, for the run report. */
  mode: "whole" | "excerpted" | "no-anchor";
  originalChars: number;
  sentChars: number;
  regions: number;
}

/** Merges overlapping/adjacent spans so the cap bounds SIZE, not mentions. */
function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Bounds ONE filing's contribution to the proceedsUse input.
 *
 * `anchorText` is the issuance's own verified quote/evidence — the figures
 * in it are what locate this issuance inside a long document.
 */
export function boundProceedsFilingText(text: string, anchorText: string): BoundedFilingInput {
  const originalChars = text.length;
  if (originalChars <= WHOLE_FILING_CHARS) {
    return { text, mode: "whole", originalChars, sentChars: originalChars, regions: 1 };
  }

  // The same discriminating figures the quote verifier uses to tell one
  // instrument from another — never a vocabulary list of proceeds words,
  // which would decide the answer by choosing the input.
  const anchors = discriminatingDigitGroups(anchorText);
  const spans: { start: number; end: number }[] = [];
  for (const anchor of anchors) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(anchor, from);
      if (at === -1) break;
      spans.push({ start: Math.max(0, at - PROCEEDS_CONTEXT_CHARS), end: Math.min(text.length, at + anchor.length + PROCEEDS_CONTEXT_CHARS) });
      from = at + anchor.length;
      if (spans.length > MAX_PROCEEDS_REGIONS * 8) break;
    }
  }

  const merged = mergeSpans(spans).slice(0, MAX_PROCEEDS_REGIONS);
  if (merged.length === 0) {
    return { text: "", mode: "no-anchor", originalChars, sentChars: 0, regions: 0 };
  }

  const excerpt = merged
    .map((s) => `[…filing text from character ${s.start}…]\n${text.slice(s.start, s.end)}`)
    .join("\n\n[…]\n\n");
  return { text: excerpt, mode: "excerpted", originalChars, sentChars: excerpt.length, regions: merged.length };
}
