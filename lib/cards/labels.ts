/**
 * CARD LABELS — type, seniority and security, each from the filer's own words
 * and each shown only where its word is stated. card_spec 3.2.
 *
 * TYPE is the filer's type word, normalised only to the spec's display set
 * (notes, term loan A, term loan B, other term loan, revolver, ABL,
 * commercial paper, letters of credit). "ABL" where the filer's own name for
 * the facility says ABL or asset-based; a revolver otherwise.
 *
 * SENIORITY and SECURITY are separate labels (card_spec v2.0 §3.5). A label
 * is stated where any of these states it, each linked:
 *   - the instrument's own name or table-row label;
 *   - a PRINTED table heading naming a single class and governing a
 *     contiguous block of rows (headings.ts decides what it governs);
 *   - a sentence in a permitted source that names the instrument and states
 *     the label, read only over the span still about its own subject.
 * Neither label is ever inferred from the other: "first lien" states
 * security and says nothing about seniority.
 *
 * TYPE for a lease or "other" line is the filer's full label (§3.6): "Finance
 * leases, mortgages and other notes" is never shortened to "finance leases".
 */
import type { LadderRow } from "../events/position";
import { statementCoversRow, statementHead, type NoteSeniorityStatement } from "../events/instrumentClass";
import type { Segment, Source } from "./types";
import { kindOf } from "./headings";

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
  const kind = kindOf(row.instrument);
  if (kind === "lease" || kind === "other") return { k: "label", t: row.instrument, stated: row.instrument, src: typeSrc };
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

/**
 * A lien's or security interest's priority ("a perfected junior-priority
 * third lien security interest", "first-priority security interest") ranks
 * collateral: it states security, never seniority in right of payment.
 */
const LIEN_PRIORITY = /\b(?:senior|junior|first|second)[- ]priority\s+(?:(?:first|second|third)\s+)?(?:lien|security interest)\b/gi;
const seniorityIn = (span: string) => SENIORITY_RE.exec(span.replace(LIEN_PRIORITY, (m) => " ".repeat(m.length)));

/** Does a heading name exactly one class? "Senior secured first lien notes" does; "Senior secured and unsecured notes" does not. */
function singleClass(heading: string): boolean {
  const sen = new Set((heading.match(new RegExp(SENIORITY_RE.source, "gi")) ?? []).map((x) => x.toLowerCase()));
  const sec = heading.match(/\b(?:un)?secured\b/gi) ?? [];
  return sen.size <= 1 && new Set(sec.map((x) => x.toLowerCase())).size <= 1 && !/\b(?:and|or)\b/i.test(heading);
}

/** Seniority and security from a printed heading governing the row (§3.5), linked to the heading. */
export function headingClass(heading: string | null, headingSrc: Source | null): { seniority: Segment | null; security: Segment | null } {
  if (!heading || !headingSrc || !singleClass(heading)) return { seniority: null, security: null };
  const sen = seniorityIn(heading);
  const sec = SECURITY_RE.exec(heading);
  return {
    seniority: sen ? { k: "label", t: sen[1].toLowerCase(), stated: sen[0], src: headingSrc } : null,
    security: sec ? { k: "label", t: sec[1].toLowerCase(), stated: sec[0], src: headingSrc } : null,
  };
}

const FRACTION: Record<string, number> = { "⅛": 0.125, "¼": 0.25, "⅜": 0.375, "½": 0.5, "⅝": 0.625, "¾": 0.75, "⅞": 0.875 };
/** Every coupon a span states, as a number: "5.125 %", "10 ⅞%", "6%". */
function couponsIn(span: string): { rate: number; at: number }[] {
  const out: { rate: number; at: number }[] = [];
  for (const m of span.matchAll(/(\d{1,2})(?:\.(\d+)|\s*([⅛¼⅜½⅝¾⅞]))?\s?%/g)) {
    const rate = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : m[3] ? FRACTION[m[3]] : 0);
    out.push({ rate, at: m.index ?? 0 });
  }
  return out;
}

/**
 * Seniority and security from a sentence that NAMES this instrument and
 * states the label (§3.5). Named means: its coupon and, where the row states
 * one, its year; or the facility's own type word where the row's name carries
 * it (ABL, commercial paper); or the facility's full name. Read only over the
 * span still about its own subject, cut before a guarantee clause; where the
 * span names several coupons, only the stretch from this coupon to the next.
 * Table text is not a sentence; a span naming two classes of notes classes
 * nothing.
 */
export function sentenceClass(rowName: string, sentences: Source[]): { seniority: Segment | null; security: Segment | null } {
  const own = couponsIn(rowName)[0]?.rate ?? null;
  const year = (/\b(20\d\d)\b/.exec(rowName) ?? [])[1] ?? null;
  const facilityWord = /\bABL\b/i.test(rowName) ? /\bABL\b/i : /commercial paper/i.test(rowName) ? /commercial paper/i : null;
  const isFacility = kindOf(rowName) === "facility";
  let seniority: Segment | null = null, security: Segment | null = null;
  for (const src of sentences) {
    if (seniority && security) break;
    const sentence = src.sentence;
    if ((sentence.match(/\d[\d,.]*/g) ?? []).length > 14) continue;
    let head = statementHead(sentence).split(/\bguaranteed on an?\b/i)[0];
    if ((head.match(/\b(?:senior|junior[- ]priority|subordinated)(?:\s+(?:secured|unsecured))?\s+notes\b/gi) ?? []).length >= 2) continue;
    const cs = couponsIn(head);
    let named = false;
    if (own !== null) {
      const hit = cs.findIndex((c) => Math.abs(c.rate - own) < 1e-9);
      if (hit >= 0) {
        const next = cs.find((c, n) => n > hit && Math.abs(c.rate - own) > 1e-9);
        const stretch = cs.length > 1 ? head.slice(cs[hit].at, next ? next.at : undefined) : head;
        if (!year || stretch.includes(year) || (cs.length === 1 && head.includes(year))) { named = true; head = stretch; }
      }
    } else if (facilityWord) named = facilityWord.test(head);
    else if (isFacility && rowName.length > 8) named = containsWord(head, rowName);
    if (!named) continue;
    const sen = seniorityIn(head);
    const sec = SECURITY_RE.exec(head);
    if (!seniority && sen) seniority = { k: "label", t: sen[1].toLowerCase(), stated: sen[0], src };
    if (!security && sec) security = { k: "label", t: sec[1].toLowerCase(), stated: sec[0], src };
  }
  return { seniority, security };
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
