/**
 * Session 18 — makes a real, recurring failure class VISIBLE instead of
 * silently passing: v10/v11's HCA pilots both showed a debt note can pass
 * BOTH checksum checks (Check 1's internal walk, Check 2's balance-sheet
 * anchor) on a PARTIAL transcription — the model stopped short of the
 * source table's real end, and nothing already built catches that, because
 * both checks only ever look at what WAS transcribed, never at what the
 * filing itself still contains beyond it.
 *
 * This is a deterministic, zero-LLM-cost, code-level cross-check against
 * the SAME full filing text already fetched for extraction (never a new
 * fetch, never a new model call) — a REPORTING signal, not a gate. It never
 * blocks, drops, or retries anything; it only names what the transcription
 * may have missed so a reviewer doesn't have to notice by hand (the exact
 * way HCA's v10 gap was originally found).
 *
 * Two structural checks against the same located debt-note section
 * (lib/fetch/noteLocation.ts's locateDebtNoteSection, re-run here at
 * zero cost — the SAME deterministic bounds already used to build the
 * extraction corpus, not re-derived differently):
 *   1. Labeled-total candidates: every "Total ... <number>"-shaped span in
 *      the source section, cross-checked against whether ANY transcribed
 *      entry's own (already-verified) sourceLine covers that position. A
 *      candidate with no covering entry is a labeled total the filing
 *      prints that never made it into scheduleSequence.
 *   2. Trailing content: how far into the source section transcription
 *      actually reached (the furthest end of any transcribed entry's own
 *      position in the full text) versus where the located section itself
 *      ends. Leftover numeric content past that point is exactly HCA's
 *      failure shape — a genuinely UNLABELED final subtotal, which check 1
 *      above can never catch, because there's no "Total" word to find.
 *
 * Known, accepted limitation: an entry verified via `verifyClaim`'s
 * co-occurrence fallback (facts scattered nearby rather than one
 * contiguous span — see verifyQuote.ts) has no single literal position
 * `String.indexOf` can find, so it's excluded from the "already covered"
 * span set. This only makes the check MORE likely to flag something as
 * missing/trailing, never less — a conservative bias in the right
 * direction for a visibility signal, never a false "complete."
 */
import { locateDebtNoteSection } from "./noteLocation";

export interface ScheduleCompletenessResult {
  /** False when there was no locatable debt-note section to check against at all (nothing to compare — never reported as either complete or incomplete). */
  checked: boolean;
  subtotalsTranscribed: number;
  /** Every "Total ... <number>"-shaped span found in the source section, whether or not it was transcribed. */
  labeledTotalCandidatesInSource: number;
  /** Raw source-text snippets for labeled-total candidates that no transcribed entry's own sourceLine covers — named, not just counted. */
  missingLabeledTotals: string[];
  /** The first PREDOMINANTLY-NUMERIC line (a money figure essentially alone on its line — the structural shape of an unlabeled subtotal) left unconsumed after the furthest point any transcribed entry reached. Null when nothing of that shape remains; adjacent narrative prose and neighbouring unrelated tables deliberately do NOT flag here — see the trailing check's own comment for why. */
  trailingUnconsumedText: string | null;
  /** True only when checked AND nothing above was flagged. A company can still pass both checksum checks with complete === false — that combination is exactly what this exists to surface. */
  complete: boolean;
}

/** A literal "Total" caption followed, within a short same-line-ish window, by a number — the one structural signature every labeled subtotal shares regardless of exact wording ("Total debt", "Total long-term debt", "Total debt principal outstanding"). Deliberately does NOT try to detect unlabeled subtotals this way — those have no "Total" word by definition; the trailing-content check below is what catches that case instead. */
const TOTAL_LABEL_RE = /Total[^\n]{0,80}?\$?\(?[\d,]{4,}\)?/g;

/** Cap on how much of a flagged trailing line gets surfaced in a report — enough to identify it, not the whole remainder of the filing. */
const TRAILING_SNIPPET_CHARS = 220;
/**
 * A trailing line only counts as a plausible missed TABLE entry when it is
 * predominantly numeric — a money figure with little accompanying prose.
 * See the trailing check below for why this ratio exists at all.
 */
const MAX_ALPHA_RATIO_FOR_NUMERIC_LINE = 0.25;
/** A flagged numeric line must carry a real, comma-grouped or decimal money-shaped figure — never a stray page number or footnote marker. */
const MONEY_SHAPED_RE = /\(?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?\$?\s?\d+\.\d+\)?/;

function emptyResult(subtotalsTranscribed: number): ScheduleCompletenessResult {
  return {
    checked: false,
    subtotalsTranscribed,
    labeledTotalCandidatesInSource: 0,
    missingLabeledTotals: [],
    trailingUnconsumedText: null,
    complete: false,
  };
}

/** Every index at which `needle` occurs in `haystack` — the whole point of the occurrence-aware fix below; `indexOf` alone silently returns only the first. */
function allOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * `entries` should be the trigger's FULL verified scheduleSequence (row +
 * adjustment + subtotal kinds alike) — every entry's own position in the
 * source matters for the trailing check, not just subtotals.
 */
export function computeScheduleCompleteness(
  fullText: string,
  entries: { sourceLine: string; kind: string }[]
): ScheduleCompletenessResult {
  const subtotalsTranscribed = entries.filter((e) => e.kind === "subtotal").length;
  if (entries.length === 0) return emptyResult(subtotalsTranscribed);

  const location = locateDebtNoteSection(fullText);
  if (location.status === "not_found") return emptyResult(subtotalsTranscribed);

  // OCCURRENCE-AWARE span resolution. The original `indexOf` took each
  // entry's FIRST occurrence anywhere in the whole document — and a 10-Q
  // routinely prints the same line more than once (the debt note's own
  // table, then MD&A restating the same totals; a caption like "Long-term
  // debt, net of current portion" appearing on the balance sheet too).
  // Picking the wrong occurrence put the computed span outside the located
  // section entirely, which then made correctly-transcribed totals inside
  // the section read as "missing" and dropped the trailing cursor back to
  // the section start. Live false positives from this exact bug: Quest (two
  // labeled totals reported missing that were verbatim present in its own
  // sequence) and Encompass Health.
  //
  // Fix: consider only occurrences INSIDE the located section, then walk
  // them in order — a debt note is transcribed in printed order, so each
  // entry's chosen position should be at or after the previous entry's.
  // Falls back to the section's first occurrence when nothing sits at or
  // after the cursor (an out-of-order transcription is possible and must
  // not crash the check — it just resolves less precisely).
  const entrySpans: { start: number; end: number }[] = [];
  let cursor = location.start;
  for (const e of entries) {
    if (!e.sourceLine) continue;
    const inSection = allOccurrences(fullText, e.sourceLine).filter((i) => i >= location.start && i < location.end);
    if (inSection.length === 0) continue; // co-occurrence-verified, or genuinely outside this section — excluded, never guessed at
    const chosen = inSection.find((i) => i >= cursor) ?? inSection[0];
    entrySpans.push({ start: chosen, end: chosen + e.sourceLine.length });
    cursor = chosen;
  }

  // If NOT ONE entry could be located inside the section, there's nothing
  // trustworthy to compare against — the transcription may have come from a
  // different part of the document than the locator found. Report unchecked
  // rather than declare the entire section "unconsumed," which would be a
  // guaranteed false positive.
  if (entrySpans.length === 0) return emptyResult(subtotalsTranscribed);

  const excerpt = fullText.slice(location.start, location.end);
  const totalMatches: { index: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  TOTAL_LABEL_RE.lastIndex = 0;
  while ((m = TOTAL_LABEL_RE.exec(excerpt))) {
    totalMatches.push({ index: location.start + m.index, text: m[0].trim() });
  }

  // Coverage test deliberately checks only the CANDIDATE'S OWN START
  // position (where the literal word "Total" sits) against exact
  // containment in an entry's span — never a padded/nearby-entry match. A
  // real subtotal's sourceLine is the verbatim caption text and virtually
  // always literally contains "Total" at (or very near) its own start, so
  // exact containment is enough; padding in either direction was tried and
  // rejected — it let an ADJACENT, unrelated, immediately-preceding entry
  // falsely "cover" the next line's real total just by being close to it
  // (two lines separated by nothing but a single newline is entirely
  // ordinary in flattened filing text). The candidate's own match window
  // extends well past "Total" (up to 80 chars, to find its dollar figure)
  // deliberately for DETECTION, but that trailing reach must never be used
  // for coverage — a real sourceLine often captures only the caption
  // wording and not the figure itself (the figure can sit in a different
  // table cell, further into the raw text than the caption), so requiring
  // the ENTRY's span to reach the figure too would false-flag correctly
  // transcribed subtotals.
  const missingLabeledTotals = totalMatches
    .filter((tm) => !entrySpans.some((span) => tm.index >= span.start && tm.index < span.end))
    .map((tm) => tm.text);

  // TRAILING CHECK — narrowed to a structural test, after the first pass
  // over 8 real companies showed the original "any numeric content left in
  // the window" rule flagging almost everything. The locator's section
  // bounds are a padded density window, not a precise table boundary, so
  // the region after the last transcribed entry routinely contains adjacent
  // NARRATIVE ("The following chart shows scheduled principal payments...",
  // ABL-facility prose) or a DIFFERENT nearby table — none of which is a
  // missed debt-schedule entry. Live false positives: Encompass Health, CHS.
  //
  // What this check exists for is one specific, real shape: a genuinely
  // UNLABELED subtotal, which the labeled-total scan above can never catch
  // (no "Total" word by definition) — HCA's own missed final figure. That
  // shape is structurally distinct from prose: a money figure sitting on a
  // line essentially by itself. So only predominantly-numeric lines are
  // reported. Consistent with this project's structural-not-lexical
  // convention — no vocabulary matching, just the ratio of letters to
  // everything else on the line.
  const maxEntryEnd = Math.max(...entrySpans.map((s) => s.end));
  const trailingRegion = fullText.slice(Math.max(maxEntryEnd, location.start), location.end);
  const numericTrailingLine = trailingRegion
    .split("\n")
    .map((line) => line.trim())
    .find((line) => {
      if (!line || !MONEY_SHAPED_RE.test(line)) return false;
      const alphaCount = (line.match(/[A-Za-z]/g) ?? []).length;
      return alphaCount / line.length <= MAX_ALPHA_RATIO_FOR_NUMERIC_LINE;
    });
  const trailingUnconsumedText = numericTrailingLine ? numericTrailingLine.slice(0, TRAILING_SNIPPET_CHARS) : null;

  return {
    checked: true,
    subtotalsTranscribed,
    labeledTotalCandidatesInSource: totalMatches.length,
    missingLabeledTotals,
    trailingUnconsumedText,
    complete: missingLabeledTotals.length === 0 && trailingUnconsumedText === null,
  };
}
