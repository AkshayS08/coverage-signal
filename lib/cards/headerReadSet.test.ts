/**
 * SESSION 27 (Akshay, Nov 16): A FILING IS "READ" IF IT IS IN THE BUILD'S READ SET. The header and Not shown check the
 * read set (the result's recordedReadSet: what the base read and what a dig opened); they never assume the week's
 * filings are unread.
 *
 * CHS's refresh read its Nov 10 8-K (the trigger), yet its card said "read at the next refresh" and, under Not shown,
 * "its text is not read": the header treated every filing of the week as unread.
 *   H1  CHS's refresh card: the Nov 10 8-K, in its read set, is "read for this card"; nothing says it is unread
 *   H2  the same card with that 8-K outside the read set: "read at the next refresh", and Not shown says it is not read
 *   H3  every shown card: each filing its header names is said read exactly when it is in that card's read set
 *   control: the CHS card built before this rule (sessions/27/chs_refresh/card.json) says a read filing is unread
 *
 * Offline, $0. Run: npx tsx lib/cards/headerReadSet.test.ts
 */
import { readFileSync } from "node:fs";
import { buildCard } from "./build";
import { READ_WHEN, READ_FOR_CARD } from "./filingWords";
import { shownCards } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");
const headerOf = (card: any) => [txt(card.v3.header.status), ...(card.v3.header.actionable ?? []).map(txt)].join(" | ");
const notShownOf = (card: any) => (card.v3.notShown ?? []).map(txt).join(" | ");

const BRIEF = "2026-11-16";
const input = JSON.parse(readFileSync("sessions/27/chs_refresh/input.json", "utf-8"));
const NOV10 = "https://www.sec.gov/Archives/edgar/data/1108109/000119312526454058/d266722d8k.htm";
const week = (input.laterFilings ?? []).filter((f: any) => f.filingDate >= "2026-11-10" && f.filingDate <= BRIEF).map((f: any) => ({ form: f.form, filingDate: f.filingDate, items: f.items ?? "", primaryDocUrl: f.url, accessionNumber: "", reportDate: "", primaryDocument: "" }));
const build = (result: any) => buildCard({ result, briefDate: BRIEF, previousBrief: null, weekFilings: week, cash: input.cash, textByUrl: new Map(Object.entries(input.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: input.periodSentence, laterUrls: (input.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts: null });

const read = build(input.result);
const h1 = headerOf(read), n1 = notShownOf(read);
assert(week.some((f: any) => f.primaryDocUrl === NOV10) && h1.includes(READ_FOR_CARD) && !h1.includes(READ_WHEN) && !/not read/.test(n1), `[H1] the Nov 10 8-K, in the read set: "${h1.slice(0, 140)}"`);

const unreadResult = { ...input.result, recordedReadSet: input.result.recordedReadSet.filter((r: any) => r.url !== NOV10) };
const unread = build(unreadResult);
const h2 = headerOf(unread), n2 = notShownOf(unread);
assert(h2.includes(READ_WHEN) && !h2.includes(READ_FOR_CARD) && /not read/.test(n2), `[H2] outside the read set: "${h2.slice(0, 120)}"; Not shown: "${n2.slice(0, 100)}"`);

for (const s of shownCards()) {
  const readUrls = new Set((s.input.result.recordedReadSet ?? []).map((r: any) => r.url));
  const named = [...(s.card.v3.header.status ?? [])].filter((x: any) => x.k === "filing" && x.url !== s.card.v3.header.filing?.url);
  const h = headerOf(s.card);
  const wrong = named.filter((f: any) => (readUrls.has(f.url) ? !h.includes(READ_FOR_CARD) : !h.includes(READ_WHEN)));
  assert(wrong.length === 0, `[H3:${s.card.company} ${s.label}] ${named.length} filing(s) named; each said read exactly when in the read set${wrong.length ? `; wrong: ${wrong.map((f: any) => f.t).join(", ")}` : ""}`);
}

const before = JSON.parse(readFileSync("sessions/27/chs_refresh/card.json", "utf-8"));
assert(headerOf(before).includes(READ_WHEN) && /its text is not read/.test(notShownOf(before)), `[control] the CHS card built before this rule calls its read Nov 10 8-K unread: "${headerOf(before).slice(0, 110)}"`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
