/**
 * SESSION 23, STAGE 1 — which document do the returned rows actually come from? $0.
 *
 * The three rows do not appear in the anchor 10-Q they claim a period column
 * from. Every baseline filing is searched for each returned sourceLine, so the
 * answer is the document's own text rather than the model's citation
 * (Rule 44: the citation is the document the quote was found in).
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings, readFiling } from "../agent/tools";
import { selectBaselineFilings } from "../agent/selectFilings";
import { buildExtractionText } from "../fetch/noteLocation";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

(async () => {
  const company = process.argv[2] ?? "Cigna Group";
  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const baseline = selectBaselineFilings(f.filings);

  const key = baseAnswerKey(f.cik, corpusFingerprint(f.filings));
  const meta = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
  const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
  const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity");
  const seq = (dm?.scheduleSequence ?? []) as Record<string, unknown>[];

  console.log(`\n${company} — baseline is ${baseline.length} filings; anchor is ${baseline[0].form} ${baseline[0].filingDate}\n`);

  const docs: { label: string; full: string; prompt: string }[] = [];
  for (const b of baseline) {
    const { text: fullText } = await readFiling(b.primaryDocUrl);
    const ex = buildExtractionText({ form: b.form, url: b.primaryDocUrl, fullText, xbrlStatedTotal: null });
    docs.push({ label: `${b.form} ${b.filingDate}`, full: norm(fullText), prompt: norm(ex.text) });
  }

  for (const e of seq) {
    const sl = norm(String(e.sourceLine ?? ""));
    console.log(`  row: "${sl.slice(0, 64)}"`);
    console.log(`       model says periodColumn = ${String(e.periodColumn)}`);
    let found = false;
    for (const d of docs) {
      const inFull = d.full.includes(sl);
      const inPrompt = d.prompt.includes(sl);
      if (inFull || inPrompt) {
        found = true;
        console.log(`       FOUND in ${d.label}  — in full text: ${inFull ? "yes" : "no"}, in the prompt text: ${inPrompt ? "yes" : "no"}`);
      }
    }
    // Loosen once: the leading instrument label alone, in case the trailing
    // figures were re-spaced. A label match with no figure match is a
    // different finding from no match at all, and must not read as the same.
    if (!found) {
      const label = sl.split(/\s\d[\d,]*\s/)[0];
      for (const d of docs) {
        if (label.length > 20 && d.full.includes(label)) {
          console.log(`       label-only match in ${d.label}: "${label.slice(0, 60)}" — the FIGURES beside it are not this document's`);
          found = true;
        }
      }
    }
    if (!found) console.log(`       NOT FOUND in any baseline filing, full text or prompt`);
    console.log("");
  }
})();
