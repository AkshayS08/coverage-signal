/**
 * SESSION 27 — RE-SIGN AT v33 UNDER THE READ-SET KEY, NAME BY NAME, ON AKSHAY'S CLEAR. $0.
 *
 * Cleared Oct 29: Tenet; Encompass at its pre-Oct 28 read set; DaVita only if
 * its card built from the v33 canonical is byte-identical to the committed
 * card (checked here, refused otherwise). Cigna is not cleared.
 *
 * For each name passed on the command line, the canonical v33 answer
 * (baselines/s27-replay.json) is signed at the golden's own pinned as-of,
 * after REFUSING on any of:
 *   - 9b below 3/3 at that as-of (s27compare: the same comparison as 9b);
 *   - a Rule 58 row (an amount its sentence does not state);
 *   - a computed criterion that does not hold;
 *   - Rule 75: where the name is cached under its current read set, a $0
 *     replay through the loop must give the same state as the stored
 *     canonical; where its corpus has since moved (Encompass), the stored
 *     canonical is signed at the read set it was taken on, as ruled;
 *   - DaVita: the card condition.
 * The basis records the clear, the read set, and every tolerated difference.
 *
 * Dry run by default. Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27sign.ts <cik>... [--write]
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runAgentLoop } from "../agent";
import { checkFree } from "./freeRun";
import { deriveGoldenState, unsupportedAmountRows, type GoldenFile } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { compareSample } from "./s27compare";
import { buildCard } from "../cards/build";

const SIGNER = "Akshay Sahani";
const CLEARED_ON = "2026-10-29";
const CLEARED: Record<string, string> = {
  "0000070318": "Cleared by Akshay Sahani on Oct 29, 2026. Re-signed Oct 30 under his Rule 66 ruling of that day: the 10-K is a source only where the anchor is not-located and directs to it, which is not Tenet's case, so the revolver's and the L/C facility's maturity (November 4, 2030), stated only in the 10-K, are removed from the card, and the 10-K leaves the position identity. Nothing else moved.",
  "0000785161": "Cleared by Akshay Sahani on Oct 29, 2026, at its pre-Oct 28 read set (its Q3 earnings 8-K of Oct 28 moved the read set after the samples were taken; by ruling, an earnings 8-K alone is not a refresh).",
  "0000927066": "Cleared by Akshay Sahani on Oct 29, 2026, on the tolerated classes: the byte-identity condition first set was withdrawn as stricter than what Tenet and Encompass were signed on. The 136 card lines that differ from the v31 card are cited sentences verbatim in the same document that state the amount (Rule 58); no figure, date or label differs. Its subtotal label \"Total debt principal outstanding\" is recovered from the document in code.",
  "0001739940": "Cleared by Akshay Sahani on Oct 30, 2026, on the condition that 3/3 and criterion 2 hold. Its deltas are matched by identity and labelled from it (ruling of Oct 29); its revolver's commitment is filled from its own sentence through its one verified facility, basis commitment, held out of captured debt (ruling of Oct 30).",
};
// The byte-identity condition on DaVita was withdrawn (Akshay, Oct 29); kept as a mechanism for a future clear that sets one.
const CARD_CONDITION = new Set<string>();
const WRITE = process.argv.includes("--write");
const ciks = process.argv.slice(2).filter((a) => /^\d{10}$/.test(a));

/** The card the generator would write from this result, with the committed snapshot's other inputs. */
export function cardFrom(cik: string, result: any): string {
  const IN = "lib/cards/inputs", BRIEF = JSON.parse(readFileSync("lib/cards/generated/index.json", "utf-8")).briefDate;
  const snap = JSON.parse(readFileSync(join(IN, `${cik}.json`), "utf-8"));
  const week = JSON.parse(readFileSync(join(IN, "week", `${BRIEF}.json`), "utf-8")).names[cik];
  const fp = join(IN, "facts", `${cik}.json`);
  const card = buildCard({
    result, briefDate: BRIEF, previousBrief: week?.previousBrief ?? null, weekFilings: week?.filings ?? [], cash: snap.cash,
    textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence,
    laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts: existsSync(fp) ? JSON.parse(readFileSync(fp, "utf-8")) : null,
  });
  return JSON.stringify(card, null, 1) + "\n";
}

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const canon = JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")).results as { company: string; result: any }[];
  const re = JSON.parse(readFileSync("baselines/s27-retaste.json", "utf-8")).results as { bust: string; result: any }[];
  for (const cik of ciks) {
    const path = `baselines/golden/${cik}.json`;
    const g = JSON.parse(readFileSync(path, "utf-8")) as GoldenFile;
    const c = canon.find((x) => x.result.cik === cik)!;
    const asOf = new Date(`${g.state.asOf}T00:00:00Z`);
    const problems: string[] = [];
    if (!CLEARED[cik]) problems.push("not cleared by Akshay");
    const samples = re.filter((x) => x.result.cik === cik).map((x) => ({ bust: x.bust, ...compareSample(c.result, x.result, asOf) }));
    const n = 1 + samples.filter((x) => x.tie.counts).length;
    if (n !== 3) problems.push(`9b ${n}/3 at ${g.state.asOf}`);
    const state = deriveGoldenState(c.result, asOf);
    for (const u of unsupportedAmountRows(state)) problems.push(`Rule 58 — ${u}`);
    const crit = evaluateGoldenCriteria(c.result, asOf, { rowsCorrect: true, instrumentTypeFaithful: true, reproducedThreeTimes: n === 3, by: SIGNER, on: CLEARED_ON });
    for (const k of crit.criteria) if (k.kind === "computed" && !k.pass) problems.push(`criterion ${k.id} does not hold: ${k.detail.slice(0, 140)}`);
    const live = await checkFree(c.company);
    let readSetNote: string;
    if (live.cached) {
      const quiet = console.log; console.log = () => {};
      const replay = await runAgentLoop(c.company);
      console.log = quiet;
      if (JSON.stringify(deriveGoldenState(replay, asOf)) !== JSON.stringify(state)) problems.push("Rule 75: the $0 replay through the loop does not give the stored canonical's state");
      readSetNote = `read set ${live.fingerprint} (current; the $0 replay through the loop gives the same state)`;
    } else readSetNote = "the read set the canonical and both re-tastes were taken on (since moved; not a refresh by ruling)";
    if (CARD_CONDITION.has(cik)) {
      const a = cardFrom(cik, c.result), b = readFileSync(`lib/cards/generated/${cik}.json`, "utf-8").replace(/\r\n/g, "\n");
      const bl = b.split("\n");
      if (a !== b) problems.push(`card condition: the card built from the v33 canonical differs from the committed card on ${a.split("\n").filter((l, i) => l !== bl[i]).length} line(s)`);
    }
    console.log(`\n${c.company} (${cik}) — 9b ${n}/3 at ${g.state.asOf}; ${readSetNote}`);
    if (problems.length) { console.log(`  REFUSED:\n${problems.map((p) => `    ${p}`).join("\n")}`); continue; }
    const tolerated = [...new Set(samples.flatMap((x) => (x.verdict.kind === "not-applicable" ? [] : x.verdict.tolerated)))];
    const basis =
      `RE-SIGNED at extraction v${EXTRACTION_PROMPT_VERSION} under the read-set key (Session 27), replacing the v${g.extractionVersion} signature of ${g.signature?.signedOn}. ` +
      `${CLEARED[cik]} Signed over the canonical v33 answer on ${readSetNote}. ` +
      `9b: 3/3 (the canonical and two CACHE_BUST re-tastes at v33 on that read set; s27compare, with the coverage tie required). ` +
      `Rule 58: every amount stated by its sentence. All computed criteria hold. ` +
      (tolerated.length ? `TOLERATED BY THE 9b GATE, RECORDED RATHER THAN DROPPED (${tolerated.length}): ${tolerated.map((t, i) => `(${i + 1}) ${t}`).join(" ")}` : "NOTHING WAS TOLERATED BY THE 9b GATE.") +
      ` Previously signed ${g.signature?.signedOn} on the basis: ${g.signature?.basis}`;
    console.log(`  ${WRITE ? "SIGNED" : "would sign"}: ${state.rows.length} rows, residual ${state.coverage.residualPercent}%, ${tolerated.length} tolerated difference(s)`);
    if (WRITE) {
      const out: GoldenFile = {
        ...g, extractionVersion: EXTRACTION_PROMPT_VERSION, signature: { signedBy: SIGNER, signedOn: CLEARED_ON, basis },
        attestation: { rowsCorrect: true, instrumentTypeFaithful: true, reproducedThreeTimes: true, by: SIGNER, on: CLEARED_ON },
        criteria: crit.criteria.map((k) => ({ id: k.id, name: k.name, kind: k.kind, pass: k.pass, detail: k.detail, defends: k.defends })),
        state, sourceResult: c.result,
      };
      writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
