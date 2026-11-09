/**
 * SESSION 27 — A REVIEW RENDER THAT IS NOT THE COMMITTED CARD. $0.
 *
 * Builds a name's card from a given answer at the current brief (briefDateArg)
 * with its own live inputs (captureCardInput: the answer's documents, tagged
 * cash at its period end, its period sentence, later filings) and this brief
 * week's filings, and writes it to sessions/27/<name>_review_card.json with the
 * visible differences from the committed card. It never writes
 * lib/cards/inputs or lib/cards/generated, and records no brief.
 *
 * Verified card facts are a separate billed extraction (capture/facts.ts);
 * the committed facts were read from the previous anchor, so the review card
 * is built WITHOUT facts, and says so.
 *
 * Molina's refresh: ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/preview.ts molina
 * A batch refresh:  ANTHROPIC_API_KEY="" npx tsx lib/cards/capture/preview.ts <cik>   (baselines/s27-refresh-batch.json)
 */
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildCard } from "../build";
import { captureCardInput } from "./snapshot";
import { briefDateArg, briefWeek } from "../briefDate";
import { previousBrief, readBriefLog } from "../briefLog";
import { liveFilingsBetween } from "../../fetch/thisWeek";
import { visibleDiff } from "../../cache/s27cardDiff";

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
  const which = process.argv[2];
  if (!which) { console.error("usage: preview.ts molina | <cik>"); process.exit(1); }
  const isMolina = which === "molina";
  // Nov 6: a refresh run may have its own record (Encompass: baselines/s27-encompass-refresh.json).
  const refresh = isMolina ? JSON.parse(readFileSync("baselines/s27-molina-refresh.json", "utf-8")) : (() => { const b = ["baselines/s27-refresh-batch.json", "baselines/s27-encompass-refresh.json", "baselines/s27-cigna-refresh.json"].filter((p) => existsSync(p)).flatMap((p) => JSON.parse(readFileSync(p, "utf-8")).names).find((n: any) => n.cik === which); if (!b) throw new Error(`${which} is not in the refresh batch`); return { boundFingerprint: b.boundFingerprint, results: b.samples }; })();
  const result = refresh.results.find((x: any) => x.bust === null).result;
  const dir = isMolina ? "sessions/27" : "sessions/27/refresh";
  const stem = isMolina ? "molina" : result.cik;
  const brief = briefDateArg();
  const prev = previousBrief(readBriefLog(), result.cik, brief);
  const week = briefWeek(brief, prev);
  const input = await captureCardInput(result, { fingerprint: refresh.boundFingerprint, commit: execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(), source: `REVIEW RENDER of the refreshed v33 answer (${result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.form} filed ${result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.date}); not the committed card`, briefDate: brief });
  writeFileSync(`${dir}/${isMolina ? "molina_review_input" : `${stem}_input`}.json`, JSON.stringify(input) + "\n");
  // The refresh's own facts stage (capture/facts.ts --input that file --out <dir>), where run.
  const factsPath = isMolina ? `sessions/27/molina_review_facts/${result.cik}.json` : `sessions/27/refresh/facts/${result.cik}.json`;
  const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf-8")) : null;
  const weekFilings = await liveFilingsBetween(result.cik, week.from, week.to);
  const card = buildCard({
    result, briefDate: brief, previousBrief: prev, weekFilings, cash: input.cash,
    textByUrl: new Map(Object.entries(input.docs).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence,
    laterUrls: input.laterFilings.filter((x) => x.filingDate <= brief).map((x) => x.url), facts,
  });
  writeFileSync(`${dir}/${stem}_review_card.json`, JSON.stringify(card, null, 1) + "\n");
  const current = JSON.parse(readFileSync(`lib/cards/generated/${result.cik}.json`, "utf-8"));
  const lines = [
    `# ${result.company}: the refreshed card against the committed card`,
    ``,
    `Review render, not committed (${(input as any).source}). Brief ${brief} (week ${week.from} to ${week.to}; previous brief ${prev}). Week filings: ${weekFilings.map((f) => `${f.form} ${f.filingDate}${f.items ? ` [${f.items}]` : ""}`).join("; ") || "none"}.`,
    facts ? `Verified card facts: read from ${facts.anchorUrl === (result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.url) ? `this anchor (the ${result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.form} filed ${result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.date})` : "ANOTHER anchor, so not used"} ($${facts.costUsd}).` : `Verified card facts: not yet read from this anchor; those sections say so.`,
    ``,
    ...visibleDiff(current, card),
  ];
  writeFileSync(`${dir}/${isMolina ? "molina_refresh" : stem}_visible_diff.md`, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
