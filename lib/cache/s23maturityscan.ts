/**
 * RULE 57's BLAST RADIUS — every facility maturity in the book, before and
 * after. $0, cached reads.
 *
 * The rule only engages where the stated value carries a RELATIVE TERM, so
 * its reach is exactly that set. Rather than argue that, this resolves every
 * facility maturity in every cached answer under both the old logic (any
 * single date token wins) and the new one, and prints every disagreement.
 *
 * A facility that GAINS a maturity would be as much a finding as one that
 * loses one, so both directions are reported.
 *
 * Run: npx tsx lib/cache/s23maturityscan.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { head } from "@vercel/blob";
import { getRecentFilings } from "../fetch";
import { baseAnswerKey, corpusFingerprint } from "./answerCache";
import { resolveFacilityMaturity } from "../events/facilityMaturity";
import { extractFactTokens } from "../agent/factTokens";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services", "Encompass Health",
  "Community Health Systems", "Quest Diagnostics", "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

interface Fig { value: string; sourceLine: string }

/** The resolver AS IT STOOD — any single date token in the string becomes the maturity. */
function before(stated: string): string {
  const s = (stated ?? "").trim();
  if (s === "") return "unstated";
  const dates = extractFactTokens(s).filter((t) => t.kind === "date" && t.dateValue);
  if (dates.length !== 1) return "relative";
  const d = dates[0].dateValue!;
  return `dated ${d.year}-${String(d.month ?? 1).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`;
}

function after(stated: string): string {
  const m = resolveFacilityMaturity(stated);
  return m.outcome === "dated" ? `dated ${m.date}` : m.outcome;
}

(async () => {
  let scanned = 0, moved = 0;
  console.log(`\n${"=".repeat(104)}`);
  console.log(`RULE 57 — every facility maturity in the book, old resolver against new`);
  console.log("=".repeat(104));

  for (const company of ALL) {
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const meta = await head(baseAnswerKey(f.cik, corpusFingerprint(f.filings)), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const j = (await (await fetch(meta.url)).json()) as { data?: Record<string, unknown>[] };
    const dm = (j.data ?? []).find((r) => r.triggerId === "debt-maturity") as Record<string, unknown> | undefined;
    const facs = (dm?.facilities ?? []) as Record<string, Fig | null | string>[];

    for (const fac of facs) {
      const stated = (fac.maturity as Fig | null)?.value ?? "";
      scanned++;
      const b = before(stated), a = after(stated);
      if (b === a) continue;
      moved++;
      console.log(`\n  ⚠ ${company} — ${String(fac.name)}`);
      console.log(`      stated: "${stated}"`);
      console.log(`      before: ${b}`);
      console.log(`      after:  ${a}   ${a.startsWith("dated") ? "← GAINED a maturity" : "← LOST a maturity"}`);
    }
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  ${scanned} facility maturities scanned across the book`);
  console.log(`  ${moved} moved`);
  console.log("=".repeat(104));
})();
