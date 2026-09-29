/**
 * SESSION 24, FIX 5 — WHEN MAY A PRIOR-PERIOD ANNUAL REPORT BE READ?
 *
 * A 10-K carries a full, tidy debt table. The anchor 10-Q often does not. That
 * asymmetry is exactly why an older annual report is the most dangerous
 * document in the corpus: substituting it produces a ladder that looks BETTER
 * than the honest one and is true at the wrong date. Cigna's v30 answer did
 * precisely that — three rows of the 10-K's table carrying the anchor's period
 * column and the anchor's citations.
 *
 * THE RULE, KEYED ON RULE 51's SHAPE:
 *
 *   tabular         the anchor has its own table. The annual report is not a
 *                   source, and any ladder row citing it is WITHHELD.
 *   prose-only      the anchor states its debt in sentences. Still its own
 *                   disclosure; the annual report is not a source.
 *   not-located,
 *     and DIRECTED  the anchor locates no note AND itself points at the
 *                   annual report ("see Note 7 to our 2025 Form 10-K"). The
 *                   table may be read — as the LABELLED PRIOR-PERIOD BASE of
 *                   the roll-forward, never as a row in the current ladder.
 *   not-located,
 *     undirected    nothing connects the two documents. Not a source.
 *
 * "DIRECTED" MEANS THE FILING SAID SO, not that both documents exist. The
 * cross-reference has to be present and verified against the anchor's own
 * text; an unverified one is a model assertion, and this gate exists because
 * an instruction the model can decline is not a constraint.
 *
 * AND `not-recorded` IS NOT A FOURTH BRANCH. It means the answer predates the
 * shape being stored, so the gate has no input and DOES NOT RUN. Re-deriving
 * the shape from today's locator and enforcing on that would be judging an old
 * answer by a measurement it never saw — the same error as comparing a golden
 * across a version bump.
 */

export type AnchorShape = "tabular" | "prose-only" | "not-located" | "not-recorded";

export interface AnnualReportGate {
  /** False when the shape was never recorded: there is nothing to enforce against. */
  enforced: boolean;
  /** May the prior-period annual report be read at all? */
  mayRead: boolean;
  /** When it may: ONLY as the labelled prior-period base, never a current row. */
  asLabeledBaseOnly: boolean;
  reason: string;
}

export function annualReportGate(shape: AnchorShape, hasVerifiedCrossReference: boolean): AnnualReportGate {
  if (shape === "not-recorded") {
    return {
      enforced: false, mayRead: false, asLabeledBaseOnly: false,
      reason:
        "the anchor note shape was not recorded on this answer, so this gate has no input and does not run. " +
        "The shape is NOT re-derived: today's locator would give today's answer about an extraction made under " +
        "another one, which is a different fact wearing the same name.",
    };
  }
  if (shape === "not-located" && hasVerifiedCrossReference) {
    return {
      enforced: true, mayRead: true, asLabeledBaseOnly: true,
      reason:
        "the anchor locates no debt note AND directs the reader to the prior-period annual report in its own " +
        "verified words. The referenced table may be read as the LABELLED PRIOR-PERIOD BASE of the roll-forward — " +
        "carrying that filing's period, never the anchor's — and may not become a row in the current ladder.",
    };
  }
  if (shape === "not-located") {
    return {
      enforced: true, mayRead: false, asLabeledBaseOnly: false,
      reason:
        "the anchor locates no debt note and does not direct the reader anywhere. Two documents both existing is " +
        "not a reference from one to the other, and an abbreviated note is ordinary rather than an invitation to " +
        "substitute an older filing's table.",
    };
  }
  return {
    enforced: true, mayRead: false, asLabeledBaseOnly: false,
    reason:
      `the anchor has its own debt disclosure (${shape}), so it is the position. A prior-period annual report is ` +
      "not a source for a ladder the anchor itself reports.",
  };
}

/**
 * Split ladder-bound entries on the gate. NEVER a silent drop: every withheld
 * entry comes back with the reason, for the caller to state.
 */
export function withholdAnnualReportRows<T extends { citedUrl?: string | null }>(
  entries: T[],
  isAnnualReport: (url: string) => boolean,
  gate: AnnualReportGate
): { kept: T[]; withheld: { entry: T; reason: string }[] } {
  // Not enforced, or the annual report is allowed only as the labelled base —
  // either way no entry is removed HERE. In the directed case the table
  // reaches the base through its own field (Rule 51's referencedScheduleSequence),
  // and a ladder row citing the annual report is still not permitted, which is
  // why the directed branch keeps withholding below.
  if (!gate.enforced) return { kept: entries, withheld: [] };
  const kept: T[] = [];
  const withheld: { entry: T; reason: string }[] = [];
  for (const e of entries) {
    const url = e.citedUrl ?? "";
    if (url && isAnnualReport(url)) withheld.push({ entry: e, reason: gate.reason });
    else kept.push(e);
  }
  return { kept, withheld };
}
