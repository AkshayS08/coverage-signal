/**
 * SESSION 23, OPTION 3 — WHAT DOES THE MODEL RETURN FOR A 37-ROW NOTE? $0.
 *
 * Asking the model costs money. But the question has been asked before: when
 * Cigna's most recent periodic filing WAS the 10-K, the anchor was that
 * 37-coupon-row note, and whatever came back was cached and never deleted —
 * the answer cache is permanent (a filing's content never changes).
 *
 * So this enumerates every cached base answer this company has ever had,
 * across fingerprints and prompt versions, and reports the schedule size in
 * each. The largest transcription the model has actually produced for this
 * note is a measurement, not an estimate — and it is already on disk.
 *
 * Reads blobs. Zero model calls by construction.
 *
 * Run: npx tsx lib/cache/s23history.ts "Cigna Group"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { list } from "@vercel/blob";
import { getRecentFilings } from "../fetch";

interface Verdict {
  triggerId?: string;
  scheduleSequence?: unknown[] | null;
  priorScheduleSequence?: unknown[] | null;
  proseInstruments?: unknown[] | null;
  statedTotal?: string | null;
}

(async () => {
  const company = process.argv[2] ?? "Cigna Group";
  const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const prefix = `answer/${f.cik}/base/`;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  const blobs: { pathname: string; url: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token });
    blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(`\n${company} — ${blobs.length} cached base answer(s) under ${prefix}\n`);
  blobs.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());

  console.log(`${"uploaded".padEnd(22)} ${"fingerprint".padEnd(26)} ${"ver".padEnd(6)} ${"sched".padEnd(7)} ${"prior".padEnd(7)} ${"prose".padEnd(7)} statedTotal`);
  console.log("-".repeat(110));
  for (const b of blobs) {
    const m = /base\/([^/]+)\/v(\d+)\.json$/.exec(b.pathname);
    const fp = m ? m[1] : "?";
    const ver = m ? m[2] : "?";
    let sched = "—", prior = "—", prose = "—", total = "—";
    try {
      const j = (await (await fetch(b.url)).json()) as { data?: Verdict[] };
      const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity");
      if (dm) {
        sched = String((dm.scheduleSequence ?? []).length);
        prior = String((dm.priorScheduleSequence ?? []).length);
        prose = String((dm.proseInstruments ?? []).length);
        total = dm.statedTotal ?? "—";
      }
    } catch {
      sched = "unreadable";
    }
    const current = fp === (await Promise.resolve(fp)) ? "" : "";
    console.log(
      `${b.uploadedAt.toISOString().slice(0, 19).replace("T", " ").padEnd(22)} ${fp.padEnd(26)} v${ver.padEnd(5)} ${sched.padEnd(7)} ${prior.padEnd(7)} ${prose.padEnd(7)} ${total}${current}`
    );
  }
  console.log("-".repeat(110));
  console.log(`  The largest scheduleSequence above is what this model has actually produced for this company's note.\n`);
})();
