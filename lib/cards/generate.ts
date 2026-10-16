/**
 * GENERATE THE SIX DEMO CARDS — from committed inputs only.
 *
 * Reads, and reads nothing else:
 *   lib/cards/inputs/<cik>.json             the card input snapshot (capture/snapshot.ts)
 *   lib/cards/inputs/week/<brief>.json      this week's filings (capture/week.ts)
 *   lib/cards/inputs/facts/<cik>.json       verified card facts, where captured (capture/facts.ts)
 *   baselines/briefs.jsonl                  the brief log
 *
 * It cannot reach the extraction loop, a model, the blob store or the
 * network (asserted by acceptance.test.ts §5.1), so generating a card cannot
 * bill, and a filing that lands later reaches a card only through the week
 * file — its This-week lines.
 *
 * Run: npx tsx lib/cards/generate.ts [briefDate]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCard } from "./build";
import { recordBrief } from "./briefLog";

/** card_spec 1: the six, in the spec's order. */
const ORDER = ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"];
const ROOT = process.cwd();
const BRIEF = process.argv[2] ?? "2026-10-15";
const IN = join(ROOT, "lib", "cards", "inputs");
const OUT = join(ROOT, "lib", "cards", "generated");

const week = JSON.parse(readFileSync(join(IN, "week", `${BRIEF}.json`), "utf-8"));
mkdirSync(OUT, { recursive: true });
const written: string[] = [];
for (const cik of ORDER) {
  const snap = JSON.parse(readFileSync(join(IN, `${cik}.json`), "utf-8"));
  const factsPath = join(IN, "facts", `${cik}.json`);
  const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf-8")) : null;
  const w = week.names[cik];
  const textByUrl = new Map<string, string>(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text]));
  const card = buildCard({
    result: snap.result,
    briefDate: BRIEF,
    previousBrief: w?.previousBrief ?? null,
    weekFilings: w?.filings ?? [],
    cash: snap.cash,
    textByUrl,
    periodSentence: snap.periodSentence,
    facts,
  });
  writeFileSync(join(OUT, `${cik}.json`), JSON.stringify(card, null, 1) + "\n", "utf-8");
  recordBrief({ cik, company: snap.company, briefDate: BRIEF });
  written.push(cik);
  console.log(`  ${snap.company}: card written (${(w?.filings ?? []).length} filing(s) this week)`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ briefDate: BRIEF, ciks: written }, null, 1) + "\n", "utf-8");
writeFileSync(join(OUT, "all.json"), JSON.stringify(written.map((c) => JSON.parse(readFileSync(join(OUT, `${c}.json`), "utf-8")))) + "\n", "utf-8");
console.log(`\n${written.length} cards for the brief of ${BRIEF}, from committed inputs only.`);
