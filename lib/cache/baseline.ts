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
    console.error(`\n⊘ INCOMPLETE after ${pass.attempts} attempts — no baseline written. A partial book would read as deletions in the next diff.`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${label}.json`);
  writeFileSync(path, pass.json, "utf8");
  console.error(`wrote ${path} — ${pass.json.length} bytes, ${companies.length} companies, ${pass.elapsedMs}ms, ${pass.hitSummary}`);
}

main();
