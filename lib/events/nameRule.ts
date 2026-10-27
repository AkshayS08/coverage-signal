/**
 * SESSION 27 (Akshay, Oct 23, 2026) — THE NAME RULE, ONE DEFINITION.
 *
 * A displayed instrument name must be in the sentence it cites, compared
 * case-insensitively with whitespace removed (the HTML-to-text spacing puts
 * "3.400 %" where the filing prints 3.400%). A name not found there is shown
 * as the plain instrument type, as the sentence itself prints it, never as
 * the model's paraphrase. Used by the card's table names and by the
 * roll-forward's delta labels, so the two cannot disagree.
 */
import { classifyInstrument } from "./instrumentClass";

/** How each instrument type is shown when the filer's own name for it cannot be. */
export const TYPE_DISPLAY: Record<string, string> = {
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

const squash = (x: string) => x.replace(/\s+/g, "").toLowerCase();

export function nameIsVerbatim(name: string, sentence: string): boolean {
  return squash(sentence).includes(squash(name));
}

/**
 * The plain type of an instrument and, where the sentence prints the type
 * word (or a stem of five letters or more, as "revolv" in "revolving"), the
 * exact text it prints. `stated` is null when the sentence prints neither.
 */
export function plainTypeOf(instrument: string, sentence: string): { word: string; stated: string | null } {
  const c = classifyInstrument({ headings: [], instrumentName: instrument });
  const word = (c.instrumentType && TYPE_DISPLAY[c.instrumentType]) || "instrument";
  const lower = sentence.toLowerCase();
  for (let n = word.length; n >= Math.min(5, word.length); n--) {
    const at = lower.indexOf(word.slice(0, n).toLowerCase());
    if (at >= 0) return { word, stated: sentence.slice(at, at + n) };
  }
  return { word, stated: null };
}

/** A label for text: the name where its sentence contains it, else the plain type as the sentence prints it, else the plain type. */
export function nameOrPlainType(name: string, sentence: string): string {
  if (nameIsVerbatim(name, sentence)) return name;
  const p = plainTypeOf(name, sentence);
  return p.stated && p.stated.length >= p.word.length ? p.stated : p.word;
}
