/**
 * GENERATE THE SIX DEMO CARDS — from cache, at $0 BY CONSTRUCTION.
 *
 *   1. Refuses unless ANTHROPIC_API_KEY is empty: an uncached call then throws
 *      instead of billing. dotenv never overrides a variable already set.
 *   2. assertFree over every signed name (Rule 75).
 *   3. Each name re-derived from cache through the current loop, and checked
 *      against its signed golden. A name that does not reproduce gets no card.
 *   4. This week's filings read as live EDGAR metadata, without touching the
 *      corpus cache (lib/fetch/thisWeek.ts).
 *   5. Cash from the filer's XBRL tag, shown beside its printed line.
 *
 * Writes lib/cards/generated/<cik>.json, which the page imports. Viewing a
 * card reads that file and nothing else.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/generate.ts [briefDate]
 */
import { loadEnvQuietly } from "../cache/loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, type GoldenFile } from "../events/golden";
import { assertFree, spendTracker } from "../cache/freeRun";
import { EXTRACTION_PROMPT_VERSION } from "../cache/promptVersion";
import { PINNED_AS_OF } from "../cache/pinnedAsOf";
import { getFilingText } from "../fetch/filingText";
import { liveFilingsBetween } from "../fetch/thisWeek";
import { fetchXbrlCash } from "../fetch/xbrlDebt";
import { buildCard } from "./build";
import { assemblePosition, parseMoneyAmount } from "../events/position";
import { locatorFor, scaledAmountString } from "../agent/tableScale";
import { previousBrief, readBriefLog, recordBrief } from "./briefLog";
import { addDays } from "./format";

/** card_spec 1: the six, in the spec's order. */
const ORDER = ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"];
const BRIEF_DATE = process.argv[2] ?? "2026-10-04";
const OUT = join(process.cwd(), "lib", "cards", "generated");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The anchor's cover line stating its period end — the sentence every "as of" date links to. */
function periodSentenceIn(text: string, iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number);
  // The cover line's own phrase, from a word boundary: "For the quarterly
  // period ended June 30, 2026". A fixed-width slice once began mid-word and
  // matched nothing in the filing.
  const re = new RegExp(`(?:For the\\s+)?(?:quarterly period|fiscal year|period) ended\\s+${MONTHS[m - 1]}\\s+${d}\\s*,\\s*${y}`, "i");
  const hit = re.exec(text.replace(/\s+/g, " "));
  return hit ? hit[0].trim() : null;
}

/**
 * The balance-sheet line printing the tagged cash figure. The cell's scale is
 * decided by the caption, through the ONE function that decides a cell's
 * scale (Rule 67); the tag only confirms the line is the right one.
 */
function printedCash(text: string, usd: number): { line: string; printed: string } | null {
  const flat = text.replace(/\s+/g, " ");
  const locator = locatorFor(text);
  const re = /Cash and cash equivalents\s*\$?\s*([\d,]+(?:\.\d+)?)(\s*\$?\s*[\d,]+(?:\.\d+)?)?/g;
  for (const m of flat.matchAll(re)) {
    const line = m[0].trim();
    const printed = scaledAmountString(`$ ${m[1]}`, line, text, locator);
    if (Math.abs((parseMoneyAmount(printed) ?? -1) - usd) < 1) return { line, printed };
  }
  return null;
}

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") {
    console.error('REFUSING: run with ANTHROPIC_API_KEY="" — card generation must be unable to bill, not merely expected not to.');
    process.exit(1);
  }
  const goldens = readdirSync(join(process.cwd(), "baselines", "golden"))
    .map((f) => JSON.parse(readFileSync(join(process.cwd(), "baselines", "golden", f), "utf-8")) as GoldenFile)
    .filter((g) => g.extractionVersion === EXTRACTION_PROMPT_VERSION)
    .sort((a, b) => ORDER.indexOf(a.state.cik) - ORDER.indexOf(b.state.cik));
  await assertFree(goldens.map((g) => ({ company: g.state.company })));
  mkdirSync(OUT, { recursive: true });
  const spend = spendTracker();
  const log = readBriefLog();
  const written: string[] = [];

  for (const g of goldens) {
    delete process.env.CACHE_BUST;
    const result = await runAgentLoop(g.state.company);
    spend.record(g.state.company);
    const verdict = compareToGolden(g.state, deriveGoldenState(result, PINNED_AS_OF));
    if (verdict.kind !== "matches") {
      console.error(`  ${g.state.company}: NO CARD — the position does not reproduce its signature (${verdict.kind})`);
      continue;
    }
    const anchor = g.state.anchor!;
    const prev = previousBrief(log, g.state.cik, BRIEF_DATE);
    const weekFrom = prev ? addDays(prev, 1) : addDays(BRIEF_DATE, -6);
    const weekFilings = await liveFilingsBetween(g.state.cik, weekFrom, BRIEF_DATE);
    const anchorText = (await getFilingText(anchor.url)).text;
    const xc = await fetchXbrlCash(g.state.cik, anchor.reportDate!);
    const pc = xc.value !== null ? printedCash(anchorText, xc.value) : null;
    // Every document a ladder row cites, preloaded: the builder is pure.
    const textByUrl = new Map<string, string>([[anchor.url, anchorText]]);
    const dm = result.results.find((r) => r.triggerId === "debt-maturity") as { facilities?: { citedUrl: string; figureSources?: Record<string, string> }[] } | undefined;
    // Every document the result cites anywhere, so each linked sentence can be
    // cited to the document it is actually found in (Rule 44).
    const urls = [
      ...assemblePosition(result, new Date(`${BRIEF_DATE}T00:00:00Z`)).rows.map((r) => r.citedUrl),
      ...(dm?.facilities ?? []).flatMap((f) => [f.citedUrl, ...Object.values(f.figureSources ?? {})]),
      ...result.results.flatMap((r) => ((r as { citations?: { url: string }[] }).citations ?? []).map((c) => c.url)),
      (dm as { priorPeriodBase?: { filingUrl?: string } } | undefined)?.priorPeriodBase?.filingUrl ?? "",
    ];
    for (const u of urls) if (u && !textByUrl.has(u)) textByUrl.set(u, (await getFilingText(u)).text);
    const card = buildCard({
      result,
      briefDate: BRIEF_DATE,
      previousBrief: prev,
      weekFilings,
      cash: {
        usd: xc.value,
        printed: pc?.printed ?? null,
        printedLine: pc?.line ?? null,
        reason: xc.value === null ? xc.unavailableReason : pc ? null : "the tagged figure appears on no printed balance-sheet line",
      },
      textByUrl,
      periodSentence: periodSentenceIn(anchorText, anchor.reportDate!),
    });
    writeFileSync(join(OUT, `${g.state.cik}.json`), JSON.stringify(card, null, 1) + "\n", "utf-8");
    recordBrief({ cik: g.state.cik, company: g.state.company, briefDate: BRIEF_DATE });
    written.push(g.state.cik);
    console.log(`  ${g.state.company}: card written (${weekFilings.length} filing(s) this week, cash ${xc.value ?? "—"})`);
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ briefDate: BRIEF_DATE, ciks: written }, null, 1) + "\n", "utf-8");
  // The page imports this one file; viewing a card reads nothing else.
  const all = written.map((c) => JSON.parse(readFileSync(join(OUT, `${c}.json`), "utf-8")));
  writeFileSync(join(OUT, "all.json"), JSON.stringify(all) + "\n", "utf-8");
  console.log(`\n${written.length} cards. ${spend.line()}`);
})();
