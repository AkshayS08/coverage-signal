/**
 * SESSION 27 (Akshay, Nov 8, 2026) — "NOT STATED" IS FORBIDDEN WHERE THE READ SET STATES AN AMOUNT FOR THE ITEM.
 *
 * The not-stated check, and the card, scan the read set's text, not only the figures the answer recorded. A facility
 * item ("letters of credit outstanding", "availability", "drawn") with a sentence in any read document stating an
 * amount for it never renders "not stated"; stated as of a date other than the position date, it renders "stated only
 * as of [date] in [form]; not shown" (Rules 70/71, the Oct 31 ruling). Encompass: "$53.6 million on the new letter of
 * credit subfacility", as of March 9, 2026, in an 8-K. A sub-facility's SIZE ("a $260 million letter of credit
 * subfacility") is not an amount outstanding.
 */
export type ReadSetItem = "lettersOfCredit" | "available" | "drawn";
export type ReadSetStatement = { item: ReadSetItem; amount: string; asOf: string | null; sentence: string; url: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AMT = String.raw`\$\s?[\d,]+(?:\.\d+)?\s*(?:million|billion|thousand)?`;
const PATTERNS: Record<ReadSetItem, RegExp[]> = {
  lettersOfCredit: [
    new RegExp(String.raw`(${AMT})\s+(?:in\s+)?(?:on|under)\s+the\s+(?:new\s+)?letters?\s+of\s+credit\s+sub-?\s?facility`, "i"),
    new RegExp(String.raw`(?:outstanding\s+)?letters?\s+of\s+credit\s+(?:outstanding|issued)\b[^.;$]{0,40}(${AMT})`, "i"),
    new RegExp(String.raw`(${AMT})[^.;$]{0,40}\b(?:was|were)\s+(?:being\s+)?(?:utilized|outstanding|issued)\s+under\s+the\s+letters?\s+of\s+credit`, "i"),
    new RegExp(String.raw`(${AMT})\s+(?:of|in)\s+(?:outstanding\s+)?letters?\s+of\s+credit\s+(?:outstanding|issued)`, "i"),
  ],
  available: [new RegExp(String.raw`(${AMT})\s+(?:was\s+)?available\s+(?:to\s+us\s+)?(?:for\s+borrowing\s+)?under\s+(?:our|the)\s+[^.;]{0,40}(?:facility|agreement)`, "i")],
  drawn: [new RegExp(String.raw`(${AMT})\s+(?:was\s+)?(?:drawn|outstanding|borrowed)\s+under\s+(?:our|the)\s+[^.;]{0,40}(?:revolving|credit)\s+(?:credit\s+)?facility`, "i")],
};
const sentencesOf = (text: string) => text.replace(/[\s ]+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"])/).filter((x) => x.length < 900);

/** The latest-dated read sentence stating an amount for the item, with the date it is stated as of (null: undated). */
export function readSetStatement(item: ReadSetItem, docs: { url: string; text: string }[]): ReadSetStatement | null {
  let best: ReadSetStatement | null = null;
  for (const d of docs) for (const s of sentencesOf(d.text)) {
    for (const re of PATTERNS[item]) {
      const m = re.exec(s);
      if (!m) continue;
      const dm = /\b(?:As of|At|as of)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/.exec(s);
      const asOf = dm ? `${dm[3]}-${String(MONTHS.indexOf(dm[1]) + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}` : null;
      const st = { item, amount: m[1].trim(), asOf, sentence: s, url: d.url };
      if (!best || (asOf ?? "") > (best.asOf ?? "")) best = st;
    }
  }
  return best;
}

/** "an 8-K", "a 10-Q", "the 10-K": the article a form takes in "stated only as of [date] in [form]". */
export const formPhrase = (form: string) => (/^10-K/.test(form) ? "the 10-K" : /^8-K/.test(form) ? "an 8-K" : `a ${form}`);
