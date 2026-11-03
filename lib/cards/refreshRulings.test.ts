/**
 * SESSION 27 (Akshay, Nov 3, 2026) — QUALIFIERS, REMAINS AFTER EACH MOVE, THE HEADER, CONFIRMATION, PAIRING.
 * Each rule over all ten cards (the six committed, the four refreshes), each with a control that must fail.
 * Rules: lib/cards/refreshRulings.ts. Offline, $0. Run: npx tsx lib/cards/refreshRulings.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rulingViolations } from "./refreshRulings";
import { buildCard } from "./build";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const CIKS = read(join("lib", "cards", "generated", "index.json")).ciks as string[];
const cards: { label: string; card: any; input: any }[] = [
  ...CIKS.map((c) => ({ label: "committed", card: read(join("lib", "cards", "generated", `${c}.json`)), input: read(join("lib", "cards", "inputs", `${c}.json`)) })),
  ...["0000070318", "0000927066", "0001108109"].map((c) => ({ label: "refresh", card: read(join("sessions", "27", "refresh", `${c}_review_card.json`)), input: read(join("sessions", "27", "refresh", `${c}_input.json`)) })),
  { label: "refresh", card: read(join("sessions", "27", "molina_review_card.json")), input: read(join("sessions", "27", "molina_review_input.json")) },
];
for (const x of cards) {
  const v = rulingViolations(x.card, x.input);
  for (const k of ["Q", "R", "H", "C", "P"] as const) assert(v[k].length === 0, `[${k}:${x.card.company} ${x.label}]${v[k].length ? ` — ${v[k].join("; ")}` : " holds"}`);
}
const ref = (cik: string) => cards.find((x) => x.label === "refresh" && x.card.cik === cik)!;
const ten = ref("0000070318"), chs = ref("0001108109"), mol = ref("0001179929");

console.log("\n=== the named cases ===");
const liq = txt((mol.card.v3.liquidity.notes ?? []).flat());
assert(/up to \$800MM of uncommitted incremental term loans/.test(liq), `[Q] Molina reads "up to $800MM of uncommitted incremental term loans…" ("${liq.slice(0, 140)}")`);
const chsMoves = chs.card.v3.moves.map((m: any) => `${txt(m.meta)} | ${m.title.map(txt).join(" / ")}`);
assert(chsMoves.some((l: string) => /^Feb 2, 2026/.test(l) && /10⅞%[^/]*\$1,780MM remains/.test(l)) && chsMoves.some((l: string) => /^May 6, 2026/.test(l) && /10⅞%[^/]*\$1,549MM remains/.test(l)), `[R] CHS: Feb 2 "$1,780MM remains", May 6 "$1,549MM remains" (${chsMoves.join(" || ")})`);
const head = `${txt([ten.card.v3.header.filing])} · ${txt(ten.card.v3.header.status)}`;
assert(/^10-Q filed Oct 29, 2026 · new this week · 1 other filing, none affecting debt$/.test(head), `[H] Tenet's header: "${head}"`);
const css = readFileSync(join("app", "cards", "cardsV3.module.css"), "utf-8");
assert(/\.headerRight\s*\{[^}]*margin-left:\s*auto/.test(css) && /\.headerRight\s*\{[^}]*text-align:\s*right/.test(css), `[H] the right-hand header block stays right-aligned when it wraps (margin-left: auto; text-align: right)`);
assert(ten.card.v3.moves.some((m: any) => /Sept 22, 2026 · Issued, confirmed by 8-K/.test(txt(m.meta))), `[C] Tenet's issuance cites the Sept 22 8-K (${ten.card.v3.moves.map((m: any) => txt(m.meta)).join(" | ")})`);

console.log("\n=== controls ===");
const q = clone(mol.card); for (const l of q.v3.liquidity.notes) for (const s of l) if (s.k === "label" && /incremental term loans/.test(s.t)) { s.t = "incremental term loans to finance certain acquisitions"; s.stated = s.t; }
assert(rulingViolations(q, mol.input).Q.length > 0, `[Q control] "up to $800MM of incremental term loans…", without "uncommitted", is flagged`);
const r = clone(chs.card); for (const m of r.v3.moves) for (const l of m.title) for (const s of l) if (s.k === "computed" && /1,780/.test(s.t)) s.t = "$1,549MM";
assert(rulingViolations(r, chs.input).R.length > 0, `[R control] CHS's Feb 2 move reading "$1,549MM remains" is flagged`);
const h = clone(ten.card); h.v3.header.status = [{ k: "text", t: "New this week: this 10-Q, filed Oct 29, 2026, is the position · 1 other filing, none affecting debt" }];
assert(rulingViolations(h, ten.input).H.length > 0, `[H control] the date stated twice is flagged`);
const c = clone(ten.card); for (const m of c.v3.moves) for (const s of m.meta) if (typeof s.t === "string") s.t = s.t.replace("confirmed by 8-K", "confirmed by 10-Q");
assert(rulingViolations(c, ten.input).C.length > 0, `[C control] "confirmed by 10-Q" where the Sept 22 8-K states it first is flagged`);
// P control: Tenet's refresh with every "proceeds" taken out of its documents and facts — the funding sentences still
// name the "2034 Senior Notes", so the issuance must still pair with both redemptions.
const batch = read("baselines/s27-refresh-batch.json").names.find((n: any) => n.cik === "0000070318");
const result = batch.samples.find((s: any) => s.bust === null).result;
const noProceeds = (x: string) => x.replace(/\b(?:net\s+)?(?:issuance\s+)?proceeds\b/gi, "funds");
const facts = JSON.parse(noProceeds(readFileSync("sessions/27/refresh/facts/0000070318.json", "utf-8")));
const pc = buildCard({ result, briefDate: "2026-10-31", previousBrief: "2026-10-15", weekFilings: [], cash: ten.input.cash, textByUrl: new Map(Object.entries(ten.input.docs as Record<string, { text: string }>).map(([u, d]) => [u, noProceeds(d.text)])), periodSentence: ten.input.periodSentence, laterUrls: [], facts });
const pair = pc.v3!.moves.find((m: any) => m.retires);
assert(!!pair && pair.retires!.items.length === 2 && /2034/.test(txt(pair.title[0])), `[P control] with no "proceeds" anywhere, the funding sentence naming the "2034 Senior Notes" still pairs the issuance with both redemptions (${pc.v3!.moves.map((m: any) => txt(m.meta)).join(" | ")})`);

console.log("\n=== P2: a reference inside a one-issuance document pairs by identity (Nov 3) ===");
// "this offering", "the offering" and "the Notes" in a document that reports exactly one issuance refer to that
// issuance: paired, no flag. The proceeds-wording flag applies only where the document reports more than one.
const enc = cards.find((x) => x.label === "committed" && x.card.cik === "0000785161")!;
const flags = (c: any) => (c.v3.notShown ?? []).map(txt).filter((l: string) => /^Paired by/.test(l));
const may = enc.card.v3.moves.find((m: any) => /May 29, 2026 · Issued/.test(txt(m.meta)));
assert(flags(enc.card).length === 0 && !!may?.retires && may.retires.items.length === 2, `[P2] Encompass: both retirements pair with the May 29 issue, no "Paired by" line (${flags(enc.card).length} flag line(s); ${may?.retires?.items.map(txt).join(" / ") ?? "no pair"})`);
const encResult = read(join("baselines", "golden", "0000785161.json")).sourceResult;
const encFacts = read(join("lib", "cards", "inputs", "facts", "0000785161.json"));
const encWeek = read(join("lib", "cards", "inputs", "week", `${enc.card.briefDate}.json`)).names["0000785161"];
const encBuild = (docs: Record<string, { text: string }>) => buildCard({ result: enc.input.result ?? encResult, briefDate: enc.card.briefDate, previousBrief: encWeek?.previousBrief ?? null, weekFilings: encWeek?.filings ?? [], cash: enc.input.cash, textByUrl: new Map(Object.entries(docs).map(([u, d]) => [u, d.text])), periodSentence: enc.input.periodSentence, laterUrls: (enc.input.laterFilings ?? []).filter((x: any) => x.filingDate <= enc.card.briefDate).map((x: any) => x.url), facts: encFacts });
// The 10-Q's "this offering" as the only link: without the 8-Ks that name the May notes by their defined term.
const only10Q = clone(enc.input.docs) as Record<string, { label: string; text: string }>;
for (const u of Object.keys(only10Q)) if (/^8-K 2026-0[56]/.test(only10Q[u].label)) delete only10Q[u];
const one = encBuild(only10Q);
const oneMay = one.v3!.moves.find((m: any) => /May 29, 2026 · Issued/.test(txt(m.meta)));
assert(flags(one).length === 0 && oneMay?.retires?.items.length === 2, `[P2] with only the 10-Q's "this offering" (one issuance reported), both retirements pair by identity, no flag (${flags(one).length} flag line(s))`);
// Control: the same 10-Q reporting a second issuance in the year — "this offering" no longer identifies one.
const two = clone(only10Q);
const q2 = Object.keys(two).find((u) => /^10-Q 2026-08-07/.test(two[u].label))!;
two[q2].text = two[q2].text.replace(/We used the net proceeds from this offering/, "In June 2026, we issued $300 million of 6.000% Senior Notes due 2036 (the “2036 Notes”) at par. We used the net proceeds from this offering");
const twoCard = encBuild(two);
assert(flags(twoCard).length > 0, `[P2 control] with a second issuance reported in the same 10-Q, "this offering" pairs only by the fallback and flags (${flags(twoCard).length} flag line(s))`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
