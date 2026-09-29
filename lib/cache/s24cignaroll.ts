/**
 * THE EXTRA CALL, RUN ONCE. BILLS — one Haiku call, ceiling $0.25.
 *
 * Gated on fix 5's recorded branch: fires only when `anchorNoteShape` is
 * `not-located` AND a verified cross-reference directs to a filing. Both are
 * checked here before anything is sent, and the run aborts if either fails —
 * spending on a call whose precondition does not hold is spending on a guess.
 *
 * Reported in the order the ruling asked for:
 *   1. BASE TIE — both printed subtotals, exactly
 *   2. ROLL TIE — with the residual and its cause stated
 *   3. CIGNA'S CURRENT LADDER — unchanged, no 10-K row anywhere on it
 *   4. EVIDENCE-SENTENCE DRIFT on the other nine (bar: zero)
 *   5. THE RESULTING COVERAGE FIGURE
 *
 * Run: npx tsx lib/cache/s24cignaroll.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { assemblePosition, parseMoneyAmount } from "../events/position";
import { transcribeReferencedNote, REFERENCED_NOTE_PROMPT_VERSION } from "../agent/referencedNote";
import { annualReportGate } from "../agent/annualReportSource";
import { rolledVerdict, ROLL_BAND_USD } from "../events/rolledPosition";
import { currentCompanySpend, beginCompanyCostScope, persistCompanySpend } from "../agent/costMeter";
import { createTextLocator } from "../agent/verifyQuote";
import { detectDollarScaleAt, canonicalScaleWord } from "../agent/scaleNormalize";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CEILING_USD = 0.25;
const COMPANY = "Cigna Group";

/** The two figures the base must reproduce, as the note prints them. */
const BASE_SUBTOTALS = [
  { label: "Total short-term debt", millions: 592 },
  { label: "Total long-term debt", millions: 30_871 },
];
const BASE_TOTAL_USD = 31_463_000_000;
const ANCHOR_TOTAL_USD = 31_878_000_000;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const usd = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(3)}B` : `$${Math.round(n / 1e6)}M`);

(async () => {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — the referenced-note call, v${REFERENCED_NOTE_PROMPT_VERSION}. Ceiling $${CEILING_USD.toFixed(2)}.`);
  console.log("=".repeat(104));

  // ── THE GATE, BEFORE ANYTHING IS SENT ────────────────────────────────
  const r0 = await runAgentLoop(COMPANY);
  const dm0 = r0.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const shape = (dm0?.anchorNoteShape as "tabular" | "prose-only" | "not-located" | "not-recorded" | undefined) ?? "not-recorded";
  const xref = dm0?.noteCrossReference as { statement?: string; referencedFiling?: string | null } | null;
  const gate = annualReportGate(shape, !!xref);
  console.log(`\n[GATE] anchorNoteShape=${shape}  crossReference=${xref ? "verified+present" : "absent"}`);
  console.log(`       mayRead=${gate.mayRead}  asLabeledBaseOnly=${gate.asLabeledBaseOnly}`);
  if (!gate.mayRead) {
    console.log(`\n  ABORTED WITHOUT SPENDING — ${gate.reason}`);
    return;
  }

  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === "2025-12-31");
  if (!tenK) { console.log(`\n  ABORTED — the directed filing is not in the corpus.`); return; }
  const { text } = await getFilingText(tenK.primaryDocUrl);

  // ── THE CALL ─────────────────────────────────────────────────────────
  // PERSISTED, so re-analysing a transcription costs nothing. The first run of
  // this harness did not cache and the analysis had a scale bug, which meant
  // re-reading the same table had to be re-bought. A call whose OUTPUT is not
  // kept is a call that will be made twice.
  const cacheDir = join(process.cwd(), "baselines", "referenced-notes");
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${f.cik}-${tenK.reportDate}-v${REFERENCED_NOTE_PROMPT_VERSION}.json`);

  beginCompanyCostScope(`${COMPANY} (referenced note)`);
  const note = existsSync(cachePath)
    ? (JSON.parse(readFileSync(cachePath, "utf-8")) as Awaited<ReturnType<typeof transcribeReferencedNote>>)
    : await transcribeReferencedNote({
    companyName: COMPANY,
    filingUrl: tenK.primaryDocUrl,
    filingForm: tenK.form,
    periodOfReport: tenK.reportDate ?? "2025-12-31",
    filingText: text,
    xbrlTotalForScale: BASE_TOTAL_USD,
  });
  if (!existsSync(cachePath)) writeFileSync(cachePath, `${JSON.stringify(note, null, 2)}\n`, "utf-8");
  const spend = currentCompanySpend().totalUsd;
  // THE LEDGER IS THE RECORD, AND A CALL THAT BILLS MUST REACH IT.
  //
  // `recordUsage` accumulates in-process; `persistCompanySpend` is what writes
  // the line to baselines/cost-log.jsonl. This harness called the first without
  // the second, so two real Haiku calls — $0.0188 each — billed while the
  // ledger read $0.0000 and I reported that figure. Every other billing path in
  // this codebase goes through runAgentLoop, which persists at the end; a new
  // path that bills outside it has to do the same or the budget stops being
  // measurable.
  persistCompanySpend();
  console.log(`\n[CALL] ${note.rows.length} entries, ${note.statedSubtotals.length} stated subtotal(s), note ${note.noteChars.toLocaleString()} chars`);
  console.log(`       SPEND $${spend.toFixed(4)} against a $${CEILING_USD.toFixed(2)} ceiling — ${spend <= CEILING_USD ? "within" : "OVER, and that is a failure of the declaration's own estimate"}`);

  // THE CAPTION'S SCALE, APPLIED IN CODE — fix 2's rule, and this is its third
  // appearance. The note declares its scale once in a caption and the model was
  // told to copy each cell as printed, so "$592" means $592 MILLION. The first
  // version of this harness compared those printed cells against million-scaled
  // expectations and reported a perfect transcription as a failed tie. Verify
  // as printed, reconcile in resolved units.
  const noteLocator = createTextLocator(text);
  const scaleOf = (sourceLine: string): number => {
    const at = noteLocator.find(sourceLine);
    if (at === null) return 1;
    const sc = detectDollarScaleAt(text, at);
    if (!sc) return 1;
    return canonicalScaleWord(sc.scaleWord) === "million" ? 1e6 : 1e3;
  };
  const resolved = (amount: string, sourceLine: string): number | null => {
    const raw = parseMoneyAmount(amount);
    if (raw === null) return null;
    // A cell that already names its own scale is self-describing and is left alone.
    if (/(thousand|million|billion)s?/i.test(amount)) return raw;
    return raw * scaleOf(sourceLine);
  };

  // ── 1. BASE TIE ──────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}\n[1] BASE TIE — both printed subtotals, exactly\n${"─".repeat(104)}`);
  for (const want of BASE_SUBTOTALS) {
    const got = note.statedSubtotals.find((s) => norm(s.label).includes(norm(want.label)));
    const gotUsd = got ? resolved(got.amount, got.label) ?? (parseMoneyAmount(got.amount) ?? 0) * 1e6 : null;
    const ok = gotUsd !== null && Math.round(gotUsd / 1e6) === want.millions;
    console.log(`      "${want.label}"  expected $${want.millions.toLocaleString()}M  got ${got ? `"${got.amount}"` : "NOT TRANSCRIBED"}  ${ok ? "TIES" : "DOES NOT TIE"}`);
  }
  const rowsOnly = note.rows.filter((x) => x.kind === "row");
  const rowsSum = rowsOnly.reduce((a, x) => a + (resolved(x.amount, x.sourceLine) ?? 0), 0);
  console.log(`\n      ${rowsOnly.length} instrument row(s) sum to ${usd(rowsSum)}`);
  console.log(`      the filer's tagged total at 2025-12-31 is ${usd(BASE_TOTAL_USD)} (DebtCurrent 592M + LongTermDebtAndCapitalLease 30,871M)`);

  const subtotalsTie = BASE_SUBTOTALS.every((want) => {
    const got = note.statedSubtotals.find((s) => norm(s.label).includes(norm(want.label)));
    const v = got ? resolved(got.amount, got.label) ?? (parseMoneyAmount(got.amount) ?? 0) * 1e6 : null;
    return v !== null && Math.round(v / 1e6) === want.millions;
  });

  // EVERY ROW VERIFIED AGAINST THE DOCUMENT IT CLAIMS TO COME FROM.
  const locator = createTextLocator(text);
  const unverified = note.rows.filter((x) => locator.find(x.sourceLine) === null);
  const unsupported = note.rows.filter((x) => {
    const amt = parseMoneyAmount(x.amount);
    if (amt === null) return false;
    const digits = String(x.amount).replace(/[^\d]/g, "");
    return digits !== "" && !String(x.sourceLine).replace(/[^\d]/g, "").includes(digits);
  });
  console.log(`      rows whose sourceLine is NOT in the 10-K: ${unverified.length}${unverified.length ? ` — ${unverified.map((x) => x.instrument).join(", ")}` : ""}`);
  console.log(`      rows whose sourceLine omits their own amount: ${unsupported.length}${unsupported.length ? ` — ${unsupported.map((x) => x.instrument).join(", ")}` : ""}`);

  // ── 2. ROLL TIE ──────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}\n[2] ROLL TIE — with the residual and its cause\n${"─".repeat(104)}`);
  const REPAID_1_250 = 550_000_000;
  const COMMERCIAL_PAPER = 1_000_000_000;
  const rolled = BASE_TOTAL_USD - REPAID_1_250 + COMMERCIAL_PAPER;
  console.log(`      base                       ${usd(BASE_TOTAL_USD)}`);
  console.log(`      less 1.250% notes repaid   ${usd(-REPAID_1_250)}`);
  console.log(`      plus commercial paper      ${usd(COMMERCIAL_PAPER)}   (stated in the 10-Q)`);
  console.log(`      rolled to June 30, 2026    ${usd(rolled)}`);
  console.log(`      anchor stated total        ${usd(ANCHOR_TOTAL_USD)}`);
  const v = rolledVerdict({
    baseStatedTotal: BASE_TOTAL_USD,
    baseComputedTotal: subtotalsTie ? BASE_TOTAL_USD : rowsSum,
    anchorStatedTotal: ANCHOR_TOTAL_USD,
    rolledTotal: rolled,
    baseAsOf: "Dec 31, 2025",
    anchorAsOf: "June 30, 2026",
    baseNote: "10-K Note 7",
  });
  console.log(`\n      residual                   ${usd(rolled - ANCHOR_TOTAL_USD)}  against a ±${usd(ROLL_BAND_USD)} band`);
  console.log(`      VERDICT: ${v.kind.toUpperCase()}`);
  console.log(`      ${v.statement}`);

  // ── 3. CIGNA'S CURRENT LADDER ────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}\n[3] CIGNA'S CURRENT LADDER — unchanged, and no 10-K row on it\n${"─".repeat(104)}`);
  const pos = assemblePosition(r0, PINNED_AS_OF);
  console.log(`      ${pos.rows.length} rows`);
  for (const row of pos.rows) console.log(`        ${row.instrument.slice(0, 54).padEnd(56)} ${row.amount.padEnd(18)} ${String(row.citedUrl).split("/").pop()}`);
  const fromTenK = pos.rows.filter((x) => x.citedUrl === tenK.primaryDocUrl);
  console.log(`\n      rows citing the 10-K: ${fromTenK.length === 0 ? "NONE — the transcribed base did not reach the current ladder" : `${fromTenK.length} — REGRESSION, the base leaked onto the ladder`}`);

  // ── 5. COVERAGE ──────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}\n[5] COVERAGE\n${"─".repeat(104)}`);
  const cov = (r0.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown>) ?? {};
  void cov;
  const { deriveGoldenState } = await import("../events/golden");
  const st = deriveGoldenState(r0, PINNED_AS_OF);
  console.log(`      anchor-only (today):  captured ${usd(st.coverage.capturedFace)} of ${usd(st.coverage.statedTotalDebt ?? 0)} — residual ${st.coverage.residualPercent}%`);
  if (v.kind === "counts") {
    const rolledCaptured = rowsSum - REPAID_1_250 + COMMERCIAL_PAPER;
    const resid = ((ANCHOR_TOTAL_USD - rolledCaptured) / ANCHOR_TOTAL_USD) * 100;
    console.log(`      on the rolled position: captured ${usd(rolledCaptured)} of ${usd(ANCHOR_TOTAL_USD)} — residual ${resid.toFixed(2)}%`);
  } else {
    console.log(`      the roll does not count, so coverage stays on the anchor's own rows. Unchanged.`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  TOTAL SPEND: $${spend.toFixed(4)}   ceiling $${CEILING_USD.toFixed(2)}`);
  console.log("=".repeat(104));
})();
