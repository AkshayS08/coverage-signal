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
import { priceOf, usdFor, ledgerBilledCall } from "./costMeter";
import { requestScope, inRequestScope, cacheBustNow } from "./requestScope";

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

/**
 * Session 27 (Akshay, Nov 16): THE GUARD'S STATE IS PER REQUEST. One build's price-only switch, priced calls, limits and
 * spend live in its own GuardState (withGuard / withPriceOnly); outside any — the command-line scripts — the
 * process-wide state applies, as before.
 */
export interface GuardState {
  limits: { perRunUsd: number | null; totalUsd: number | null };
  runLabel: string; runSpent: number; totalSpent: number; priceOnly: boolean;
  last: PricedCall | null; priced: PricedCall[];
  digAllowance: number | null; digSpent: number;
  /** Every call made, with its worst case priced before it and its actual cost after: the per-call spend report. */
  made: MadeCall[];
}
export interface MadeCall { kind: string; sample: string; model: string; inputTokens: number; maxTokens: number; worstUsd: number; actualUsd: number }
const fresh = (): GuardState => ({ limits: { perRunUsd: null, totalUsd: null }, runLabel: "(no run)", runSpent: 0, totalSpent: 0, priceOnly: false, last: null, priced: [], digAllowance: null, digSpent: 0, made: [] });
const processState: GuardState = fresh();
const st = (): GuardState => requestScope()?.guard ?? processState;
const kindNow = (): string | null => requestScope()?.kind ?? null;

/** Runs `fn` under its own guard: its own limits and spend, untouched by any other request. */
export async function withGuard<T>(l: { perRunUsd?: number | null; totalUsd?: number | null }, fn: () => Promise<T>): Promise<{ result: T; spentUsd: number; priced: PricedCall[]; made: MadeCall[] }> {
  const g = fresh();
  g.limits = { perRunUsd: l.perRunUsd ?? null, totalUsd: l.totalUsd ?? null };
  // A build that fails part-way still reports what it spent: the error carries it.
  let result: T;
  try { result = await inRequestScope({ guard: g }, fn); }
  catch (e) { if (e && typeof e === "object") Object.assign(e, { spentUsd: g.totalSpent, made: [...g.made] }); throw e; }
  return { result, spentUsd: g.totalSpent, priced: [...g.priced], made: [...g.made] };
}
/** Runs `fn` in price-only mode for this request alone: every guarded call inside is counted and recorded, none made. */
export async function withPriceOnly<T>(fn: () => Promise<T>): Promise<{ result: T; priced: PricedCall[] }> {
  const g = fresh();
  g.priceOnly = true;
  const result = await inRequestScope({ guard: g }, fn);
  return { result, priced: [...g.priced] };
}

/** What digs may spend: the build's cap less the other stages' counted worst case. Null: no dig allowance. */
export function setDigAllowance(usd: number | null): void { const g = st(); g.digAllowance = usd; g.digSpent = 0; }
export const digAllowanceLeft = (): number | null => { const g = st(); return g.digAllowance === null ? null : g.digAllowance - g.digSpent; };
/** Runs `fn` with every guarded call inside it counted as `kind` ("dig"). */
export async function asKind<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  return inRequestScope({ kind }, fn);
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

export function setSpendLimits(l: { perRunUsd?: number | null; totalUsd?: number | null }): void {
  st().limits = { perRunUsd: l.perRunUsd ?? null, totalUsd: l.totalUsd ?? null };
}
/** A new run (one company's build): the per-run spend restarts; the running total does not. */
export function beginGuardRun(label: string): void { const g = st(); g.runLabel = label; g.runSpent = 0; }
/** The process-wide switch, for the command-line scripts. A request uses withPriceOnly. */
export function setPriceOnly(on: boolean): void { processState.priceOnly = on; }
export function resetSpendGuard(): void { Object.assign(processState, fresh()); }
export const lastPriced = (): PricedCall | null => st().last;
export const pricedCalls = (): PricedCall[] => [...st().priced];
export const spentTotal = (): number => st().totalSpent;
export const spentThisRun = (): number => st().runSpent;
export const madeCalls = (): MadeCall[] => [...st().made];

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
export async function guardedCreate(client: Anthropic, params: CreateParams, options?: Parameters<Anthropic["messages"]["create"]>[1]): Promise<Anthropic.Message> {
  const g = st();
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
  const kind = kindNow();
  g.last = { model: params.model, inputTokens, maxTokens: params.max_tokens, worstUsd, label: g.runLabel };
  if (g.priceOnly) { g.priced.push(g.last); throw new PricedOnlyError(worstUsd); }
  if (g.limits.perRunUsd !== null && g.runSpent + worstUsd > g.limits.perRunUsd + 1e-12) {
    throw new SpendRefusedError(`${g.runLabel}: $${g.runSpent.toFixed(4)} spent this run + this call's worst case $${worstUsd.toFixed(4)} (${inputTokens} in, ${params.max_tokens} max out, ${params.model}) would cross the per-run limit $${g.limits.perRunUsd.toFixed(4)}`, worstUsd);
  }
  if (kind === "dig" && g.digAllowance !== null && g.digSpent + worstUsd > g.digAllowance + 1e-12) {
    throw new DigRefusedError(`${g.runLabel}: digs have spent $${g.digSpent.toFixed(4)} of the $${g.digAllowance.toFixed(4)} left under the cap after the other stages' counted worst case; this dig's worst case is $${worstUsd.toFixed(4)}`, worstUsd);
  }
  if (g.limits.totalUsd !== null && g.totalSpent + worstUsd > g.limits.totalUsd + 1e-12) {
    throw new SpendRefusedError(`$${g.totalSpent.toFixed(4)} spent so far + this call's worst case $${worstUsd.toFixed(4)} (${inputTokens} in, ${params.max_tokens} max out, ${params.model}) would cross the running limit $${g.limits.totalUsd.toFixed(4)}`, worstUsd);
  }
  const response = (await client.messages.create(params, options)) as Anthropic.Message;
  const actual = usdFor(params.model, response.usage);
  g.runSpent += actual;
  g.totalSpent += actual;
  if (kind === "dig") g.digSpent += actual;
  g.made.push({ kind: kind ?? "base extraction", sample: cacheBustNow() ?? "canonical", model: params.model, inputTokens, maxTokens: params.max_tokens, worstUsd, actualUsd: actual });
  // Nov 16 (Akshay): every billed call writes the cost log, here, from the pipeline itself; a write that fails is an
  // error (the call has billed: its spend stays counted in the guard above).
  try { ledgerBilledCall({ kind: kind ?? "base extraction", sample: cacheBustNow() ?? "canonical", model: params.model, usage: response.usage as any, usd: actual }); }
  catch (e) { throw new LedgerWriteError(`a billed call ($${actual.toFixed(6)}, ${kind ?? "base extraction"}, ${params.model}) could not be written to the cost log: ${e instanceof Error ? e.message : String(e)}`); }
  return response;
}

/** Nov 16: a billed call whose ledger write failed. The call billed; the build stops. */
export class LedgerWriteError extends Error { name = "LedgerWriteError"; }
