/**
 * DELETE A CACHED ANSWER BUILT BY A PROMPT THAT NO LONGER EXISTS AT ITS
 * VERSION. $0 — no model is called.
 *
 * THE RULE THIS ENFORCES: nothing cached at a version may have been built by
 * a different prompt at that version. A cache key says "this is the answer to
 * v31's question"; if v31's question changed after the answer was written,
 * the key is lying, and every later run that hits it inherits the lie for
 * free and silently.
 *
 * DaVita's v31.json is the case. It was written by an accidental run during a
 * test sweep, under a v31 prompt whose third unit example was afterwards
 * removed for doubling DaVita's ladder. Keeping it would mean the cold pass
 * skips the one name whose behaviour we most need to re-measure.
 *
 * DESTRUCTIVE, so it prints what it will remove and re-reads afterwards to
 * prove it is gone — a delete reported without a read is a claim, not a
 * result.
 *
 * Run: npx tsx lib/cache/s23delpoisoned.ts "<Company>"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head, del } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

(async () => {
  const company = process.argv[2];
  if (!company) { console.error('usage: s23delpoisoned.ts "<Company>"'); process.exit(1); }
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const key = baseAnswerKey(f.cik, corpusFingerprint(f.filings));

  console.log(`\n${"=".repeat(100)}`);
  console.log(`DELETE A POISONED ANSWER — ${company}, v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(100));
  console.log(`\n  key: ${key}`);

  let meta;
  try { meta = await head(key, { token }); }
  catch { console.log(`\n  NOTHING THERE — already absent. No delete needed, and none performed.`); return; }
  console.log(`  present: ${meta.size} bytes, written ${meta.uploadedAt}`);

  await del(meta.url, { token });
  console.log(`\n  deleted.`);

  // READ BACK, defeating any cached copy, because "I called del" is not evidence.
  let stillThere = false;
  for (let i = 0; i < 4; i++) {
    try { await head(key, { token }); stillThere = true; } catch { stillThere = false; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`  READ BACK: ${stillThere ? "STILL PRESENT — the delete did not take" : "gone — the key no longer resolves"}`);
  if (stillThere) process.exit(1);
  console.log(`\n  ${company} will now re-extract on the next run, which is what the reconciliation gate expects.`);
  console.log(`  SPEND: $0.0000 — no model was called.`);
})();
