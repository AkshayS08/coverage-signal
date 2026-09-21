/**
 * THE REFRESH PASS — the roster's second observation, and the verdict on it.
 *
 * Rule 55 cleared this run before it was priced: Molina's anchor states the
 * field, verbatim, so a re-ask can actually answer something. Encompass's
 * watch was struck at the same gate and is not re-asked here.
 *
 * WHAT MAKES THIS A SECOND TRIAL RATHER THAN A SECOND RUN. The verdict is
 * only meaningful if both observations are about the same documents, so the
 * corpus fingerprint is compared before and after and handed to dropVerdict
 * as `corpusMovedBetween`. A fingerprint that moved does not produce a
 * finding; it produces "not-comparable" and a re-sign (Rule 30).
 *
 * WHAT CACHE_BUST DOES AND DOES NOT TOUCH. It appends its value to the
 * fingerprint, so the re-ask writes to its OWN key. The v30 answer every
 * signed golden rests on is read here and never overwritten — re-running
 * this script with the same bust value is free.
 *
 * THIS RUN BILLS. One company, one cold extraction.
 *
 * Run: npx tsx lib/cache/s23refresh.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings, getFilingText } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";
import { quoteAppearsIn } from "../agent/verifyQuote";
import { REFRESH_ROSTER, dropVerdict, type SentenceLocation } from "./refreshRoster";

const BUST = process.env.REFRESH_BUST ?? "s23-refresh-1";

interface Fig { value: string; sourceLine: string }
interface Fac { name: string; drawn?: Fig | null; lettersOfCredit?: Fig | null; available?: Fig | null; facilitySize?: Fig | null; maturity?: Fig | null }

(async () => {
  const entries = REFRESH_ROSTER.filter((r) => r.fieldDrops.length > 0);
  console.log(`\n${"=".repeat(100)}`);
  console.log(`REFRESH — ${entries.length} name(s) carry a field watch; the rest of the roster is a re-sign, not a re-ask`);
  console.log("=".repeat(100));

  let spend = 0;
  for (const entry of entries) {
    const f = await getRecentFilings(entry.company, ["8-K", "10-Q", "10-K"]);
    const fpBefore = corpusFingerprint(f.filings);

    // OBSERVATION 1, read from the blob rather than remembered. A baseline
    // quoted from a report is a baseline nobody can re-derive.
    const meta = await head(baseAnswerKey(f.cik, fpBefore), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const v30 = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const v30dm = (v30.data ?? []).find((r) => r.triggerId === "debt-maturity");
    const v30facs = (v30dm?.facilities ?? []) as Fac[];

    // The anchor, for deciding where a filled value came FROM.
    const anchor = f.filings.find((x) => x.form === "10-Q" || x.form === "10-K")!;
    const anchorText = (await getFilingText(anchor.primaryDocUrl)).text;

    console.log(`\n${entry.company}`);
    console.log(`  corpus fingerprint (before): ${fpBefore}`);
    console.log(`  anchor: ${anchor.form} ${anchor.filingDate}`);
    console.log(`  re-asking with CACHE_BUST=${BUST} — this bills`);

    process.env.CACHE_BUST = BUST;
    const result = await runAgentLoop(entry.company);
    delete process.env.CACHE_BUST;
    const cost = currentCompanySpend().totalUsd;
    spend += cost;

    // The fingerprint AFTER, because the filing-list cache has a 24h TTL and
    // a new 8-K between the two observations would quietly change what the
    // second one is about.
    const fpAfter = corpusFingerprint((await getRecentFilings(entry.company, ["8-K", "10-Q", "10-K"])).filings);
    const moved = fpAfter !== fpBefore;
    console.log(`  corpus fingerprint (after):  ${fpAfter}${moved ? "   ⚠ MOVED" : "   unchanged"}`);
    console.log(`  cost: $${cost.toFixed(4)}`);

    // OBSERVATION 2, READ FROM ITS OWN BLOB — not from runAgentLoop's return.
    //
    // The first version of this harness read the loop's result, which is the
    // row AFTER verification, and scored REPRODUCING-DROP on a run where the
    // model had in fact returned the field correctly and Rule 53 rejected it.
    // Two different layers, one number, and the instrument reported the wrong
    // one with full confidence. `dropVerdict` is a question about what the
    // MODEL returned; the verifier's disposition is a separate line below,
    // because folding them is how a fixed defect reads as an unfixed one.
    const bustMeta = await head(baseAnswerKey(f.cik, `${fpBefore}-bust${BUST}`), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const raw = (await (await fetch(bustMeta.url)).json()) as { data?: Record<string, unknown>[] };
    const rawDm = (raw.data ?? []).find((r) => r.triggerId === "debt-maturity");
    const facs = (rawDm?.facilities ?? []) as Fac[];

    // What our own code then did with it, kept separate and named.
    const verifiedDm = result.results.find((t) => t.triggerId === "debt-maturity");
    const verifiedFacs = (verifiedDm?.facilities ?? []) as unknown as Fac[];

    for (const watch of entry.fieldDrops) {
      const before = v30facs.find((x) => x.name === watch.facility) ?? v30facs[0];
      const after = facs.find((x) => x.name === watch.facility) ?? facs[0];
      const beforeFig = before?.[watch.field] ?? null;
      const afterFig = after?.[watch.field] ?? null;

      let location: SentenceLocation | null = null;
      if (afterFig) location = quoteAppearsIn(afterFig.sourceLine, anchorText) ? "anchor" : "off-anchor";

      const verdict = dropVerdict(watch, { value: afterFig?.value ?? null, sentenceLocation: location }, moved);

      console.log(`\n  ${"-".repeat(96)}`);
      console.log(`  FIELD: ${watch.field} on "${watch.facility}"`);
      console.log(`  ${"-".repeat(96)}`);
      console.log(`    the filings state it     ${watch.statedBy.document} (${watch.statedBy.location})`);
      console.log(`                             "${watch.statedBy.sentence}"`);
      console.log(`    observation 1  (v30)     ${beforeFig ? `${beforeFig.value}` : "null — dropped"}`);
      console.log(`    observation 2  (refresh) ${afterFig ? `${afterFig.value}   [from the ${location}]` : "null — dropped"}`);
      if (afterFig) console.log(`                             "${afterFig.sourceLine}"`);
      console.log(`\n    VERDICT (what the MODEL did): ${verdict.kind.toUpperCase()}`);
      console.log(`    ${verdict.action}`);

      // THE SECOND LAYER, REPORTED SEPARATELY. A field the model returned and
      // our verifier refused is null downstream for a reason that has nothing
      // to do with the drop, and no prompt change touches it.
      const vFac = verifiedFacs.find((x) => x.name === watch.facility) ?? verifiedFacs[0];
      const vFig = vFac?.[watch.field] ?? null;
      console.log(`\n    THEN VERIFICATION: ${vFig ? `kept — renders ${vFig.value}` : "REJECTED — the model returned it and our own check threw it away, so the rendered null is ours, not the filing's"}`);

      // The whole facility, either way — a field that came back while the row
      // around it moved is not a clean recovery, and the only way to see that
      // is to print the row.
      console.log(`\n    the row, both observations:`);
      for (const k of ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const) {
        const b = before?.[k]?.value ?? "—";
        const a = after?.[k]?.value ?? "—";
        console.log(`      ${k.padEnd(16)} v30: ${String(b).padEnd(22)} refresh: ${String(a).padEnd(22)}${b !== a ? "  ← moved" : ""}`);
      }
      console.log(`      ${"name".padEnd(16)} v30: ${String(before?.name ?? "—").padEnd(22)} refresh: ${String(after?.name ?? "—").padEnd(22)}${before?.name !== after?.name ? "  ← moved" : ""}`);
      console.log(`      ${"facilities".padEnd(16)} v30: ${String(v30facs.length).padEnd(22)} refresh: ${String(facs.length).padEnd(22)}${v30facs.length !== facs.length ? "  ← moved" : ""}`);
    }
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(100));
})();
