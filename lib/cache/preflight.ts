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
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint, baseAnswerKey } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
const ALL=["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health","Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];
async function main(){
  const token=process.env.BLOB_READ_WRITE_TOKEN;
  console.log("company                       filings  fingerprint               base answer");
  let missing=0;
  for(const c of ALL){
    const f=await getRecentFilings(c,["8-K","10-Q","10-K"]);
    const fp=corpusFingerprint(f.filings);
    // Rule 12 audit: the SAME builder cachedBaseClassification uses. A
    // hand-copied key here would let preflight report "cached" about a key
    // nothing reads, which is the one thing preflight must never do.
    const key=baseAnswerKey(f.cik,fp);
    let present=false;
    try{ await head(key,{token}); present=true; }catch{ present=false; }
    if(!present) missing++;
    console.log(`${c.padEnd(28)}  ${String(f.filings.length).padStart(6)}  ${fp}  ${present?"cached":"WOULD RE-BILL"}`);
  }
  console.log("");
  console.log(`${missing} of ${ALL.length} would re-extract on the next run.`);
}
main().catch(e=>{console.error(e);process.exit(1);});
