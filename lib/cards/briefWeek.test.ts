/**
 * SESSION 27 (Akshay, Oct 30, 2026) — THE BRIEF WEEK IS A RULE, NOT A CONSTANT.
 *
 * The brief date is today's date where EDGAR keeps time (New York), unless a
 * date is given. The header's week, the "this week" filing status, the
 * 18-month window's end and every "months away" count derive from it, and a
 * card whose ANCHOR was filed inside the brief week names it in the header as
 * this card's position, never as a new filing "not yet read".
 *
 *   W1  briefDateFor: the New York date of an instant (late evening UTC is
 *       still the same day in New York; early morning UTC is the day before)
 *   W2  briefWeek: from the day after the previous brief to the brief date;
 *       a first brief is the trailing seven days
 *   W3  every committed card: its header week, window end and months-away
 *       counts follow its own brief date (rebuilt at another date, they move)
 *   W4  Molina's refresh (anchor: 10-Q filed Oct 22) at the brief of Oct 30:
 *       the header names the 10-Q as filed this week and as the position, and
 *       no line calls it "not yet read"
 *   W5  control: the committed Molina card (anchor: Jul 23 10-Q) with the
 *       same Oct 22 10-Q in its week says it is new and NOT yet read, and the
 *       header does not claim it as the position
 *
 * Offline, $0. Run: npx tsx lib/cards/briefWeek.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCard } from "./build";
import { briefDateFor, briefWeek } from "./briefDate";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[]) => l.map((s: any) => s.t ?? s.printed ?? "").join("");
// Nov 3: the published brief moved to Nov 3; this fixture is the Oct 15 brief, read from its archive.
const IN = join("lib", "cards", "archive", "2026-10-15", "inputs");
const snapOf = (cik: string) => JSON.parse(readFileSync(join(IN, `${cik}.json`), "utf-8"));
const build = (cik: string, result: any, briefDate: string, previousBrief: string | null, weekFilings: any[]) => {
  const snap = snapOf(cik);
  const fp = join(IN, "facts", `${cik}.json`);
  return buildCard({ result, briefDate, previousBrief, weekFilings, cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: [], facts: existsSync(fp) ? JSON.parse(readFileSync(fp, "utf-8")) : null }) as any;
};

console.log("\n=== W1-W2: the rule ===");
assert(briefDateFor(new Date("2026-10-30T23:30:00Z")) === "2026-10-30", `[W1] 7:30 pm New York on Oct 30 is the brief of Oct 30`);
assert(briefDateFor(new Date("2026-10-31T02:00:00Z")) === "2026-10-30", `[W1] 2 am UTC on Oct 31 is still Oct 30 in New York`);
const w = briefWeek("2026-10-30", "2026-10-15");
assert(w.from === "2026-10-16" && w.to === "2026-10-30", `[W2] the week after the Oct 15 brief runs Oct 16 to Oct 30 (${w.from} to ${w.to})`);
const w0 = briefWeek("2026-10-30", null);
assert(w0.from === "2026-10-24" && w0.to === "2026-10-30", `[W2] a first brief is the trailing seven days (${w0.from} to ${w0.to})`);

console.log("\n=== W3: every committed card follows its brief date ===");
const CIKS = nonEmpty("the published cards", JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[]);
for (const cik of CIKS) {
  const r = snapOf(cik).result;
  const a = build(cik, r, "2026-10-15", "2026-10-04", []), b = build(cik, r, "2026-10-30", "2026-10-15", []);
  const label = (c: any) => c.v3.header.label, call = (c: any) => JSON.stringify(c.v3.call?.label ?? c.v3.call?.title ?? "");
  assert(/Oct 5 to Oct 15/i.test(label(a)) && /Oct 16 to Oct 30/i.test(label(b)), `[W3:${r.company}] header week follows the brief date ("${label(a)}" / "${label(b)}")`);
  const ends = (c: any) => JSON.stringify(c.v3.call).match(/to (Apr \d{1,2}, 2028)/i)?.[1] ?? null;
  assert(ends(a) === "Apr 15, 2028" && ends(b) === "Apr 30, 2028", `[W3:${r.company}] the 18-month window ends 18 months after the brief date (${ends(a)} / ${ends(b)})`);
}

console.log("\n=== W4-W5: an anchor filed in the brief week ===");
const ref = JSON.parse(readFileSync(join("baselines", "s27-molina-refresh.json"), "utf-8")).results.find((x: any) => x.bust === null).result;
const anchor = ref.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling;
const q3 = { form: "10-Q", filingDate: anchor.date, reportDate: anchor.reportDate, accessionNumber: "0001179929-26-000000", primaryDocument: anchor.url.split("/").pop(), primaryDocUrl: anchor.url, items: "" };
const fresh = build("0001179929", ref, "2026-10-30", "2026-10-15", [q3]);
// Nov 3: the filing segment names the form and date, the status says "new this week" (the date once).
const status = `${txt([fresh.v3.header.filing])} · ${txt(fresh.v3.header.status)}`;
const all = JSON.stringify(fresh.v3);
assert(/^10-Q filed Oct 22, 2026 · new this week\b/.test(status) && status.split("Oct 22, 2026").length === 2, `[W4] the header names the 10-Q filed Oct 22 as this week's filing, the date once: "${status}"`);
// The line that calls a NEW filing unread ("Not yet read: this card's position is still …"); Session 27's missing-stage
// lines ("Debt moves this year: not yet read from …") are a different statement and are tested in missingStage.test.
const NEW_UNREAD = /Not yet read: this card's position is still/;
assert(!NEW_UNREAD.test(all), `[W4] no line calls the anchor a new filing "not yet read"`);
const stale = build("0001179929", snapOf("0001179929").result, "2026-10-30", "2026-10-15", [q3]);
const sStatus = txt(stale.v3.header.status);
assert(NEW_UNREAD.test(JSON.stringify(stale.v3)) && !/position/i.test(sStatus), `[W5 control] a card still on the Jul 23 10-Q calls the Oct 22 10-Q new and not yet read, and its header does not claim it ("${sStatus}")`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
