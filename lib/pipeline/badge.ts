/**
 * SESSION 27, STAGE 2 — THE TRUST BADGE (pipeline_design §3). Rules in order; the first that applies decides.
 * A failing card is never Signed, whatever golden it has.
 */
export type Badge = "could-not-build" | "signed" | "checks-failed" | "checks-passed";
export const BADGE_LABEL: Record<Badge, string> = { "could-not-build": "Could not build", signed: "Signed", "checks-failed": "Checks failed", "checks-passed": "Checks passed" };

export function decideBadge(i: {
  stoppedAt: { stage: string; reason: string } | null;
  goldenReproduces: boolean;
  cardChecksFailed: boolean;
  failures: string[];
  samplesReproducing: number;
  samples: number;
}): { badge: Badge; reasons: string[] } {
  if (i.stoppedAt) return { badge: "could-not-build", reasons: [`${i.stoppedAt.reason} (stopped at: ${i.stoppedAt.stage})`] };
  const fails = [...i.failures];
  if (i.cardChecksFailed && !fails.length) fails.push("the card's own checks failed (see its breakage panel)");
  if (i.samplesReproducing < i.samples) fails.push(`stability: ${i.samplesReproducing} of ${i.samples} samples reproduce`);
  if (fails.length) return { badge: "checks-failed", reasons: fails };
  if (i.goldenReproduces) return { badge: "signed", reasons: ["a person reviewed this card's answer, and today's answer still matches it"] };
  return { badge: "checks-passed", reasons: [`every automated check holds, including ${i.samplesReproducing} of ${i.samples} stability; no person has signed it`] };
}
