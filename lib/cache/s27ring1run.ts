/**
 * SESSION 27, STAGE 2 — RING 1, RUN (Akshay approved up to $0.40, Nov 14, 2026; declared $0.17).
 *
 * The six signed names through the full pipeline as of the production brief (2026-11-09), served from each name's last
 * build (lastBuild.ts): three samples proven $0 (assertFree) and the canonical served from cache; the card input
 * captured; the card-facts stage (production's adopted facts where read from the same anchor, else the facts stage on
 * the run's own input, billed under the approval's remaining ceiling, pre-call); the card built twice (determinism:
 * byte-identical); then compared with production field by field (sessions/27/ring1/comparison.json).
 *
 * Run: npx tsx lib/cache/s27ring1run.ts --approved=0.40
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { runAgentLoop } from "../agent";
import { checkFree, assertFree } from "./freeRun";
import { captureCardInput } from "../cards/capture/snapshot";
import { factsForBuild } from "../cards/capture/factsForBuild";
import { buildCard } from "../cards/build";
import { RING1_BRIEF, RING1_NAMES, RING1_SAMPLES } from "./s27ring1Names";

const DIR = "sessions/27/ring1";
const APPROVED = Number((process.argv.find((a) => a.startsWith("--approved=")) ?? "").slice(11));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const quiet = async <T>(fn: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

/** The card's fields as a reader sees them, keyed for comparison. */
function fields(card: any): Record<string, string> {
  const v = card.v3, out: Record<string, string> = {};
  out["position"] = txt(v.header.position);
  out["header status"] = `${txt([v.header.filing])} · ${txt(v.header.status)}`;
  out["checks"] = v.checks ?? "(none)";
  if (v.breakage) out["breakage"] = `${v.breakage.gap.t} — ${txt(v.breakage.cause)}`;
  if (v.call) {
    out["call: headline"] = txt(v.call.headline);
    for (const tl of v.call.tiles) out[`call: tile ${tl.label}`] = `${txt([tl.value])} · ${txt(tl.sub)}`;
    if (v.call.nextTile) out["call: next maturity"] = `${v.call.nextTile.value ? txt([v.call.nextTile.value]) : ""} ${txt(v.call.nextTile.instrument)} ${v.call.nextTile.date ? txt([v.call.nextTile.date]) : ""}`.trim();
    v.call.rows.forEach((r: any) => { out[`call: row ${txt(r.when)} ${txt(r.body).replace(/^\S+\s/, "").slice(0, 40)}`] = `${txt(r.body)} | ${r.tag ? txt(r.tag.text) : ""}`; });
    v.call.notes.forEach((n: any, i: number) => { out[`call: note ${i + 1}`] = txt(n); });
  }
  if (v.totalDebt) { out["total debt"] = txt([v.totalDebt.figure]); for (const l of v.totalDebt.legend) out[`total debt: ${txt(l.label)}`] = txt([l.amount]); v.totalDebt.notes.forEach((n: any, i: number) => { out[`total debt: note ${i + 1}`] = txt(n); }); }
  out["liquidity"] = v.liquidity.figure ? txt([v.liquidity.figure]) : "—";
  for (const l of v.liquidity.legend) out[`liquidity: ${txt(l.label)}`] = txt([l.amount]);
  v.liquidity.notes.forEach((n: any, i: number) => { out[`liquidity: note ${i + 1}`] = txt(n); });
  if (v.table) for (const r of v.table.rows) out[`table: ${txt(r.matures)} ${txt(r.instrument)}`] = `${r.face ? txt([r.face]) : "—"} | ${r.status ? txt(r.status.text) : ""}`;
  v.moves.forEach((m: any) => { out[`move: ${txt(m.meta)}`] = `${m.title.map(txt).join(" / ")}${m.detail ? ` | ${txt(m.detail)}` : ""}${m.retires ? ` → ${txt(m.retires.meta)} :: ${m.retires.items.map(txt).join(" / ")}` : ""}`; });
  (v.possibleMoves ?? []).forEach((p: any, i: number) => { out[`possible move ${i + 1}`] = txt(p); });
  v.facilities.forEach((f: any, i: number) => { out[`facility ${i + 1}`] = `${txt(f.bold)}${f.sub ? ` | ${txt(f.sub)}` : ""}`; });
  v.notShown.forEach((n: any, i: number) => { out[`not shown ${i + 1}`] = txt(n); });
  out["footnote"] = txt(v.footnote);
  return out;
}

(async () => {
  if (!(APPROVED > 0)) { console.error("REFUSING: pass the approved ceiling (--approved=<usd>); a billed loop never runs without one"); process.exit(1); }
  if (process.env.CACHE_NO_WRITE === "1") { console.error("REFUSING: a billed run writes its answers (else a re-run re-bills); unset CACHE_NO_WRITE"); process.exit(1); }
  process.env.READ_SET_AS_OF = RING1_BRIEF;
  mkdirSync(`${DIR}/inputs`, { recursive: true }); mkdirSync(`${DIR}/facts`, { recursive: true }); mkdirSync(`${DIR}/cards`, { recursive: true });
  const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  const week = JSON.parse(readFileSync(`lib/cards/inputs/week/${RING1_BRIEF}.json`, "utf-8"));
  let spent = 0;
  const report: any[] = [];
  for (const company of RING1_NAMES) {
    for (const b of RING1_SAMPLES) { const v = await quiet(() => checkFree(company, b)); if (!v.cached) throw new Error(`${company} [${b ?? "canonical"}] is not cached: Ring 1 was priced at $0 for it; stopping`); }
    await assertFree(RING1_SAMPLES.map((b) => ({ company, bust: b ?? undefined })) as any);
    delete process.env.CACHE_BUST;
    const result = JSON.parse(JSON.stringify(await quiet(() => runAgentLoop(company))));
    const cik = result.cik as string;
    const fp = (await quiet(() => checkFree(company))).fingerprint;
    const input = await quiet(() => captureCardInput(result, { fingerprint: fp, commit, source: "RING 1: the full pipeline as of the production brief", briefDate: RING1_BRIEF }));
    const inPath = `${DIR}/inputs/${cik}.json`;
    writeFileSync(inPath, JSON.stringify(input) + "\n");
    // The card-facts stage.
    let facts: any = null, factsSource = "";
    const adopted = factsForBuild(input);
    if (adopted.source === "adopted") { facts = adopted.facts; factsSource = "production's adopted facts (same anchor), $0"; }
    else {
      const remaining = Math.floor((APPROVED - spent) * 10000) / 10000;
      if (!(remaining > 0)) throw new Error(`no approval remains for ${company}'s facts; stopping`);
      const out = execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", RING1_BRIEF, "--input", inPath, "--out", `${DIR}/facts`, "--bill", "--limit", remaining.toFixed(4)], { encoding: "utf-8", shell: true });
      const m = /SPEND: \$([\d.]+)/.exec(out);
      if (!m) throw new Error(`facts stage for ${company} reported no spend; stopping:\n${out.slice(-600)}`);
      spent += Number(m[1]);
      facts = JSON.parse(readFileSync(`${DIR}/facts/${cik}.json`, "utf-8"));
      factsSource = `the facts stage on the run's own input, billed $${Number(m[1]).toFixed(4)} (${(/\((\d+) calls\)/.exec(out) ?? ["", "?"])[1]} calls)`;
    }
    const w = week.names[cik];
    const make = () => buildCard({ result, briefDate: RING1_BRIEF, previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= RING1_BRIEF).map((x: any) => x.url), facts });
    const a = JSON.stringify(make(), null, 1), b2 = JSON.stringify(make(), null, 1);
    writeFileSync(`${DIR}/cards/${cik}.json`, a + "\n");
    const prod = JSON.parse(readFileSync(`lib/cards/generated/${cik}.json`, "utf-8"));
    const fa = fields(prod), fb = fields(JSON.parse(a));
    const diffs = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]).map((k) => ({ field: k, production: fa[k] ?? null, ring1: fb[k] ?? null }));
    const sameResult = JSON.stringify(result) === JSON.stringify(JSON.parse(readFileSync(`lib/cards/inputs/${cik}.json`, "utf-8")).result);
    report.push({ company, cik, readSet: fp, answerIsProductions: sameResult, factsSource, deterministic: a === b2, fieldsCompared: Object.keys(fa).length, differences: diffs });
    console.log(`${company.padEnd(30)} read set ${fp.slice(0, 8)}; answer = production's: ${sameResult}; facts: ${factsSource}; deterministic: ${a === b2}; ${diffs.length} field(s) differ of ${Object.keys(fa).length}`);
  }
  writeFileSync(`${DIR}/comparison.json`, JSON.stringify({ ranAt: new Date().toISOString(), asOf: RING1_BRIEF, commit, approvedUsd: APPROVED, spentUsd: Number(spent.toFixed(6)), names: report }, null, 1) + "\n");
  console.log(`\nRING 1 done: spent $${spent.toFixed(4)} of $${APPROVED.toFixed(2)} approved.`);
})().catch((e) => { console.error(e); process.exit(1); });
