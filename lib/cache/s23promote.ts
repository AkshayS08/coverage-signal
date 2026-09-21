/**
 * PROMOTE A CACHE_BUST ANSWER TO THE CANONICAL KEY. $0 — no model is called.
 *
 * WHY THIS IS A LEGITIMATE WRITE AND NOT A FORGERY. CACHE_BUST changes the
 * cache KEY and nothing else: the prompt, the corpus, the schema and the
 * extraction version are identical to the ones a cold re-extract at the
 * canonical key would use (lib/agent/loop.ts appends the bust value to the
 * fingerprint AFTER the corpus is assembled). So the answer under the bust
 * key IS an answer at this version for this exact filing set. Promoting it
 * buys, for $0, the same bytes a $0.16 re-extract would produce.
 *
 * WHAT IT COSTS, AND IT IS NOT NOTHING. It OVERWRITES the canonical answer
 * that any signed golden for this company rests on. So:
 *   - the answer being overwritten is printed field by field before the write
 *   - the write is refused unless the two answers are genuinely different,
 *     because a promotion that changes nothing is a write nobody needed
 *   - the golden it affects is named, so it can be held rather than assumed
 *
 * Run: npx tsx lib/cache/s23promote.ts "<Company>" <bust-value>
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { writeCache } from "../fetch/cache";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";

interface Fig { value: string; sourceLine: string }
const FIELDS = ["facilitySize", "drawn", "lettersOfCredit", "available", "maturity"] as const;

/**
 * A READ THAT CANNOT RETURN THE BYTES IT IS CHECKING WERE REPLACED.
 *
 * The first version fetched the blob URL plainly, and the read-back after the
 * write reported MISMATCH while the write had in fact succeeded — it was
 * served the pre-write copy from the CDN. A verification step that can read a
 * stale copy is not a verification step; it is the session's own dominant
 * defect class (a check whose inputs decide its answer) committed inside the
 * tool written to prove a write took.
 *
 * So: no-store, a cache-busting query, and a short retry — because eventual
 * consistency is a real property of the store and "try once and declare" is
 * the same mistake in a different costume.
 */
async function readKey(key: string, attempts = 1): Promise<Record<string, unknown>[] | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const meta = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const res = await fetch(`${meta.url}?promote-readback=${Date.now()}`, { cache: "no-store" });
      const j = (await res.json()) as { data?: Record<string, unknown>[] };
      if (j.data) return j.data;
    } catch {
      /* fall through to the retry */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

function facilitiesOf(data: Record<string, unknown>[] | null): Record<string, Fig | null | string>[] {
  const dm = (data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
  return (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
}

(async () => {
  const company = process.argv[2];
  const bust = process.argv[3];
  if (!company || !bust) { console.error("usage: s23promote.ts \"<Company>\" <bust-value>"); process.exit(1); }

  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const fp = corpusFingerprint(f.filings);
  const canonicalKey = baseAnswerKey(f.cik, fp);
  const bustKey = baseAnswerKey(f.cik, `${fp}-bust${bust}`);

  console.log(`\n${"=".repeat(100)}`);
  console.log(`PROMOTE — ${company}`);
  console.log(`  from  ${bustKey}`);
  console.log(`  to    ${canonicalKey}`);
  console.log("=".repeat(100));

  const source = await readKey(bustKey);
  if (!source) { console.error(`\n  REFUSED — nothing at the bust key. There is no answer to promote.`); process.exit(1); }
  const target = await readKey(canonicalKey);

  // WHAT IS BEING DESTROYED, PRINTED BEFORE IT IS DESTROYED.
  const before = facilitiesOf(target);
  const after = facilitiesOf(source);
  console.log(`\n  the answer being OVERWRITTEN (${before.length} facility(ies)) against the one replacing it (${after.length}):`);
  const names = [...new Set([...before, ...after].map((x) => String(x.name)))];
  let differences = 0;
  for (const name of names) {
    const b = before.find((x) => String(x.name) === name);
    const a = after.find((x) => String(x.name) === name);
    console.log(`\n    ${name}`);
    for (const field of FIELDS) {
      const bv = (b?.[field] as Fig | null)?.value ?? "—";
      const av = (a?.[field] as Fig | null)?.value ?? "—";
      const moved = bv !== av;
      if (moved) differences++;
      console.log(`      ${field.padEnd(16)} was ${String(bv).padEnd(22)} becomes ${String(av).padEnd(22)}${moved ? "  ← CHANGES" : ""}`);
    }
  }

  if (differences === 0) {
    console.error(`\n  REFUSED — the two answers are identical. A promotion that changes nothing is a write nobody needed.`);
    process.exit(1);
  }

  console.log(`\n  ${differences} field(s) change. Writing.`);
  await writeCache(canonicalKey, source);

  // READ IT BACK. A write reported without a read is a claim, not a result.
  const verify = facilitiesOf(await readKey(canonicalKey, 5));
  const ok = FIELDS.every((field) =>
    after.every((a) => {
      const v = verify.find((x) => String(x.name) === String(a.name));
      return ((v?.[field] as Fig | null)?.value ?? null) === ((a[field] as Fig | null)?.value ?? null);
    })
  );
  console.log(`\n  READ BACK: ${ok ? "the canonical key now serves the promoted answer, field for field" : "MISMATCH — the key does not hold what was written"}`);
  if (!ok) process.exit(1);
  console.log(`\n  ⚠ ${company}'s signed golden now describes a superseded answer and MUST be re-signed before it means anything.`);
  console.log(`\n  SPEND: $0.0000 — no model was called.`);
})();
