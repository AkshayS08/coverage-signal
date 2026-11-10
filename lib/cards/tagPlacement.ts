/**
 * SESSION 27 (Akshay, Nov 9): WHERE A LINE'S "10-K" TAGS RENDER — after the full instrument label, never mid-label.
 *
 * A tag marks a standing term read from the latest 10-K. On a label it renders after the instrument phrase the label
 * sits in: the label segments and instrument words that follow it ("senior unsecured" + " notes"). A date's tag stays
 * beside the date. One home: the page renders tags here, and tagPlacement.test checks every shown card's lines.
 */
import type { Line } from "./types";

/** Words that continue an instrument's label: its type and class words, and the spaces between them. */
export const INSTRUMENT_WORDS = /^(?:\s|notes?|debentures?|bonds?|term loans?|loans?|credit facilit(?:y|ies)|facilit(?:y|ies)|commercial paper|senior|junior|secured|unsecured|first[- ]lien|second[- ]lien|subordinated)*$/i;

/** The segment index after which each tag renders, ascending, one per position. */
export function tagPositions(line: Line): number[] {
  const out = new Set<number>();
  line.forEach((s, n) => {
    if (!((s.k === "label" || s.k === "date") && s.tenK)) return;
    let end = n;
    if (s.k === "label") {
      for (let k = n + 1; k < line.length; k++) {
        const x = line[k];
        if (x.k === "label") { end = k; continue; }
        if (x.k === "text" && INSTRUMENT_WORDS.test(x.t)) { if (/\S/.test(x.t)) end = k; continue; }
        break;
      }
    }
    out.add(end);
  });
  return [...out].sort((a, b) => a - b);
}
