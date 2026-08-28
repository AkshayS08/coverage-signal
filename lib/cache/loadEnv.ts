import dotenv from "dotenv";

/**
 * SESSION 19 — one place that loads .env.local, quietly.
 *
 * dotenv's banner carries a ROTATING marketing tip, so two otherwise
 * identical captures differ on line 1. That is the whole reason baselines
 * are serialized from in-memory objects now (bookSnapshot.ts) — but the tip
 * is worth killing at the source anyway, for every script.
 *
 * This lives in its own file, apart from bookSnapshot.ts, because
 * preflight.ts needs it and preflight's contract is that it "imports nothing
 * that can make a model call." Importing it from bookSnapshot.ts would pull
 * runAgentLoop and the Anthropic SDK in behind it and quietly void the one
 * property that makes preflight's answer trustworthy.
 */
export function loadEnvQuietly(): void {
  dotenv.config({ path: ".env.local", quiet: true });
}
