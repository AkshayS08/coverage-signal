/**
 * WHAT DOES CIGNA'S CORPUS ACTUALLY SUPPORT? $0 — cached filings and text.
 *
 * Before an extra extraction call is written, the four things it depends on
 * are checked, because each of them is a way the whole design could be
 * unbuildable and none of them is visible from the declaration:
 *
 *   1. Is the referenced 10-K even IN the fetched corpus? The cross-reference
 *      naming it is not the same as the document being available.
 *   2. Can its debt note be LOCATED? The extra call transcribes a note; if the
 *      locator cannot find one in the 10-K either, there is nothing to ask for.
 *   3. Does 31,463 — the number the base must tie to — actually appear in that
 *      note? If the declared reconciliation target is not in the document, the
 *      target is wrong and the gate would fail for the wrong reason.
 *   4. What does the anchor state as the cross-reference, verbatim?
 *
 * Run: npx tsx lib/cache/s24cignabase.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection, spanIsTabular } from "../fetch/noteLocation";
import { runAgentLoop } from "../agent";
import { currentCompanySpend } from "../agent/costMeter";

const COMPANY = "Cigna Group";

(async () => {
  let spend = 0;
  const f = await getRecentFilings(COMPANY, ["8-K", "10-Q", "10-K"]);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`CIGNA — what the corpus supports for a prior-period base`);
  console.log("=".repeat(104));

  console.log(`\n[1] THE CORPUS — ${f.filings.length} filing(s) fetched\n`);
  for (const x of f.filings) {
    console.log(`      ${String(x.form).padEnd(6)} filed ${x.filingDate}  period ${x.reportDate ?? "—"}  ${String(x.primaryDocUrl).split("/").pop()}`);
  }
  const tenK = f.filings.find((x) => /^10-K$/i.test(x.form));
  if (!tenK) {
    console.log(`\n  NO 10-K IN THE CORPUS. The extra call has no document to read and the design is unbuildable as declared.`);
    return;
  }

  console.log(`\n[2] CAN ITS DEBT NOTE BE LOCATED?\n`);
  const { text } = await getFilingText(tenK.primaryDocUrl);
  console.log(`      document text: ${text.length.toLocaleString()} chars`);
  const loc = locateDebtNoteSection(text);
  console.log(`      locator: ${loc.status}${loc.status === "found" ? ` — span ${loc.start.toLocaleString()}..${loc.end.toLocaleString()} (${(loc.end - loc.start).toLocaleString()} chars)` : ""}`);
  if (loc.status === "found") {
    const tab = spanIsTabular(text, loc.start, loc.end);
    console.log(`      tabular: ${tab.tabular} (${tab.groupedFigures} comma-grouped figures)`);
  }

  console.log(`\n[3] IS 31,463 IN THAT NOTE?\n`);
  const span = loc.status === "found" ? text.slice(loc.start, loc.end) : text;
  for (const probe of ["31,463", "31,878", "31.463", "31.878"]) {
    const inSpan = span.includes(probe);
    const inDoc = text.includes(probe);
    console.log(`      "${probe}"  in the located note: ${inSpan ? "YES" : "no "}   anywhere in the 10-K: ${inDoc ? "YES" : "no"}`);
    if (inSpan) {
      const at = span.indexOf(probe);
      console.log(`            "${span.slice(Math.max(0, at - 90), at + 40).replace(/\s+/g, " ").trim()}"`);
    }
  }

  console.log(`\n[4] WHAT THE ANCHOR SAYS, VERBATIM\n`);
  const r = await runAgentLoop(COMPANY);
  spend += currentCompanySpend().totalUsd;
  const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
  const x = dm?.noteCrossReference as { statement?: string; referencedNote?: string | null; referencedFiling?: string | null; referencedSubject?: string | null } | null;
  console.log(`      anchorNoteShape      ${String(dm?.anchorNoteShape ?? "(not recorded)")}`);
  if (!x) console.log(`      noteCrossReference   null — the gate's second condition is NOT met`);
  else {
    console.log(`      referencedNote       ${JSON.stringify(x.referencedNote)}`);
    console.log(`      referencedFiling     ${JSON.stringify(x.referencedFiling)}`);
    console.log(`      referencedSubject    ${JSON.stringify(x.referencedSubject)}`);
    console.log(`      statement            "${String(x.statement).replace(/\s+/g, " ")}"`);
    const anchorUrl = (dm?.debtScheduleSourceFiling as { url?: string } | undefined)?.url;
    if (anchorUrl) {
      const anchorText = (await getFilingText(anchorUrl)).text;
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      console.log(`      verified in the anchor's own text: ${norm(anchorText).includes(norm(String(x.statement))) ? "YES" : "NO — the direction is a model assertion, and the gate must not open on it"}`);
    }
  }

  console.log(`\n  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
})();
