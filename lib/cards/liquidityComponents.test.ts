/**
 * SESSION 27 (Akshay, Oct 23, 2026) — LIQUIDITY NEVER DROPS A COMPONENT
 * BECAUSE ANOTHER FIELD CHANGED. Undrawn capacity and the commercial-paper
 * netting render whenever their inputs are stated; an uncertain component is
 * flagged, never omitted.
 *
 * Cigna's v33 answer dropped the revolver's stated availability. The v3
 * liquidity bar skipped every facility without one, so the undrawn revolver
 * vanished and the CP netting (Akshay's ruling) with it, although the
 * revolver's size and drawn figure were stated and the CP outstanding too.
 *
 *   Q1  over all six cards (committed inputs): every committed lender facility
 *       with a stated size or availability has an "Undrawn" legend entry
 *   Q2  with every facility's stated availability REMOVED: the same entries
 *       still render (computed from size less drawn, flagged where letters of
 *       credit outstanding is not stated), and Cigna's CP netting note stays
 *   Q3  Cigna as its v33 answer has it: undrawn revolver and CP netting render
 *   control: an entry missing from the legend is caught by the same check
 *
 * Offline, $0. Run: npx tsx lib/cards/liquidityComponents.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCard } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = ["0000070318", "0000785161", "0000927066", "0001108109", "0001179929", "0001739940"];
const week = JSON.parse(readFileSync("lib/cards/inputs/week/2026-10-15.json", "utf-8"));
const text = (l: any[]) => l.map((s: any) => s.t).join("");
function build(cik: string, mutate?: (result: any) => void, result?: any) {
  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
  const r = JSON.parse(JSON.stringify(result ?? snap.result));
  mutate?.(r);
  const factsPath = join("lib", "cards", "inputs", "facts", `${cik}.json`);
  const w = week.names[cik];
  return buildCard({ result: r, briefDate: "2026-10-15", previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= "2026-10-15").map((x: any) => x.url), facts: existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf-8")) : null } as any);
}
const lenders = (r: any) => (r.results.find((t: any) => t.triggerId === "debt-maturity")?.facilities ?? []).filter((f: any) => !/commercial-paper|letter-of-credit/.test(f.category ?? "") && !/commercial paper|letter of credit facility/i.test(f.name) && (f.available || f.facilitySize));
const undrawnEntries = (card: any) => (card.v3?.liquidity.legend ?? []).filter((e: any) => /^Undrawn/.test(text(e.label)));
const nettingNote = (card: any) => (card.v3?.liquidity.notes ?? []).some((n: any) => /shown net of .* commercial paper/i.test(text(n)));

for (const cik of CIKS) {
  const snap = JSON.parse(readFileSync(join("lib", "cards", "inputs", `${cik}.json`), "utf-8"));
  const want = lenders(snap.result).length;
  const card = build(cik);
  assert(undrawnEntries(card).length >= want, `[Q1:${snap.company}] ${want} lender facilit(ies) with a stated size or availability, ${undrawnEntries(card).length} undrawn entr(ies)`);
  const stripped = build(cik, (r) => { for (const f of r.results.find((t: any) => t.triggerId === "debt-maturity")?.facilities ?? []) f.available = null; });
  assert(undrawnEntries(stripped).length >= want, `[Q2:${snap.company}] with every stated availability removed, still ${undrawnEntries(stripped).length} undrawn entr(ies) of ${want}`);
  if (nettingNote(card)) assert(nettingNote(stripped), `[Q2:${snap.company}] the CP netting note stays when availability is removed`);
}

console.log("\n=== Q3: Cigna as its v33 answer has it ===");
const replay = existsSync("baselines/s27-replay.json") ? JSON.parse(readFileSync("baselines/s27-replay.json", "utf-8")) : null;
const cr = replay?.results.find((x: any) => x.result.cik === "0001739940")?.result;
if (cr) {
  const card = build("0001739940", undefined, cr);
  assert(undrawnEntries(card).length >= 1, `[Q3] the undrawn revolver renders (${undrawnEntries(card).map((e: any) => text(e.label)).join("; ")})`);
  assert(nettingNote(card), `[Q3] the CP netting note renders`);
}

console.log("\n=== Q4-Q5: a stated availability beats a computed one (Cigna ruling (c)) ===");
if (cr) {
  const card = build("0001739940", undefined, cr);
  const amt = undrawnEntries(card)[0]?.amount;
  assert(amt?.k === "figure" && /undrawn committed capacity under our revolving credit agreement/i.test(amt.src.sentence) && /6,500|6\.5/.test(amt.t), `[Q4] the v33 card shows the revolver's stated availability (${amt?.t}), from "${amt?.src?.sentence?.slice(0, 70)}…"`);
  assert(!(card.v3?.liquidity.notes ?? []).some((n: any) => /computed as size less drawn/i.test(text(n))), `[Q4] and drops the computed flag`);
  assert(!(card.v3?.liquidity.legend ?? []).some((e: any) => /^Undrawn/.test(text(e.label)) && /5,500|5\.5/.test(e.amount?.t ?? "")), `[Q5] the commercial paper program's "$5.5 billion of remaining capacity" is never the revolver's availability`);
  // control: with that sentence gone from the documents, the computed flag stands
  const snap = JSON.parse(readFileSync("lib/cards/inputs/0001739940.json", "utf-8"));
  const w = week.names["0001739940"];
  const docs = new Map(Object.entries(snap.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text.replace(/we had \$6\.5 billion of undrawn committed capacity under our revolving credit agreement/g, "we had a revolving credit agreement")]));
  const c2 = buildCard({ result: cr, briefDate: "2026-10-15", previousBrief: w?.previousBrief ?? null, weekFilings: w?.filings ?? [], cash: snap.cash, textByUrl: docs, periodSentence: snap.periodSentence, laterUrls: (snap.laterFilings ?? []).filter((x: any) => x.filingDate <= "2026-10-15").map((x: any) => x.url), facts: JSON.parse(readFileSync("lib/cards/inputs/facts/0001739940.json", "utf-8")) } as any);
  assert((c2.v3?.liquidity.notes ?? []).some((n: any) => /computed as size less drawn/i.test(text(n))), `[Q4 control] with no sentence stating availability, the computed flag stands`);
}

console.log("\n=== control ===");
const c = build("0001739940");
const lost = JSON.parse(JSON.stringify(c)); lost.v3.liquidity.legend = lost.v3.liquidity.legend.filter((e: any) => !/^Undrawn/.test(text(e.label)));
assert(undrawnEntries(lost).length < lenders(JSON.parse(readFileSync("lib/cards/inputs/0001739940.json", "utf-8")).result).length, `[control] a legend with its undrawn entry removed is caught`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
