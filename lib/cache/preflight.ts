/**
 * WOULD THE NEXT RUN COST MONEY? Answers that WITHOUT calling any model.
 *
 * Written after getting it wrong twice in one session. Two runs reported here
 * as "zero API cost, replayed from cache" had in fact re-extracted a company
 * live, and neither was noticed until a blob listing showed an answer written
 * minutes earlier.
 *
 * The mechanism is not a bug, it is the cache key doing what it says:
 * corpusFingerprint hashes the company's FULL filing catalog, and the
 * filing-list cache has a 24-hour TTL. When that TTL lapses and EDGAR returns
 * a catalog that differs by even one filing — a new 8-K anywhere in a
 * 293-filing history — the fingerprint changes, every cached answer for that
 * company becomes unreachable, and the next run silently re-extracts it. A
 * replay is therefore only free INSIDE a TTL window, and "I replayed from
 * cache" is a claim about a moment, not a property of the code.
 *
 * So it should be checkable rather than assumed. This does a HEAD against
 * each company's exact answer key and reports which would re-bill. Run it
 * before any run that is being described as free.
 *
 * Reads the filing list (cached, free) and does one blob HEAD per company.
 * Zero model calls by construction — it imports nothing that can make one.
 *
 * Run: npm run preflight
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { checkFree } from "./freeRun";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { nonEmpty } from "../testing/nonEmpty";
const ALL=["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health","Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];
async function main(){
  console.log("company                       read set                  base answer");
  let missing=0;
  for(const c of nonEmpty("the preflight names", ALL)){
    // Rule 12 audit, Session 27: checkFree resolves the read set and builds
    // the key exactly as the loop does (lib/cache/readSet.ts). A hand-copied
    // key here would let preflight report "cached" about a key nothing reads.
    // Only a 404 is "not cached"; an unreachable store is a named error.
    const v=await checkFree(c);
    if(!v.cached) missing++;
    console.log(`${c.padEnd(28)}  ${v.fingerprint}  ${v.cached?"cached":"WOULD RE-BILL"}`);
  }
  console.log("");
  console.log(`${missing} of ${ALL.length} would re-extract on the next run.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
