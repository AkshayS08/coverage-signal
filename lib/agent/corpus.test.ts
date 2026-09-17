/**
 * SESSION 22, STAGE 3 — THE CORPUS PRIMITIVE, PINNED.
 *
 * Every assertion here is one of the six real occurrences of this defect,
 * reduced to the shape that produced it. A suite that only proves the happy
 * path would not have caught any of them.
 *
 * Run: npx tsx lib/agent/corpus.test.ts
 */
import { Corpus, corpusOf, buildCorpus } from "./corpus";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const A = "https://sec.gov/a.htm";
const B = "https://sec.gov/b.htm";
const SENTENCE = "We had outstanding letters of credit of $ 113 million as of June 30, 2026.";

console.log("\n=== [1] AN EMPTY CORPUS CANNOT SAY NO — occurrence 6, Centene ===");
{
  // verifyFacilities checked against the model's self-reported citedUrls.
  // Centene reported none, so this map was empty, and eight figures were
  // rejected as "not in any cited filing" — six of them verbatim in its own
  // anchor 10-Q. Every facility the company has was deleted.
  const empty = corpusOf(new Map());
  const r = empty.find(SENTENCE);
  assert(r.outcome === "undetermined",
    `[1a] a lookup in an empty corpus is UNDETERMINED, never absent. This is the exact call that deleted Centene's facilities (got "${r.outcome}")`);
  assert(empty.canConcludeAbsence === false,
    "[1b] and the corpus says so before it is asked, so a caller can refuse to conclude rather than discovering afterwards that it should have");
  assert(empty.describe().includes("NO DOCUMENTS LOADED"),
    "[1c] its description leads with the fact, because this string is what ends up in a report a person reads");
}

console.log("\n=== [2] A FAILED FETCH IS NOT AN ABSENCE — occurrences 1, 4 and 5 ===");
{
  const failed = corpusOf(new Map(), [{ url: A, message: "fetch failed" }]);
  assert(failed.state === "failed" && failed.find(SENTENCE).outcome === "undetermined",
    "[2a] a corpus whose only document failed to fetch reports UNDETERMINED — Session 21's check sheet rendered six HCA facts as unplaceable on exactly this");
  const r = failed.find(SENTENCE);
  assert(r.outcome === "undetermined" && r.why.includes("could not be fetched"),
    "[2b] and it carries the reason, so the surface says 'we could not look' rather than 'the filing does not say'");

  // PARTIAL IS THE SUBTLE ONE. Some documents loaded, one failed: a sentence
  // we cannot find might be in the one we could not read.
  const partial = corpusOf(new Map([[A, "unrelated text"]]), [{ url: B, message: "timeout" }]);
  assert(partial.find(SENTENCE).outcome === "undetermined",
    "[2c] A PARTIALLY LOADED CORPUS STILL CANNOT CONCLUDE ABSENCE. The missing sentence may be in the document that failed — this is the case a size check alone would wave through");
  assert(partial.find("unrelated text").outcome === "present",
    "[2d] but it can still confirm PRESENCE, which needs only one document and is unaffected by what else failed");
}

console.log("\n=== [3] A LOADED CORPUS ANSWERS BOTH WAYS ===");
{
  const loaded = corpusOf(new Map([[A, `preamble. ${SENTENCE} postscript.`], [B, "other text"]]));
  const hit = loaded.find(SENTENCE);
  assert(hit.outcome === "present" && hit.url === A,
    "[3a] present, and NAMES THE DOCUMENT — a figure's provenance is which filing states it, not that some filing does");
  assert(loaded.find("a sentence nobody filed").outcome === "absent",
    "[3b] and absent is available, because the corpus was actually loaded. This is the only state in which a negative finding is a finding");
  assert(loaded.canConcludeAbsence === true, "[3c] which it says plainly");
}

console.log("\n=== [4] buildCorpus RECORDS FAILURES RATHER THAN SWALLOWING THEM ===");
{
  (async () => {
    const c = await buildCorpus([A, B], async (u) => {
      if (u === B) throw new Error("blob read failed");
      return `text containing ${SENTENCE}`;
    });
    assert(c.state === "failed" && c.size === 1,
      "[4a] one document loaded and one threw: the corpus is FAILED, not a one-document success. A try/catch that continues silently is how occurrence 1 happened");
    assert(c.find(SENTENCE).outcome === "present",
      "[4b] presence still resolves from the document that loaded");
    assert(c.find("nothing").outcome === "undetermined",
      "[4c] and absence still does not, which is the entire contract");
    assert(c.failures[0].message.includes("blob read failed"),
      "[4d] the failure's own message survives to the report — 'a document could not be read' is not actionable, the reason is");

    const ok = await buildCorpus([A], async () => `text containing ${SENTENCE}`);
    assert(ok.state === "loaded" && ok.find("nothing").outcome === "absent",
      "[4e] a clean build concludes absence normally — the guard costs nothing when everything works");

    console.log(`\n${passed} passed, ${failed} failed.`);
    if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
  })();
}
