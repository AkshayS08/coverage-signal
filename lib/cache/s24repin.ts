/**
 * RE-PIN THE SIGNED GOLDENS UNDER FIX 1's IDENTITY. $0 — every golden carries
 * the CompanyResult it was signed from, so nothing is fetched and nothing is
 * asked of a model.
 *
 * Fix 1 narrowed a golden's identity from "every document any of fifteen
 * triggers cited" to "the documents the POSITION rests on". Every signed file
 * on disk stores the old union, so every one of them now reads as pinned to a
 * corpus that moved — while nothing about the position moved at all.
 *
 * THIS IS A RE-PIN, NOT A RE-SIGN, AND THE DIFFERENCE IS THE WHOLE POINT. A
 * re-sign says "the reading changed and a person checked the new one". A
 * re-pin says "the reading is byte-identical and only the definition of what
 * it is pinned TO has changed". Conflating them would put a signature on a
 * state nobody re-read.
 *
 * SO THE POSITION IS PROVED IDENTICAL FIRST. The comparison is run with
 * filingSet neutralised — set equal on both sides — so that the filing-set
 * guard stands aside and EVERY OTHER FIELD is compared: rows, amounts,
 * maturities, provenance, capacity, coverage, tier 2, cards. Only a state that
 * comes back MATCHES is re-pinned. Anything else stops and is reported for a
 * real re-sign by a person.
 *
 * AND A GOLDEN AT AN OLDER EXTRACTION VERSION IS NOT TOUCHED. It is already
 * not-applicable for a reason that has nothing to do with this change, and
 * re-pinning it would silently refresh a file whose captured input answers a
 * different question.
 *
 * Dry run by default. Pass --write to rewrite the files.
 *
 * Run: npx tsx lib/cache/s24repin.ts
 *      npx tsx lib/cache/s24repin.ts --write
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveGoldenState, compareToGolden, positionFilingSetOf, otherCitationsOf, type GoldenFile } from "../events/golden";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const GOLDEN_DIR = join(process.cwd(), "baselines", "golden");
const WRITE = process.argv.includes("--write");

const REPIN_REASON =
  "IDENTITY REDEFINED BY FIX 1, POSITION UNCHANGED. Session 24 narrowed a golden's filing set from the union of " +
  "citations across all fifteen triggers to the documents the POSITION rests on — ladder rows' own citations, the " +
  "anchor, and each facility figure's own `figureSources` document. The old union made an unrelated trigger's " +
  "citation part of a signed position's identity: DaVita's 10-K entered it via `international-expansion` (whose " +
  "quote had FAILED verification and been discarded) and CHS's 8-K via `asset-sale`, each in one run of three, and " +
  "each made the signed position read as incomparable. This file was RE-PINNED, not re-signed: the position state " +
  "was compared field by field with the filing set neutralised and came back identical — rows, amounts, maturities, " +
  "granularity, provenance, capacity flags, coverage, tier 2 and cards all unchanged. No figure was re-read and no " +
  "new attestation is claimed; only the definition of what this signature is pinned TO has changed.";

(async () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort();
  console.log(`\n${"=".repeat(104)}`);
  console.log(`RE-PIN UNDER FIX 1 — ${WRITE ? "WRITING" : "DRY RUN, nothing is written"} — code at v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(104));

  let repinned = 0, skipped = 0, stopped = 0;

  for (const f of files) {
    const path = join(GOLDEN_DIR, f);
    const golden = JSON.parse(readFileSync(path, "utf-8")) as GoldenFile;
    const name = golden.state.company;
    const asOf = new Date(`${golden.state.asOf}T00:00:00Z`);

    console.log(`\n${"─".repeat(104)}`);
    console.log(`${name}   (${f})`);
    console.log("─".repeat(104));

    if ((golden.extractionVersion ?? 0) !== EXTRACTION_PROMPT_VERSION) {
      skipped++;
      console.log(`  NOT RE-PINNED — signed at extraction v${golden.extractionVersion ?? "(unrecorded)"}, code is v${EXTRACTION_PROMPT_VERSION}.`);
      console.log(`  It stays not-applicable for a reason unrelated to this change, and re-pinning it would refresh a`);
      console.log(`  file whose captured input answers a different question.`);
      continue;
    }

    const derived = deriveGoldenState(golden.sourceResult, asOf);
    const oldSet = golden.state.filingSet;
    const newSet = positionFilingSetOf(golden.sourceResult, asOf);
    const others = otherCitationsOf(golden.sourceResult, asOf);

    // THE POSITION, COMPARED WITH IDENTITY NEUTRALISED. Both sides get the
    // same filing set so the guard stands aside and everything else is asked.
    const verdict = compareToGolden(
      { ...golden.state, filingSet: newSet, otherCitations: others },
      { ...derived, filingSet: newSet, otherCitations: others }
    );

    console.log(`  filing set   ${oldSet.length} signed  →  ${newSet.length} position-only`);
    for (const u of newSet) console.log(`      keeps    ${u.split("/").pop()}`);
    for (const u of oldSet.filter((x) => !newSet.includes(x))) console.log(`      moves to otherCitations  ${u.split("/").pop()}`);
    for (const u of newSet.filter((x) => !oldSet.includes(x))) console.log(`      ADDED to identity        ${u.split("/").pop()}   ← was not in the signed set`);
    console.log(`  position state (filingSet neutralised): ${verdict.kind.toUpperCase()}`);
    if (verdict.kind === "diverged") for (const d of verdict.divergences) console.log(`      ${d}`);
    if (verdict.kind === "not-applicable") console.log(`      ${verdict.reason}`);
    if ("tolerated" in verdict && verdict.tolerated.length) {
      for (const t of verdict.tolerated) console.log(`      tolerated: ${t.slice(0, 150)}`);
    }

    if (verdict.kind !== "matches") {
      stopped++;
      console.log(`\n  STOPPED — the position is NOT identical to what was signed. This name needs a REAL re-sign by a`);
      console.log(`  person, not a re-pin. Nothing was written for it.`);
      continue;
    }

    repinned++;
    console.log(`\n  RE-PINNABLE — position byte-identical to the signed state; only the identity definition changed.`);
    if (WRITE) {
      const out: GoldenFile = {
        ...golden,
        signature: { ...golden.signature, basis: `${golden.signature.basis} ${REPIN_REASON}` },
        state: { ...golden.state, filingSet: newSet, otherCitations: others },
      };
      writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
      console.log(`  WRITTEN.`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  re-pinnable ${repinned}   not re-pinned (older version) ${skipped}   STOPPED for a real re-sign ${stopped}`);
  console.log(`  ${WRITE ? "files rewritten" : "DRY RUN — nothing written"}`);
  console.log(`  SPEND: $0.0000 — every golden carries its own captured input.`);
  console.log("=".repeat(104));
})();
