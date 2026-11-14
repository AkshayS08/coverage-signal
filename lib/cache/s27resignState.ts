/**
 * SESSION 27 (Nov 14): RE-SIGN A GOLDEN OVER THE SAME ANSWER WHERE ONLY A RULE CHANGED ITS STATE. $0.
 *
 * The signed answer (sourceResult) is kept byte for byte. Its state is re-derived under the current rules with the
 * anchor's text; the script REFUSES unless every difference from the signed state is in the fields the clear names.
 * The basis records the clear and the previous basis. Dry run by default.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27resignState.ts <cik> [--write]
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync } from "node:fs";
import { deriveGoldenState, compareToGolden } from "../events/golden";
import { anchorTextOf } from "./anchorText";

const CLEARS: Record<string, { on: string; fields: RegExp; basis: string }> = {
  "0001739940": {
    on: "2026-11-14",
    fields: /^rolled\.(?:rollComputedMillions|rollResidualMillions|toleranceMillions)\b/,
    basis: "Cleared by Akshay Sahani on Nov 14, 2026, after he viewed the v16 render (sessions/26/screenshots_v16/Cigna-June.png): re-signed over the same answer, its state's roll recomputed under the rules of Nov 13 — exact cash-flow figures feed the carrying-value roll as cash proceeds, never face (commercial paper 975 against the stated ~$1,000MM); attribution only to a stated cause; the 0.2% materiality line (Akshay's ruling). Rolled 31,913 → 31,888; residual 35 → 10 (0.03%, disclosed on the card); band ±50 → 0.2% of rolled debt (63.8).",
  },
};

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const cik = process.argv.slice(2).find((a) => /^\d{10}$/.test(a));
  const clear = cik ? CLEARS[cik] : undefined;
  if (!cik || !clear) { console.error(`REFUSING: no clear recorded for ${cik ?? "(no cik)"}`); process.exit(1); }
  const path = `baselines/golden/${cik}.json`;
  const g = JSON.parse(readFileSync(path, "utf-8"));
  const fresh = deriveGoldenState(g.sourceResult, new Date(`${g.state.asOf}T00:00:00Z`), { anchorText: await anchorTextOf(g.sourceResult) });
  const verdict = compareToGolden(g.state, fresh);
  const diffs = verdict.kind === "diverged" ? verdict.divergences : [];
  const outside = diffs.filter((d: string) => !clear.fields.test(d));
  console.log(`${g.state.company}: ${diffs.length} difference(s) from the signed state`);
  for (const d of diffs) console.log(`  ${clear.fields.test(d) ? "named " : "OTHER "} ${d}`);
  if (!diffs.length) { console.log("Nothing to re-sign."); return; }
  if (outside.length) { console.error(`REFUSING: ${outside.length} difference(s) outside the fields the clear names`); process.exit(1); }
  if (!process.argv.includes("--write")) { console.log("Dry run. Re-run with --write to re-sign."); return; }
  const prev = g.signature;
  const out = { ...g, state: fresh, signature: { signedBy: "Akshay Sahani", signedOn: clear.on, basis: `${clear.basis} Previously signed ${prev.signedOn} on the basis: ${prev.basis}` } };
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(`Re-signed ${path} (sourceResult unchanged).`);
})().catch((e) => { console.error(e); process.exit(1); });
