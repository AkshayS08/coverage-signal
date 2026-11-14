/**
 * SESSION 27 (Akshay, Nov 14, 2026) — THE READ WINDOW COVERS THE CARD.
 *
 * Debt-item 8-Ks are read from the EARLIER of the latest 10-K's filing date and the start of the card's moves window
 * (Jan 1 of the anchor period's year, the card's own fyStart). Applies from each name's next trigger, as decided.
 * Fact retention: a move dated inside the moves window keeps its full statement — every debt-item 8-K filed within a
 * week of the move (an 8-K is due within four business days) is in the read set.
 *   T1  the read set's 8-Ks start at min(latest 10-K filing date, moves-window start)
 *   T2  over the six names (their adopted facts' moves, on the read set the rule gives at their next trigger): no
 *       retention gap
 *   T3  build.ts takes the moves window from movesWindowStart (one home)
 *   control: the Nov 14 rule (debt-item 8-Ks since the latest 10-K only) drops Molina's Feb 6 8-K, the full statement
 *            of its Feb 4 credit-agreement amendment, and fails retention
 *
 * Offline, $0. Run: npx tsx lib/cache/readWindow.test.ts
 */
import { readFileSync } from "node:fs";
import { selectEightKsV2, movesWindowStart, retentionGaps } from "./lastBuild";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const fx = (cik: string) => JSON.parse(readFileSync(`lib/cache/fixtures/filings-${cik}.json`, "utf-8")).filings as any[];
const DEBT = ["1.01", "1.02", "2.03", "2.04", "7.01", "8.01"];
const sinceTenKOnly = (fs: any[]) => { const k = fs.filter((f) => f.form === "10-K").map((f) => f.filingDate).sort().pop() ?? ""; return fs.filter((f) => f.form === "8-K" && f.filingDate >= k && String(f.items).split(",").some((i) => DEBT.includes(i.trim()))); };
/** Moves from the name's adopted facts, by date. */
const movesOf = (cik: string) => (JSON.parse(readFileSync(`lib/cards/inputs/facts/${cik}.json`, "utf-8")).moves ?? []).map((m: any) => ({ date: m.date.value as string, what: `${m.type} ${m.instrument.value}` }));

const mol = fx("0001179929");
const v2 = selectEightKsV2(mol);
const anchor = mol.filter((f) => f.form === "10-Q" || f.form === "10-K").sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))[0];
const tenK = mol.filter((f) => f.form === "10-K").map((f) => f.filingDate).sort().pop()!;
const from = [tenK, movesWindowStart(anchor.reportDate)].sort()[0];
assert(v2.every((f) => f.filingDate >= from) && v2.some((f) => f.filingDate === "2026-02-06"), `[T1] Molina's 8-Ks are read from ${from} (10-K ${tenK}, window ${movesWindowStart(anchor.reportDate)}): ${v2.map((f) => f.filingDate).join(", ")}`);

for (const cik of CIKS) {
  const fs = fx(cik);
  const gaps = retentionGaps(movesOf(cik), fs, new Set(selectEightKsV2(fs).map((f) => f.accessionNumber)));
  assert(gaps.length === 0, `[T2:${cik}] no move loses its full statement${gaps.length ? `: ${gaps.join("; ")}` : ""}`);
}

const build = readFileSync("lib/cards/build.ts", "utf-8");
assert(/const fyStart = movesWindowStart\(/.test(build), `[T3] build.ts takes its moves window from movesWindowStart`);

const ctlGaps = retentionGaps(movesOf("0001179929"), mol, new Set(sinceTenKOnly(mol).map((f) => f.accessionNumber)));
assert(ctlGaps.some((g) => /2026-02-06/.test(g)), `[control] the Nov 14 rule drops Molina's Feb 6 8-K and fails retention: ${ctlGaps.join("; ") || "no gap"}`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
