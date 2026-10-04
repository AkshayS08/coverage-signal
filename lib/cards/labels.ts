/**
 * CARD LABELS — type, seniority and security, each from the filer's own words
 * and each shown only where its word is stated. card_spec 3.2.
 *
 * TYPE is the filer's type word, normalised only to the spec's display set
 * (notes, term loan A, term loan B, other term loan, revolver, ABL,
 * commercial paper, letters of credit). "ABL" where the filer's own name for
 * the facility says ABL or asset-based; a revolver otherwise.
 *
 * SENIORITY and SECURITY are separate labels. Approved sources: the
 * instrument's own name or table-row label, linked to that row; and a note
 * sentence that predicates the class of the instruments it names (Rule 38
 * already bounds its reach). A section heading spanning several instruments
 * is NOT a source for either label. Neither label is ever inferred from the
 * other: "first lien" states security and says nothing about seniority.
 */
import type { LadderRow } from "../events/position";
import { statementCoversRow, statementHead, type NoteSeniorityStatement } from "../events/instrumentClass";
import type { Segment, Source } from "./types";

const SENIORITY_RE = /\b(senior(?:[- ]priority)?|junior[- ]priority|junior|subordinated)\b/i;
const SECURITY_RE = /\b(unsecured|secured|first[- ]lien|second[- ]lien)\b/i;

const TYPE_DISPLAY: Record<string, string> = {
  "senior-note": "notes",
  "term-loan-a": "term loan A",
  "term-loan-b": "term loan B",
  "term-loan": "other term loan",
  "delayed-draw": "other term loan",
  revolver: "revolver",
  "credit-facility": "revolver",
  "commercial-paper": "commercial paper",
  "finance-lease": "finance leases",
  "letter-of-credit": "letters of credit",
};

export interface RowLabels {
  type: Segment;
  seniority: Segment | null;
  security: Segment | null;
}

/** Whitespace- and case-insensitive containment — how a label's word is checked against its sentence. */
export function containsWord(sentence: string, word: string): boolean {
  // Typography only: case, runs of whitespace, dash variants and a space before
  // "%" ("7.875 %" is "7.875%"). Never a change of words.
  const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[‐-―]/g, "-").replace(/ %/g, "%");
  return norm(sentence).includes(norm(word));
}

/**
 * The type label. `typeSrc` is the sentence that names the type: the row's own
 * line where it does, otherwise its section heading (a type word in a heading
 * IS the filer naming the kind of instrument; only seniority and security
 * are barred from headings).
 */
export function typeLabel(row: Pick<LadderRow, "instrument" | "classification">, typeSrc: Source): Segment {
  const c = row.classification;
  const abl = /\bABL\b|asset[- ]based/i.exec(row.instrument);
  if (abl) return { k: "label", t: "ABL", stated: abl[0], src: typeSrc };
  if (c.instrumentType && TYPE_DISPLAY[c.instrumentType] && c.instrumentTypeStatedAs) {
    return { k: "label", t: TYPE_DISPLAY[c.instrumentType], stated: c.instrumentTypeStatedAs, src: typeSrc };
  }
  // A debenture is a note by another name, and the filer's word is kept.
  const deb = /\bdebentures?\b/i.exec(row.instrument);
  if (deb) return { k: "label", t: "debentures", stated: deb[0], src: typeSrc };
  // No recognised type word: the filer's own name for the line IS its type.
  return { k: "label", t: row.instrument, stated: row.instrument, src: typeSrc };
}

/** Seniority and security from the row's own label, then a note sentence that names it — never a heading. */
export function classLabels(
  rowName: string,
  rowSrc: Source,
  statement: { s: NoteSeniorityStatement; src: Source } | null
): { seniority: Segment | null; security: Segment | null } {
  const fromName = (re: RegExp): Segment | null => {
    const m = re.exec(rowName);
    return m && containsWord(rowSrc.sentence, m[0]) ? { k: "label", t: m[1].toLowerCase(), stated: m[0], src: rowSrc } : null;
  };
  const fromStatement = (re: RegExp): Segment | null => {
    if (!statement) return null;
    // Only the span still about its own subject (Rule 38): "…and rank senior
    // to any of our subordinated indebtedness" names other debt, not this.
    const m = re.exec(statementHead(statement.s.statement));
    return m ? { k: "label", t: m[1].toLowerCase(), stated: m[0], src: statement.src } : null;
  };
  return {
    seniority: fromName(SENIORITY_RE) ?? fromStatement(SENIORITY_RE),
    security: fromName(SECURITY_RE) ?? fromStatement(SECURITY_RE),
  };
}

/** card_spec 3.2's fallback suffix, exactly. Null when both labels are stated. */
export function notStatedSuffix(seniority: Segment | null, security: Segment | null): string | null {
  if (seniority && security) return null;
  if (!seniority && !security) return "seniority and security not stated, please refer to sources";
  return seniority ? "security not stated, please refer to sources" : "seniority not stated, please refer to sources";
}

/**
 * Does a note's seniority sentence reach this row? Decided by the classifier's
 * own scope test (Rule 38), asked on its own — not "did the classifier end up
 * using the sentence", which is false whenever the row's name supplied a class
 * first, so "The Senior Notes are senior, unsecured obligations" never got to
 * say "unsecured". A tranche priced by an 8-K is never reached by the note's
 * sentence (position.ts says why).
 */
export function statementReaches(s: NoteSeniorityStatement | null | undefined, row: Pick<LadderRow, "instrument" | "provenance" | "maturityDate" | "classification">): boolean {
  if (!s || row.provenance === "pricing-8-K") return false;
  return statementCoversRow(s.appliesTo, { instrumentName: row.instrument, instrumentType: row.classification.instrumentType, maturityDate: row.maturityDate });
}
