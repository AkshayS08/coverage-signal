/**
 * SESSION 21, STAGE 6 — verification sheets for signature, and the golden
 * writer that runs only when one is given.
 *
 * Warm cache only; declares $0. Two modes:
 *
 *   npx tsx lib/cache/s21sheets.ts                       every unsigned company
 *   npx tsx lib/cache/s21sheets.ts --sheet "DaVita"      one company
 *   npx tsx lib/cache/s21sheets.ts --sign "Universal Health Services" --by "Akshay" --basis "..."
 *
 * NOTHING IS WRITTEN WITHOUT --sign. A golden file is a signature, not a
 * snapshot, and a writer that runs by default would turn "whatever the last
 * run produced" into "the pinned correct answer" without anyone looking.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";
import { getFilingText } from "../fetch";
import { buildEvents } from "../events/buildEvents";
import { assemblePosition } from "../events/position";
import { deriveGoldenState, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { renderVerificationSheet, derivedFor } from "./verificationSheet";
import { buildDerivedLines } from "../events/derived";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

/** UHS is signed (Session 20, hand-verified against the filing, reproduced x3 at v28). */
const SIGNED = ["Universal Health Services"];

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const ASOF = new Date("2026-09-04T00:00:00Z");

const PCT = new RegExp("\\d+\\s?%");
const COVERAGE_WORDS = new RegExp("cover|ratio|sufficient|enough to|times this", "i");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function stateFor(company: string) {
  const result = await runAgentLoop(company);
  // Every cited document, so a line sourced from an 8-K places in that 8-K.
  // All cached; no network cost.
  const corpus: { url: string; text: string; label: string }[] = [];
  const seen = new Map<string, string>();
  for (const t of result.results) for (const c of t.citations) if (c.url && !seen.has(c.url)) seen.set(c.url, `${c.form ?? "filing"} ${c.date ?? ""}`.trim());
  for (const [url, label] of seen) {
    try {
      const raw = await getFilingText(url);
      corpus.push({ url, label, text: typeof raw === "string" ? raw : (raw as { text: string }).text });
    } catch { /* a document we cannot fetch simply cannot place a line; NOT FOUND says so */ }
  }
  const cards = buildEvents([result], ASOF).flashCardCandidates;
  return { result, corpus, cards };
}

(async () => {
  const signTarget = arg("--sign");
  const sheetOnly = arg("--sheet");

  if (signTarget) {
    const { result } = await stateFor(signTarget);
    const state = deriveGoldenState(result, ASOF);
    const attestation = {
      rowsCorrect: arg("--rows-correct") !== "false",
      instrumentTypeFaithful: arg("--type-faithful") !== "false",
      reproducedThreeTimes: arg("--reproduced") === "true",
      by: arg("--by") ?? "(unnamed)",
      on: arg("--on") ?? ASOF.toISOString().slice(0, 10),
    };
    const crit = evaluateGoldenCriteria(result, ASOF, attestation);
    // WRITTEN ONLY WHEN ALL NINE HOLD. The definition is not advisory: a file
    // written with an unmet criterion is not a golden file under its own
    // terms, and a writer that shrugged would make the whole artifact
    // worthless.
    if (!crit.allHold) {
      console.error(`
REFUSED — ${result.company} does not satisfy all nine criteria; no golden file written.`);
      for (const x of crit.criteria.filter((y) => y.pass !== true)) console.error(`  [${x.id}] ${x.name}
      ${x.detail}`);
      process.exitCode = 1;
      return;
    }
    const file: GoldenFile = {
      signature: {
        signedBy: attestation.by,
        signedOn: attestation.on,
        basis: arg("--basis") ?? "(no basis stated)",
      },
      attestation,
      criteria: crit.criteria,
      state,
      sourceResult: result,
    };
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    const path = join(GOLDEN_DIR, `${result.cik}.json`);
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf-8");
    console.log(`\nGOLDEN FILE WRITTEN — ${result.company} (CIK ${result.cik})`);
    console.log(`  ${path}`);
    console.log(`  signed by ${file.signature.signedBy} on ${file.signature.signedOn}`);
    console.log(`  basis: ${file.signature.basis}`);
    console.log(`  pinned to ${state.filingSet.length} document(s); ${state.rows.length} ladder row(s)`);
    console.log(`  all nine criteria hold; cards and derived lines are NOT pinned`);
    return;
  }

  const book = sheetOnly ? [sheetOnly] : ALL.filter((c) => !SIGNED.includes(c));
  const liquidityOffenders: string[] = [];
  const summary: string[] = [];
  const sheets: string[] = [];

  for (const company of book) {
    const { result, corpus, cards } = await stateFor(company);
    const derived = derivedFor(result, cards, ASOF);
    // BUFFERED. runAgentLoop logs its trace to stdout as it goes, and a sheet
    // interleaved with the NEXT company's trace reads as though the warnings
    // belong to it — which on a sheet meant for signature is worse than no
    // warnings at all. Sheets print together, after every run has finished.
    sheets.push(...renderVerificationSheet({ result, corpus, cards, derivedByCard: derived, asOf: ASOF }));
    // The Stage 5 liquidity rule, checked on every company as the sheets are built.
    const pos = assemblePosition(result, ASOF);
    for (const card of cards) {
      const block = buildDerivedLines({ card, position: pos,
        debtMaturity: result.results.find((t) => t.triggerId === "debt-maturity"),
        newDebtIssuance: result.results.find((t) => t.triggerId === "new-debt-issuance"), asOf: ASOF });
      const liq = block.lines.find((l) => l.kind === "liquidity");
      if (liq && (PCT.test(liq.text) || COVERAGE_WORDS.test(liq.text) || liq.computed !== null)) {
        liquidityOffenders.push(`${result.company}: ${liq.text}`);
      }
    }
    const st = deriveGoldenState(result, ASOF);
    summary.push(`  ${result.company.padEnd(30)} rows ${String(st.rows.length).padStart(2)}  coverage ${st.coverage.statedTotalDebt ? Math.round(st.coverage.capturedFace / st.coverage.statedTotalDebt * 100) + "%" : "—"}  resid ${st.coverage.residualPercent ?? "—"}%  tier2 ${st.tier2.length}  cards ${st.cards.length}  filings ${st.filingSet.length}`);
  }

  console.log("");
  console.log("#".repeat(100));
  console.log("# VERIFICATION SHEETS — every run above is trace; everything below is the sheets.");
  console.log("#".repeat(100));
  for (const line of sheets) console.log(line);

  console.log("");
  console.log("=".repeat(100));
  console.log(`${book.length} SHEET(S) PRESENTED FOR SIGNATURE. No golden file has been written.`);
  console.log("=".repeat(100));
  for (const s of summary) console.log(s);
  console.log("");
  console.log(`LIQUIDITY RULE (Stage 5, revised): ${liquidityOffenders.length} card(s) stating a ratio or coverage phrasing.`);
  for (const o of liquidityOffenders) console.log(`  !! ${o}`);
})();
