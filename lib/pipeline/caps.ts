/**
 * SESSION 27, STAGE 2 — CAPS, THE DEMO ALLOWANCE AND THE APPROVAL SCREEN (pipeline_design §6; Akshay, Oct 29, Nov 9).
 *
 * Decided before any call, from the build's declared worst case (pre-call counts) and the day's recorded spend:
 *   - a cached build is free (proven by assertFree first) and never asks;
 *   - $2.00 worst case per card, $10 a day per user, $25 a day across everyone, each refusing before any call;
 *   - the demo allowance (DEMO_ALLOWANCE_USD, Akshay funds it; never above the per-user cap): within what remains of
 *     it, a demo user's build runs with no approval screen; above it, the approval screen with the declared price;
 *   - a paying user sees the approval screen for every billed build.
 * Every price is rounded up to the cent.
 */
export const CAPS = { perBuildUsd: 2.0, perUserDayUsd: 10, globalDayUsd: 25 } as const;
const DEFAULT_ALLOWANCE_USD = 2.0;
export const ceilCent = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

/** The per-user daily allowance from the environment, held inside the per-user cap. */
export function allowanceUsd(env: string | undefined = process.env.DEMO_ALLOWANCE_USD): number {
  const n = Number(env);
  return Math.min(Number.isFinite(n) && env !== undefined && env !== "" ? n : DEFAULT_ALLOWANCE_USD, CAPS.perUserDayUsd);
}

export type SpendDecision =
  | { kind: "free" }
  | { kind: "run"; declaredUsd: number; allowanceLeftUsd: number }
  | { kind: "needs-approval"; declaredUsd: number; why: string }
  | { kind: "refused"; declaredUsd: number; reason: string };

export function decide(i: { cached: boolean; worstUsd: number; userSpentToday: number; globalSpentToday: number; allowanceUsd: number; paying: boolean }): SpendDecision {
  if (i.cached) return { kind: "free" };
  const declared = ceilCent(i.worstUsd);
  const usd = (x: number) => `$${x.toFixed(2)}`;
  if (declared > CAPS.perBuildUsd) return { kind: "refused", declaredUsd: declared, reason: `cost cap reached: this card's worst case is ${usd(declared)}, over the ${usd(CAPS.perBuildUsd)} per-card cap` };
  if (i.userSpentToday + declared > CAPS.perUserDayUsd) return { kind: "refused", declaredUsd: declared, reason: `cost cap reached: ${usd(declared)} would take today's spend past the ${usd(CAPS.perUserDayUsd)} per-user cap` };
  if (i.globalSpentToday + declared > CAPS.globalDayUsd) return { kind: "refused", declaredUsd: declared, reason: `cost cap reached: ${usd(declared)} would take today's spend across everyone past ${usd(CAPS.globalDayUsd)}` };
  if (i.paying) return { kind: "needs-approval", declaredUsd: declared, why: "every billed build is approved first" };
  const left = Math.min(i.allowanceUsd, CAPS.perUserDayUsd) - i.userSpentToday;
  if (declared <= left + 1e-9) return { kind: "run", declaredUsd: declared, allowanceLeftUsd: ceilCent(left - declared) };
  return { kind: "needs-approval", declaredUsd: declared, why: `${usd(declared)} is more than the ${usd(Math.max(0, left))} left of today's allowance` };
}

/**
 * Nov 16: MAY THIS BUILD BILL? Only when billing is switched on, the reader confirmed, the caps did not refuse it, and
 * its declared price is within the approval (the allowance's own figure when it runs within the allowance). Its ceiling
 * is that declared price: the spend guard refuses any call whose counted worst case would cross it.
 */
export function billingGate(i: { billingOn: boolean; confirm: boolean; decision: SpendDecision; declaredUsd: number; approvedUsd?: number }): { bill: true; ceilingUsd: number } | { bill: false; why: string } {
  if (!i.billingOn || !i.confirm) return { bill: false, why: "priced only" };
  if (i.decision.kind === "refused") return { bill: false, why: i.decision.reason };
  const approved = i.approvedUsd ?? (i.decision.kind === "run" ? i.declaredUsd : 0);
  if (i.declaredUsd > approved + 1e-9) return { bill: false, why: `this build's worst case $${i.declaredUsd.toFixed(2)} is over the $${approved.toFixed(2)} approved; nothing was charged` };
  return { bill: true, ceilingUsd: i.declaredUsd };
}
