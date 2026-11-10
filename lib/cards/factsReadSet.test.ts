/**
 * SESSION 27 (Akshay, Nov 9, 2026) — DECISION 11: THE FACTS STAGE READS THE SAME READ SET AS EXTRACTION.
 *
 * One deciding function names the debt-item 8-Ks (Items 1.01, 1.02, 2.03, 2.04, 8.01) filed since the latest 10-K
 * (lib/cache/readSet.ts debtEightKsSinceTenK); the card input records them (captureCardInput) and the facts stage
 * reads them, beside the anchor and the filings after it. Tenet's Sept 8 and Sept 22 8-Ks state days and funding its
 * 10-Q gives by month; the facts stage never saw them.
 *   D1  captureCardInput and the facts stage use the one function (no second list)
 *   D2  over every card that can be shown or signed: the facts input holds a document block for every debt-item 8-K
 *       the card input records
 *   D3  control: the facts input built without them is flagged
 *
 * $0 (the facts stage writes its inputs with --dump and calls nothing). Run: npx tsx lib/cards/factsReadSet.test.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { shownCards, everyShownCard } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

const snapshotSrc = readFileSync(join("lib", "cards", "capture", "snapshot.ts"), "utf-8");
const factsSrc = readFileSync(join("lib", "cards", "capture", "facts.ts"), "utf-8");
assert(/debtEightKsSinceTenK\(/.test(snapshotSrc) && !/const DEBT_ITEMS = \[/.test(snapshotSrc), `[D1] captureCardInput names the debt-item 8-Ks through debtEightKsSinceTenK, with no list of its own`);
assert(/debtEightKs/.test(factsSrc), `[D1] the facts stage reads the debt-item 8-Ks the card input records`);

const dir = join(process.env.TEMP ?? ".", "factsReadSet");
mkdirSync(dir, { recursive: true });
const factsInput = (inputPath: string, tag: string): string => {
  const out = join(dir, tag);
  mkdirSync(out, { recursive: true });
  execFileSync("npx", ["tsx", "lib/cards/capture/facts.ts", "2026-11-09", "--input", inputPath, "--dump", out], { env: { ...process.env, ANTHROPIC_API_KEY: "" }, shell: true, stdio: "ignore" });
  const cik = JSON.parse(readFileSync(inputPath, "utf-8")).cik;
  const f = join(out, `input-${cik}.txt`);
  return existsSync(f) ? readFileSync(f, "utf-8") : "";
};
const blocksFor = (text: string, urls: string[]) => urls.filter((u) => !text.includes(`| ${u} ---`));

const shown = nonEmpty("the cards that can be shown or signed", shownCards());
for (const s of shown) {
  const eightKs = (s.input.debtEightKs ?? []).filter((e: any) => s.input.docs[e.url]).map((e: any) => e.url as string);
  if (!eightKs.length) { assert(true, `[D2:${s.card.company} ${s.label}] no debt-item 8-K since the latest 10-K to read`); continue; }
  const missing = blocksFor(factsInput(s.inputPath, s.key.replace(":", "_")), eightKs);
  assert(missing.length === 0, `[D2:${s.card.company} ${s.label}] the facts input holds all ${eightKs.length} debt-item 8-K(s)${missing.length ? ` — missing: ${missing.map((u) => u.split("/").pop()).join(", ")}` : ""}`);
}

console.log("\n=== control ===");
// Control material: read from every card, whatever the scope (releaseGate.test R4).
const ten = everyShownCard().find((s) => s.cik === "0000070318" && s.label === "review") ?? everyShownCard().find((s) => s.cik === "0000070318")!;
const stripped = JSON.parse(JSON.stringify(ten.input)); const want = (stripped.debtEightKs ?? []).map((e: any) => e.url); delete stripped.debtEightKs;
const p = join(dir, "control-input.json"); writeFileSync(p, JSON.stringify(stripped));
assert(blocksFor(factsInput(p, "control"), want).length > 0, `[D3 control] Tenet's facts input built without its debt-item 8-Ks is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
