/**
 * SESSION 19 — THE LINE-LEVEL BASELINE WRITER.
 *
 * "Persist line-level output after each run so the next diff has a baseline"
 * is a standing constraint of this project, and until now it was satisfied by
 * redirecting a script's stdout to a file. See bookSnapshot.ts for why that
 * is not a baseline of the product.
 *
 * This writes the SAME bytes the determinism harnesses compare, produced by
 * the same function, so the two mechanisms cannot drift apart. Zero model
 * calls when the book is cached; it is the same read the harnesses do.
 *
 * Run: npm run baseline -- <label> ["Company A,Company B"]
 *   label   goes in the filename, e.g. "pre-run-a"
 *   book    defaults to both books, all ten
 */
import { loadEnvQuietly, captureBookSnapshot } from "./bookSnapshot";
loadEnvQuietly();
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatPassErrors, runPassWithRetries } from "./passHarness";

const BOTH_BOOKS = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

const OUT_DIR = "baselines";

async function main() {
  const label = (process.argv[2] || "").trim();
  if (!label || !/^[a-z0-9][a-z0-9-]*$/i.test(label)) {
    console.error('usage: npm run baseline -- <label> ["Company A,Company B"]   (label: letters, digits, dashes)');
    process.exit(1);
  }
  const companies = process.argv[3] ? process.argv[3].split(",").map((s) => s.trim()).filter(Boolean) : BOTH_BOOKS;

  // A baseline captured from a pass that did not complete is not a baseline;
  // it is a partial book that the next diff would read as deletions.
  const pass = await runPassWithRetries(() => captureBookSnapshot(companies));
  for (const line of formatPassErrors(pass.errors)) console.error(line);
  if (pass.status !== "clean") {
    // SESSION 20 (1b): INCOMPLETE now covers narration as well as fetches.
    // One rule on two surfaces — a company attempted and failed renders as
    // a failed attempt, and a baseline is written only from a clean pass.
    // Session 19 shipped s19-final.json carrying Tenet's card as
    // `source: "failed"`; the determinism runs that followed healed it, so
    // the persisted reference described a book that never shipped.
    console.error(`
⊘ INCOMPLETE after ${pass.attempts} attempts — no baseline written. A pass that could not complete cleanly is not a reference: a partial book reads as deletions in the next diff, and a healed failure reads as a change that never happened.`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${label}.json`);
  writeFileSync(path, pass.json, "utf8");
  // The as-of date sits beside the bytes, not inside them: a byte-identity
  // comparison is only valid between captures sharing one, and a diff across
  // two must say so rather than report a month rollover as a regression.
  writeFileSync(join(OUT_DIR, `${label}.meta.json`), JSON.stringify({ asOf: pass.asOf, companies, bytes: pass.json.length, attempts: pass.attempts }, null, 2), "utf8");
  console.error(`wrote ${path} — ${pass.json.length} bytes, ${companies.length} companies, as-of ${pass.asOf}, ${pass.elapsedMs}ms, ${pass.hitSummary}`);
}

main();
