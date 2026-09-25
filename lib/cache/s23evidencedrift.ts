/**
 * WHAT v31 DID TO THE EVIDENCE SENTENCES, BOOK-WIDE. $0 — two cached blobs
 * per name, no model call.
 *
 * THE BLIND SPOT THIS MEASURES. The v31 declaration was about two things:
 * where a not-located anchor routes its table, and whether a printed unit
 * gets converted. Both are about AMOUNTS. Nothing in it said anything about
 * WHICH SENTENCE gets captured as a row's evidence — and three separate
 * observations tonight say that moved anyway:
 *
 *   - CHS's borrowing-base evidence thinned to the fragment "subject to
 *     borrowing base capacity", where v30 carried the fuller ABL sentence.
 *   - Cigna's four issued tranches swapped a flattened table row that
 *     CONTAINS the principal for a readable prose sentence that does NOT.
 *   - Tenet's sourceLine re-expression, already diagnosed as model-side.
 *
 * A golden pins the sentence shown beside each figure. Signing five names
 * against sentences chosen by a mechanism that moved, unmeasured, between
 * versions is signing something nobody looked at. So it is looked at first,
 * and it costs nothing.
 *
 * THE VERDICT THAT MATTERS IS "DEGRADED": v30's sentence stated the row's own
 * amount and v31's does not. That is Rule 58's exact target, arriving as a
 * version change rather than as a model slip. An improvement is reported too,
 * because a rule that only counts the losses is measuring the conclusion.
 *
 * Run: npx tsx lib/cache/s23evidencedrift.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { corpusFingerprint } from "./answerCache";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";
import { amountSupportOf } from "../events/position";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
const PRIOR = 30;

interface Line { key: string; where: string; amount: string; sourceLine: string; states: boolean }

async function answerAt(cik: string, fp: string, v: number): Promise<Record<string, unknown>[] | null> {
  try {
    const meta = await head(`answer/${cik}/base/${fp}/v${v}.json`, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(`${meta.url}?t=${Date.now()}`, { cache: "no-store" })).json()) as { data?: Record<string, unknown>[] };
    return j.data ?? null;
  } catch { return null; }
}

/**
 * Every place in an answer that carries an amount AND the sentence meant to
 * support it. Keyed by instrument rather than by position, because a row
 * added or removed between versions would otherwise shift every key after it
 * and report the whole list as changed.
 */
function linesOf(data: Record<string, unknown>[] | null): Line[] {
  const out: Line[] = [];
  const push = (where: string, key: string, amount: unknown, sourceLine: unknown) => {
    const a = String(amount ?? ""), s = String(sourceLine ?? "");
    if (!a) return;
    out.push({ key: `${where}:${key}`, where, amount: a, sourceLine: s, states: amountSupportOf(a, s).kind !== "unsupported" });
  };
  for (const t of data ?? []) {
    const id = String(t.triggerId ?? "");
    for (const e of (t.scheduleSequence ?? []) as Record<string, unknown>[]) {
      push("schedule", String(e.instrument ?? e.label ?? "—"), e.amount, e.sourceLine);
    }
    for (const e of (t.proseInstruments ?? []) as Record<string, unknown>[]) {
      push("prose", String(e.instrument ?? "—"), e.amount, e.sourceLine);
    }
    for (const e of (t.issuedTranches ?? []) as Record<string, unknown>[]) {
      push("issued", String(e.instrument ?? "—"), e.amount, e.sourceLine);
    }
    if (id === "debt-maturity") {
      for (const f of (t.facilities ?? []) as Record<string, Record<string, unknown> | string>[]) {
        for (const field of ["facilitySize", "drawn", "lettersOfCredit", "available"]) {
          const fig = f[field] as { value?: unknown; sourceLine?: unknown } | null;
          if (fig) push(`facility.${field}`, String(f.name), fig.value, fig.sourceLine);
        }
      }
    }
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

(async () => {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`EVIDENCE-SENTENCE DRIFT, v${PRIOR} → v${EXTRACTION_PROMPT_VERSION} — the v31 declaration measured amounts, not sentences`);
  console.log("=".repeat(104));

  let totalCompared = 0, totalMoved = 0;
  const degraded: string[] = [], improved: string[] = [], movedBoth: string[] = [];
  const noBaseline: string[] = [];

  for (const company of ALL) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const fp = corpusFingerprint(f.filings);
    const a = await answerAt(f.cik, fp, PRIOR);
    const b = await answerAt(f.cik, fp, EXTRACTION_PROMPT_VERSION);
    if (!a || !b) { noBaseline.push(`${company} — ${!a ? `no v${PRIOR} answer at this fingerprint` : `no v${EXTRACTION_PROMPT_VERSION} answer`}`); continue; }

    const before = new Map(linesOf(a).map((l) => [l.key, l]));
    const after = linesOf(b);
    let moved = 0, compared = 0;
    for (const n of after) {
      const o = before.get(n.key);
      if (!o) continue;
      compared++;
      if (norm(o.sourceLine) === norm(n.sourceLine)) continue;
      moved++;
      const tag = `${company} — ${n.key}  (${n.amount})`;
      if (o.states && !n.states) degraded.push(`${tag}\n      v${PRIOR} STATED IT: "${norm(o.sourceLine).slice(0, 150)}"\n      v${EXTRACTION_PROMPT_VERSION} does not: "${norm(n.sourceLine).slice(0, 150)}"`);
      else if (!o.states && n.states) improved.push(`${tag}  — v${PRIOR}'s sentence did not state the amount, v${EXTRACTION_PROMPT_VERSION}'s does`);
      // THE TWO UNCHANGED CASES ARE NOT THE SAME CASE. Both-state-it is fine;
      // neither-states-it is a row that was already unsupported at v30 and
      // still is. The first draft built the string "both state it" and then
      // appended "; NEITHER states it", printing a sentence that contradicts
      // itself — on the line whose whole job is to say whether a figure can
      // be checked.
      else movedBoth.push(`${tag}  — ${o.states ? "both sentences state it" : "NEITHER sentence states it — unsupported at v30 too, so v31 did not cause this"}`);
    }
    totalCompared += compared; totalMoved += moved;
    console.log(`\n  ${company.padEnd(28)} ${String(compared).padStart(3)} comparable line(s), ${String(moved).padStart(3)} sentence(s) moved`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${totalMoved} of ${totalCompared} evidence sentences moved between v${PRIOR} and v${EXTRACTION_PROMPT_VERSION}`);
  console.log("=".repeat(104));

  console.log(`\n[DEGRADED] ${degraded.length} — v${PRIOR}'s sentence stated the amount and v${EXTRACTION_PROMPT_VERSION}'s does not. This is Rule 58's target arriving as a version change.\n`);
  for (const d of degraded) console.log(`  ${d}\n`);
  console.log(`[IMPROVED] ${improved.length} — the other direction, counted so this is a measurement and not a case\n`);
  for (const i of improved) console.log(`  ${i}`);
  console.log(`\n[MOVED, SUPPORT UNCHANGED] ${movedBoth.length} — a different sentence, same answer to "does it state the figure"\n`);
  for (const m of movedBoth.slice(0, 25)) console.log(`  ${m}`);
  if (movedBoth.length > 25) console.log(`  ... and ${movedBoth.length - 25} more`);
  if (noBaseline.length) { console.log(`\n[NOT COMPARABLE]\n`); for (const n of noBaseline) console.log(`  ${n}`); }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  SPEND: $0.0000 — two cached blobs per name, no model called.`);
  console.log("=".repeat(104));
})();
