/**
 * SESSION 27 — THE APPROVED NARRATION PASS, UNDER THE PREVENTIVE GATE (Akshay, Oct 23). BILLS.
 *
 * Up to $0.0476. The guard holds that as the running limit: every narration
 * call's input is counted first and the call is refused if its worst case
 * (input at Sonnet's rate, output at its 700-token cap) would cross it. Only
 * the cards that miss the wording cache are narrated; a name not cached under
 * its current read set is reported, not run. Every call is in the ledger as
 * "<company> (narration)".
 *
 * Run: S27_APPROVED=narration npx tsx lib/cache/s27narrate.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { createHash } from "node:crypto";
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";
import { setSpendLimits, spentTotal, lastPriced } from "../agent/spendGuard";
import { buildEvents, buildVerifiedFactBase } from "../events";
import { buildContext } from "../events/sonnetEventBriefing";
import { cachedDraftEventBriefing } from "./wordingCache";
import { NARRATION_PROMPT_VERSION } from "./promptVersion";
import { answerExists, checkFree } from "./freeRun";

const LIMIT = 0.0476;
const AS_OF = new Date("2026-09-01T00:00:00Z");
const NAMES = ["TENET HEALTHCARE CORP", "Encompass Health Corp", "DAVITA INC.", "COMMUNITY HEALTH SYSTEMS INC", "MOLINA HEALTHCARE, INC.", "Cigna Group"];
const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };

(async () => {
  if (process.env.S27_APPROVED !== "narration") stop("this bills; set S27_APPROVED=narration only after approval");
  if (!process.env.ANTHROPIC_API_KEY) stop("no API key in the environment");
  setSpendLimits({ totalUsd: LIMIT });
  for (const company of NAMES) {
    if (!(await checkFree(company)).cached) { console.log(`${company}: not cached under its current read set (corpus moved) — not narrated`); continue; }
    const result = await runAgentLoop(company);
    if (currentCompanySpend().totalUsd > 0) stop(`${company}'s cached replay billed`);
    const { flashCardCandidates } = buildEvents([result], AS_OF);
    const facts = buildVerifiedFactBase(result, AS_OF);
    for (const card of flashCardCandidates) {
      const key = `wording/card/nar-v${NARRATION_PROMPT_VERSION}/${createHash("sha256").update(buildContext(card, facts)).digest("hex").slice(0, 24)}.json`;
      if (await answerExists(key)) continue;
      const before = spentTotal();
      const b = await cachedDraftEventBriefing(card, facts);
      const p = lastPriced();
      console.log(`  ${card.id}: counted ${p?.inputTokens} in, worst $${p?.worstUsd.toFixed(4)}, billed $${(spentTotal() - before).toFixed(4)} (${b.source}${b.source === "failed" ? `: ${b.failureReason}` : ""})`);
    }
  }
  console.log(`narration: $${spentTotal().toFixed(4)} of $${LIMIT} approved`);
})().catch((e) => { console.error(e?.name === "SpendRefusedError" ? `REFUSED BEFORE THE CALL: ${e.message}` : e); process.exit(1); });
