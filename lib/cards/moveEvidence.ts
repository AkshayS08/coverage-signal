/**
 * SESSION 27 (Akshay, Nov 13, 2026): THE CARD'S DECIDING FUNCTIONS FOR A MOVE'S EVIDENCE — one home, called by the card
 * build and by the facts verifier, with no separate copy (verifierParity.test).
 *
 *  - quoteFound: a quote is in a text when the two match with spacing normalised ("10%" and "10 %", "$223" and
 *    "$ 223", "2032," and "2032 ,") and quote glyphs unified.
 *  - statesSameMove: a sentence states THIS move — the move's own verb, the note's coupon (or a "<year> … Notes" term
 *    in a document that prints the coupon), and never a document about the move (a notice, a press release, an
 *    announcement, an intention).
 *  - datesCompletedMove (ruling A2, Nov 4): a scheduled or expected day ("expected to be redeemed on September 23")
 *    never dates a completed move, and neither does a notice.
 */
import { couponsIn } from "./labels";

export const RETIRING_TYPES = new Set(["redemption", "special call", "tender or repurchase", "tender offer", "repayment at maturity", "paydown"]);
/** A document about a move, not the move: issuing a notice dates the notice. */
export const NOTICE = /\bnotice\b|\bpress release\b|\bannounc\w*|\bmay\s+redeem\b|\bintends?\s+to\b/i;
/** A day that has not happened as a completed move's day (ruling A2). */
export const SCHEDULED = /\bexpected to\b|\bscheduled\b|\bwill be\b|\bset for\b|\bconditional\b|\banticipat\w*/i;

/** The verb that states a move of this type done, or null for a type no verb dates. */
export function moveVerb(type: string): RegExp | null {
  return type === "issuance" ? /\b(?:issued|completed\s+(?:the|an|its|our)\s+(?:sale|offering|issuance))\b/i
    : RETIRING_TYPES.has(type) ? /\b(?:redeem\w*|redemption|repurchas\w*|repaid|retired)\b/i
    : null;
}

/** Spacing-normalised, glyph-normalised text for quote matching. */
export function quoteKey(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[\s ]+/g, "").toLowerCase();
}
export function quoteFound(text: string, quote: string): boolean {
  const q = quoteKey(quote);
  return q.length > 0 && quoteKey(text).includes(q);
}

/** Does `sentence` (in a document whose full text is `docText`) state this move, done? */
export function statesSameMove(sentence: string, move: { instrument: string; type: string }, docText: string): boolean {
  const verb = moveVerb(move.type);
  const own = couponsIn(move.instrument)[0]?.rate;
  if (!verb || own === undefined || !verb.test(sentence) || NOTICE.test(sentence)) return false;
  const year = (/\bdue\s+(?:[A-Z][a-z]+\s+)?(20\d\d)\b/.exec(move.instrument) ?? /\b(20\d\d)\b/.exec(move.instrument) ?? [])[1];
  const namesCoupon = couponsIn(sentence).some((c) => Math.abs(c.rate - own) < 1e-9);
  const namesTerm = !!year && new RegExp(`\\b${year}\\s+(?:Senior\\s+(?:Secured\\s+)?)?Notes\\b`).test(sentence) && couponsIn(docText).some((c) => Math.abs(c.rate - own) < 1e-9);
  return namesCoupon || namesTerm;
}

/** May this sentence date a completed move? Never a notice, never a scheduled or expected day (ruling A2). */
export function datesCompletedMove(sentence: string): boolean {
  return !NOTICE.test(sentence) && !SCHEDULED.test(sentence);
}
