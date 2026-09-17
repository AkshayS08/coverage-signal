/**
 * SESSION 22, STAGE 3 — A FACILITY FIGURE IS VERIFIED AGAINST ITS OWN SENTENCE.
 *
 * The rule this module exists to enforce, stated once:
 *
 *     NO FACILITY FIGURE IS EVER SOURCED FROM A FILING THAT DOES NOT STATE IT.
 *
 * Two checks, and a figure must pass BOTH:
 *
 *   1. THE SENTENCE IS REAL. `sourceLine` appears in the text of one of the
 *      filings THIS RUN FETCHED — the corpus the model was actually shown.
 *      A sentence nobody filed is not evidence.
 *
 *      IT WAS ORIGINALLY THE CITED filings, AND THAT WAS WRONG. `citedUrls`
 *      is the model's own self-report of which documents it used, and it is
 *      routinely empty or partial: Centene's debt-maturity trigger reported
 *      NO citations at all, so the check ran against nothing and rejected
 *      all eight of its figures — six of which are verbatim in Centene's own
 *      anchor 10-Q. Every facility that company has was deleted on the
 *      strength of an empty list.
 *
 *      That is this project's oldest defect wearing new clothes: an empty or
 *      unreachable corpus reported as a finding about the source. "We could
 *      not check" and "the filing does not say this" are different answers,
 *      and only one of them may delete an instrument.
 *
 *      The corpus is therefore what was FETCHED. Which document a figure was
 *      found in is recorded, so staleness stays a separate, visible question
 *      rather than being enforced by accident through a citation list that
 *      was never meant to carry it.
 *   2. THE SENTENCE CONTAINS THE FIGURE. The figure's own discriminating
 *      digits appear in that sentence. This is the check whose absence let
 *      Encompass's $824 million through: Session 20 verified ONE sentence
 *      for the whole revolver object, so `available` was accepted on the
 *      strength of a sentence about `drawn`. The figure and the sentence
 *      were both real and they had nothing to do with each other, which is
 *      the composite-fabrication class in its purest form — a true number
 *      and a true quote, joined by nothing.
 *
 * A FAILING FIGURE IS DROPPED, THE FACILITY IS KEPT. A facility whose size
 * verifies and whose available figure does not is a real facility with an
 * unverifiable availability, and it renders that way. Deleting the facility
 * to avoid rendering the gap would suppress a verified instrument to hide an
 * unverified number — Rule 3, and the opposite of what the withheld-line
 * refusal is for.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: reconcile. If drawn + LCs + available
 * does not equal size, that is reported as a flag and never repaired by
 * substituting a figure from elsewhere. Stitching a number in from a
 * document that does not state it is precisely the failure this module is
 * built to make impossible.
 */
import type { FacilityRow, FacilityFigure } from "./claude";
import { discriminatingDigitGroups, normalizeForMatch } from "./verifyQuote";
import { corpusOf, type Corpus } from "./corpus";

export interface VerifiedFacility extends FacilityRow {
  /** The filing whose text states this facility's name-bearing sentence. */
  citedUrl: string;
  /**
   * Which document stated EACH figure, by field name. A facility's figures
   * routinely come from different filings — Encompass's size from an 8-K
   * about the credit agreement, its availability from the 10-Q's liquidity
   * discussion — and "this facility is cited to X" would hide that.
   */
  figureSources: Record<string, string>;
}

export interface FigureRejection {
  facility: string;
  field: string;
  value: string;
  reason:
    | "sentence appears in no fetched filing"
    /** The corpus could not answer. NEVER a claim about the filing — see corpus.ts. */
    | "could not be checked — the corpus was not loaded"
    | "sentence does not state this figure";
  sourceLine: string;
}

/**
 * Does `sentence` actually state `value`?
 *
 * Discriminating digit groups first — the same primitive the quote verifier
 * uses, so "verified" means here what it means everywhere else.
 *
 * AND A FALLBACK, because the first version of this rejected "$1 billion".
 * A single-digit magnitude has no DISCRIMINATING group by construction, so
 * requiring one rejected Encompass's genuinely-stated $1 billion facility
 * size — a false rejection, which is the same defect as a false acceptance
 * pointed the other way and would have read as "the filing does not state
 * its own facility size". Where there is nothing discriminating to compare,
 * the value's own text must appear in the sentence instead.
 *
 * A value that is neither — no digits and no text in common — is rejected.
 * Rule 10 in reverse: absence of a check is not a pass.
 */
/**
 * SESSION 22, STAGE 7 (A1) — EXPORTED so the signature packet reuses THIS
 * rule rather than growing a second, weaker one. The packet displays figures
 * beside sentences, which is exactly the join this function exists to police;
 * a surface that checks belonging its own way is two deciding functions for
 * one question.
 */
export function sentenceStatesFigure(value: string, sentence: string): boolean {
  const hay = normalizeForMatch(sentence);
  const groups = discriminatingDigitGroups(value);
  if (groups.length > 0) return groups.every((g) => hay.includes(normalizeForMatch(g)));
  const needle = normalizeForMatch(value);
  return needle.length > 0 && hay.includes(needle);
}

function verifyFigure(
  facilityName: string,
  field: string,
  fig: FacilityFigure | null,
  corpus: Corpus
): { kept: FacilityFigure | null; foundIn: string | null; rejection: FigureRejection | null } {
  if (!fig) return { kept: null, foundIn: null, rejection: null };

  // THREE OUTCOMES, NOT TWO (corpus.ts). "absent" is only reachable from a
  // corpus that was actually loaded; anything else says so and does not
  // pretend to be a finding about the filing.
  const hit = corpus.find(fig.sourceLine);
  if (hit.outcome === "undetermined") {
    return {
      kept: null, foundIn: null,
      rejection: { facility: facilityName, field, value: fig.value, reason: "could not be checked — the corpus was not loaded", sourceLine: fig.sourceLine },
    };
  }
  if (hit.outcome === "absent") {
    return {
      kept: null, foundIn: null,
      rejection: { facility: facilityName, field, value: fig.value, reason: "sentence appears in no fetched filing", sourceLine: fig.sourceLine },
    };
  }
  const foundIn = hit.url;
  if (!sentenceStatesFigure(fig.value, fig.sourceLine)) {
    return {
      kept: null, foundIn: null,
      rejection: { facility: facilityName, field, value: fig.value, reason: "sentence does not state this figure", sourceLine: fig.sourceLine },
    };
  }
  return { kept: fig, foundIn, rejection: null };
}

const FIGURE_FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

export function verifyFacilities(params: {
  facilities: FacilityRow[];
  /** The documents this run fetched. NOT the model's self-reported citations — see the note above. */
  textByUrl: Map<string, string>;
}): { verified: VerifiedFacility[]; rejections: FigureRejection[]; droppedFacilities: string[] } {
  const corpus = corpusOf(params.textByUrl);
  const verified: VerifiedFacility[] = [];
  const rejections: FigureRejection[] = [];
  const droppedFacilities: string[] = [];

  for (const f of params.facilities) {
    const out: FacilityRow = { ...f };
    const figureSources: Record<string, string> = {};
    let anyFigureSurvives = false;
    let citedUrl: string | null = null;

    for (const field of FIGURE_FIELDS) {
      const r = verifyFigure(f.name, field, f[field], corpus);
      if (r.kept && r.foundIn) figureSources[field] = r.foundIn;
      (out as unknown as Record<string, unknown>)[field] = r.kept;
      if (r.rejection) rejections.push(r.rejection);
      if (r.kept) {
        anyFigureSurvives = true;
        // The facility is cited to the document that actually stated a figure
        // which survived — never to one whose sentence was rejected, and
        // never to a list the model supplied about itself.
        citedUrl ??= r.foundIn;
      }
    }

    // A FACILITY WITH NO SURVIVING FIGURE IS NOT A FACILITY. It is a name
    // with nothing behind it, and rendering it would assert the existence of
    // an instrument on no evidence — which is a different and worse error
    // than withholding a figure from an instrument we can see.
    if (!anyFigureSurvives || !citedUrl) {
      droppedFacilities.push(f.name);
      continue;
    }
    verified.push({ ...out, citedUrl, figureSources });
  }

  return { verified, rejections, droppedFacilities };
}

/**
 * drawn + letters of credit + available = size, when all the parts needed
 * are stated. Reported, never repaired.
 */
export function facilityArithmetic(f: FacilityRow, parse: (s: string) => number | null): {
  checkable: boolean;
  ties: boolean | null;
  gap: number | null;
  why: string;
} {
  const size = f.facilitySize ? parse(f.facilitySize.value) : null;
  const avail = f.available ? parse(f.available.value) : null;
  const drawn = f.drawn ? parse(f.drawn.value) : null;
  const lcs = f.lettersOfCredit ? parse(f.lettersOfCredit.value) : null;

  // EVERY COMPONENT, OR NO CONCLUSION. Treating a missing component as zero
  // manufactures a gap the filing never stated: a facility with size and
  // available but no letters-of-credit figure would read "DOES NOT TIE" on
  // the strength of a number nobody wrote down. And we cannot tell "there
  // are no letters of credit" from "the letters of credit are not stated
  // here" — Rule 10, absence is only evidence when a match was possible. So
  // an incomplete set is NOT CHECKABLE, and says which part is missing.
  const missing: string[] = [];
  if (size === null) missing.push("facility size");
  if (avail === null) missing.push("available");
  if (drawn === null) missing.push("drawn");
  if (lcs === null) missing.push("letters of credit");
  if (missing.length > 0) {
    return { checkable: false, ties: null, gap: null, why: `partial — not checkable, no verified figure for ${missing.join(", ")}` };
  }

  const parts = (drawn as number) + (lcs as number) + (avail as number);
  const gap = (size as number) - parts;
  const ties = Math.abs(gap) <= Math.abs(size as number) * 0.005;
  return {
    checkable: true,
    ties,
    gap,
    why: ties
      ? `drawn + letters of credit + available ties to the stated size`
      : `DOES NOT TIE — the parts sum to ${parts.toLocaleString("en-US")} against a stated size of ${(size as number).toLocaleString("en-US")}`,
  };
}
