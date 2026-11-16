/**
 * SESSION 27, STAGE 2 — CHS REFRESH THROUGH THE PIPELINE (Akshay, Nov 16, 2026: approved up to $1.85 on pre-call counts,
 * under the $2 demo allowance, with BUILD_BILLING=on for this one run only).
 *
 * CHS's 8-K of Nov 10 (Items 8.01, 9.01) is a refresh trigger: its read set moved, so its card is built afresh. This runs
 * the product's own build (buildFor) for CHS, confirmed at the approved figure: three samples, the extra reads each
 * needs, and the card-facts stage over the read set, all under one spend guard whose ceiling is the declared price.
 * It then writes, to sessions/27/chs_refresh/:
 *   - spend.json / spend.md: every call made, its worst case counted before it and its actual cost, against the
 *     declared price per call
 *   - card.json and diff.md: the card, and its visible differences from production's CHS card
 *   - input.json, facts.json: the card input and the facts the card was built with
 * and registers the facts' answer keys as unadopted (baselines/unadopted.json) until Akshay clears them. Nothing here
 * writes lib/cards/inputs or lib/cards/generated, and nothing is released.
 *
 *   --price   price only ($0, token counts): CACHE_NO_WRITE=1 npx tsx lib/cache/s27chsRefresh.ts --price
 *   bill:     BUILD_BILLING=on npx tsx lib/cache/s27chsRefresh.ts --approved=1.85
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildFor, type BuildEvent, type BuildOutcome } from "../pipeline/buildFor";
import { resolveCompany } from "../pipeline/resolve";
import { visibleDiff } from "./s27cardDiff";
import type { MadeCall } from "../agent/spendGuard";

const DIR = "sessions/27/chs_refresh";
const PRICE_ONLY = process.argv.includes("--price");
const APPROVED = Number((process.argv.find((a) => a.startsWith("--approved=")) ?? "").slice(11));
const usd = (x: number) => `$${x.toFixed(4)}`;

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("the token counter needs a key; no call is made"); process.exit(1); }
  if (PRICE_ONLY) {
    if (process.env.CACHE_NO_WRITE !== "1") { console.error("REFUSING: pricing never writes the shared cache; run with CACHE_NO_WRITE=1"); process.exit(1); }
    if (process.env.BUILD_BILLING === "on") { console.error("REFUSING: --price runs with billing off"); process.exit(1); }
  } else {
    if (!(APPROVED > 0)) { console.error("REFUSING: pass the approved ceiling (--approved=<usd>)"); process.exit(1); }
    if (process.env.BUILD_BILLING !== "on") { console.error("REFUSING: billing is off; set BUILD_BILLING=on for this one run"); process.exit(1); }
    if (process.env.CACHE_NO_WRITE === "1") { console.error("REFUSING: a billed run writes its answers (else a re-run re-bills); unset CACHE_NO_WRITE"); process.exit(1); }
  }
  const r = await resolveCompany("CYH");
  if (r.kind !== "one") throw new Error(`CYH did not resolve to one registrant (${r.kind})`);
  const emit = (e: BuildEvent) => { if (e.status !== "running") console.log(`  ${e.status.padEnd(7)} ${e.stage}: ${e.detail}`); };
  let input: any = null, facts: any = null;
  const out: BuildOutcome = await buildFor(r.match, { emit, confirm: !PRICE_ONLY, approvedUsd: PRICE_ONLY ? undefined : APPROVED, keep: (i, f) => { input = i; facts = f; } });
  mkdirSync(DIR, { recursive: true });

  if (out.kind === "priced") {
    console.log(`\nPRICED: worst case ${usd(out.price.worstUsd)}, declared $${out.price.declaredUsd.toFixed(2)}; decision ${out.decision.kind}. Nothing billed.`);
    for (const c of out.price.calls) console.log(`  ${c.stage} (${c.sample}): ${c.count} × ${usd(c.worstEachUsd)}${c.estimate ? " (estimate)" : ""}`);
    writeFileSync(`${DIR}/price.json`, JSON.stringify({ pricedAt: new Date().toISOString(), ...out }, null, 1) + "\n");
    return;
  }

  // Spend against the declared price, per call.
  const calls: MadeCall[] = out.calls ?? [];
  const stageOf = (k: string) => (k === "dig" ? "dig budget" : k);
  const groups = new Map<string, { calls: MadeCall[]; declaredEach: number | null; declaredCount: number }>();
  for (const c of calls) {
    const key = `${stageOf(c.kind)}|${c.kind === "card facts" ? "facts" : c.sample}`;
    if (!groups.has(key)) groups.set(key, { calls: [], declaredEach: null, declaredCount: 0 });
    groups.get(key)!.calls.push(c);
  }
  const price = out.kind === "card" ? out.price : null;
  for (const d of price?.calls ?? []) {
    const key = `${d.stage}|${d.sample}`;
    if (!groups.has(key)) groups.set(key, { calls: [], declaredEach: null, declaredCount: 0 });
    Object.assign(groups.get(key)!, { declaredEach: d.worstEachUsd, declaredCount: d.count });
  }
  const spent = calls.reduce((t, c) => t + c.actualUsd, 0);
  const lines = [`# CHS refresh — spend against the declared price, per call`, ``, `Approved up to $${APPROVED.toFixed(2)}; declared ${price ? `$${price.declaredUsd.toFixed(2)} (worst ${usd(price.worstUsd)})` : "(none: the build stopped before)"}; spent **${usd(spent)}** across ${calls.length} calls.`, ``, `| Stage (sample) | Declared | Calls made | Worst case counted before each | Actual |`, `|---|---|---|---|---|`];
  for (const [key, g] of groups) {
    const [stage, sample] = key.split("|");
    lines.push(`| ${stage} (${sample}) | ${g.declaredCount ? `${g.declaredCount} × ${usd(g.declaredEach!)}` : "—"} | ${g.calls.length} | ${g.calls.map((c) => usd(c.worstUsd)).join(", ") || "—"} | ${usd(g.calls.reduce((t, c) => t + c.actualUsd, 0))} |`);
  }
  writeFileSync(`${DIR}/spend.md`, lines.join("\n") + "\n");
  writeFileSync(`${DIR}/spend.json`, JSON.stringify({ ranAt: new Date().toISOString(), approvedUsd: APPROVED, declaredUsd: price?.declaredUsd ?? null, worstUsd: price?.worstUsd ?? null, spentUsd: Number(spent.toFixed(6)), calls, price }, null, 1) + "\n");
  // The ledger: each sample's loop writes its own line (costMeter); this run's total is in spend.json, not added again.

  if (out.kind !== "card") {
    console.log(`\nCOULD NOT BUILD at ${out.stage}: ${out.reason}\nSpent ${usd(spent)}. See ${DIR}/spend.md.`);
    process.exit(1);
  }
  writeFileSync(`${DIR}/card.json`, JSON.stringify(out.card, null, 1) + "\n");
  if (input) writeFileSync(`${DIR}/input.json`, JSON.stringify(input) + "\n");
  writeFileSync(`${DIR}/facts.json`, JSON.stringify(facts, null, 1) + "\n");
  const prod = JSON.parse(readFileSync(`lib/cards/generated/${r.match.cik.padStart(10, "0")}.json`, "utf-8"));
  writeFileSync(`${DIR}/diff.md`, [`# CHS: the refresh card against production's card`, ``, `Badge: **${out.badge}** — ${out.reasons.join("; ")}`, ``, ...visibleDiff(prod, out.card)].join("\n") + "\n");
  // The facts are not adopted until Akshay clears them.
  if (out.facts && out.facts.keys.length) {
    const reg = JSON.parse(readFileSync("baselines/unadopted.json", "utf-8"));
    const have = new Set(reg.keys.map((k: any) => k.key));
    for (const key of out.facts.keys) if (!have.has(key)) reg.keys.push({ key, why: "CHS refresh of Nov 16 (read set after the Nov 10 8-K): awaiting Akshay's review" });
    writeFileSync("baselines/unadopted.json", JSON.stringify(reg, null, 1) + "\n");
  }
  // A build that bills is recorded (builds.json): its read set's date (the Nov 10 trigger) and the rule it read under.
  const reg = JSON.parse(readFileSync("baselines/builds.json", "utf-8"));
  const list = (reg.builds[r.match.cik.padStart(10, "0")] ??= []);
  if (!list.some((b: any) => b.readSetAsOf === "2026-11-10")) list.push({ readSetAsOf: "2026-11-10", eightKRule: 2, what: "the Stage 2 refresh on the Nov 10 8-K, run Nov 16 (billed, not signed)" });
  writeFileSync("baselines/builds.json", JSON.stringify(reg, null, 1) + "\n");
  console.log(`\n${out.badge.toUpperCase()}: ${out.reasons.join("; ")}\nSpent ${usd(spent)} of $${APPROVED.toFixed(2)} approved (declared $${price!.declaredUsd.toFixed(2)}). Facts: ${out.facts?.source} (${out.facts?.keys.length ?? 0} keys registered unadopted). See ${DIR}/.`);
})().catch((e) => { console.error(e); process.exit(1); });
