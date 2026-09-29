/**
 * WHICH FIELD CARRIES THE DRIFTING CITATION? $0 — cached blobs and cached
 * filing text, bust tags derived and never typed.
 *
 * `filingSetOf` unions `citations` across all FIFTEEN triggers, and that union
 * is a golden file's identity. So a pharmacy-launch trigger citing one more
 * 8-K changes what a signed POSITION is pinned to, and every future
 * comparison answers "not applicable, the corpus moved" — about a corpus that
 * never moved and a document the ladder never read.
 *
 * Two documents drift, and the whole redefinition depends on what they back:
 *   DaVita   dva-20251231.htm   cited by run 2, not by runs 1 and 3
 *   CHS      cyh-20260401.htm   cited by the canonical run, not by either re-taste
 *
 * RULE 63 — EVERY PRODUCER, NOT THE LIKELIEST ONE. Asked three ways, because
 * "no ladder row cites it" is not the same claim as "nothing in the position
 * rests on it":
 *   (a) which TRIGGER's citations carry it
 *   (b) does any LADDER ROW cite it — `citedUrl`, exact
 *   (c) does any FACILITY FIGURE's evidence sentence appear IN it — facility
 *       figures carry no URL at all, only a sentence, so the only honest test
 *       is whether that sentence is in this document's text
 *
 * If it backs a row or a figure, this is real drift and the redefinition is
 * wrong. Reported either way.
 *
 * Run: npx tsx lib/cache/s24drift.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { getFilingText } from "../fetch";
import { currentCompanySpend } from "../agent/costMeter";

const BUST_TAG = "s23-sign";

interface Fig { value: string; sourceLine: string }
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

const CASES = [
  { company: "DaVita", drifting: "https://www.sec.gov/Archives/edgar/data/927066/000092706626000012/dva-20251231.htm", citedBy: "run 2 only" },
  { company: "Community Health Systems", drifting: "https://www.sec.gov/Archives/edgar/data/1108109/000119312526138026/cyh-20260401.htm", citedBy: "the canonical run only" },
];

/** Same normalization verification uses, so "is this sentence in this document" is asked the way it is asked elsewhere. */
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();

async function runFor(company: string, run: number | null) {
  if (run === null) delete process.env.CACHE_BUST;
  else process.env.CACHE_BUST = `${BUST_TAG}-${company.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${run}`;
  const r = await runAgentLoop(company);
  delete process.env.CACHE_BUST;
  return r;
}

(async () => {
  let spend = 0;

  for (const { company, drifting, citedBy } of CASES) {
    console.log(`\n${"=".repeat(104)}`);
    console.log(`${company} — ${drifting.split("/").pop()}, cited by ${citedBy}`);
    console.log("=".repeat(104));

    // (a) WHICH TRIGGER CITES IT, in every run.
    console.log(`\n  [a] which TRIGGER's citations carry it\n`);
    for (const run of [null, 1, 2] as const) {
      const r = await runFor(company, run);
      spend += currentCompanySpend().totalUsd;
      const carriers = r.results
        .filter((t) => t.citations.some((c) => c.url === drifting))
        .map((t) => t.triggerId);
      const label = run === null ? "run 1 (canonical)" : `run ${run + 1} (re-taste)`;
      console.log(`      ${label.padEnd(20)} ${carriers.length === 0 ? "cited by NO trigger" : `cited by: ${carriers.join(", ")}`}`);
    }

    // (b) and (c) against the run that DOES cite it.
    const citing = company === "DaVita" ? 1 : null;
    const r = await runFor(company, citing);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;

    console.log(`\n  [b] does any LADDER ROW cite it?\n`);
    const rowsCiting = pos.rows.filter((x) => x.citedUrl === drifting);
    console.log(`      ${pos.rows.length} ladder rows; ${rowsCiting.length} cite this document`);
    for (const x of rowsCiting) console.log(`          ${x.instrument} | ${x.amount}`);
    const urls = [...new Set(pos.rows.map((x) => x.citedUrl).filter(Boolean))];
    console.log(`      the documents ladder rows DO cite:`);
    for (const u of urls) console.log(`          ${u.split("/").pop()}`);

    console.log(`\n  [c] does any FACILITY FIGURE's sentence appear IN it?\n`);
    let text = "";
    try { text = (await getFilingText(drifting)).text; } catch { /* reported below */ }
    if (!text) {
      console.log(`      could not read the document's text — this check is INCONCLUSIVE and must not be read as "no"`);
    } else {
      const haystack = norm(text);
      const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
      let hits = 0, checked = 0;
      for (const f of facs) {
        for (const k of FIELDS) {
          const fig = f[k] as Fig | null;
          if (!fig?.sourceLine) continue;
          checked++;
          if (haystack.includes(norm(fig.sourceLine))) {
            hits++;
            console.log(`          IN THIS DOCUMENT: ${String(f.name)}.${k} = ${fig.value}`);
          }
        }
      }
      console.log(`      ${checked} facility figure sentence(s) checked, ${hits} found in this document`);
    }

    console.log(`\n  VERDICT for ${company}: ${rowsCiting.length === 0
      ? "no ladder row cites it. Combined with [a] and [c] above, decide whether the POSITION rests on it."
      : "A LADDER ROW CITES IT — this is REAL DRIFT and redefining the filing set would hide it."}`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
  console.log("=".repeat(104));
})();
