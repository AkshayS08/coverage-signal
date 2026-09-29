/**
 * IS HCA'S AMOUNT CELL BESIDE ITS ROW LABEL? $0.
 *
 * s24evidence reported "no segment states this amount" for HCA's four rows.
 * That was MY SPLITTER TALKING. It segments on runs of four or more spaces —
 * which is precisely what separates a flattened table's label from its amount
 * cell — so it tore each row in half and then reported that neither half
 * contains the other. A diagnostic that answers a question about its own
 * tokenizer is the failure mode this codebase has hit in four harnesses now.
 *
 * So the question is asked without that split: starting at the row label's own
 * position in the document, what does the next stretch of raw text contain?
 * If the amount is there, the fix is the one the ruling already names — for a
 * table row the evidence is the FULL ROW INCLUDING THE AMOUNT CELL — and not a
 * prose search at all.
 *
 * Run: npx tsx lib/cache/s24hcacell.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition, amountSupportOf, parseMoneyAmount } from "../events/position";
import { getFilingText } from "../fetch";
import { createTextLocator } from "../agent/verifyQuote";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = process.argv[2] ?? "HCA Healthcare";
/** How far past the label to look. A table row's cells sit within a few dozen characters. */
const WINDOWS = [120, 240, 400];

(async () => {
  const r = await runAgentLoop(COMPANY);
  const spend = currentCompanySpend().totalUsd;
  const pos = assemblePosition(r, PINNED_AS_OF);
  const bad = pos.rows.filter((x) => amountSupportOf(x.amount, x.sourceLine).kind === "unsupported");

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — ${bad.length} row(s) whose evidence does not state the amount`);
  console.log("=".repeat(104));

  const cache = new Map<string, string>();
  for (const row of bad) {
    console.log(`\n  ── ${row.instrument}   ${row.amount}   (parsed ${parseMoneyAmount(row.amount)})`);
    if (!cache.has(row.citedUrl)) {
      try { cache.set(row.citedUrl, (await getFilingText(row.citedUrl)).text); } catch { cache.set(row.citedUrl, ""); }
    }
    const text = cache.get(row.citedUrl) ?? "";
    if (!text) { console.log(`     document unreadable — inconclusive`); continue; }

    const at = createTextLocator(text).find(row.sourceLine);
    if (at === null) { console.log(`     its own sourceLine is NOT LOCATABLE in the cited document — a different problem`); continue; }

    for (const w of WINDOWS) {
      const window = text.slice(at, at + row.sourceLine.length + w).replace(/\s+/g, " ").trim();
      const ok = amountSupportOf(row.amount, window).kind !== "unsupported";
      console.log(`     +${String(w).padStart(3)} chars  ${ok ? "STATES THE AMOUNT" : "does not"}   "${window.slice(0, 150)}"`);
      if (ok) break;
    }
  }
  console.log(`\n  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
})();
