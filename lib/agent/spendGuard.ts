/**
 * SESSION 27 (Akshay, Oct 23, 2026) — THE GATE IS PREVENTIVE.
 *
 * Every billed call goes through `guardedCreate`. Before the call it counts
 * the input tokens (the Messages API's own counter, which is free), prices
 * the WORST case from that count at the model's rate with output at the
 * call's max_tokens, and refuses the call if that worst case would cross the
 * per-run or the running limit. After the call it adds the actual cost.
 *
 * Why: Tenet's proceeds-use refill was approved to $0.064 and billed $0.0738.
 * The gate measured after each call, so it caught the overrun and could not
 * prevent it. Priced before the call, that call's worst case was $0.0762 and
 * it would have been refused.
 *
 * A count that cannot be taken is a refusal, never an unguarded call. With
 * no limits set (the ordinary app path) every call is still counted and
 * priced, and none is refused. Price-only mode counts and records without
 * calling, for declarations.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { priceOf, usdFor } from "./costMeter";

export class SpendRefusedError extends Error {
  readonly worstUsd: number | null;
  constructor(message: string, worstUsd: number | null) {
    super(`SPEND REFUSED before the call: ${message}`);
    this.name = "SpendRefusedError";
    this.worstUsd = worstUsd;
  }
}
/**
 * SESSION 27 (Akshay, Oct 31, 2026): the per-build cap stays; DIGS DRAW ONLY ON WHAT IS LEFT UNDER IT after the
 * other stages' counted worst case. A dig that would not fit is refused before the call, and its trigger renders as
 * unresolved. A cap is never raised to fit a worst case.
 */
export class DigRefusedError extends Error {
  readonly worstUsd: number;
  constructor(message: string, worstUsd: number) {
    super(`DIG REFUSED before the call: ${message}`);
    this.name = "DigRefusedError";
    this.worstUsd = worstUsd;
  }
}
let digAllowance: number | null = null;
let digSpent = 0;
let currentKind: string | null = null;
/** What digs may spend: the build's cap less the other stages' counted worst case. Null: no dig allowance. */
export function setDigAllowance(usd: number | null): void { digAllowance = usd; digSpent = 0; }
export const digAllowanceLeft = (): number | null => (digAllowance === null ? null : digAllowance - digSpent);
/** Runs `fn` with every guarded call inside it counted as `kind` ("dig"). */
export async function asKind<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  const prev = currentKind; currentKind = kind;
  try { return await fn(); } finally { currentKind = prev; }
}
export class PricedOnlyError extends Error {
  readonly worstUsd: number;
  constructor(worstUsd: number) {
    super(`PRICED ONLY: this call would cost at most $${worstUsd.toFixed(6)}; price-only mode makes no call`);
    this.name = "PricedOnlyError";
    this.worstUsd = worstUsd;
  }
}

export interface PricedCall { model: string; inputTokens: number; maxTokens: number; worstUsd: number; label: string }
let limits: { perRunUsd: number | null; totalUsd: number | null } = { perRunUsd: null, totalUsd: null };
let runLabel = "(no run)", runSpent = 0, totalSpent = 0, priceOnly = false;
let last: PricedCall | null = null;
const priced: PricedCall[] = [];

export function setSpendLimits(l: { perRunUsd?: number | null; totalUsd?: number | null }): void {
  limits = { perRunUsd: l.perRunUsd ?? null, totalUsd: l.totalUsd ?? null };
}
/** A new run (one company's build): the per-run spend restarts; the running total does not. */
export function beginGuardRun(label: string): void { runLabel = label; runSpent = 0; }
export function setPriceOnly(on: boolean): void { priceOnly = on; }
export function resetSpendGuard(): void { digAllowance = null; digSpent = 0; currentKind = null; limits = { perRunUsd: null, totalUsd: null }; runLabel = "(no run)"; runSpent = 0; totalSpent = 0; priceOnly = false; last = null; priced.length = 0; }
export const lastPriced = (): PricedCall | null => last;
export const pricedCalls = (): PricedCall[] => [...priced];
export const spentTotal = (): number => totalSpent;
export const spentThisRun = (): number => runSpent;

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
export async function guardedCreate(client: Anthropic, params: CreateParams, options?: Parameters<Anthropic["messages"]["create"]>[1]): Promise<Anthropic.Message> {
  const price = priceOf(params.model);
  if (!price) throw new SpendRefusedError(`model ${params.model} has no price, so its worst case cannot be known`, null);
  let inputTokens: number;
  try {
    const { model, messages, system, tools, tool_choice, thinking } = params as any;
    const counted = await client.messages.countTokens({ model, messages, ...(system !== undefined ? { system } : {}), ...(tools ? { tools } : {}), ...(tool_choice ? { tool_choice } : {}), ...(thinking ? { thinking } : {}) } as any);
    inputTokens = counted.input_tokens;
  } catch (e) {
    throw new SpendRefusedError(`the input could not be counted (${e instanceof Error ? e.message : String(e)}), so the call is not made`, null);
  }
  const worstUsd = (inputTokens * price.input + params.max_tokens * price.output) / 1_000_000;
  last = { model: params.model, inputTokens, maxTokens: params.max_tokens, worstUsd, label: runLabel };
  if (priceOnly) { priced.push(last); throw new PricedOnlyError(worstUsd); }
  if (limits.perRunUsd !== null && runSpent + worstUsd > limits.perRunUsd + 1e-12) {
    throw new SpendRefusedError(`${runLabel}: $${runSpent.toFixed(4)} spent this run + this call's worst case $${worstUsd.toFixed(4)} (${inputTokens} in, ${params.max_tokens} max out, ${params.model}) would cross the per-run limit $${limits.perRunUsd.toFixed(4)}`, worstUsd);
  }
  if (currentKind === "dig" && digAllowance !== null && digSpent + worstUsd > digAllowance + 1e-12) {
    throw new DigRefusedError(`${runLabel}: digs have spent $${digSpent.toFixed(4)} of the $${digAllowance.toFixed(4)} left under the cap after the other stages' counted worst case; this dig's worst case is $${worstUsd.toFixed(4)}`, worstUsd);
  }
  if (limits.totalUsd !== null && totalSpent + worstUsd > limits.totalUsd + 1e-12) {
    throw new SpendRefusedError(`$${totalSpent.toFixed(4)} spent so far + this call's worst case $${worstUsd.toFixed(4)} (${inputTokens} in, ${params.max_tokens} max out, ${params.model}) would cross the running limit $${limits.totalUsd.toFixed(4)}`, worstUsd);
  }
  const response = (await client.messages.create(params, options)) as Anthropic.Message;
  const actual = usdFor(params.model, response.usage);
  runSpent += actual;
  totalSpent += actual;
  if (currentKind === "dig") digSpent += actual;
  return response;
}
