/**
 * WHERE DOES 31,463 COME FROM, IF NOT FROM THE 10-K's TEXT? $0.
 *
 * The declaration's base tie target — 31,463 at Dec 31, 2025 — appears nowhere
 * in Cigna's 10-K: not in the located debt note, not anywhere in its 518,211
 * characters, in either scale. Neither does 31,878.
 *
 * That is not a reason to abandon the target; 31,878 is ALREADY the coverage
 * denominator today and is demonstrably right. It is a reason to find out what
 * KIND of number it is. 31,878 is `DebtCurrent + LongTermDebtNoncurrent` — a
 * SUM OF TWO XBRL TAGS, never printed as one figure. If 31,463 is the same
 * sum at the prior period, then the base tie is a tie against the filer's own
 * tags and not against a printed total, and the declaration's wording needs
 * correcting before anything bills.
 *
 * Also printed: what the located note ACTUALLY states as its totals, because
 * that is what a transcription would be checked against.
 *
 * Run: npx tsx lib/cache/s24cignaxbrl.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { fetchXbrlDebtTotal } from "../fetch/xbrlDebt";
import { locateDebtNoteSection } from "../fetch/noteLocation";

(async () => {
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — what 31,463 and 31,878 actually are`);
  console.log("=".repeat(104));

  console.log(`\n[1] THE FILER'S OWN TAGS, at both dates\n`);
  for (const period of ["2025-12-31", "2026-06-30"]) {
    try {
      const t = await fetchXbrlDebtTotal(f.cik, period);
      if (!t || t.total === null) { console.log(`      ${period}   no tagged total — ${t?.unavailableReason ?? "absent"}`); continue; }
      console.log(`      ${period}   ${t.parts.map((p) => `${p.tag}=${p.value.toLocaleString("en-US")}`).join(" + ")}`);
      console.log(`                   = ${t.total.toLocaleString("en-US")}   (= $${(t.total / 1e6).toLocaleString("en-US")}M)`);
    } catch (e) {
      console.log(`      ${period}   lookup failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  console.log(`\n[2] WHAT THE 10-K's DEBT NOTE ITSELF PRINTS AS TOTALS\n`);
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form))!;
  const { text } = await getFilingText(tenK.primaryDocUrl);
  const loc = locateDebtNoteSection(text);
  const span = loc.status === "found" ? text.slice(loc.start, loc.end) : "";
  for (const m of span.matchAll(/(total[^.\n]{0,60}?)\s((?:\$\s*)?[\d][\d,]*)/gi)) {
    console.log(`      "${m[1].replace(/\s+/g, " ").trim()}"  ->  ${m[2]}`);
  }

  console.log(`\n[3] THE BIGGEST FIGURES IN THE NOTE, as a sanity read\n`);
  const nums = [...span.matchAll(/\b\d{2},\d{3}\b/g)].map((m) => m[0]);
  console.log(`      five-figure comma numbers present: ${[...new Set(nums)].join(", ") || "none"}`);

  console.log(`\n  SPEND: $0.0000 — cached filing text and the filer's XBRL facts.`);
})();
