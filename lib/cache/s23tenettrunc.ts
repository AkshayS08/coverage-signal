/**
 * TENET'S REVOLVER: WHOSE TRUNCATION? $0, cached reads.
 *
 * The row renders `$1,900 million` against a sentence the provenance scan
 * printed as ending "...up to $ 1.900 ". Three candidates, and they need
 * different actions:
 *
 *   MY DISPLAY      that scan slices sourceLine at 160 characters, and the
 *                   printed string is ~158. The likeliest explanation is that
 *                   nothing is truncated at all and the report cut it.
 *   OUR HANDLING    the blob holds the whole sentence and something between
 *                   the blob and the row shortens or reformats it — a refresh
 *                   cannot fix that.
 *   MODEL-SIDE      the blob itself holds a short or re-expressed value — a
 *                   refresh may clear it.
 *
 * Tenet's canonical answer is unreachable at the CURRENT fingerprint (its
 * corpus moved), so this lists the blob store for every answer ever written
 * under Tenet's CIK and reads the newest v30 one. A question about what the
 * model returned is answered from the model's own bytes or not at all.
 *
 * Run: npx tsx lib/cache/s23tenettrunc.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { list } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { amountSupportOf } from "../events/position";

interface Fig { value: string; sourceLine: string }

(async () => {
  const f = await getRecentFilings("Tenet Healthcare", ["8-K", "10-Q", "10-K"]);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const prefix = `answer/${f.cik}/base/`;
  const { blobs } = await list({ prefix, token, limit: 1000 });
  const v30 = blobs
    .filter((b) => b.pathname.endsWith(`/v${EXTRACTION_PROMPT_VERSION}.json`) && !b.pathname.includes("-bust"))
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  console.log(`\n${"=".repeat(104)}`);
  console.log(`Tenet Healthcare — ${blobs.length} answer blob(s) under ${prefix}; ${v30.length} non-bust at v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(104));
  if (v30.length === 0) { console.log(`\n  none — nothing to read.`); return; }

  const newest = v30[0];
  console.log(`\n  reading the newest: ${newest.pathname}  (written ${newest.uploadedAt})`);
  const j = (await (await fetch(`${newest.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
  const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
  const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];

  for (const x of facs) {
    const size = x.facilitySize as Fig | null;
    if (!size) continue;
    console.log(`\n${"-".repeat(104)}`);
    console.log(`  ${String(x.name)}`);
    console.log(`${"-".repeat(104)}`);
    console.log(`    facilitySize.value      "${size.value}"`);
    console.log(`    sourceLine LENGTH       ${size.sourceLine.length} characters`);
    console.log(`    sourceLine, IN FULL, no slicing:`);
    console.log(`      "${size.sourceLine}"`);
    console.log(`    ends with a scale word? ${/\b(thousand|million|billion|trillion)s?\b\s*\.?\s*$/i.test(size.sourceLine.trim()) ? "yes" : "NO — it stops before one"}`);
    console.log(`    amountSupportOf         ${amountSupportOf(size.value, size.sourceLine).kind}`);
  }
})();
