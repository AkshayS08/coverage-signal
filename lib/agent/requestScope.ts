/**
 * SESSION 27 (Akshay, Nov 16): STATE THAT BELONGS TO ONE REQUEST IS HELD PER REQUEST, NOT PER PROCESS.
 *
 * On a server several builds share one process. The spend guard's state (price-only, the priced calls, the limits and
 * what has been spent), the call kind, and the cache-bust tag that picks a sample were module or env globals, so one
 * request's switch reached another's calls. Each is now read from the request's scope (AsyncLocalStorage); outside any
 * scope — the command-line scripts — the process-wide value applies as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { GuardState } from "./spendGuard";

export interface RequestScope {
  /** This request's spend guard (spendGuard.withGuard / withPriceOnly). */
  guard?: GuardState;
  /** The kind of the guarded calls inside (asKind: "dig"). */
  kind?: string | null;
  /** The sample this request reads: a cache-bust tag, or null for the canonical answer. */
  cacheBust?: string | null;
}

const als = new AsyncLocalStorage<RequestScope>();
export const requestScope = (): RequestScope | undefined => als.getStore();

/** Runs `fn` with `over` layered on the enclosing scope. */
export function inRequestScope<T>(over: RequestScope, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() ?? {}), ...over }, fn);
}

/** The cache-bust tag in force: the request's, else the process's (the measurement scripts set CACHE_BUST). */
export function cacheBustNow(): string | undefined {
  const s = als.getStore();
  if (s && "cacheBust" in s) return s.cacheBust ?? undefined;
  return process.env.CACHE_BUST || undefined;
}
