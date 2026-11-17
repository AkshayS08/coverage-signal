/**
 * SESSION 27 (Akshay, Nov 16): A PUBLISHED CARD NEVER CHANGES SILENTLY. For each published card, what today's code
 * renders against the card in production (lib/cards/generated at origin/main, the last release), at $0, writing
 * nothing under lib/cards:
 *   - "regenerated": the committed input and facts, as lib/cards/generate.ts would render them today
 *   - Cigna "with its re-read facts": its input recaptured through the read set and the facts re-read Nov 16
 *     (sessions/27/cigna_facts), not adopted
 * Writes sessions/27/published_impact/<cik>.md and summary.md.
 *
 *   ANTHROPIC_API_KEY="" npx tsx lib/cache/s27publishedImpact.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { buildCard } from "../cards/build";
import { visibleDiff } from "./s27cardDiff";

if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY=""'); process.exit(1); }
const OUT = "sessions/27/published_impact";
mkdirSync(OUT, { recursive: true });
const index = JSON.parse(readFileSync("lib/cards/generated/index.json", "utf-8"));
const BRIEF: string = index.briefDate;
const week = JSON.parse(readFileSync(join("lib", "cards", "inputs", "week", `${BRIEF}.json`), "utf-8"));
const render = (snap: any, facts: any, cik: string) => {
  const w = week.names[cik];
  return buildCard({ result: snap.result, briefDate: BRIEF, previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
};
const summary = [`# Published cards: what today's code renders against the cards in production (origin/main; brief of ${BRIEF})`, ``, `Nothing here is published or written to lib/cards/generated.`, ``];
for (const cik of index.ciks as string[]) {
  const pub = JSON.parse(execSync(`git show origin/main:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64e6 }));
  const snap = JSON.parse(readFileSync(`lib/cards/inputs/${cik}.json`, "utf-8"));
  const fp = `lib/cards/inputs/facts/${cik}.json`;
  const card = render(snap, existsSync(fp) ? JSON.parse(readFileSync(fp, "utf-8")) : null, cik);
  const diff = visibleDiff(pub, card);
  const parts = [`# ${pub.company}: regenerated from the committed input and facts`, ``, ...diff];
  if (cik === "0001739940" && existsSync("sessions/27/cigna_facts/0001739940.json")) {
    const reread = render(JSON.parse(readFileSync("sessions/27/cigna_facts/input.json", "utf-8")), JSON.parse(readFileSync("sessions/27/cigna_facts/0001739940.json", "utf-8")), cik);
    writeFileSync("sessions/27/cigna_facts/card.json", JSON.stringify(reread, null, 1) + "\n");
    parts.push(``, `# ${pub.company}: with its facts re-read Nov 16 (not adopted), over its input recaptured through the read set`, ``, ...visibleDiff(pub, reread));
  }
  writeFileSync(join(OUT, `${cik}.md`), parts.join("\n") + "\n");
  const sections = diff.filter((l) => /^- \*\*/.test(l)).map((l) => l.replace(/^- \*\*|\*\*$/g, ""));
  summary.push(`- **${pub.company}**: ${sections.length ? sections.join(", ") : "no visible change"}`);
  console.log(`${pub.company}: ${sections.length ? sections.join(", ") : "no visible change"}`);
}
writeFileSync(join(OUT, "summary.md"), summary.join("\n") + "\n");
