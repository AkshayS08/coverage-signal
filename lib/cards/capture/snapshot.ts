/**
 * CARD INPUT SNAPSHOTS — the only thing a card is built from (Akshay, Oct 15).
 *
 * The card generator and page never reach the extraction loop, a model, the
 * blob store or the network. Everything a card needs is captured HERE, once,
 * into a committed per-name file, so a filing that lands later can only
 * change the This-week lines (captured separately, per brief).
 *
 * Each snapshot records its extraction version, corpus fingerprint and source
 * commit. Its `result` is asserted byte-identical to what goldenThroughLoop
 * reproduces for that name today; for a name whose corpus has moved (Cigna),
 * it IS the signed golden's stored result.
 *
 * $0 BY CONSTRUCTION: refuses unless ANTHROPIC_API_KEY is empty, and runs
 * assertFree for every name it re-derives.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/snapshot.ts
 */
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runAgentLoop } from "../../agent";
import { checkFree, assertFree } from "../../cache/freeRun";
import { EXTRACTION_PROMPT_VERSION } from "../../cache/promptVersion";
import { getFilingText } from "../../fetch/filingText";
import { liveFilingsBetween } from "../../fetch/thisWeek";
import { fetchXbrlCash } from "../../fetch/xbrlDebt";
import { locatorFor, scaledAmountString } from "../../agent/tableScale";
import { assemblePosition, parseMoneyAmount } from "../../events/position";

const ROOT = process.cwd();
const OUT = join(ROOT, "lib", "cards", "inputs");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BRIEF = process.argv[2] ?? "2026-10-15";

/** The anchor's cover line stating its period end — the phrase every "as of" date links to. */
export function periodSentenceIn(text: string, iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number);
  const re = new RegExp(`(?:For the\\s+)?(?:quarterly period|fiscal year|period) ended\\s+${MONTHS[m - 1]}\\s+${d}\\s*,\\s*${y}`, "i");
  const hit = re.exec(text.replace(/\s+/g, " "));
  return hit ? hit[0].trim() : null;
}

/** The balance-sheet line printing the tagged cash figure; the cell's scale from its caption (Rule 67). */
function printedCash(text: string, usd: number): { line: string; printed: string } | null {
  const flat = text.replace(/\s+/g, " ");
  const locator = locatorFor(text);
  for (const m of flat.matchAll(/Cash and cash equivalents\s*\$?\s*([\d,]+(?:\.\d+)?)(\s*\$?\s*[\d,]+(?:\.\d+)?)?/g)) {
    const line = m[0].trim();
    const printed = scaledAmountString(`$ ${m[1]}`, line, text, locator);
    if (Math.abs((parseMoneyAmount(printed) ?? -1) - usd) < 1) return { line, printed };
  }
  return null;
}

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY="" so nothing can bill'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  const goldens = readdirSync(join(ROOT, "baselines", "golden")).map((f) => JSON.parse(readFileSync(join(ROOT, "baselines", "golden", f), "utf-8"))).filter((g) => g.extractionVersion === EXTRACTION_PROMPT_VERSION);

  for (const g of goldens) {
    const name = g.state.company as string;
    const v = await checkFree(name);
    let result: any, source: string;
    if (v.cached) {
      await assertFree([{ company: name }]);
      delete process.env.CACHE_BUST;
      result = JSON.parse(JSON.stringify(await runAgentLoop(name)));
      source = "re-derived through the loop from the cached answer, $0";
    } else {
      result = g.sourceResult;
      source = `the signed golden's stored result — corpus moved to ${v.fingerprint.slice(0, 8)}, so the answer it was signed from is not re-derivable without re-extraction`;
    }
    const dm = result.results.find((r: any) => r.triggerId === "debt-maturity");
    const anchor = dm.debtScheduleSourceFiling;
    const later = (await liveFilingsBetween(result.cik, anchor.date, BRIEF)).filter((x) => x.primaryDocUrl !== anchor.url && ["8-K", "10-Q", "10-K"].includes(x.form));

    // Every document the card may link a sentence to.
    const urls = new Map<string, string>([[anchor.url, `${anchor.form} ${anchor.date}`]]);
    for (const x of later) urls.set(x.primaryDocUrl, `${x.form} ${x.filingDate}`);
    for (const r of result.results) for (const c of r.citations ?? []) if (c?.url && !urls.has(c.url)) urls.set(c.url, `${c.form} ${c.date}`);
    for (const r of assemblePosition(result, new Date(`${BRIEF}T00:00:00Z`)).rows) if (r.citedUrl && !urls.has(r.citedUrl)) urls.set(r.citedUrl, r.citedUrl.split("/").pop()!);
    for (const f of dm.facilities ?? []) for (const u of [f.citedUrl, ...Object.values(f.figureSources ?? {})] as string[]) if (u && !urls.has(u)) urls.set(u, u.split("/").pop()!);
    if (dm.priorPeriodBase?.filingUrl) urls.set(dm.priorPeriodBase.filingUrl, `10-K for ${dm.priorPeriodBase.periodOfReport}`);
    const docs: Record<string, { label: string; text: string }> = {};
    for (const [u, label] of urls) docs[u] = { label, text: (await getFilingText(u)).text };

    const xc = await fetchXbrlCash(result.cik, anchor.reportDate);
    const pc = xc.value !== null ? printedCash(docs[anchor.url].text, xc.value) : null;
    const snapshot = {
      cik: result.cik,
      company: result.company,
      extractionVersion: EXTRACTION_PROMPT_VERSION,
      corpusFingerprint: v.fingerprint,
      sourceCommit: commit,
      capturedOn: new Date().toISOString().slice(0, 10),
      source,
      cash: { usd: xc.value, printed: pc?.printed ?? null, printedLine: pc?.line ?? null, reason: xc.value === null ? xc.unavailableReason : pc ? null : "the tagged figure appears on no printed balance-sheet line" },
      periodSentence: periodSentenceIn(docs[anchor.url].text, anchor.reportDate),
      laterFilings: later.map((x) => ({ form: x.form, filingDate: x.filingDate, items: x.items, url: x.primaryDocUrl })),
      result,
      docs,
    };
    writeFileSync(join(OUT, `${result.cik}.json`), JSON.stringify(snapshot) + "\n", "utf-8");
    console.log(`${result.company}: ${source.split(" —")[0]}; ${Object.keys(docs).length} documents; cash ${xc.value ?? "—"}; ${later.length} later filing(s)`);
  }
})();
