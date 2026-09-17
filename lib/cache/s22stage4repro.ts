/**
 * SESSION 22, STAGE 4 — THE DEMO GATE'S REPRODUCIBILITY RUN. PAID.
 *
 * Cost and result shape declared first, in files/session_22_stage4_declaration.md.
 *
 * CACHE_BUST forces the model to be re-asked at the SAME prompt version on
 * the SAME filings, which is the only way to separate "v29 does not fill this
 * field" from "one cached run happened not to". Deliberately not a version
 * bump: a bump changes what the model is asked, which is the opposite of the
 * controlled comparison this is for.
 *
 * Reports, per run: how many schedule rows carry a section heading, and the
 * ladder's row identities and amounts — because a heading that comes back
 * while the amounts move is not good news, and the run must be able to say so.
 *
 * Run: npx tsx lib/cache/s22stage4repro.ts "Tenet Healthcare" 3
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { normalizeScheduleSequence, assemblePosition, rowIdentityKey, parseMoneyAmount } from "../events/position";
import { priorityClassLabel } from "../events/instrumentClass";
import { currentCompanySpend } from "../agent/costMeter";
import { buildVerifiedFactBase } from "../events/factBase";
import { buildEvents } from "../events/buildEvents";
import { draftEventBriefing } from "../events/sonnetEventBriefing";

/** Value and unit, the same comparison compareToGolden uses — never whitespace. */
function amountKey(raw: string): string {
  const v = parseMoneyAmount(raw);
  if (v === null) return raw.replace(/\s+/g, " ").trim();
  const unit = /(thousand|million|billion|trillion)s?/i.exec(raw);
  return `${v}|${unit ? unit[1].toLowerCase() : "asPrinted"}`;
}

const COMPANY = process.argv[2] ?? "Tenet Healthcare";
const RUNS = Number(process.argv[3] ?? 3);

interface Snap {
  headings: number;
  rows: number;
  distinctHeadings: string[];
  classed: number;
  ladder: string[];
  /** The instrument names, compared separately: drift here is a rename, not a position change. */
  labels: string[];
  /**
   * SESSION 22, v10 — THE CARD BODY, NOT ONLY THE POSITION.
   *
   * A reproducibility run that checks the ladder and stops is checking the
   * half that did not change. The why-now bump rewrote what these cards SAY,
   * and "correct once" is not the same claim as "reproducible" — which is
   * this session's own recurring lesson, so the thing that changed is the
   * thing that gets re-asked three times.
   */
  cards: string[];
  cost: number;
}

(async () => {
  const snaps: Snap[] = [];
  let spend = 0;

  for (let i = 1; i <= RUNS; i++) {
    process.env.CACHE_BUST = `s22-stage4-${i}`;
    const result = await runAgentLoop(COMPANY);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const seqRows = normalizeScheduleSequence(dm?.scheduleSequence).filter((e) => e.kind === "row");
    // MERGED, because `section` and `seniority` are one concept split across
    // two fields and the model puts a given company's class in either.
    // Counting one field is what made this look like a lost field rather
    // than a misread one.
    const withSen = seqRows.filter((e) => [e.section, e.seniority].some((h) => (h ?? "").trim() !== ""));
    const pos = assemblePosition(result, PINNED_AS_OF);
    const facts = buildVerifiedFactBase(result, PINNED_AS_OF);
    const cardBodies: string[] = [];
    for (const card of buildEvents([result], PINNED_AS_OF).flashCardCandidates) {
      const b = await draftEventBriefing(card, facts);
      cardBodies.push(
        `${card.headlineTrigger.triggerId} :: ${b.callAbout} :: ${b.whyNow} :: ${b.keyPoints.join(" | ")}` +
        (b.source === "failed" ? ` :: FAILED(${b.failureReason})` : "")
      );
    }
    // THE METER IS READ AFTER EVERY CALL THIS RUN WILL MAKE, NOT BEFORE.
    //
    // It was read immediately after runAgentLoop and before the narration
    // loop, so it reported the extraction cost and silently omitted every
    // Sonnet call — three demo names came back "$0.0000" for a run that
    // billed. Rule 34's shape in the reporting layer: a cost figure must
    // cover the calls that actually happened, or it is not a cost figure.
    const cost = currentCompanySpend().totalUsd;
    spend += cost;
    snaps.push({
      headings: withSen.length,
      rows: seqRows.length,
      distinctHeadings: [...new Set(withSen.map((e) => (e.section ?? e.seniority ?? "").trim()))],
      classed: pos.rows.filter((r) => r.classification.priorityClass !== null).length,
      // Identity and amount, so a heading returning while the ladder moves
      // underneath it cannot read as a clean result.
      // THE POSITION, AS THE GOLDEN NOW DEFINES IT (Session 22): identity from
      // the facts the filing states, the amount compared by VALUE and unit
      // rather than by its whitespace, and the class. The label is captured
      // separately — it is a transcription worth seeing drift in, and it is
      // not what decides whether two runs hold the same position.
      ladder: pos.rows
        // THE NORMALIZED CLASS, not its verbatim. `priorityClassLabel` returns
        // the filer's own words, which the model transcribes with whatever
        // capitalisation it used that run — "senior secured" against "Senior
        // secured" is one class written two ways, and it drives the same rank
        // and the same sort position. The verbatim still renders (Rule 32) and
        // still gets compared, in `labels`, where a transcription belongs.
        .map((r) => `${rowIdentityKey(r)} | ${amountKey(r.amount)} | ${r.classification.priorityClass ?? "none"}`)
        .sort(),
      labels: pos.rows.map((r) => `${r.instrument} :: ${priorityClassLabel(r.classification)}`).sort(),
      cards: cardBodies,
      cost,
    });
    console.log(`\n  RUN ${i}: ${withSen.length} of ${seqRows.length} rows carry a heading  ($${cost.toFixed(4)})`);
    if (withSen.length) console.log(`         headings: ${snaps[i - 1].distinctHeadings.map((h) => `"${h}"`).join(", ")}`);
  }
  delete process.env.CACHE_BUST;

  console.log(`\n${"=".repeat(100)}\n${COMPANY} — ${RUNS} CACHE_BUST re-asks at v29\n${"=".repeat(100)}`);
  console.log(`  headings per run: ${snaps.map((s) => `${s.headings}/${s.rows}`).join("  ")}`);
  console.log(`  ladder rows with a class: ${snaps.map((s) => s.classed).join("  ")}`);

  const headingCounts = new Set(snaps.map((s) => s.headings));
  const verdict =
    headingCounts.size > 1
      ? "MIXED — extraction variance. The gate fails on reproducibility whichever run is prettiest."
      : snaps[0].headings === 0
        ? (snaps[0].rows === 0
            ? "NOT APPLICABLE — this filer's note prints no table rows at all, so there are no headings to carry. Its class comes from instrument names."
            : "SYSTEMATIC — no run fills a heading for this filer, in either field.")
        : "REPRODUCIBLE — every run fills the same number of headings, across the merged section/seniority pair.";
  console.log(`\n  HEADING VERDICT: ${verdict}`);

  // The larger question the declaration required: is anything ELSE moving?
  // THE CARDS FIRST, because they are what this bump changed.
  const cardTexts = snaps.map((s) => s.cards.join("\n"));
  const cardsStable = cardTexts.every((c) => c === cardTexts[0]);
  // WORDING AND SUBSTANCE ARE DIFFERENT CLAIMS, and only one of them was ever
  // promised. Session 21 established it in as many words — "the position
  // reproduces, the presentation does not" — because determinism here comes
  // from the wording cache, not from the model: re-ask Sonnet and the verb
  // moves. What must hold across re-asks is the REASON, which is what v10
  // changed: every run's why-now must rest on an event and none on a balance.
  const BALANCE_REASON = /(?:cash and cash equivalents|cash balance|cash on hand|cash position)|cash\s+(?:grew|rose|increased)|drawn\s+balance/i;
  const whyNows = snaps.map((s) => s.cards.map((c) => c.split(" :: ")[2] ?? ""));
  const anyBalance = whyNows.flat().filter((w) => BALANCE_REASON.test(w));
  console.log(`  WHY-NOW SUBSTANCE: ${anyBalance.length === 0 ? `no run rests a why-now on a balance (${whyNows.flat().filter(Boolean).length} why-now(s) across ${RUNS} runs)` : `${anyBalance.length} why-now(s) REST ON A BALANCE`}`);
  for (const w of anyBalance) console.log(`      >>> ${w.slice(0, 170)}`);
  console.log(`  CARD STABILITY  : ${cardsStable ? `identical across all runs — ${snaps[0].cards.length} card(s), same callAbout/whyNow/keyPoints` : "MOVED BETWEEN RUNS"}`);
  if (cardsStable) {
    for (const c of snaps[0].cards) console.log(`      ${c.slice(0, 190)}`);
  } else {
    for (let i = 0; i < snaps.length; i++) {
      console.log(`\n  --- run ${i + 1} cards ---`);
      for (const c of snaps[i].cards) console.log(`    ${c.slice(0, 190)}`);
    }
  }

  const ladders = snaps.map((s) => s.ladder.join("\n"));
  const ladderStable = ladders.every((l) => l === ladders[0]);
  const labelSets = snaps.map((x) => x.labels.join(" || "));
  const labelsStable = labelSets.every((l) => l === labelSets[0]);
  if (ladderStable && !labelsStable) {
    console.log("  LABEL DRIFT     : the same rows under different names across runs — a rename, not a position change");
    for (let i = 0; i < snaps.length; i++) console.log(`      run ${i + 1}: ${snaps[i].labels.join(" / ")}`);
  }
  console.log(`  LADDER STABILITY: ${ladderStable ? "identical across all runs — row set, amounts and classes all reproduce" : "MOVED between runs — see below; this is worse than the heading"}`);
  if (!ladderStable) {
    for (let i = 0; i < snaps.length; i++) {
      console.log(`\n  --- run ${i + 1} ladder ---`);
      for (const l of snaps[i].ladder) console.log(`    ${l}`);
    }
  }
  console.log(`\n  SPEND THIS RUN: $${spend.toFixed(4)}`);
  console.log("=".repeat(100));
})();
