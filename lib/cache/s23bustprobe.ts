/**
 * WHY DID A CACHE_BUST KEY THAT HIT AT 02:20 MISS AT 16:52? $0 — blob
 * existence checks only.
 *
 * Two CHS re-tastes were re-read for free earlier today and billed $0.1388
 * and $0.1385 when read again fifteen hours later. The canonical answer hit
 * both times at the same fingerprint (2b1a61a3), so the corpus did not move
 * — which removes the obvious explanation and leaves a real question about
 * whether measurement runs stay re-readable.
 *
 * Three possibilities, and they are distinguishable by looking:
 *   - the busted blob is GONE          -> the answer cache is not permanent
 *                                         for these keys, and any "re-read at
 *                                         $0" claim has a shelf life
 *   - the busted blob is THERE         -> the key the reader composes is not
 *                                         the key the writer composed, and
 *                                         the miss is ours
 *   - the fingerprint differs from the -> the corpus moved after all and the
 *     one the canonical answer uses       canonical hit for another reason
 *
 * Run: npx tsx lib/cache/s23bustprobe.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const COMPANY = process.argv[2] ?? "Community Health Systems";
const BUST_TAG = "s23-sign";

async function exists(key: string): Promise<string | null> {
  try {
    const m = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return `${(m.size / 1024).toFixed(0)} KB, uploaded ${m.uploadedAt instanceof Date ? m.uploadedAt.toISOString() : String(m.uploadedAt)}`;
  } catch { return null; }
}

(async () => {
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  const tag = COMPANY.replace(/[^a-z0-9]/gi, "").slice(0, 14);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`${COMPANY} — which answer blobs exist right now`);
  console.log("=".repeat(104));
  console.log(`\n  fingerprint the code composes NOW: ${fp}`);
  console.log(`  filings in the list: ${f.filings.length}`);

  const keys: [string, string][] = [
    ["canonical", `answer/${f.cik}/base/${fp}/v${EXTRACTION_PROMPT_VERSION}.json`],
    ["re-taste 1", `answer/${f.cik}/base/${fp}-bust${BUST_TAG}-${tag}-1/v${EXTRACTION_PROMPT_VERSION}.json`],
    ["re-taste 2", `answer/${f.cik}/base/${fp}-bust${BUST_TAG}-${tag}-2/v${EXTRACTION_PROMPT_VERSION}.json`],
  ];
  for (const [label, key] of keys) {
    const meta = await exists(key);
    console.log(`\n  ${label.padEnd(12)} ${meta ? `PRESENT — ${meta}` : "ABSENT"}`);
    console.log(`               ${key}`);
  }

  console.log(`\n  READ THIS AS: the re-taste blobs being PRESENT means the miss was a key the reader`);
  console.log(`  composed differently from the writer. Their being ABSENT means a measurement run is`);
  console.log(`  re-readable for a while and then is not — which changes what "$0 re-read" is worth`);
  console.log(`  promising, and is worth knowing before the next declaration leans on it.`);
  console.log(`\n  SPEND: $0.0000 — existence checks only.`);
})();
