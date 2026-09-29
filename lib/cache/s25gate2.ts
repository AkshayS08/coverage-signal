/**
 * GATE 2, ASSERTING ITS OWN WORDING. $0.
 *
 * "Both printed subtotals tie exactly" was implemented as: parse the
 * transcribed SUBTOTAL LINES and compare them to 592 and 30,871. That checks
 * whether the model copied two numbers, not whether the rows it transcribed
 * add up to them — so a sample whose 36 rows summed to 22,783 passed it.
 *
 * Now it sums the INSTRUMENT ROWS against each printed subtotal, partitioning
 * by position: a subtotal closes the section of rows that precede it, which is
 * how the note is laid out and needs no field the transcription does not
 * carry.
 *
 * Run: npx tsx lib/cache/s25gate2.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { runAgentLoop } from "../agent";
import { locatorFor, tableCellMillions } from "../agent/tableScale";
import { currentCompanySpend } from "../agent/costMeter";

const BUST = "s25-cigna";
interface Row { instrument: string; amount: string; sourceLine: string; kind: string }

(async () => {
  let spend = 0;
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form) && x.reportDate === "2025-12-31")!;
  const { text } = await getFilingText(tenK.primaryDocUrl);
  const loc = locatorFor(text);

  console.log(`\n${"=".repeat(96)}\nGATE 2 — instrument rows summed against each printed subtotal\n${"=".repeat(96)}`);
  let allPass = true;
  for (const n of [0, 1, 2]) {
    if (n === 0) delete process.env.CACHE_BUST; else process.env.CACHE_BUST = `${BUST}-${n}`;
    const r = await runAgentLoop("Cigna Group");
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const entries = ((dm?.priorPeriodBase as { rows?: Row[] } | null)?.rows ?? []);

    // A subtotal closes the section of rows before it.
    let bucket: Row[] = [];
    const sections: { label: string; stated: number | null; rowsSum: number; count: number }[] = [];
    for (const e of entries) {
      if (e.kind === "row") { bucket.push(e); continue; }
      if (e.kind === "subtotal") {
        sections.push({
          label: e.instrument,
          stated: tableCellMillions(e.amount, e.sourceLine, text, loc),
          rowsSum: bucket.reduce((a, x) => a + (tableCellMillions(x.amount, x.sourceLine, text, loc) ?? 0), 0),
          count: bucket.length,
        });
        bucket = [];
      }
    }
    const label = n === 0 ? "sample 1 (canonical)" : `sample ${n + 1} (re-taste)`;
    console.log(`\n  ${label}`);
    let ok = sections.length > 0;
    for (const s of sections) {
      const ties = s.stated !== null && Math.round(s.rowsSum) === Math.round(s.stated);
      if (!ties) ok = false;
      console.log(`      ${s.label.slice(0, 34).padEnd(36)} ${s.count} rows sum ${Math.round(s.rowsSum).toLocaleString().padStart(7)}M  vs printed ${s.stated === null ? "UNREADABLE" : Math.round(s.stated).toLocaleString().padStart(7) + "M"}   ${ties ? "TIES" : "DOES NOT TIE"}`);
    }
    const total = sections.reduce((a, s) => a + s.rowsSum, 0);
    console.log(`      ${"ALL ROWS".padEnd(36)} ${Math.round(total).toLocaleString().padStart(13)}M  vs tagged  31,463M   ${Math.round(total) === 31463 ? "TIES" : "DOES NOT TIE"}`);
    if (Math.round(total) !== 31463) ok = false;
    if (!ok) allPass = false;
  }
  console.log(`\n${"=".repeat(96)}`);
  console.log(`  GATE 2 (asserting its wording): ${allPass ? "HOLDS IN ALL THREE SAMPLES" : "FAILS"}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(96));
})();
