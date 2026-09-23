/**
 * DOES EVERY EXTRACTED FACILITY REACH THE LADDER, OR GET DROPPED WITH A
 * STATED REASON? $0, cached reads, every company.
 *
 * UHS's vanishing $700M turned out to be model variance — run 3's blob holds
 * three facilities where runs 1 and 2 hold four. That answers the UHS
 * question and NOT the one behind it: is the assembly path itself sound, or
 * would a Tenet / CHS / Encompass refresh hit a silent drop of its own?
 *
 * Inferring "the path is fine" from one name where the path was not at fault
 * is the same move as measuring a rate from one sample. So this asks the
 * question of every company directly: for each facility in the raw blob, does
 * a ladder row carry it — and where none does, is there a REASON on record?
 *
 * TWO REASONS ARE LEGITIMATE AND NAMED:
 *   letter-of-credit   an LC is not borrowed money and has no ladder
 *                      destination at all — the destination was removed
 *                      deliberately, which is not a silent drop
 *   already on the ladder   a prose or schedule row already carries this
 *                      instrument under its own name; adding a second row
 *                      would double-count it
 *
 * Anything else is a facility the model returned and the page does not show,
 * with nothing saying why. That is the defect class position.ts:603 was.
 *
 * Run: npx tsx lib/cache/s23assembly.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { classifyInstrument } from "../events/instrumentClass";
import { parseMoneyAmount } from "../events/position";
import { resolveFacilityMaturity } from "../events/facilityMaturity";
import { currentCompanySpend } from "../agent/costMeter";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

interface Fig { value: string; sourceLine: string }

/** Significant words, so a row carrying the same instrument under another name still counts. */
const STOP = new Set(["the", "and", "a", "of", "under", "our", "its", "facility", "loan", "credit", "term", "new"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

(async () => {
  let facilities = 0, onLadder = 0, lc = 0, claimed = 0, silent = 0, spend = 0;
  const unreachable: string[] = [];
  console.log(`\n${"=".repeat(104)}`);
  console.log(`ASSEMBLY INTEGRITY — every extracted facility, does it reach the ladder or get dropped with a reason?`);
  console.log("=".repeat(104));

  for (const company of ALL) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    // A MISSING BLOB IS A STATE, NOT A CRASH. The filing-list cache has a 24h
    // TTL; when a company files something new the fingerprint moves and its
    // cached answer becomes unreachable. That is Rule 30's shape at the cache
    // layer, and it is exactly what a refresh exists to resolve — so it is
    // reported by name rather than stopping the sweep.
    let facs: Record<string, Fig | null | string>[];
    try {
      const meta = await head(baseAnswerKey(f.cik, corpusFingerprint(f.filings)), { token: process.env.BLOB_READ_WRITE_TOKEN });
      const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
      const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
      facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];
    } catch {
      unreachable.push(company);
      console.log(`
  ${company.padEnd(30)} CORPUS MOVED — no cached answer at the current fingerprint, so there is nothing to check against. A refresh re-extracts it (Rule 30).`);
      continue;
    }

    const result = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(result, PINNED_AS_OF);

    const lines: string[] = [];
    for (const fac of facs) {
      facilities++;
      const name = String(fac.name);
      const size = (fac.facilitySize as Fig | null)?.value ?? null;
      const sizeVal = size ? parseMoneyAmount(size) : null;

      // On the ladder under any name: matched by amount, or by significant words.
      const fw = words(name);
      // THE FACILITY'S OWN MATURITY, as a third way to recognise its row.
      //
      // Word overlap alone reported Molina's revolver as a SILENT DROP. Its
      // ladder row is "Credit Facility (no amount stated)" — the amount does
      // not match because none is stated, and the name reduces to nothing
      // because this checker's own stopword list removes both "credit" and
      // "facility". A detector whose stopwords can empty a row's identity
      // will report that row as missing every time. Same class as the
      // scans this session that judged by a stricter standard than the page.
      const fm = resolveFacilityMaturity((fac.maturity as Fig | null)?.value);
      const hit = pos.rows.find((r) => {
        const rv = parseMoneyAmount(String(r.amount ?? ""));
        if (sizeVal !== null && rv !== null && Math.abs(rv - sizeVal) < 1) return true;
        if (fm.outcome === "dated" && r.isCapacity && r.maturityDate === fm.date) return true;
        const rw = words(String(r.instrument));
        const shared = [...fw].filter((w) => rw.has(w));
        return fw.size > 0 && shared.length >= Math.min(2, fw.size);
      });
      if (hit) { onLadder++; continue; }

      if (classifyInstrument({ headings: [], instrumentName: name }).instrumentType === "letter-of-credit") {
        lc++; lines.push(`      ${name.slice(0, 54).padEnd(56)} ${String(size ?? "—").padEnd(16)} dropped: an LC is not borrowed money and has no ladder destination`);
        continue;
      }
      // Drawn balance already carried by a prose row under the facility's own name.
      const drawn = (fac.drawn as Fig | null)?.value ?? null;
      const dv = drawn ? parseMoneyAmount(drawn) : null;
      if (dv !== null && pos.rows.some((r) => { const rv = parseMoneyAmount(String(r.amount ?? "")); return rv !== null && Math.abs(rv - dv) < 1; })) {
        claimed++; lines.push(`      ${name.slice(0, 54).padEnd(56)} ${String(size ?? "—").padEnd(16)} dropped: its drawn balance is already a ladder row`);
        continue;
      }
      silent++;
      lines.push(`      ${name.slice(0, 54).padEnd(56)} ${String(size ?? "—").padEnd(16)} ⚠ SILENT DROP — extracted, not on the ladder, no reason on record`);
    }

    console.log(`\n  ${company.padEnd(30)} ${facs.length} facility(ies) extracted → ${pos.rows.length} ladder rows   ${lines.length === 0 ? "every facility on the ladder" : ""}`);
    for (const l of lines) console.log(l);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${facilities} facilities extracted across the book`);
  console.log(`  ${onLadder} reach the ladder · ${lc} dropped as letters of credit · ${claimed} already carried by another row`);
  console.log(`  ${silent} SILENT DROPS${silent === 0 ? " — the assembly path is sound for every name" : " — each is a facility the page does not show and nothing explains"}`);
  if (unreachable.length) console.log(`  ${unreachable.length} name(s) have NO cached answer at the current fingerprint — ${unreachable.join(", ")}`);
  console.log(`  SPEND: $${spend.toFixed(4)}`);
  console.log("=".repeat(104));
})();
