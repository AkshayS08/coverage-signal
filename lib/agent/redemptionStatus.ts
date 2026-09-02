/**
 * SESSION 21 — AN INTENTION IS NOT A COMPLETION.
 *
 * Item 1d gave the redemption claim a verbatim sourceLine and made the model
 * state whether the retirement had happened. The sourceLines came back good
 * and verified in four of six. The STATUS did not: measured across the book
 * at v26, the model labelled two claims "completed" whose own quoted sentence
 * reads "intends to use the net proceeds ... to finance ... the redemption"
 * (Tenet) and "intends to use the proceeds (i) to repay $2.0 billion"
 * (Cigna).
 *
 * THIS IS NOT A STATUS JUDGE. It is the refusal to trust a status the
 * claim's own evidence does not support — exactly the shape of
 * amountCorroborated, which does not decide what a row's balance is, only
 * whether the balance the model reported is printed where it said it was.
 * Two returned fields have to agree before either is used.
 *
 * THE TEST IS GRAMMATICAL, AND THAT IS WHAT BOUNDS IT. A completed payment
 * is stated in the past tense — "we redeemed", "were used", "repaid in
 * full". An intention is stated with a prospective construction — "intends
 * to", "will", "notice of its election to". The difference between "redeem"
 * and "redeemed" is tense, not vocabulary: it carries no company names, no
 * instrument names, and no filer-specific phrasing, and it is the same kind
 * of closed list this codebase already relies on in PARTIAL_REDEMPTION_RE
 * and moneyScale.ts's SCALE_WORDS.
 *
 * IT FAILS TOWARD THE SAFE SIDE, ALWAYS. A "completed" that cannot be
 * corroborated is demoted to "intended", never the reverse. Getting this
 * wrong in the demoting direction leaves a repaid tranche visible on a
 * ladder, which the next filing corrects; getting it wrong the other way
 * removes a live obligation from a banker's screen, which nothing corrects.
 * That asymmetry is the same one PARTIAL_REDEMPTION_RE's own comment
 * records, and it is why the default is not neutral.
 *
 * Measured against all six real claims in the book — see
 * redemptionCorroboration.test.ts, which pins every one of them.
 */

/**
 * Prospective constructions. Present tense of intent, future auxiliaries,
 * and the "notice of election" form a redemption notice takes — a notice
 * that a company MEANS to redeem is not a redemption.
 */
const PROSPECTIVE_RE =
  /\b(?:intends?|expects?|plans?|proposes?|anticipates?|elects?)\s+to\b|\b(?:will|would|shall|may)\b|\b(?:is|are)\s+expected\s+to\b|\bnotice\s+of\s+(?:its\s+|the\s+)?(?:election|intention)\b/i;

/**
 * Completed payment, in the past tense. "used"/"were used" covers the
 * commonest form ("the net proceeds were used to repay in full"), and the
 * -ed forms cover the direct statement ("we redeemed all $1.500 billion").
 */
const COMPLETED_RE =
  /\b(?:redeemed|repaid|retired|repurchased|discharged|satisfied|defeased)\b|\b(?:was|were|have|has|had)\s+used\b|\b(?:we|the\s+company|the\s+issuer)\s+used\b|\bused\s+the\s+net\s+proceeds\b|\bcompleted\s+the\s+(?:redemption|repayment|retirement)\b/i;

export type RedemptionStatus = "completed" | "intended" | null;

export interface StatusCorroboration {
  /** The status to act on — never more confident than the evidence. */
  status: RedemptionStatus;
  /** True when the claim's own sourceLine states a completed payment. */
  corroborated: boolean;
  /** Set when a claimed "completed" was demoted, so the demotion is reportable rather than silent. */
  demotedReason: string | null;
}

/**
 * Reconciles a claimed status against the sentence the claim itself quoted.
 * A claim with no sourceLine has nothing to corroborate and cannot be
 * completed — which is the same answer verification already gives it.
 */
export function corroborateRedemptionStatus(
  claimed: RedemptionStatus,
  sourceLine: string | null | undefined
): StatusCorroboration {
  const line = (sourceLine ?? "").trim();
  if (!line) {
    return {
      status: claimed === "completed" ? "intended" : claimed,
      corroborated: false,
      demotedReason: claimed === "completed" ? "claimed completed with no sourceLine to corroborate it" : null,
    };
  }
  const prospective = PROSPECTIVE_RE.exec(line);
  const completed = COMPLETED_RE.exec(line);
  const corroborated = completed !== null && prospective === null;
  if (claimed !== "completed") return { status: claimed, corroborated, demotedReason: null };
  if (corroborated) return { status: "completed", corroborated: true, demotedReason: null };
  return {
    status: "intended",
    corroborated: false,
    demotedReason: prospective
      ? `claimed completed, but its own sourceLine states an intention (${JSON.stringify(prospective[0])})`
      : "claimed completed, but its own sourceLine states no completed payment — no past-tense repayment, redemption or use of proceeds in it",
  };
}
