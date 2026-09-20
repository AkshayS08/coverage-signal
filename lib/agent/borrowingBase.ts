/**
 * SESSION 23, B4 (WIDENED) — A BORROWING BASE IS ANNOUNCED TWO WAYS, AND
 * EITHER IS ENOUGH.
 *
 * The first cut keyed on one signal: the filer's qualifying sentence, carried
 * in `availabilityBasis`. The v30 cold pass showed why one signal is not
 * enough — it missed on the very company the rule was written for.
 *
 * CHS's ABL Facility came back with `availabilityBasis: null`, even though
 * the size sentence the model itself returned reads "...a revolving
 * asset-based loan facility in the maximum aggregate principal amount of
 * $1.0 billion, SUBJECT TO BORROWING BASE CAPACITY", and the availability
 * sentence reads "...approximately $751 million of additional borrowing
 * capacity (AFTER TAKING INTO CONSIDERATION the $32 million of outstanding
 * letters of credit)". The words were in the text the model handed back; it
 * simply did not put them in the dedicated field. A rule that depends on the
 * model populating one optional field is a rule with a single point of
 * failure, and this is that failure.
 *
 * So the trigger is a DISJUNCTION. Either is sufficient on its own:
 *
 *   (a) THE LABEL. The facility is identified as asset-based, or as an ABL.
 *       An ABL always has a borrowing base — that is what the instrument is
 *       — whether or not the availability sentence restates the fact. So the
 *       label alone settles it, and no carve-out is needed: measured across
 *       this book there is no facility labelled ABL that lacks one.
 *
 *   (b) THE STATED LANGUAGE. The filing says availability is subject to a
 *       borrowing base, or states availability as already net of something,
 *       or gives an eligible-collateral formula. A NON-ABL revolver can
 *       carry a borrowing base too — Tenet's does, on "specified percentages
 *       of eligible accounts receivable, eligible inventory and Medicaid
 *       supplemental payments" — so the language alone settles it as well.
 *
 * Keying on either signal alone misses the other's cases, which is precisely
 * what happened: (b) alone missed CHS, and (a) alone would miss Tenet.
 *
 * WHERE THE LANGUAGE IS READ FROM is the filer's own sentences — the
 * verbatim `sourceLine` of any figure on the facility, plus the
 * `availabilityBasis` statement when the model did fill it. Those are
 * filing text we already hold and have already verified; reading them is not
 * a second extraction.
 *
 * AND THE SEAM, STATED: matching "subject to borrowing base" in a sentence is
 * vocabulary, which this codebase otherwise refuses (Rule 1). It is admitted
 * here for one reason — the trigger is defined as *the filer's stated
 * language*, so the words ARE the signal rather than a proxy for one. The
 * patterns below name a financial construction, never a company, and the
 * label path (a) exists so that a filer phrasing it a new way is still caught.
 */
import type { FacilityRow } from "./claude";

/** The label path: this instrument is an ABL, so it has a base by definition. */
const ASSET_BASED_LABEL = /\basset[-\s]?based\b|\bABLs?\b/i;

/**
 * The stated-language path. Three constructions, each naming a way a filer
 * says availability is not simply the commitment:
 *   - a borrowing base, named as such
 *   - availability stated as already net of something
 *   - an eligible-collateral formula
 */
const BORROWING_BASE_LANGUAGE: { re: RegExp; limitedBy: string }[] = [
  { re: /borrowing\s+base/i, limitedBy: "borrowing base" },
  { re: /after\s+(?:taking\s+into\s+consideration|giving\s+effect\s+to|deducting)/i, limitedBy: "the amounts the filing states availability is already net of" },
  { re: /(?:specified\s+)?percentages?\s+of\s+eligible|eligible\s+(?:accounts\s+receivable|inventory|collateral)/i, limitedBy: "specified percentages of eligible collateral" },
];

export interface BorrowingBase {
  /** What availability is limited by, in the filing's words where they are available. */
  limitedBy: string;
  /** The sentence that settles it. For the label path, the sentence naming the facility. */
  statement: string;
  /** Which signal fired. Rendered, so a reader can see why the rule applied. */
  signal: "asset-based-label" | "stated-language";
}

/** Every verbatim sentence this facility carries, in the order they were read. */
function sentencesOf(f: FacilityRow): string[] {
  const figs = [f.facilitySize, f.drawn, f.lettersOfCredit, f.available, f.maturity];
  const out = figs.filter((x) => !!x).map((x) => x!.sourceLine);
  if (f.availabilityBasis) out.unshift(f.availabilityBasis.statement);
  return out;
}

/**
 * Is this facility's availability limited by a borrowing base? Either signal
 * suffices; neither is required.
 *
 * Returns null where the filing says nothing and the facility is not an ABL —
 * which is the ordinary revolver, whose availability identity holds and whose
 * disagreement, if any, is therefore unexplained and must be flagged.
 */
export function borrowingBaseOf(f: FacilityRow): BorrowingBase | null {
  // The model's own field first, where it filled it: the filer's sentence
  // beats anything inferred from a label.
  if (f.availabilityBasis) {
    return { limitedBy: f.availabilityBasis.limitedBy, statement: f.availabilityBasis.statement, signal: "stated-language" };
  }
  const sentences = sentencesOf(f);
  for (const s of sentences) {
    for (const { re, limitedBy } of BORROWING_BASE_LANGUAGE) {
      if (re.test(s)) return { limitedBy, statement: s, signal: "stated-language" };
    }
  }
  // The label path. Checked AFTER the language so a stated sentence is what
  // renders where one exists — a reader would rather see the filer's words
  // than our inference from a name.
  const label = `${f.name} ${sentences.join(" ")}`;
  if (ASSET_BASED_LABEL.test(f.name) || ASSET_BASED_LABEL.test(label)) {
    return {
      limitedBy: "a borrowing base",
      statement: f.facilitySize?.sourceLine ?? f.name,
      signal: "asset-based-label",
    };
  }
  return null;
}
