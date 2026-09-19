/**
 * SESSION 23, STAGE 1 — WHY DOES A LARGE NOTE TRANSCRIBE SHORT? $0.
 *
 * "Do not design against a guess." The prompt offers three candidate causes —
 * the model stops early, it hits an output limit, or it summarises — and this
 * measures which, on the real cached v29 answer, before a line of the fix is
 * written.
 *
 * ZERO MODEL CALLS BY CONSTRUCTION: it imports the blob READ path and the
 * locator, and nothing that can reach `messages.create`. It reads the base
 * answer at the CURRENT key (so a miss means "never extracted at v29", not
 * "re-extract it now") and the permanently-cached filing text.
 *
 * Reports per filing, for each named company:
 *   - what the locator hands the model: span, its derivable coupon-row count,
 *     and whether spanIsTabular routes it to the schedule schema at all
 *   - what came back: schedule entries, prose instruments, stated total
 *
 * The comparison is the point. A company that transcribes completely and one
 * that does not, measured the same way, is the only thing that can say which
 * of the three causes it is — a short list on its own is consistent with all
 * three (Rule 41: read the rows, not the count; Rule 24: the region first).
 *
 * Run: npx tsx lib/cache/s23transcription.ts "Cigna Group" "Tenet Healthcare"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings, readFiling } from "../agent/tools";
import { buildExtractionText, assertSpanContainsTable, spanIsTabular } from "../fetch/noteLocation";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const COMPANIES = process.argv.slice(2);

/** The blob the run would read. Fetched directly so nothing can recompute it. */
async function readBaseAnswer(cik: string, fingerprint: string): Promise<unknown | null> {
  const key = baseAnswerKey(cik, fingerprint);
  try {
    const meta = await head(key);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface Verdict {
  triggerId?: string;
  scheduleSequence?: unknown[] | null;
  proseInstruments?: unknown[] | null;
  facilities?: unknown[] | null;
  statedTotal?: string | null;
  fired?: boolean;
}

(async () => {
  if (COMPANIES.length === 0) {
    console.error("Name at least one company.");
    process.exit(1);
  }
  console.log(`\n${"=".repeat(104)}`);
  console.log(`TRANSCRIPTION DIAGNOSIS at v${EXTRACTION_PROMPT_VERSION} — cached reads only, zero model calls`);
  console.log("=".repeat(104));

  for (const company of COMPANIES) {
    // THE SAME CATALOG THE LOOP ASKS FOR. Called without this filter the
    // fingerprint differs from the one the run uses, and every "absent" would
    // be an artefact of the harness rather than a fact about the cache —
    // caught by cross-checking preflight, which is what preflight is for.
    const filings = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const fingerprint = corpusFingerprint(filings.filings);
    // The blob wraps the payload: { cachedAt, data: Verdict[] }. Reading
    // `results` off it returned undefined and printed "no cached answer"
    // beside a header saying CACHED — two surfaces disagreeing about one
    // fact, which is the defect this codebase names most often.
    const blob = (await readBaseAnswer(filings.cik, fingerprint)) as { cachedAt?: string; data?: Verdict[] } | null;
    const answer = blob?.data ? { results: blob.data, cachedAt: blob.cachedAt } : null;

    console.log(`\n\n### ${company}   cik ${filings.cik}   fingerprint ${fingerprint.slice(0, 24)}`);
    console.log(`    base answer at v${EXTRACTION_PROMPT_VERSION}: ${answer ? "CACHED — read, not recomputed" : "ABSENT (never extracted at this version)"}`);

    // WHAT THE LOCATOR HANDS THE MODEL, per periodic filing. The region is
    // measured before the response is, because a short answer over a narrow
    // region is a region problem and reads identically to a model problem.
    const periodic = filings.filings.filter((f) => f.form === "10-Q" || f.form === "10-K");
    console.log(`\n    THE REGION — what the model was given to transcribe`);
    console.log(`    ${"form".padEnd(6)} ${"filed".padEnd(11)} ${"status".padEnd(10)} ${"span chars".padEnd(11)} ${"couponRows".padEnd(11)} ${"statedTotal".padEnd(12)} routing`);
    // THE ANCHOR is the most recent periodic filing, full stop (Session 20).
    // Its note is the only one that may become the ladder, so its size is the
    // only size that can be compared against what came back.
    const anchorUrl = periodic[0]?.primaryDocUrl;
    for (const f of periodic) {
      const { text: fullText } = await readFiling(f.primaryDocUrl);
      const ex = buildExtractionText({ form: f.form, url: f.primaryDocUrl, fullText, xbrlStatedTotal: null });
      if (!ex.noteSpan) {
        console.log(`  ${f.primaryDocUrl === anchorUrl ? "A>" : "  "} ${f.form.padEnd(6)} ${f.filingDate.padEnd(11)} ${String(ex.debtNoteStatus).padEnd(10)} ${"—".padEnd(11)} ${"—".padEnd(11)} ${"—".padEnd(12)} no span located`);
        continue;
      }
      const { start, end } = ex.noteSpan;
      const table = assertSpanContainsTable(fullText, start, end);
      const tab = spanIsTabular(fullText, start, end);
      // DOES THE REGION SURVIVE INTO THE PROMPT? The locator finding a
      // 37-row note proves nothing if the bounded extraction text the model
      // actually receives cuts it. Measured by asking whether the span's own
      // first and last 60 characters are present in what gets sent (Rule 24:
      // the region the measurement runs on is the measurement).
      const spanText = fullText.slice(start, end);
      const headIn = ex.text.includes(spanText.slice(0, 60));
      const tailIn = ex.text.includes(spanText.slice(-60));
      const inPrompt = headIn && tailIn ? "whole span in prompt" : headIn ? "HEAD ONLY — span tail cut from prompt" : "SPAN NOT IN PROMPT";
      const routing = tab.tabular
        ? `tabular (${tab.groupedFigures} grouped figures) — schedule field OFFERED`
        : `PROSE-ONLY — schedule field WITHHELD from the schema`;
      console.log(
        `  ${f.primaryDocUrl === anchorUrl ? "A>" : "  "} ${f.form.padEnd(6)} ${f.filingDate.padEnd(11)} ${String(ex.debtNoteStatus).padEnd(10)} ` +
          `${String(end - start).padEnd(11)} ${String(table.couponRows).padEnd(11)} ${String(table.hasStatedTotal).padEnd(12)} ${routing}  |  prompt ${ex.text.length}ch, ${inPrompt}`
      );
    }

    // WHAT CAME BACK.
    if (!answer?.results) {
      console.log(`\n    THE RESPONSE — unavailable (no cached answer at v${EXTRACTION_PROMPT_VERSION})`);
      continue;
    }
    const dm = answer.results.find((r) => r.triggerId === "debt-maturity");
    console.log(`\n    THE RESPONSE — what v${EXTRACTION_PROMPT_VERSION} returned for debt-maturity`);
    if (!dm) {
      console.log(`      no debt-maturity verdict in the cached answer`);
      continue;
    }
    const seq = Array.isArray(dm.scheduleSequence) ? dm.scheduleSequence : [];
    const prose = Array.isArray(dm.proseInstruments) ? dm.proseInstruments : [];
    const fac = Array.isArray(dm.facilities) ? dm.facilities : [];
    console.log(`      fired               : ${dm.fired}`);
    console.log(`      scheduleSequence    : ${dm.scheduleSequence === null ? "null (field absent from the schema)" : `${seq.length} entr${seq.length === 1 ? "y" : "ies"}`}`);
    console.log(`      proseInstruments    : ${prose.length}`);
    console.log(`      facilities          : ${fac.length}`);
    console.log(`      statedTotal         : ${dm.statedTotal ?? "—"}`);

    // THE SHAPE OF WHAT CAME BACK is what separates "stopped early" from
    // "summarised": a prefix of the printed note is early stopping; a set of
    // roll-up lines spanning the whole note is a summary.
    const kinds = seq.map((e) => (e as { kind?: string }).kind ?? "?");
    const counts = kinds.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
    if (seq.length) {
      console.log(`      entry kinds         : ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      console.log(`      entries, in order   :`);
      for (const e of seq) {
        const x = e as { kind?: string; label?: string; instrument?: string; amount?: string; section?: string | null };
        console.log(`        [${(x.kind ?? "?").padEnd(10)}] ${(x.section ?? "—").slice(0, 22).padEnd(24)} ${(x.instrument ?? x.label ?? "").slice(0, 52).padEnd(54)} ${x.amount ?? ""}`);
      }
    }
    if (prose.length) {
      console.log(`      prose instruments   :`);
      for (const p of prose) {
        const x = p as { name?: string; amount?: string };
        console.log(`        ${(x.name ?? "").slice(0, 60).padEnd(62)} ${x.amount ?? ""}`);
      }
    }
  }
  console.log(`\n${"=".repeat(104)}\n`);
})();
