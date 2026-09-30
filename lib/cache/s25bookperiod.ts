/**
 * SESSION 25 — THE BOOK, BEFORE AND AFTER THE PERIOD RULE. $0, all cached.
 *
 * WHY THIS EXISTS RATHER THAN golden.test.ts.
 *
 * `golden.test.ts` re-derives each signed state from the CompanyResult stored
 * inside the golden file. That is the right test for a change to the
 * DERIVATION layer, and it is the WRONG test for a change to `loop.ts` — the
 * stored result was captured after the loop ran, so a loop-level filter
 * cannot reach it and the suite would report "five goldens unchanged" without
 * having executed one line of the new rule.
 *
 * That is this session's dominant defect class exactly: a check whose inputs
 * make its answer predetermined. Eight logged instances is enough.
 *
 * So the book is re-run THROUGH the loop, from cache, and the state derived
 * from what the loop produces today is compared against what it produced
 * before the rule existed. Snapshot to disk, run twice, diff.
 *
 *   npx tsx lib/cache/s25bookperiod.ts before
 *   ...make the change...
 *   npx tsx lib/cache/s25bookperiod.ts after
 *
 * The second invocation diffs itself against the first and names every name
 * that moved.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { deriveGoldenState, compareToGolden, positionFilingSetOf, type GoldenFile } from "../events/golden";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { currentCompanySpend } from "../agent/costMeter";

const BOOK = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const OUT = join(process.cwd(), "baselines", "s25period");
const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

const doc = (u: string) => (u ? u.split("/").pop() ?? u : "");

interface Snap {
  company: string;
  cik: string;
  anchor: string;
  positionSet: string[];
  rows: string[];
  coverage: string;
  facilities: string[];
  goldenVerdict: string;
}

function goldenFor(cik: string): GoldenFile | null {
  if (!existsSync(GOLDEN_DIR)) return null;
  for (const f of readdirSync(GOLDEN_DIR).filter((x) => x.endsWith(".json"))) {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf-8")) as GoldenFile;
    if (g.state.cik === cik) return g;
  }
  return null;
}

(async () => {
  const label = (process.argv[2] || "").trim();
  if (!/^[a-z0-9-]+$/.test(label)) { console.error("usage: npx tsx lib/cache/s25bookperiod.ts <before|after>"); process.exit(1); }
  mkdirSync(OUT, { recursive: true });

  const snaps: Snap[] = [];
  for (const company of BOOK) {
    delete process.env.CACHE_BUST;
    const r = await runAgentLoop(company);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity");
    const state = deriveGoldenState(r, PINNED_AS_OF);

    const g = goldenFor(state.cik);
    let verdict: string;
    if (!g) verdict = "(no signed golden)";
    else if ((g.extractionVersion ?? 0) !== EXTRACTION_PROMPT_VERSION) verdict = `(golden at v${g.extractionVersion ?? "?"}, code v${EXTRACTION_PROMPT_VERSION} — pin does not apply)`;
    else {
      const v = compareToGolden(g.state, state);
      verdict = v.kind === "matches" ? "MATCHES SIGNED GOLDEN"
        : v.kind === "not-applicable" ? `NOT APPLICABLE — ${v.reason}`
        : `DIVERGED — ${v.divergences.join(" | ")}`;
    }

    snaps.push({
      company,
      cik: state.cik,
      anchor: `${state.anchor?.form ?? "—"} ${state.anchor?.reportDate ?? "—"} ${doc(state.anchor?.url ?? "")}`,
      positionSet: positionFilingSetOf(r, PINNED_AS_OF).map(doc),
      rows: state.rows.map((x) => `${x.instrument}|${x.amount}|${x.maturityDate ?? "—"}|${x.status}`),
      coverage: `stated=${state.coverage.statedTotalDebt} face=${state.coverage.capturedFace} residual=${state.coverage.residualPercent} passes=${state.coverage.residualPasses}`,
      facilities: (dm?.facilities ?? []).flatMap((f) =>
        FIELDS.filter((k) => (f as unknown as Record<string, unknown>)[k]).map((k) => {
          const fig = (f as unknown as Record<string, { value: string }>)[k];
          return `${f.name}.${k} = ${fig.value} @ ${doc(f.figureSources?.[k] ?? "")}`;
        })
      ),
      goldenVerdict: verdict,
    });
    console.log(`  ${company.padEnd(28)} ${snaps[snaps.length - 1].positionSet.length} docs, ${state.rows.length} rows — ${verdict.slice(0, 60)}`);
  }

  const path = join(OUT, `${label}.json`);
  writeFileSync(path, JSON.stringify(snaps, null, 2), "utf8");
  console.log(`\n  wrote ${path}`);

  // DIFF against the "before" snapshot, when this is not it.
  const beforePath = join(OUT, "before.json");
  if (label !== "before" && existsSync(beforePath)) {
    const before = JSON.parse(readFileSync(beforePath, "utf-8")) as Snap[];
    console.log(`\n${"=".repeat(104)}`);
    console.log(`  BOOK-WIDE DIFF — "${label}" against "before"`);
    console.log("=".repeat(104));
    let moved = 0;
    for (const a of snaps) {
      const b = before.find((x) => x.company === a.company);
      if (!b) { console.log(`  ${a.company}: NEW (absent from before)`); moved++; continue; }
      const lines: string[] = [];
      const cmp = (name: string, x: unknown, y: unknown) => {
        const sx = JSON.stringify(x), sy = JSON.stringify(y);
        if (sx !== sy) lines.push(`      ${name}:\n        before ${sy}\n        after  ${sx}`);
      };
      cmp("anchor", a.anchor, b.anchor);
      cmp("position filing set", a.positionSet, b.positionSet);
      cmp("rows", a.rows, b.rows);
      cmp("coverage", a.coverage, b.coverage);
      cmp("facility figures", a.facilities, b.facilities);
      cmp("golden verdict", a.goldenVerdict, b.goldenVerdict);
      if (lines.length === 0) console.log(`  ${a.company.padEnd(28)} unchanged`);
      else { moved++; console.log(`  ${a.company.padEnd(28)} MOVED:`); for (const l of lines) console.log(l); }
    }
    console.log(`\n  ${moved} of ${snaps.length} name(s) moved.`);
  }
  console.log(`  SPEND: $${currentCompanySpend().totalUsd.toFixed(4)}`);
})();
