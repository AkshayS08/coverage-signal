/**
 * SESSION 23, B3 — A STATED ZERO IS A STATED FIGURE.
 *
 * `sentenceStatesFigure` asks whether the sentence contains the value's
 * digits. For every figure but one that is exactly right. For zero it is
 * exactly wrong: filings almost never print "$0" in prose. They write "we
 * had no cash borrowings", "no amount was outstanding", "there were no
 * borrowings under the facility", or they print an em-dash in the column.
 *
 * So a genuinely stated zero was extracted correctly and then thrown away by
 * the check meant to protect it — and the field fell back to null, which
 * means "this filing does not say". The filing said. It said zero.
 *
 * ==========================================================================
 * THE RULE, AND WHY IT IS NOT A PHRASE LIST
 * ==========================================================================
 *
 * Absence is asserted with a small, CLOSED GRAMMATICAL CLASS — negative
 * determiners and quantifiers. That class is finite in English and does not
 * grow with the next filer's house style, which is what separates it from a
 * vocabulary guard (Rule 1): "nothing was drawn", "without any outstanding
 * balance" and "no borrowings were outstanding" all resolve without any of
 * them appearing in a list here, because each carries a member of the class.
 *
 * WHAT THE RULE MUST NOT DO is accept a zero over a sentence that states a
 * real quantity. Tenet's own sentence is the case that proves it matters:
 *
 *   "On that date, we had no cash borrowings and less than $ 1 million of
 *    standby letters of credit outstanding under the Credit Agreement."
 *
 * The model claimed $0 for BOTH drawn and lettersOfCredit off this one
 * sentence. Drawn is right — "no cash borrowings". Letters of credit is
 * WRONG: the filing says less than $1 million, which is not zero, and a
 * blanket "the sentence contains 'no'" test would wave it through.
 *
 * So absence is SCOPED. The sentence is split into clauses; a clause
 * asserting absence and carrying no quantity of its own supports zero, and
 * a clause carrying a quantity supports that quantity instead. Then the
 * clause that belongs to the field being checked is the one that decides —
 * Rule 38's shape, one field over: a statement reaches only what its own
 * words scope.
 *
 * ==========================================================================
 * THE ONE SEAM WHERE VOCABULARY IS UNAVOIDABLE, STATED PLAINLY
 * ==========================================================================
 *
 * Deciding WHICH clause belongs to `drawn` rather than to `lettersOfCredit`
 * requires connecting our schema's field name to the noun a filing uses for
 * that quantity. Nothing structural can do that: "drawn" and "borrowings"
 * are the same idea in two vocabularies, and only a map says so.
 *
 * FIELD_NOUNS below is that map. It is deliberately small, it names
 * quantities rather than filers, and it is the one place in this module a
 * new phrasing could need an addition. Recorded as such rather than hidden —
 * a rule with a known seam is honest; a rule pretending it has none is the
 * thing that breaks quietly.
 */

/**
 * Negative determiners and quantifiers — a closed grammatical class, not a
 * list of filing phrasings. An em-dash is included because a table column
 * prints zero that way, which is the same assertion in typography (the
 * precedent is Rule 16: a stated deduction is negative however it is
 * punctuated).
 */
const ABSENCE_MARKER = /(^|[\s(])(no|none|nil|zero|not|never|without|nothing)([\s,.;)]|$)|[—–]/i;

/** A quantity: digits with a scale word, a currency mark, or a percent. */
const QUANTITY = /\$\s?[\d,]+(\.\d+)?|\b[\d,]+(\.\d+)?\s*(thousand|million|billion|trillion)s?\b/i;

/**
 * Schema field -> the nouns filings use for that quantity. THE SEAM. See the
 * header. Ordered most specific first so "letters of credit outstanding"
 * does not read as `drawn` merely because it contains "outstanding".
 */
const FIELD_NOUNS: { field: string; re: RegExp }[] = [
  { field: "lettersOfCredit", re: /letters?\s+of\s+credit|\bl\/?cs?\b|standby\s+letters?/i },
  { field: "available", re: /availab|undrawn|remaining\s+(?:capacity|availability)|capacity\s+(?:remaining|available)/i },
  // "amounts outstanding" and "no amount WAS outstanding" are the same claim.
  // A COPULA BETWEEN A NOUN AND ITS PREDICATE DOES NOT CHANGE WHICH FIELD THE
  // CLAUSE IS ABOUT — and copulas are a closed class, exactly like the
  // negative determiners this rule already rests on, so admitting them is not
  // a phrase list growing by one filer. Molina is the measured cost: its
  // anchor says "As of June 30, 2026, no amount was outstanding under the
  // Credit Agreement", the model returned $0 against that very sentence, and
  // the adjacency requirement threw the zero away — which is the exact act
  // Rule 53 exists to prevent, committed by Rule 53.
  { field: "drawn", re: /borrow|drawn|draw(?:n|ings)?\b|advance|outstanding\s+(?:balance|principal|amount)|amounts?\s+(?:(?:was|were|is|are|remains?|remained|be|been)\s+)?outstanding|cash\s+borrowings/i },
  { field: "facilitySize", re: /facility|commitment|aggregate\s+principal|total\s+capacity|provides?\s+for/i },
];

export type ZeroSupport =
  /** A clause belonging to this field asserts the balance is absent. */
  | { kind: "asserts-absence"; clause: string }
  /** A clause belonging to this field states a quantity — so zero is not what it says. */
  | { kind: "states-a-quantity"; clause: string }
  /** The sentence says nothing about this field. Null, never zero. */
  | { kind: "silent" };

/**
 * Clause boundaries: coordinating conjunctions and punctuation. Deliberately
 * crude — the job is only to stop one clause's absence from covering
 * another's quantity, not to parse English.
 */
export function clausesOf(sentence: string): string[] {
  return sentence
    .split(/,\s+|\s+and\s+|\s+but\s+|\s+while\s+|;\s*|\s+whereas\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Which field a clause is about, or null when it names no quantity we track. */
export function fieldOfClause(clause: string): string | null {
  for (const { field, re } of FIELD_NOUNS) if (re.test(clause)) return field;
  return null;
}

/**
 * Does this sentence support a ZERO for this field?
 *
 * Note the asymmetry, which is the point: absence must be asserted IN a
 * clause about this field. A sentence that never mentions the field is
 * `silent` and the figure stays null — Rule 10, one field over. Absence of a
 * mention is not an assertion of zero.
 */
export function zeroSupportFor(sentence: string, field: string): ZeroSupport {
  // A TRAILING CLAUSE THAT NAMES NOTHING CONTINUES THE ONE BEFORE IT.
  //
  // Filings assert absence by anaphora as often as by repetition: "...any
  // letters of credit outstanding under it, OF WHICH THERE WERE NONE". That
  // second clause names no quantity at all — it is a pronoun pointing back —
  // and scoping it on its own words alone loses the zero it states.
  //
  // So an unanchored clause inherits the subject of the last clause that had
  // one. Structural, and it cuts both ways: the same carry-forward makes a
  // trailing quantity refuse a zero just as readily as a trailing "none"
  // supports it.
  const clauses = clausesOf(sentence);
  const attributed: { clause: string; field: string | null }[] = [];
  let carried: string | null = null;
  for (const c of clauses) {
    const own = fieldOfClause(c);
    if (own) carried = own;
    attributed.push({ clause: c, field: own ?? carried });
  }
  const mine = attributed.filter((a) => a.field === field).map((a) => a.clause);
  if (mine.length === 0) return { kind: "silent" };

  // A clause of this field's own that carries no quantity and asserts
  // absence is the zero. Checked BEFORE the quantity case so a sentence
  // pairing "no borrowings" with a separate figure still resolves.
  for (const c of mine) {
    if (ABSENCE_MARKER.test(c) && !QUANTITY.test(c)) return { kind: "asserts-absence", clause: c };
  }
  for (const c of mine) {
    if (QUANTITY.test(c)) return { kind: "states-a-quantity", clause: c };
  }
  // Mentions the field, asserts nothing measurable about it.
  return { kind: "silent" };
}

/** True where the value is a zero in any of the forms the schema may carry it. */
export function isZeroValue(value: string): boolean {
  const t = value.trim();
  if (/^[—–-]$/.test(t)) return true;
  const digits = t.replace(/[^\d.]/g, "");
  return digits.length > 0 && Number(digits) === 0;
}
