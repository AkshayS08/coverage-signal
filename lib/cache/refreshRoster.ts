/**
 * THE REFRESH ROSTER — which names get re-extracted next, and why each is on
 * it. Data, not prose, so the next pass reads it rather than remembering it.
 *
 * A name lands here for one of two reasons, and they are NOT the same
 * question:
 *
 *   corpus-moved — the signed golden describes a filing set that no longer
 *     exists. Rule 30: stale, not wrong. The refresh re-signs it.
 *
 *   field-drop — a field came back null at the blob while the filings the
 *     model was given DO state it. The refresh measures whether the drop
 *     reproduces: twice is a prompt problem, once is variance.
 *
 * A name can carry both, and Encompass does — which is exactly why the two
 * reasons are separate fields rather than one label.
 *
 * WHAT A FIELD-DROP ENTRY MUST CARRY. A drop is only worth re-asking about
 * if the filing states the field. So every field-drop entry names the
 * sentence that would fill it, quoted from the corpus, and which document
 * that sentence lives in. Without that, "the model dropped it" and "the
 * filing never said it" are the same observation, and a refresh priced
 * against the second one buys nothing. Session 23's Stage 1 was that mistake
 * at full price.
 */

/** Where the filling sentence lives, relative to the anchor. */
export type SentenceLocation = "anchor" | "off-anchor";

export interface FieldDropWatch {
  /** The field that came back null. */
  field: "drawn" | "lettersOfCredit" | "available" | "facilitySize" | "maturity";
  /** The facility it was null on. */
  facility: string;
  /** What the corpus actually says — verbatim, so a recovery can be checked against it. */
  statedBy: { location: SentenceLocation; document: string; sentence: string };
  /** The value a correct extraction would carry. */
  expected: string;
  /** v30's observation. Null here is what "dropped" means. */
  observedAtV30: string | null;
}

export interface RosterEntry {
  company: string;
  corpusMoved: boolean;
  /** Empty where the name is on the roster for staleness alone. */
  fieldDrops: FieldDropWatch[];
  note: string;
}

export const REFRESH_ROSTER: RosterEntry[] = [
  // Molina was on this roster and is DONE — refreshed, 9b tested at v30, and
  // re-baselined. Removed rather than left with a "done" flag, because a
  // roster that keeps completed names is a list nobody can read at a glance.
  //
  // UHS was never on it: its corpus had not moved and it had no field drop.
  // It is now HELD as a v31 candidate — its $700M delayed-draw facility is
  // absent from one raw extraction in three, which no refresh fixes and no
  // signature should pin.
  {
    company: "Tenet Healthcare",
    corpusMoved: true,
    fieldDrops: [],
    note: "Golden not-applicable at v30 — filing set moved. Re-sign against the new corpus.",
  },
  {
    company: "Community Health Systems",
    corpusMoved: true,
    fieldDrops: [],
    note:
      "Golden not-applicable at v30 — filing set moved. Also carries the two-rows-one-instrument " +
      "render case (ABL $0 [repaid] beside ABL $1.0B capacity), which is a RENDER question for the " +
      "product read, not an extraction one, and is not fixed by this refresh.",
  },
  {
    company: "Molina Healthcare",
    corpusMoved: false,
    fieldDrops: [
      {
        field: "drawn",
        facility: "revolving credit facility",
        statedBy: {
          location: "anchor",
          document: "10-Q 2026-07-23",
          sentence: "As of June 30, 2026, no amount was outstanding under the Credit Agreement.",
        },
        expected: "$0",
        observedAtV30: null,
      },
    ],
    note:
      "NOT stale — Molina's corpus is unchanged, so this is a clean second trial of the same " +
      "question against the same documents. The anchor states the field twice, on the anchor's own " +
      "as-of date, in the same section the model DID draw `available` from ('Credit Agreement " +
      "Borrowing Capacity'). The absence language is plain and Rule 53 accepts it. The model had it " +
      "and did not return it.",
  },
  {
    company: "Encompass Health",
    corpusMoved: true,
    // STRUCK, and struck on evidence rather than dropped quietly. The session
    // carried Encompass for a `lettersOfCredit: $0` that the filings do not
    // state. The whole corpus contains exactly two LC sentences, both in the
    // 8-K of 2026-03-10, and they say $53.6 million as of MARCH 9 — not zero,
    // and not the anchor's date. The anchor 10-Q (2026-08-07) is silent.
    //
    // So null is the CORRECT answer here, and it is Rule 51's shape one field
    // over: where the anchor does not state it, the row does not carry it.
    // A refresh cannot recover a number the anchor never states; it can only
    // return null again (right) or reach into the 8-K for $53.6M and stamp it
    // with the anchor's date (the off-anchor substitution this whole session
    // has been removing). Neither outcome is worth the call.
    //
    // Encompass stays on the roster for the corpus move alone.
    fieldDrops: [],
    note:
      "Corpus moved — re-sign. The lettersOfCredit watch was STRUCK before spending: the expectation " +
      "of $0 is not what the filings say. Only LC figures in the corpus are $53.6M and $250.0M drawn, " +
      "both as of March 9, 2026, in the 8-K of 2026-03-10; the anchor 10-Q does not mention letters " +
      "of credit at all. Note the identity closes on that stale number — 1,000 − 200 − 53.6 = 746.4 " +
      "against a stated available of $746M — which makes it very likely still the balance and still " +
      "not something the anchor states. Implying it from the arithmetic is the thing we do not do.",
  },
];

/**
 * Two observations of one field, one verdict.
 *
 * `reproducing-drop` is the only one that justifies a prompt change, and
 * "null twice" alone does not earn it: the two observations have to be the
 * SAME question. Where the corpus moved between them, the second null is a
 * null about different documents, and saying otherwise is Rule 30's error
 * wearing a different hat.
 *
 * `off-anchor-substitution` exists because a filled field is not automatically
 * a recovery. A value that arrives from a document the anchor is not is the
 * failure Rule 51 was written for, and it must never be counted as the drop
 * having resolved.
 */
export type DropVerdict =
  | { kind: "reproducing-drop"; action: string }
  | { kind: "one-time-drop"; action: string }
  | { kind: "off-anchor-substitution"; action: string }
  | { kind: "not-comparable"; action: string };

export function dropVerdict(
  watch: FieldDropWatch,
  after: { value: string | null; sentenceLocation: SentenceLocation | null },
  corpusMovedBetween: boolean
): DropVerdict {
  if (corpusMovedBetween) {
    return {
      kind: "not-comparable",
      action:
        "the corpus changed between the two observations, so this is not a second trial of the same " +
        "question — re-sign first, then re-observe against the new corpus",
    };
  }
  if (after.value === null) {
    return {
      kind: "reproducing-drop",
      action: `the filing states it (${watch.statedBy.document}) and the model has now omitted it twice — this is a prompt fix, not variance`,
    };
  }
  if (after.sentenceLocation === "off-anchor") {
    return {
      kind: "off-anchor-substitution",
      action:
        "the field came back filled, but from a document that is not the anchor — that is a regression " +
        "of the kind Rule 51 removed, not a recovery of the drop",
    };
  }
  return {
    kind: "one-time-drop",
    action: "the field came back from the anchor's own text — v30's null was variance, and no prompt change is bought by it",
  };
}

/** The names a refresh pass actually re-extracts. */
export function rosterNames(): string[] {
  return REFRESH_ROSTER.map((r) => r.company);
}

/** The field watches a refresh must report on. Empty entries contribute nothing. */
export function activeWatches(): { company: string; watch: FieldDropWatch }[] {
  return REFRESH_ROSTER.flatMap((r) => r.fieldDrops.map((watch) => ({ company: r.company, watch })));
}
