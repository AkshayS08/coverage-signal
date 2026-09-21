/**
 * IS A CAPACITY SITTING IN A BALANCE FIELD ANYWHERE ELSE? $0, cached reads.
 *
 * Molina's golden carried `lettersOfCredit: $100 million` sourced to "a $100
 * million letter of credit SUB-FACILITY" — the sub-facility's size, not
 * letters of credit outstanding. Rule 48's category error exactly: a limit
 * reported into the field that holds a balance.
 *
 * The distinguishing evidence is in the sentence, not the number, so this
 * prints EVERY lettersOfCredit figure in the book beside its own sentence and
 * marks the ones whose sentence reads like a limit. Printing all of them is
 * the point: a scan that shows only its own hits cannot be checked by the
 * person reading it.
 *
 * `drawn` and `available` are scanned too. The error is about a FIELD holding
 * a limit, and nothing about it is specific to letters of credit — a scan
 * that looked only where the instance was found would answer a narrower
 * question than the one asked.
 *
 * Run: npx tsx lib/cache/s23capacityscan.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";

/** Language that describes a LIMIT — what an instrument may reach. */
const CAPACITY_LANGUAGE = [
  { re: /sub-?facilit/i, why: "names a sub-facility, which is a limit" },
  { re: /\bup\s+to\b/i, why: '"up to" states a ceiling, not a balance' },
  { re: /maximum\s+aggregate|aggregate\s+principal\s+amount\s+of/i, why: "states an aggregate commitment" },
  { re: /provides?\s+for|includes?\s+a\b/i, why: "describes what the agreement provides, not what is drawn on it" },
  { re: /capacity/i, why: 'uses the word "capacity"' },
];
/** Language that describes a BALANCE — what is actually outstanding. */
const BALANCE_LANGUAGE = /outstanding|issued|drawn|utilized|utilised|after\s+(?:taking|giving)|net\s+of|there\s+were\s+no/i;

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const BALANCE_FIELDS = ["lettersOfCredit", "drawn", "available"] as const;

interface Fig { value: string; sourceLine: string }

(async () => {
  let total = 0, flagged = 0;
  console.log(`\n${"=".repeat(104)}`);
  console.log(`A LIMIT IN A BALANCE FIELD — every lettersOfCredit / drawn / available figure in the book, with its sentence`);
  console.log("=".repeat(104));

  for (const company of ALL) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const meta = await head(baseAnswerKey(f.cik, corpusFingerprint(f.filings)), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
    const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];

    console.log(`\n${"-".repeat(104)}\n${company}\n${"-".repeat(104)}`);
    let printed = 0;
    for (const fac of facs) {
      for (const field of BALANCE_FIELDS) {
        const fig = fac[field] as Fig | null;
        if (!fig?.value) continue;
        total++; printed++;
        const line = fig.sourceLine.replace(/\s+/g, " ");
        const limitHits = CAPACITY_LANGUAGE.filter((c) => c.re.test(line));
        const statesBalance = BALANCE_LANGUAGE.test(line);
        // A sentence can carry both — CHS's does. The flag is for a sentence
        // that reads ONLY as a limit while filling a balance field.
        const suspect = limitHits.length > 0 && !statesBalance;
        if (suspect) flagged++;
        console.log(`\n  ${suspect ? "⚠ CANDIDATE" : "  ok       "}  ${String(fac.name).slice(0, 34).padEnd(36)} ${field.padEnd(16)} ${fig.value}`);
        console.log(`                "${line.slice(0, 190)}"`);
        if (suspect) console.log(`                → limit language only (${limitHits.map((h) => h.why).join("; ")}), and the sentence states no balance`);
      }
    }
    if (printed === 0) console.log(`\n  (no balance figures stated)`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${total} balance figures scanned across the book`);
  console.log(`  ${flagged} candidate(s): a sentence that reads only as a limit, filling a field that holds a balance`);
  console.log("=".repeat(104));
})();
