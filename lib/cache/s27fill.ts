/**
 * SESSION 27 — THE TWO APPROVED FILLS (Akshay, Oct 23, 2026). BILLS.
 *
 *   1. Tenet's proceeds-use answer, paid for in the canonical run and lost to
 *      a swallowed write: up to $0.064. Its base answer is cached; only the
 *      Sonnet proceeds-use call may bill.
 *   2. The Sonnet narration pass that makes the determinism test $0: up to
 *      $0.0476, priced as two cards (Tenet's 5.125% 2027 card, DaVita's new
 *      issuance) at the determinism test's pinned as-of date.
 *
 * THE GATE. Before: all six base answers cached, so no extraction can bill.
 * Fill 1: bills non-zero, Sonnet only, within $0.064, and leaves Tenet's
 * proceedsUse set. Before fill 2, the misses are counted again ($0, HEAD
 * only) and must be the two priced; during it the running narration spend
 * may not pass $0.0476 (checked before each card is drawn). Every call is in
 * the ledger: the loop's line for fill 1, a "(narration)" line per card.
 *
 * Run: S27_APPROVED=fill npx tsx lib/cache/s27fill.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";
import { buildEvents, buildVerifiedFactBase } from "../events";
import { buildContext } from "../events/sonnetEventBriefing";
import { cachedDraftEventBriefing } from "./wordingCache";
import { NARRATION_PROMPT_VERSION } from "./promptVersion";
import { answerExists, assertFree } from "./freeRun";

const PROCEEDS_CEILING = 0.064;
const NARRATION_CEILING = 0.0476;
const NARRATION_AS_OF = new Date("2026-09-01T00:00:00Z");
const PRICED_MISSES = ["TENET HEALTHCARE CORP::debt-maturity::5.125%::2027::1500000000", "DAVITA INC.::new-debt-issuance"];
const NAMES = ["TENET HEALTHCARE CORP", "Encompass Health Corp", "DAVITA INC.", "COMMUNITY HEALTH SYSTEMS INC", "MOLINA HEALTHCARE, INC.", "Cigna Group"];
const LEDGER = "baselines/cost-log.jsonl";
const ledgerLines = () => readFileSync(LEDGER, "utf-8").trim().split("\n");
const stop = (why: string): never => { console.error(`STOPPED: ${why}`); process.exit(1); };

(async () => {
  if (process.env.S27_APPROVED !== "fill") stop("this bills; set S27_APPROVED=fill only after Akshay's approval");
  if (!process.env.ANTHROPIC_API_KEY) stop("no API key in the environment");
  await assertFree(NAMES.map((company) => ({ company })));
  console.log("GATE before: all six base answers cached; no extraction can bill.");

  // ── fill 1: Tenet's proceeds-use ──
  const l0 = ledgerLines().length;
  const tenet = await runAgentLoop("TENET HEALTHCARE CORP");
  const s1 = currentCompanySpend();
  const pu = tenet.results.find((t) => t.triggerId === "new-debt-issuance")?.proceedsUse ?? null;
  const models = s1.byModel.map((m) => m.model);
  console.log(`fill 1: Tenet proceeds-use $${s1.totalUsd.toFixed(4)} (ceiling $${PROCEEDS_CEILING}), models ${models.join(", ") || "none"}, proceedsUse now ${pu}`);
  if (s1.totalUsd === 0) stop("fill 1 billed $0: the proceeds-use answer came from somewhere other than this call");
  if (s1.totalUsd > PROCEEDS_CEILING) stop(`fill 1 billed $${s1.totalUsd.toFixed(4)}, over its approved $${PROCEEDS_CEILING}`);
  if (models.some((m) => !/sonnet/.test(m))) stop(`fill 1 billed a model other than Sonnet (${models.join(", ")}): an extraction was not cached`);
  if (!pu) stop("fill 1 billed but proceedsUse is still empty");
  if (ledgerLines().length <= l0) stop("fill 1 billed but wrote no ledger line");

  // ── fill 2: the narration pass ──
  const misses: { company: string; id: string }[] = [];
  const plan: { company: string; result: any; cards: any[]; facts: any }[] = [];
  for (const company of NAMES) {
    const result = await runAgentLoop(company);
    if (currentCompanySpend().totalUsd > 0) stop(`${company}'s replay billed $${currentCompanySpend().totalUsd.toFixed(4)}; the six must be cached`);
    const { flashCardCandidates } = buildEvents([result], NARRATION_AS_OF);
    const facts = buildVerifiedFactBase(result, NARRATION_AS_OF);
    for (const card of flashCardCandidates) {
      const key = `wording/card/nar-v${NARRATION_PROMPT_VERSION}/${createHash("sha256").update(buildContext(card, facts)).digest("hex").slice(0, 24)}.json`;
      if (!(await answerExists(key))) misses.push({ company, id: card.id });
    }
    plan.push({ company, result, cards: flashCardCandidates, facts });
  }
  console.log(`GATE before fill 2: ${misses.length} narrated card(s) miss: ${misses.map((m) => m.id).join("; ") || "none"}`);
  if (misses.length > PRICED_MISSES.length || misses.some((m) => !PRICED_MISSES.includes(m.id))) stop(`the misses are not the ${PRICED_MISSES.length} priced: ${misses.map((m) => m.id).join("; ")}`);

  let narration = 0;
  const l1 = ledgerLines().length;
  for (const p of plan) for (const card of p.cards) {
    if (!misses.some((m) => m.id === card.id)) { await cachedDraftEventBriefing(card, p.facts); continue; } // a hit, $0
    if (narration > NARRATION_CEILING) stop(`narration spend $${narration.toFixed(4)} passed its approved $${NARRATION_CEILING} before ${card.id}`);
    const before = ledgerLines().length;
    const b = await cachedDraftEventBriefing(card, p.facts);
    const added = ledgerLines().slice(before).map((l) => JSON.parse(l)).filter((j) => /\(narration\)$/.test(j.company));
    const usd = added.reduce((a, j) => a + (j.totalUsd ?? 0), 0);
    narration += usd;
    console.log(`  narration ${card.id}: $${usd.toFixed(4)} (${b.source})`);
    if (b.source !== "sonnet") stop(`${card.id} narration did not succeed (${b.source}); not cached, so the determinism test is not yet $0`);
  }
  const narrLines = ledgerLines().slice(l1).map((l) => JSON.parse(l)).filter((j) => /\(narration\)$/.test(j.company));
  console.log(`fill 2: narration $${narration.toFixed(4)} (ceiling $${NARRATION_CEILING}) across ${narrLines.length} ledger line(s)`);
  if (narration > NARRATION_CEILING) stop(`narration billed $${narration.toFixed(4)}, over its approved $${NARRATION_CEILING}`);
  console.log(`TOTAL: $${(s1.totalUsd + narration).toFixed(4)} of $${(PROCEEDS_CEILING + NARRATION_CEILING).toFixed(4)} approved.`);
})().catch((e) => { console.error(e); process.exit(1); });
