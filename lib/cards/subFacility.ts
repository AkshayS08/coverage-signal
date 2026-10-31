/**
 * SESSION 27 (Akshay, Nov 1, 2026) — A SUB-FACILITY IS ONE ITS OWN SENTENCE
 * PLACES INSIDE THE PARENT FACILITY. DaVita's facts filed "letters of credit
 * of approximately $ 184,758 outstanding under a separate bilateral secured
 * letter of credit facility" — another facility's outstanding letters of
 * credit — as a sub-facility of its revolver.
 *
 * Inside: the sentence names a sub-facility, sub-limit or swingline, or says
 * the parent includes / provides for / has available capacity for letters of
 * credit. Never inside: a facility the sentence calls separate, standalone or
 * bilateral, or letters of credit merely "outstanding under" a facility.
 */
const INSIDE = /\bsub-?facilit|\bsub-?limit|\bsublimit|\bswing\s?line|\b(?:includ\w*|provides?\s+for|provided\s+for|availab\w*\s+for)\b(?:[^.]|\.(?=\d)){0,100}\bletters?\s+of\s+credit\b/i;
const SEPARATE = /\b(?:separate|standalone|stand-alone|bilateral)\b(?:[^.]|\.(?=\d)){0,40}\bfacilit/i;

export function placedInsideParent(sentence: string): boolean {
  return INSIDE.test(sentence) && !SEPARATE.test(sentence);
}
