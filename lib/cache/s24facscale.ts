/**
 * WHAT HAPPENS TO A FACILITY FIGURE WHOSE CELL CARRIES NO UNIT? $0.
 *
 * Enumerated rather than guessed (Rule 63): `deriveScaleFromFilingDeclaration`
 * is applied to `scheduleSequence`, `priorScheduleSequence`,
 * `balanceSheetDebtCaptions` and `cashAmount`. It is NOT applied to
 * `facilities`. So a facility figure's unit depends entirely on the model
 * having appended one, and DaVita's five alternate between
 * "$ 188,482 thousand" and "$ 188,482" across runs at one version.
 *
 * THE QUESTION THAT DECIDES HOW BAD THIS IS: what does the unit-less form
 * render as? If it is dropped as indeterminate, the cost is a missing figure.
 * If it renders, "$ 188,482" is $188 thousand where the filing means $188.5
 * MILLION — a 1000x understatement of a letter-of-credit balance, on the page,
 * beside a sentence that does not contradict it.
 *
 * Printed per run, with whether the figure's own sentence sits under a scale
 * declaration the filing makes — which is what a fix would read.
 *
 * Run: npx tsx lib/cache/s24facscale.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { runAgentLoop } from "../agent";
import { getFilingText } from "../fetch";
import { detectDollarScaleAt } from "../agent/scaleNormalize";
import { hasDeterminableMoneyScale, isSelfDescribingAmount } from "../agent/moneyScale";
import { createTextLocator } from "../agent/verifyQuote";
import { currentCompanySpend } from "../agent/costMeter";

const BUST_TAG = "s23-sign";
const COMPANY = process.argv[2] ?? "DaVita";
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;
interface Fig { value: string; sourceLine: string }

(async () => {
  let spend = 0;
  for (const run of [null, 1, 2] as const) {
    if (run === null) delete process.env.CACHE_BUST;
    else process.env.CACHE_BUST = `${BUST_TAG}-${COMPANY.replace(/[^a-z0-9]/gi, "").slice(0, 14)}-${run}`;
    const r = await runAgentLoop(COMPANY);
    delete process.env.CACHE_BUST;
    spend += currentCompanySpend().totalUsd;

    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const anchorUrl = (dm?.debtScheduleSourceFiling as { url?: string } | undefined)?.url;
    let text = "";
    if (anchorUrl) { try { text = (await getFilingText(anchorUrl)).text; } catch { /* reported */ } }
    const locator = text ? createTextLocator(text) : null;

    console.log(`\n${"=".repeat(104)}`);
    console.log(`${COMPANY} — ${run === null ? "run 1 (canonical)" : `run ${run + 1} (re-taste)`}`);
    console.log("=".repeat(104));

    for (const f of (dm?.facilities ?? []) as Record<string, Fig | null | string>[]) {
      console.log(`\n  ${String(f.name)}`);
      for (const k of FIELDS) {
        const fig = f[k] as Fig | null;
        if (!fig) { console.log(`      ${k.padEnd(16)} null`); continue; }
        const selfDesc = isSelfDescribingAmount(fig.value);
        const determinable = hasDeterminableMoneyScale(fig.value);
        let decl = "sourceLine not locatable in the anchor";
        if (locator) {
          const at = locator.find(fig.sourceLine);
          if (at === null) decl = "sourceLine NOT FOUND in the anchor text";
          else {
            const scale = detectDollarScaleAt(text, at);
            decl = scale ? `governing declaration "${scale.declarationText.replace(/\s+/g, " ").slice(0, 44)}" -> ${scale.scaleWord}` : "no scale declaration above it";
          }
        }
        console.log(`      ${k.padEnd(16)} ${String(fig.value).padEnd(24)} selfDescribing=${selfDesc}  determinable=${determinable}`);
        console.log(`          ${decl}`);
        if (!selfDesc) console.log(`          ← NO UNIT OF ITS OWN. ${determinable ? "AND IT IS DETERMINABLE, so it RENDERS — as literal dollars." : "Indeterminate, so it is dropped."}`);
      }
    }
  }
  console.log(`\n  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
})();
