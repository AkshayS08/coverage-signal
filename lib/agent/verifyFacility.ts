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
import { isZeroValue, zeroSupportFor } from "./statedZero";
import { figurePeriodOf } from "./figurePeriod";

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
    | "sentence does not state this figure"
    | "the sentence does not predicate letters of credit outstanding or issued"
    /**
     * SESSION 23, B3 — the two ways a claimed ZERO fails, kept apart because
     * they need different fixes. A sentence stating a real quantity means the
     * model mis-read a figure it had; a sentence asserting nothing about the
     * field means it attached the wrong sentence. Collapsing them into
     * "does not state this figure" is how B3's own defect stayed invisible.
     */
    | "claimed zero, but the sentence states a quantity for this figure"
    | "claimed zero, but the sentence asserts nothing about this figure"
    /**
     * RULE 71 — the figure is real and is as of another date. NOT a fabrication
     * and never described as one: it is PRIOR-PERIOD EVIDENCE, kept in this
     * list (which persists on the trigger) so the figure is recorded rather
     * than erased, and kept OUT of the current position.
     */
    | "stated as of a date other than the anchor's period";
  sourceLine: string;
  /** Rule 71 — the period the figure's own sentence predicates, where it predicates one. */
  statedPeriod?: string;
  /** Rule 70 — set when the model's own asOfDate disagreed with that sentence. */
  modelAsOfDisagreed?: string;
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

/**
 * RULE 66, REACHING THE PRODUCER IT MISSED — AND THE ANCHOR'S OWN SENTENCE
 * RECOVERS THE FIGURE RATHER THAN LOSING IT.
 *
 * Rule 66 ruled that a prior-period annual report is a source only when the
 * anchor says so, and even then only as the LABELLED PRIOR-PERIOD BASE — never
 * as part of the current position. `withholdAnnualReportRows` applies that to
 * schedule ROWS. It was never applied to FACILITY FIGURES, and that is the
 * whole of Cigna's remaining identity instability: re-taste 2 sourced the
 * revolver's SIZE and MATURITY from
 *
 *   "In April 2025, the Company … entered into a $ 6.5 billion, five-year
 *    revolving credit and letter of credit agreement … matures April 2030"
 *
 * in the 2025 10-K, while samples 1 and 3 read the anchor 10-Q's own
 *
 *   "The Company maintains a $ 6.5 billion, five-year revolving credit and
 *    letter of credit agreement that will mature in April 2030…"
 *
 * Rule 71 does not catch this and must not: neither date is predicated of the
 * figure — April 2025 is when the paper was signed and April 2030 is the
 * maturity — so the SIZE is a standing term that is true at the anchor. The
 * figure is right. Only the document backing it is one the gate does not
 * permit, and which of two true sentences the model picked decided the
 * position's identity.
 *
 * SO THE ANCHOR'S OWN SENTENCE IS PREFERRED, AND THE VALUE NEVER CHANGES.
 * This re-points evidence; it does not re-derive a figure. Where the anchor
 * states the figure itself, that sentence becomes the evidence and the
 * identity stops depending on a coin flip. Where it does not, the figure is
 * WITHHELD with its reason — recorded as prior-period evidence, not erased.
 *
 * DELIBERATELY NARROW: this fires ONLY on the prior-period annual report,
 * which is the document Rule 66 already ruled on. A general "prefer the
 * anchor" rule would move Encompass's facility size off the 8-K that states
 * it — a legitimate current source the anchor never restates — and would
 * change a signed golden's identity to fix a different company's problem.
 */
/** A facility's standing terms; every other figure field is a balance stated as of a date. */
const STANDING_TERMS = new Set<string>(["facilitySize", "maturity"]);
const flatOf = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
const sentencesOf = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)/).filter((x) => x.length > 12 && x.length < 900);
const FACILITY_STOP = new Set(["senior", "secured", "unsecured", "first", "lien", "that", "with", "from"]);
/** Does this sentence name the facility: two of its own name's distinguishing words, or its defined term? */
function namesFacility(sentence: string, name: string): boolean {
  const s = sentence.toLowerCase();
  const words = (name.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !FACILITY_STOP.has(w));
  const hits = words.filter((w) => s.includes(w)).length;
  const defined = /letter of credit/i.test(name) ? /\blc facility\b|letter of credit facility/i.test(sentence) : /revolv/i.test(name) ? /credit agreement|credit facility|revolving/i.test(sentence) : false;
  return hits >= Math.min(2, words.length) || defined;
}
/** A sentence stating that the facility WAS amended or replaced — never the "as amended (to date)" formula of a defined name. */
const AMENDS = /\b(?:entered into an? (?:\w+ )?amendment|amendment (?:no\.|to)|we amended|was amended|were amended|amended and restated|replaced|refinanced|terminated)\b/i;
function amendingFilings(f: { name: string }, later: { url: string; form: string; filingDate: string; items?: string | null }[], after: string | null, textByUrl: Map<string, string>): string[] {
  return later
    .filter((x) => !after || x.filingDate > after)
    .filter((x) => x.form === "10-Q" || (x.form === "8-K" && String(x.items ?? "").split(",").map((i) => i.trim()).some((i) => ["1.01", "1.02", "2.03"].includes(i))))
    .filter((x) => sentencesOf(textByUrl.get(x.url) ?? "").some((s) => namesFacility(s, f.name) && AMENDS.test(s.replace(/\(as amended[^)]*\)|,? as amended(?: to date| and restated)?/gi, ""))))
    .map((x) => x.url);
}

export function retargetAnnualReportFigures(params: {
  facilities: FacilityRow[];
  textByUrl: Map<string, string>;
  isAnnualReport: (url: string) => boolean;
  anchorUrl: string | null;
  anchorReportDate: string | null;
  /** From `annualReportGate`. Not enforced ⇒ this does nothing. */
  enforced: boolean;
  /** From `annualReportGate`: Rule 66 permits the annual report (the anchor is not-located and directs to it). */
  mayRead?: boolean;
  gateReason: string;
  /** The annual report's filing date, and the read set's filings: what may amend a standing term after it. */
  annualReportDate?: string | null;
  laterFilings?: { url: string; form: string; filingDate: string; items?: string | null }[];
}): { facilities: FacilityRow[]; retargeted: string[]; notRestated: string[]; removed: string[] } {
  const { facilities, textByUrl, isAnnualReport, anchorUrl, anchorReportDate, enforced, gateReason } = params;
  const mayRead = params.mayRead ?? false;
  if (!enforced || facilities.length === 0) return { facilities, retargeted: [], notRestated: [], removed: [] };
  const corpus = corpusOf(textByUrl);
  const anchorText = anchorUrl ? textByUrl.get(anchorUrl) : undefined;
  const anchorSentences = anchorText
    ? anchorText.split(/(?<=[.;])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 12 && s.length < 700)
    : [];

  const retargeted: string[] = [];
  /** Kept at the annual report where Rule 66 permits it — see the tail of the loop below. */
  const notRestated: string[] = [];
  /** Removed: stated only in the annual report, which Rule 66 does not permit for this anchor. */
  const removed: string[] = [];

  const out = facilities.map((f) => {
    const next: FacilityRow = { ...f };
    const words = f.name.toLowerCase().match(/[a-z0-9.%]+/g)?.filter((w) => w.length > 3) ?? [];
    for (const field of FIGURE_FIELDS) {
      const fig = next[field];
      if (!fig?.sourceLine) continue;
      const hit = corpus.find(fig.sourceLine);
      // Only a sentence we can place, in a document the gate excludes.
      if (hit.outcome !== "present" || !isAnnualReport(hit.url)) continue;

      // A ZERO IS SELECTED THE WAY A ZERO IS VERIFIED. `sentenceStatesFigure`
      // falls back to text containment for a value with no discriminating
      // digits, so "$ 0" matches any sentence carrying a 0 — including the
      // "0" inside "June 30, 2026". That is the composite-fabrication shape
      // this module exists to prevent, arriving through the selector instead
      // of the verifier, so selection uses `zeroSupportFor` — the SAME
      // function `verifyFigure` decides a claimed zero with (Rule 21).
      const states = (s: string) =>
        isZeroValue(fig.value) ? zeroSupportFor(s, field).kind === "asserts-absence" : sentenceStatesFigure(fig.value, s);
      const best = anchorSentences
        .filter((s) => states(s) && figurePeriodOf(s, anchorReportDate).period !== "other")
        .map((s) => ({ s, hits: words.filter((w) => s.toLowerCase().includes(w)).length }))
        .filter((c) => c.hits > 0)
        .sort((a, b) => b.hits - a.hits || a.s.length - b.s.length)[0];

      if (best) {
        next[field] = { ...fig, sourceLine: best.s };
        retargeted.push(`${f.name}.${field} = ${fig.value} — the anchor states it itself, so the anchor's sentence is the evidence and the value is unchanged`);
        continue;
      }
      // AND WHERE THE ANCHOR DOES NOT STATE IT, THE FIGURE STAYS.
      //
      // A first version WITHHELD here, and the book measured the cost before
      // it shipped: Tenet's revolver lost its November 4, 2030 maturity, two
      // of Quest's facilities lost theirs, and a signed golden's identity
      // moved. All correct, current facts — a facility's maturity and size
      // are standing contractual terms, and the anchor 10-Q simply does not
      // restate every one of them each quarter.
      //
      // Rule 66 was decided about the 10-K's debt TABLE being substituted for
      // the anchor's ladder, which is a balance at the wrong date. A standing
      // term is not that, and applying the gate to it deletes true current
      // figures to fix a different problem. The coin flip this function
      // exists to remove is "which of two documents that BOTH state it", and
      // where only one does there is no coin flip to remove.
      //
      // SESSION 27 (Akshay, Oct 30, 2026) — SUPERSEDED FOR AN ANCHOR RULE 66
      // DOES NOT COVER. The 10-K is a source only when the anchor is
      // not-located and directs to it. Where it does not, a figure only the
      // 10-K states is REMOVED from the card — Tenet's revolver and L/C
      // facility maturities, "November 4, 2030", which no 10-Q or 8-K it holds
      // states. Logged, never silent. Where Rule 66 does permit it (Cigna),
      // the standing term stays at the document that states it, as above.
      // A sentence the ANCHOR ITSELF prints is not "stated only in the 10-K": verification decides it (a figure of
      // another date is withheld there under Rule 71, and says so). Encompass's $46.3 million "as of December 31,
      // 2025" is in both documents.
      if (anchorText && flatOf(anchorText).includes(flatOf(fig.sourceLine))) { notRestated.push(`${f.name}.${field} = ${fig.value} — its sentence is also in the anchor, so verification decides it`); continue; }
      // SESSION 27 (Akshay, Oct 30, bounded the same day) — A STANDING TERM IS NOT A BALANCE. Rule 66 governs
      // amounts stated as of a date (drawn, letters of credit outstanding, available). A facility's maturity and
      // size hold until amended: stated only in the latest 10-K, they are KEPT and tagged (standingFrom10K),
      // unless a filing in the read set after that 10-K amends or replaces this facility — then the term comes
      // from that filing where it states it, or is not stated.
      if (!mayRead && STANDING_TERMS.has(field)) {
        const amending = amendingFilings(f, params.laterFilings ?? [], params.annualReportDate ?? null, textByUrl);
        if (amending.length === 0) {
          (next as FacilityRow & { standingFrom10K?: string[] }).standingFrom10K = [...((next as { standingFrom10K?: string[] }).standingFrom10K ?? []), field];
          notRestated.push(`${f.name}.${field} = ${fig.value} — a standing term stated only in the latest 10-K, and no later filing in the read set amends this facility; shown with the 10-K tag`);
          continue;
        }
        const restated = amending.flatMap((u) => sentencesOf(textByUrl.get(u) ?? "")).find((x) => namesFacility(x, f.name) && flatOf(x).includes(flatOf(String(fig.value))));
        if (restated) {
          next[field] = { ...fig, sourceLine: restated };
          retargeted.push(`${f.name}.${field} = ${fig.value} — a later filing amends this facility and states it, so that filing's sentence is the evidence`);
          continue;
        }
        next[field] = null;
        removed.push(`${f.name}.${field} = ${fig.value} — a filing after the 10-K amends this facility (${amending.map((u) => u.split("/").pop()).join(", ")}) and does not state this term, so it is not stated`);
        continue;
      }
      if (!mayRead) {
        next[field] = null;
        // Recorded on the facility, so a row claiming the same figure does not render it as "withheld" either.
        (next as FacilityRow & { removedUnderRule66?: string[] }).removedUnderRule66 = [...((next as { removedUnderRule66?: string[] }).removedUnderRule66 ?? []), field];
        removed.push(`${f.name}.${field} = ${fig.value} — stated only in the prior-period annual report, which is a source only where the anchor locates no debt note and directs to it (Rule 66); no current filing states it, so it is not shown`);
        continue;
      }
      notRestated.push(`${f.name}.${field} = ${fig.value} (the anchor does not restate it; a standing term is kept at the document that states it, Rule 66 permitting)`);
    }
    return next;
  });

  return { facilities: out, retargeted, notRestated, removed };
}

function verifyFigure(
  facilityName: string,
  field: string,
  fig: FacilityFigure | null,
  corpus: Corpus,
  /** Rule 71 — the anchor's own period. Null means the check does not run. */
  anchorReportDate: string | null,
  /** Rule 70 — the model's own asOfDate for this facility. ONE signal, never the answer. */
  modelAsOf: string | null
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

  // SESSION 23, B3 — ZERO IS STATED IN WORDS, SO IT IS CHECKED IN WORDS.
  //
  // sentenceStatesFigure asks whether the sentence carries the value's
  // digits, which is right for every figure except the one filings write as
  // "no cash borrowings". Routed to its own rule rather than loosened for
  // everything: widening the digit check would let any figure through any
  // sentence, which is the guard this file exists to be.
  if (isZeroValue(fig.value)) {
    const support = zeroSupportFor(fig.sourceLine, field);
    if (support.kind === "asserts-absence") return { kept: fig, foundIn, rejection: null };
    return {
      kept: null,
      foundIn: null,
      rejection: {
        facility: facilityName,
        field,
        value: fig.value,
        reason:
          support.kind === "states-a-quantity"
            ? "claimed zero, but the sentence states a quantity for this figure"
            : "claimed zero, but the sentence asserts nothing about this figure",
        sourceLine: fig.sourceLine,
      },
    };
  }
  if (!sentenceStatesFigure(fig.value, fig.sourceLine)) {
    return {
      kept: null, foundIn: null,
      rejection: { facility: facilityName, field, value: fig.value, reason: "sentence does not state this figure", sourceLine: fig.sourceLine },
    };
  }


  // RULE 71 — AND WHICH PERIOD IS THIS FIGURE'S OWN?
  //
  // LAST, DELIBERATELY. The three checks above ask whether the sentence is
  // real, whether a claimed zero is asserted in words, and whether the
  // sentence states this figure. Only a sentence that has passed all three is
  // evidence at all, and asking "which period" of a sentence that does not
  // even state the figure would classify noise — the date in it belongs to
  // whatever the sentence IS about.
  //
  // The two checks above ask whether the sentence is real and whether it
  // states this figure. Neither asks WHEN. Cigna's re-taste 2 answered both
  // yes on "As of December 31, 2025, there was no outstanding balance under
  // the Credit Agreement" — a real sentence stating a real zero, six months
  // before the anchor — and the prior-period 10-K entered the position's
  // identity through it while the other two samples read the anchor's own
  // sentence at June 30, 2026.
  //
  // Schedule rows have `rowsOnAnchor` and prose instruments have `onAnchor`.
  // Facility figures had neither, and a document rule would be the wrong one
  // here anyway: Encompass's facility size legitimately comes from an 8-K
  // about the credit agreement. The question is the figure's PERIOD, not its
  // document, so it is asked that way.
  const period = figurePeriodOf(fig.sourceLine, anchorReportDate, modelAsOf);
  if (period.period === "other") {
    return {
      kept: null, foundIn: null,
      rejection: {
        facility: facilityName, field, value: fig.value,
        reason: "stated as of a date other than the anchor's period",
        sourceLine: fig.sourceLine,
        statedPeriod: period.predicated.join(", "),
        ...(period.modelAgrees === false && modelAsOf ? { modelAsOfDisagreed: modelAsOf } : {}),
      },
    };
  }

  return { kept: fig, foundIn, rejection: null };
}

const FIGURE_FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

/**
 * SESSION 27 (Akshay, Oct 23, 2026) — A LETTER-OF-CREDIT FIGURE IS
 * OUTSTANDING ONLY WHERE ITS SENTENCE PREDICATES OUTSTANDING OR ISSUED
 * AMOUNTS. The predicate principle of Rules 57 and 70: a figure is what its
 * own clause says of it. Cigna's v33 answer took "with up to $ 500 million
 * available for issuance of letters of credit" — a sub-limit — as $500MM of
 * letters of credit outstanding.
 *
 * The scope is the figure's own clause: the parenthetical it sits in, or else
 * back to the previous ", ", " and ", ";" or "(" and forward to the next ";",
 * "." or ")". Then, a closed grammatical class (how the amount is
 * predicated, never what company or instrument it is about):
 *   outstanding  "outstanding", "issued", "utilized", "drawn"
 *   capacity     "available for issuance", "sub-limit", "sub-facility",
 *                "up to", "may be used/issued", "capacity" — and no
 *                outstanding predicate
 *   unstated     neither
 */
export function letterOfCreditPredicate(value: string, sentence: string): "outstanding" | "capacity" | "unstated" {
  const num = (value.match(/\d[\d,]*(?:\.\d+)?/) ?? [])[0];
  let scope = sentence;
  if (num) {
    const esc = num.replace(/[.,]/g, (m) => `\\${m}`);
    let i = sentence.search(new RegExp(`\\$\\s*${esc}`));
    if (i < 0) i = sentence.indexOf(num);
    if (i >= 0) {
      const open = sentence.lastIndexOf("(", i), lastClose = sentence.lastIndexOf(")", i), close = sentence.indexOf(")", i);
      if (open >= 0 && open > lastClose && close > i) scope = sentence.slice(open + 1, close);
      else {
        const before = sentence.slice(0, i);
        const cut = Math.max(before.lastIndexOf(", "), before.lastIndexOf(" and "), before.lastIndexOf(";"), before.lastIndexOf("("));
        const after = sentence.slice(i);
        const end = after.search(/[;)]|\.(?:\s|$)/);
        scope = before.slice(cut < 0 ? 0 : cut + 1) + (end < 0 ? after : after.slice(0, end));
      }
    }
  }
  if (/\b(?:outstanding|issued|utili[sz]ed|drawn)\b/i.test(scope)) return "outstanding";
  if (/\bavailable for (?:the )?issuance\b|\bsub-?limit\b|\bsub-?facility\b|\bup to\b|\b(?:may|can) be (?:used|issued)\b|\bcapacity\b/i.test(scope)) return "capacity";
  return "unstated";
}

export function verifyFacilities(params: {
  facilities: FacilityRow[];
  /** The documents this run fetched. NOT the model's self-reported citations — see the note above. */
  textByUrl: Map<string, string>;
  /**
   * RULE 71 — the anchor's own reporting period. Optional, and its absence is
   * not a finding: with no period to compare against, no figure is excluded.
   */
  anchorReportDate?: string | null;
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
      // Session 27: a letters-of-credit figure its own clause predicates as
      // CAPACITY is not letters of credit outstanding. It is kept as capacity
      // (so outstanding reads "not stated"), never as outstanding; one its
      // clause predicates neither way is withheld with that reason.
      const lc = field === "lettersOfCredit" ? f.lettersOfCredit : null;
      // A ZERO claimed from a sentence that states only CAPACITY ("a $100
      // million letter of credit sub-facility") says nothing about what is
      // outstanding: outstanding is not stated, and the claim is neither kept
      // nor withheld. The sentence's own figure is what its predicate is read on.
      if (lc?.value && lc.sourceLine && isZeroValue(lc.value)) {
        const own = (lc.sourceLine.match(/\$\s*\d[\d,]*(?:\.\d+)?/) ?? [])[0];
        if (own && letterOfCreditPredicate(own, lc.sourceLine) === "capacity" && !/\b(?:outstanding|issued|utili[sz]ed|drawn)\b/i.test(lc.sourceLine)) {
          (out as unknown as Record<string, unknown>)[field] = null;
          continue;
        }
      }
      if (lc?.value && lc.sourceLine && !isZeroValue(lc.value)) {
        const pred = letterOfCreditPredicate(lc.value, lc.sourceLine);
        if (pred !== "outstanding") {
          const check = verifyFigure(f.name, field, lc, corpus, params.anchorReportDate ?? null, f.asOfDate ?? null);
          (out as unknown as Record<string, unknown>)[field] = null;
          if (pred === "capacity" && check.kept) {
            (out as unknown as Record<string, unknown>).lettersOfCreditCapacity = check.kept;
            if (check.foundIn) figureSources.lettersOfCreditCapacity = check.foundIn;
          } else if (check.rejection) rejections.push(check.rejection);
          else rejections.push({ facility: f.name, field, value: lc.value, reason: "the sentence does not predicate letters of credit outstanding or issued", sourceLine: lc.sourceLine });
          continue;
        }
      }
      const r = verifyFigure(f.name, field, f[field], corpus, params.anchorReportDate ?? null, f.asOfDate ?? null);
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

/**
 * SESSION 27 (Akshay, Oct 30, 2026) — RULE 53, EXTENDED. "No amount was
 * outstanding", "no borrowings outstanding" and their equivalents are a stated
 * zero for a facility's DRAWN amount. Molina's three refresh samples left drawn
 * empty while its Q3 10-Q says "As of September 30, 2026, no amount was
 * outstanding under the Credit Agreement."
 *
 * Only a facility the answer left without a drawn amount is filled, and only
 * from a sentence of the anchor that names THIS facility (its name, or the
 * defined term its own sentences give it) and no other facility on the list
 * (Rule 19), asserts absence for "drawn" (zeroSupportFor — the same test a
 * claimed zero is verified by), and predicates the anchor's own period
 * (Rule 71). A stated amount is never replaced.
 */
export function fillStatedNothingOutstanding<F extends { name: string; drawn?: FacilityFigure | null; figureSources?: Record<string, string> }>(
  facilities: F[],
  anchorText: string | null | undefined,
  anchorUrl: string | null,
  anchorReportDate: string | null
): { facilities: F[]; filled: string[] } {
  const filled: string[] = [];
  if (!anchorText || !anchorUrl) return { facilities, filled };
  const sentences = sentencesOf(anchorText);
  const out = facilities.map((f) => {
    if (f.drawn) return f;
    const hit = sentences
      .filter((s) => namesFacility(s, f.name) && !facilities.some((o) => o !== f && namesFacility(s, o.name)))
      .filter((s) => zeroSupportFor(s, "drawn").kind === "asserts-absence")
      .filter((s) => figurePeriodOf(s, anchorReportDate).period === "anchor")
      .sort((a, b) => a.length - b.length)[0]
      // A bare note number the text-flattening ran on after the sentence ("…Credit Agreement. 8.") is not part of it.
      ?.replace(/(\.)\s+\d{1,3}\.$/, "$1");
    if (!hit) return f;
    filled.push(`${f.name}.drawn = $0 — "${hit}" (a stated nothing-outstanding sentence naming this facility, at the anchor's period)`);
    return { ...f, drawn: { value: "$0", sourceLine: hit }, figureSources: { ...(f.figureSources ?? {}), drawn: anchorUrl } };
  });
  return { facilities: out, filled };
}
