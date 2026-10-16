/**
 * WHAT CAN RUN WHEN A MODULE LOADS — the static check behind card_spec §5.1.
 *
 * Walks runtime imports only: `import type` / `export type` are erased at
 * compile time and reach nothing. Each finding names the chain that reached
 * the forbidden module, so a cut can be made at the right link.
 *
 * Forbidden for the card page and the card generator: the extraction loop and
 * model clients, the Anthropic SDK, the blob store and every network module.
 * Code reachable from a page is one change away from running on render.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const FORBIDDEN_MODULES = [
  /lib[\\/]agent[\\/](?:loop|claude|proceedsUse|referencedNote|tools|index)\.ts$/,
  /lib[\\/]cache[\\/](?:answerCache|wordingCache)\.ts$/,
  /lib[\\/]fetch[\\/][^\\/]+\.ts$/,
];
export const FORBIDDEN_PACKAGES = /^(?:@anthropic-ai\/sdk|@vercel\/blob)$/;

export function readDisk(p: string): string | null {
  if (!existsSync(p)) return null;
  if (p.endsWith(".json")) return "";
  try { return readFileSync(p, "utf-8"); } catch { return null; }
}

export function reachable(entry: string, root: string, read: (p: string) => string | null = readDisk): string[] {
  const seen = new Set<string>(), bad: string[] = [];
  const short = (p: string) => p.replace(root, "").replace(/\\/g, "/");
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (FORBIDDEN_MODULES.some((r) => r.test(file))) bad.push([...chain, file].map(short).join(" → "));
    const src = read(file);
    if (src === null) return;
    for (const m of src.matchAll(/^\s*(import|export)(\s+type\b)?[^'";]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/gm)) {
      if (m[2]) continue; // type-only: erased
      const spec = m[3] ?? m[4] ?? m[5];
      if (FORBIDDEN_PACKAGES.test(spec)) { bad.push([...chain, file].map(short).join(" → ") + ` → ${spec}`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(file), spec);
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (read(cand) !== null) { walk(cand, [...chain, file]); break; }
    }
  };
  walk(entry, []);
  return bad;
}
