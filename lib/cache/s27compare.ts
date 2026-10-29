/**
 * SESSION 27 — ONE COMPARISON FOR 9b, THE PROPOSALS AND THE SIGNER.
 *
 * A re-taste against its canonical answer: compareToGolden with the recorded
 * tolerated classes and the source-line check over the name's documents, Rule
 * 66 accepted for the labelled prior-period base, and countsToward9b (a
 * broken coverage tie is a check failure). s27nineb, s27signing and s27sign
 * all call this, so the three cannot disagree about what "reproduces" means.
 */
import { readFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden, sourceLineCheckFor, countsToward9b } from "../events/golden";

export const docsOf = (cik: string) => new Map<string, string>(Object.entries(JSON.parse(readFileSync(`lib/cards/inputs/${cik}.json`, "utf-8")).docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));

export function compareSample(canonical: any, sample: any, asOf: Date) {
  const expected: any = deriveGoldenState(canonical, asOf), actual: any = deriveGoldenState(sample, asOf);
  const base = sample.results.find((t: any) => t.triggerId === "debt-maturity")?.priorPeriodBase?.filingUrl;
  const extra = [...expected.filingSet.filter((u: string) => !actual.filingSet.includes(u)), ...actual.filingSet.filter((u: string) => !expected.filingSet.includes(u))];
  let rule66: string | null = null;
  if (base && extra.length === 1 && extra[0] === base) {
    actual.filingSet = expected.filingSet;
    actual.otherCitations = (actual.otherCitations ?? []).filter((u: string) => u !== base);
    expected.otherCitations = (expected.otherCitations ?? []).filter((u: string) => u !== base);
    rule66 = base;
  }
  const verdict = compareToGolden(expected, actual, { sourceLineCheck: sourceLineCheckFor(sample, docsOf(sample.cik), asOf) });
  return { verdict, tie: countsToward9b(expected, actual, verdict), rule66 };
}
