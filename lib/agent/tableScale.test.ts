/**
 * RULES 67 AND 68, ON FIXTURES. Offline, $0.
 *
 * Both rules come from defects that had already happened three times and
 * twice respectively, so each suite asserts the FAILING SHAPE as well as the
 * fixed one — a rule tested only where it succeeds does not say what it
 * prevents.
 *
 * Run: npx tsx lib/agent/tableScale.test.ts
 */
import { governingScale, scaledAmountString, resolvedAmountUsd, locatorFor } from "./tableScale";
import { withCostScope } from "./costScope";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

/** A filing that declares its scale once and prints bare cells beneath it. */
const FILING = [
  "MERIDIAN HEALTH PARTNERS INC",
  "Note 7 — Short-term and long-term debt",
  // THE ANCHOR IS THE WORD "dollars", NOT THE PARENTHESIS. A bare
  // "(In millions)" is deliberately NOT a scale declaration in this codebase —
  // it could just as easily caption a share count — and [67h] below pins that.
  // My first fixture used the bare form, and the three failures it produced
  // were the FIXTURE being wrong, not the module.
  "(dollars in millions)",
  "Commercial paper $ 592 $ 410",
  "4.500% Senior Notes due 2030 $ 1,000 $ 1,000",
  "Total short-term debt $ 592 $ 410",
  "Total long-term debt $ 30,871 $ 29,400",
].join("\n");

/** The same table with a caption that names no unit of account. */
const BARE_CAPTION_FILING = FILING.replace("(dollars in millions)", "(In millions)");
const loc = locatorFor(FILING);
const parse = (s: string): number | null => {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

console.log("\n=== RULE 67 — one deciding function for a table cell's scale ===\n");
{
  const g = governingScale("$ 592", "Total short-term debt $ 592 $ 410", FILING, loc);
  assert(g.word === "million" && g.reason === "governed-by-caption",
    `[67a] a bare cell takes the scale its table declares — "(In millions)" above it (got ${g.word}/${g.reason})`);
  assert(resolvedAmountUsd("$ 592", "Total short-term debt $ 592 $ 410", FILING, loc, parse) === 592_000_000,
    "[67b] THE FAILING SHAPE, FIXED: a harness read this as 592 DOLLARS and reported a perfect 38-entry transcription of Cigna's 10-K as a failed base tie — '36 rows sum to $0M'");
  assert(scaledAmountString("$ 592", "Total short-term debt $ 592 $ 410", FILING, loc) === "$ 592 million",
    "[67c] and the display form carries the tool's canonical singular, not the caption's inflection");

  const self = governingScale("$ 1.900 billion", "we maintain a $ 1.900 billion revolving facility", FILING, loc);
  assert(self.reason === "self-describing" && self.multiplier === 1,
    "[67d] A CELL THAT NAMES ITS OWN SCALE WINS. The caption cannot override a figure that states its magnitude — that direction turns $1B into $1 quadrillion");
  assert(scaledAmountString("$ 1.900 billion", "we maintain a $ 1.900 billion revolving facility", FILING, loc) === "$ 1.900 billion",
    "[67e] so it renders untouched");

  const nowhere = governingScale("$ 77", "a line that appears in no filing", FILING, loc);
  assert(nowhere.reason === "not-locatable" && nowhere.multiplier === 1,
    "[67f] a sourceLine that cannot be located resolves to NOTHING rather than to a guess");
  assert(resolvedAmountUsd("$ 77", "a line that appears in no filing", FILING, loc, parse) === 77,
    "[67g] and its number is left unscaled rather than silently multiplied — a cell we cannot scale must not become a plausible wrong one");

  // THE DELIBERATE REJECTION, PINNED. A caption naming a magnitude but no unit
  // of account does not scale a dollar figure: "(In millions)" sits above share
  // counts as readily as above money, and this codebase requires the word
  // "dollars" to anchor the match.
  const bareLoc = locatorFor(BARE_CAPTION_FILING);
  const bare = governingScale("$ 592", "Total short-term debt $ 592 $ 410", BARE_CAPTION_FILING, bareLoc);
  assert(bare.reason === "no-declaration" && bare.multiplier === 1,
    `[67h] a bare "(In millions)" with no unit of account does NOT scale — it could caption a share count, and guessing here is how a share number becomes a dollar one (got ${bare.reason})`);
}

console.log("\n=== RULE 68 — a call cannot bill without reaching the ledger ===\n");
async function rule68() {
  const LEDGER = join(process.cwd(), "baselines", "cost-log.jsonl");
  const before = existsSync(LEDGER) ? readFileSync(LEDGER, "utf-8") : "";
  const lines = () => (existsSync(LEDGER) ? readFileSync(LEDGER, "utf-8").trim().split("\n").length : 0);

  const n0 = lines();
  await withCostScope("SYNTHETIC — rule 68 success path", async () => "ok");
  assert(lines() === n0 + 1,
    `[68a] a scope that RETURNS writes exactly one ledger line (${n0} -> ${lines()})`);

  const n1 = lines();
  let threw = false;
  try {
    await withCostScope("SYNTHETIC — rule 68 throwing path", async () => { throw new Error("call failed after the tokens were spent"); });
  } catch { threw = true; }
  assert(threw, "[68b] the error still propagates — persisting is not swallowing");
  assert(lines() === n1 + 1,
    `[68c] AND THE THROWING CASE STILL REACHES THE LEDGER, which is the one that matters: a call that failed after its tokens were consumed has still been paid for, and is the one a human is least likely to record by hand (${n1} -> ${lines()})`);

  // Leave the ledger as it was — a test must not spend the budget's own record.
  writeFileSync(LEDGER, before, "utf-8");
  assert(readFileSync(LEDGER, "utf-8") === before,
    "[68d] and this suite restores the ledger it wrote to, because a test that permanently edits the spend record is corrupting the thing it exists to protect");
}

rule68().then(() => {
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
});
