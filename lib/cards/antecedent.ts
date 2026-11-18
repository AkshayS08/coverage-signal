/**
 * SESSION 27 (Nov 9): THE SENTENCES OF A DOCUMENT, BY PARAGRAPH, AND THE ANTECEDENT'S WINDOW — one home for both, read
 * by build.ts (antecedentParagraph.test).
 *
 * The card input's text keeps paragraph breaks ("\n\n", getFilingParagraphs). A sentence never spans two paragraphs.
 * Text captured before Nov 9 has none: it is one paragraph, split as before.
 */

/** A referring phrase: "this borrowing", "this offering", "the Notes" (Nov 7; shared with the facts verifier, Nov 13). */
export const REFERS = /\b(?:this|the)\s+(?:borrowing|offering|issuance)\b|\bthe\s+Notes\b/;
/** A note heading ("5. Redeemable Noncontrolling Interests"): an antecedent search stops there. */
export const HEADING = /^\d{1,2}\.\s+[A-Z][a-z]+/;

/**
 * Nov 18 (Akshay, ruling A2 — a date failure never drops a move): A SENTENCE SPENDING "THE NET (ISSUANCE) PROCEEDS"
 * REFERS TO THE OFFERING THAT RAISED THEM, as "this offering" does. Its antecedent is the earlier sentence of its
 * paragraph that states that offering or borrowing (issued, priced, completed the sale, borrowed, drew), never merely the
 * nearest dated one (Tenet: "We will pay interest … beginning March 15, 2027" sits between the redemption and its
 * offering). One home, read by the facts verifier and the parity check.
 */
/**
 * Nov 18 (Encompass's May redemption): WHERE A QUOTE IS, among a document's sentences — the sentence that contains it;
 * only failing that, a sentence of comparable length the quote contains. Never a short sentence the quote happens to
 * contain ("2028 Notes"), which put the antecedent search in the wrong place. `contains` is the quote matcher.
 */
export function sentenceIndexOf(ss: { sentence: string }[], quote: string, contains: (text: string, q: string) => boolean): number {
  const inside = ss.findIndex((x) => contains(x.sentence, quote));
  return inside >= 0 ? inside : ss.findIndex((x) => x.sentence.length >= 0.6 * quote.length && contains(quote, x.sentence));
}
export const PROCEEDS_REF =/\b(?:the|these|such)\s+(?:net\s+)?(?:issuance\s+)?proceeds\b/i;
export const OFFERING = /\b(?:issued|completed\s+(?:the|an|its|our)\s+(?:sale|offering|issuance)|priced|borrowed|drew)\b/i;
export function offeringAntecedents(ss: { sentence: string; para: number }[], at: number, hasBreaks: boolean): number[] {
  if (!REFERS.test(ss[at].sentence) && !PROCEEDS_REF.test(ss[at].sentence)) return [];
  return antecedentWindow(ss, at, hasBreaks, (x) => HEADING.test(x)).filter((k) => OFFERING.test(ss[k].sentence));
}

/** The splitter build.ts has always used, applied within each paragraph. */
const splitSentences = (para: string): string[] => para.replace(/[\s ]+/g, " ").trim().split(/(?<=[.;])\s+(?=[A-Z(“"])/).filter((x) => x.length > 0 && x.length < 900);

export function paragraphSentences(text: string): { sentences: { sentence: string; para: number }[]; hasBreaks: boolean } {
  const paras = text.split(/\n[ \t ]*\n/);
  const sentences: { sentence: string; para: number }[] = [];
  paras.forEach((p, para) => { for (const sentence of splitSentences(p)) sentences.push({ sentence, para }); });
  return { sentences, hasBreaks: paras.length > 1 };
}

/**
 * The sentences an antecedent may be in, nearest first: with paragraph breaks, every earlier sentence of the same
 * paragraph; without, at most three sentences back (decision 13's approximation). Either way, stopping at a note heading.
 */
export function antecedentWindow(ss: { sentence: string; para: number }[], at: number, hasBreaks: boolean, isHeading: (s: string) => boolean): number[] {
  const out: number[] = [];
  const floor = hasBreaks ? 0 : Math.max(0, at - 3);
  for (let k = at - 1; k >= floor; k--) {
    if (hasBreaks && ss[k].para !== ss[at].para) break;
    out.push(k);
    if (isHeading(ss[k].sentence)) break;
  }
  return out;
}
