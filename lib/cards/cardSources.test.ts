/**
 * EVERY SENTENCE A CARD LINKS TO IS IN THE DOCUMENT IT LINKS TO.
 *
 * cards.test.ts proves each sentence states its figure, date or label. This
 * proves the other half: the sentence is really in the filing the link opens,
 * located by the same text locator quote verification uses. A real sentence
 * cited to the wrong document is Rule 44's defect.
 *
 * NOT OFFLINE: reads filing text from the document cache. Zero model calls.
 *
 * Run: npx tsx lib/cards/cardSources.test.ts
 */
import { loadEnvQuietly } from "../cache/loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getFilingText } from "../fetch/filingText";
import { createTextLocator } from "../agent/verifyQuote";
import type { Card, Line, Segment, Source } from "./types";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const cards: Card[] = JSON.parse(readFileSync(join(process.cwd(), "lib", "cards", "generated", "all.json"), "utf-8"));

function sourcesOf(card: Card): Source[] {
  const lines: Line[] = [...card.header];
  for (const s of [card.thisWeek, card.headlines.totalDebt, card.headlines.liquidity, card.headlines.due24, card.ladder, card.facilities, card.withheld, card.coverage]) {
    lines.push(...s.lines);
    for (const b of s.blocks ?? []) lines.push(b.heading, ...b.lines);
  }
  const out: Source[] = [];
  for (const seg of lines.flat() as Segment[]) {
    if ("src" in seg) out.push(seg.src);
    if (seg.k === "computed") out.push(...seg.parts.map((p) => p.src));
  }
  return out;
}

(async () => {
  const locators = new Map<string, ReturnType<typeof createTextLocator>>();
  for (const card of cards) {
    const srcs = sourcesOf(card);
    const unique = [...new Map(srcs.map((s) => [`${s.url}|${s.sentence}`, s])).values()];
    const missing: string[] = [];
    for (const s of unique) {
      if (!locators.has(s.url)) locators.set(s.url, createTextLocator((await getFilingText(s.url)).text));
      if (locators.get(s.url)!.find(s.sentence) === null) missing.push(`${s.doc}: "${s.sentence.slice(0, 100)}"`);
    }
    assert(missing.length === 0, `[1:${card.company}] all ${unique.length} distinct linked sentences are found in the document they link to${missing.length ? ":\n        " + missing.slice(0, 6).join("\n        ") : ""}`);
  }
  // Negative control: a sentence that is in no filing must not be found.
  const any = [...locators.values()][0];
  assert(!!any && any.find("This sentence was written by a test and appears in no filing anywhere.") === null, "[2] the locator rejects a sentence that is in no filing (it can fail)");
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
})();
