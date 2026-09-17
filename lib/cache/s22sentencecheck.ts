/**
 * SESSION 22, STAGE 3 — IS A REJECTED SENTENCE REAL? $0.
 *
 * Built on `lib/agent/corpus.ts`, which is the point: the two throwaway
 * versions of this probe both concluded "ABSENT — the guard is right" from a
 * document set they had failed to load, and I nearly reported both. The
 * primitive makes that impossible — a corpus that is not fully loaded cannot
 * return `absent`, so this cannot print a fabrication verdict it has not
 * earned.
 *
 * Checks each rejected sentence against the company's FULL EDGAR catalog,
 * not the run's corpus, which separates three outcomes the run itself
 * cannot:
 *
 *   in the run's corpus      the guard was wrong to reject it
 *   in the catalog only      real text, from a document this run never
 *                            fetched — out of scope, NOT fabricated
 *   in neither               reconstructed
 *
 * That middle case is the one my earlier reporting collapsed into
 * "fabricated", and it is a materially different claim about a model.
 *
 * Run: npx tsx lib/cache/s22sentencecheck.ts "Quest Diagnostics"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { getRecentFilings } from "../fetch/filings";
import { getFilingText } from "../fetch";
import { buildCorpus } from "../agent/corpus";

const COMPANY = process.argv[2] ?? "Quest Diagnostics";
/** The catalog is large; the recent window is what could plausibly be in scope. */
const RECENT = Number(process.argv[3] ?? 14);

(async () => {
  const result = await runAgentLoop(COMPANY);
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const rejections = dm?.facilityRejections ?? [];

  const filings = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const recent = [...filings.filings].sort((a, b) => b.filingDate.localeCompare(a.filingDate)).slice(0, RECENT);
  const label = new Map(recent.map((f) => [f.primaryDocUrl, `${f.form} ${f.filingDate}`]));

  const catalog = await buildCorpus(recent.map((f) => f.primaryDocUrl), async (u) => {
    const raw = await getFilingText(u);
    return typeof raw === "string" ? raw : (raw as { text: string }).text;
  });

  console.log(`\n${"=".repeat(100)}`);
  console.log(`${COMPANY} — ${rejections.length} rejected figure(s)`);
  console.log(`catalog checked: ${catalog.describe()}  (${recent.length} most recent filings)`);
  console.log(`the run's own cited set: ${(dm?.citations ?? []).map((c) => `${c.form} ${c.date}`).join(", ") || "(none reported)"}`);
  console.log("=".repeat(100));

  if (!catalog.canConcludeAbsence) {
    console.error(`\n  Every "absent" verdict below is UNAVAILABLE: ${catalog.describe()}.`);
    console.error(`  Presence still resolves; absence does not. Reporting fabrication from here would repeat the defect this probe was rewritten to prevent.`);
  }

  for (const r of rejections) {
    const hit = catalog.find(r.sourceLine);
    console.log(`\n  ${r.facility}.${r.field} = ${r.value}`);
    console.log(`    rejected because: ${r.reason}`);
    console.log(`    "${r.sourceLine.replace(/\s+/g, " ").slice(0, 130)}"`);
    console.log(`    -> ${
      hit.outcome === "present"
        ? `REAL, stated in ${label.get(hit.url) ?? hit.url} — a document outside this run's corpus, so out of scope rather than invented`
        : hit.outcome === "absent"
          ? "RECONSTRUCTED — in none of the filings checked"
          : `UNDETERMINED — ${hit.why}`
    }`);
  }
})();
