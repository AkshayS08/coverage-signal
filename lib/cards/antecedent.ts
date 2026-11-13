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
