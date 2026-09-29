/**
 * FIX 5's PRECONDITIONS, MEASURED BEFORE ANYTHING IS BUILT. $0.
 *
 * The rule: a prior-period ANNUAL REPORT is a source only when
 * `anchorNoteShapeOf` is `not-located` AND a verified cross-reference directs
 * to it — and then only as the labelled prior-period base of the roll-forward,
 * never a row in the current ladder. Otherwise any ladder row citing it is
 * withheld with the reason stated.
 *
 * WHAT ALREADY EXISTS, so this does not rebuild a working guard (Rule 63):
 * `rowsOnAnchor` already drops schedule rows verified against a document other
 * than the anchor, and says so loudly. So the question is not "is anything
 * guarding this" — it is whether the guard covers every PRODUCER of a ladder
 * row, and whether the not-located-and-directed case has anywhere legitimate
 * to put the table it is allowed to read.
 *
 * Printed per company: the anchor's shape, whether a cross-reference exists
 * and is verified, every document its ladder rows cite, and whether any of
 * those is an annual report.
 *
 * Run: npx tsx lib/cache/s24anchor.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { assemblePosition } from "../events/position";
import { currentCompanySpend } from "../agent/costMeter";

const NAMES = ["DaVita", "Cigna Group", "HCA Healthcare", "Tenet Healthcare", "Encompass Health", "Molina Healthcare", "Quest Diagnostics", "Centene Corporation", "Universal Health Services", "Community Health Systems"];

/** A 10-K's primary document. Deliberately conservative: the FORM decides, never the filename. */
function isAnnualReport(url: string, filings: { url: string; form: string }[]): boolean {
  const f = filings.find((x) => x.url === url);
  return f ? /10-K/i.test(f.form) : false;
}

(async () => {
  let spend = 0;
  for (const company of NAMES) {
    const r = await runAgentLoop(company);
    spend += currentCompanySpend().totalUsd;
    const pos = assemblePosition(r, PINNED_AS_OF);
    const dm = r.results.find((t) => t.triggerId === "debt-maturity") as unknown as Record<string, unknown> | undefined;
    const anchor = dm?.debtScheduleSourceFiling as { form?: string; date?: string; url?: string } | undefined;
    // THE RECORDED SHAPE, NEVER A RE-DERIVED ONE.
    //
    // The first version of this probe read `dm?.anchorNoteLocator` — a field
    // that does not exist — so every company resolved to
    // anchorNoteShapeOf(undefined) === "not-located", including DaVita and
    // Tenet whose own run logs say `found [tabular]`. The probe's input made
    // its answer predetermined, which is the defect class Rules 42, 43 and 52
    // are all instances of, committed here by me while measuring a fix for it.
    //
    // Cached answers predate the field, so they read "not-recorded" — which is
    // the honest value and the reason the gate does not run on them.
    const shape = (dm?.anchorNoteShape as string | undefined) ?? "not-recorded";
    const xref = dm?.noteCrossReference as { statement?: string; verified?: boolean } | null;
    const refSeq = ((dm?.referencedScheduleSequence ?? []) as unknown[]).length;

    const filings = r.results.flatMap((t) => t.citations.map((c) => ({ url: c.url ?? "", form: c.form ?? "" })));
    const rowUrls = [...new Set(pos.rows.map((x) => x.citedUrl).filter(Boolean))];
    const annualRowUrls = rowUrls.filter((u) => isAnnualReport(u, filings));

    console.log(`\n${"─".repeat(104)}`);
    console.log(`${company}`);
    console.log("─".repeat(104));
    console.log(`  anchor                       ${anchor?.form ?? "—"} ${anchor?.date ?? ""}`);
    console.log(`  anchorNoteShapeOf            ${shape}`);
    console.log(`  noteCrossReference           ${xref ? `POPULATED${xref.verified === undefined ? "" : ` (verified=${xref.verified})`}` : "null"}`);
    console.log(`  referencedScheduleSequence   ${refSeq} entries`);
    console.log(`  ladder rows                  ${pos.rows.length}, citing ${rowUrls.length} document(s)`);
    for (const u of rowUrls) console.log(`      ${isAnnualReport(u, filings) ? "ANNUAL REPORT →" : "                "} ${u.split("/").pop()}`);
    console.log(`  ladder rows citing an ANNUAL REPORT: ${annualRowUrls.length === 0 ? "none" : annualRowUrls.map((u) => u.split("/").pop()).join(", ")}`);

    const expectation =
      shape === "not-recorded"
        ? "SHAPE NOT RECORDED — the gate does not run on this answer; it is enforced from the next extraction on"
        : shape === "not-located" && xref
        ? "DIRECTED: may read the annual report, but only as the labelled prior-period base — never a current ladder row"
        : shape === "not-located"
          ? "not-located and UNDIRECTED: must not touch the annual report at all"
          : `${shape}: the anchor has its own note, so an annual-report row must be withheld`;
    console.log(`  EXPECTED under fix 5         ${expectation}`);
    console.log(`  HOLDS TODAY?                 ${annualRowUrls.length === 0 ? "yes — no ladder row cites an annual report" : "NO — a ladder row cites an annual report"}`);
  }
  console.log(`\n  SPEND: $${spend.toFixed(4)} — must be $0.0000`);
})();
