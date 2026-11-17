/**
 * SESSION 27 (Akshay, Nov 16): ALL SIX CANDIDATE CARDS AGAINST PRODUCTION, $0. Each candidate is rendered from its input
 * recaptured through the read set and its facts re-read over that full read set (not adopted); CHS is its Stage 2
 * refresh (brief of Nov 16). Each is diffed against production's card (origin/main) and run through the card's own
 * checks: facts valid for its read set, the trust rule, move integrity, no pending move shown as done. Writes
 * sessions/27/candidates/<cik>.json, <cik>.md and summary.md. Nothing under lib/cards is written; nothing is released.
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27candidates.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { buildCard } from "../cards/build";
import { factsValidFor } from "../cards/factsValidity";
import { moveIntegrityViolations } from "../cards/moveIntegrity";
import { pendingShownAsDone } from "../cards/pendingMoves";
import { visibleDiff } from "./s27cardDiff";

if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
const OUT = "sessions/27/candidates";
mkdirSync(OUT, { recursive: true });
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const BRIEF = "2026-11-09";
const week = read(join("lib", "cards", "inputs", "week", `${BRIEF}.json`));
const SOURCES: Record<string, { input: string; facts: string; card?: string; note: string }> = {
  "0000070318": { input: "sessions/27/facts_full/0000070318/input.json", facts: "sessions/27/facts_full/0000070318/0000070318.json", note: "facts re-read Nov 16 over the full read set" },
  "0000785161": { input: "sessions/27/facts_full/0000785161/input.json", facts: "sessions/27/facts_full/0000785161/0000785161.json", note: "facts re-read Nov 16 over the full read set" },
  "0001179929": { input: "sessions/27/facts_full/0001179929/input.json", facts: "sessions/27/facts_full/0001179929/0001179929.json", note: "facts re-read Nov 16 over the full read set" },
  "0000927066": { input: "sessions/27/facts_full/0000927066/input.json", facts: "sessions/27/facts_full/0000927066/0000927066.json", note: "facts re-read Nov 16 over the full read set" },
  "0001108109": { input: "sessions/27/chs_refresh_v3/input.json", facts: "sessions/27/chs_refresh_v3/facts.json", card: "sessions/27/chs_refresh_v3/card.json", note: "the Stage 2 refresh on the Nov 10 8-K (brief of Nov 16), facts re-derived by identity from the paid reads" },
  "0001739940": { input: "sessions/27/cigna_facts/input.json", facts: "sessions/27/cigna_facts/0001739940.json", note: "facts re-read Nov 16, re-derived by identity from the paid reads" },
};
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const summary = [`# The six candidate cards against production (origin/main)`, ``, `Not adopted, not regenerated, not released.`, ``, `| Card | Facts valid for its read set | Checks | Move integrity | Pending shown as done | Moves (candidate / production) |`, `|---|---|---|---|---|---|`];
for (const [cik, s] of Object.entries(SOURCES)) {
  const input = read(s.input), facts = read(s.facts);
  const w = week.names[cik];
  const card = s.card ? read(s.card) : buildCard({ result: input.result, briefDate: BRIEF, previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
  const prod = JSON.parse(execSync(`git show origin/main:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 }));
  const anchorUrl = input.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
  const valid = factsValidFor(facts, input.result, anchorUrl);
  const mi = moveIntegrityViolations(card, input);
  const miCount = Object.values(mi).reduce((n, v) => n + v.length, 0);
  const pend = pendingShownAsDone(card, facts);
  writeFileSync(join(OUT, `${cik}.json`), JSON.stringify(card, null, 1) + "\n");
  writeFileSync(join(OUT, `${cik}.md`), [`# ${prod.company}: candidate (${s.note}) against production`, ``, `Facts valid for the read set: ${valid}. Card checks: ${card.v3?.checks === "failed" ? "FAILED (breakage)" : "hold"}. Move integrity: ${miCount ? Object.entries(mi).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join("; ")}`).join(" | ") : "holds"}. Pending shown as done: ${pend.length ? pend.join("; ") : "none"}.`, ``, ...visibleDiff(prod, card)].join("\n") + "\n");
  const mv = (c: any) => (c.v3?.moves ?? []).map((m: any) => txt(m.meta)).join("; ") || (c.v3?.movesUnread ? "not yet read" : "none");
  summary.push(`| ${prod.company} | ${valid ? "yes" : "**no**"} | ${card.v3?.checks === "failed" ? "**failed**" : "hold"} | ${miCount ? `**${miCount} issue(s)**` : "holds"} | ${pend.length ? `**${pend.length}**` : "none"} | ${mv(card)} / ${mv(prod)} |`);
  console.log(`${prod.company}: valid ${valid}; checks ${card.v3?.checks ?? "hold"}; integrity ${miCount}; pending-as-done ${pend.length}`);
}
writeFileSync(join(OUT, "summary.md"), summary.join("\n") + "\n");
