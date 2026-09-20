/**
 * SESSION 23 — the RAW facility rows as v30 stored them, with every figure's
 * own sentence in full. $0, cached read.
 *
 * The cold pass's rejection messages truncate the sentence at 120 characters,
 * which is enough to see that something was refused and not enough to say
 * whether the refusal was right. This prints them whole.
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";

interface Fig { value: string; sourceLine: string }
interface Fac {
  name: string;
  category?: string;
  facilitySize?: Fig | null;
  drawn?: Fig | null;
  lettersOfCredit?: Fig | null;
  available?: Fig | null;
  maturity?: Fig | null;
  availabilityBasis?: { statement: string; limitedBy: string } | null;
}

(async () => {
  for (const company of process.argv.slice(2)) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const key = baseAnswerKey(f.cik, corpusFingerprint(f.filings));
    const meta = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity");
    const facs = (dm?.facilities ?? []) as Fac[];
    console.log(`\n${"=".repeat(96)}\n${company} — ${facs.length} facilities as the model returned them\n${"=".repeat(96)}`);
    for (const x of facs) {
      console.log(`\n  ${x.name}   [${x.category ?? "?"}]`);
      for (const k of ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const) {
        const fig = x[k];
        if (!fig) { console.log(`    ${k.padEnd(16)} —`); continue; }
        console.log(`    ${k.padEnd(16)} ${fig.value}`);
        console.log(`    ${" ".repeat(16)} └ "${fig.sourceLine}"`);
      }
      console.log(`    availabilityBasis ${x.availabilityBasis ? `limitedBy="${x.availabilityBasis.limitedBy}"\n${" ".repeat(22)}└ "${x.availabilityBasis.statement}"` : "— (none reported)"}`);
    }
  }
})();
