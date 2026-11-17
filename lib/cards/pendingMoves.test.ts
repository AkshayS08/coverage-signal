/**
 * SESSION 27 (Akshay, Nov 16): PENDING STATUS FOR EVERY MOVE TYPE, AND LIABILITY-MANAGEMENT EVENTS.
 *
 *   N1  every move type, pending, renders "… announced, awaiting confirmation" and never its completed word: issuances,
 *       repurchases, repayments, paydowns, amendments, exchanges, tenders, consent solicitations and redemptions
 *   N2  the facts schema names exchange offer, tender offer and consent solicitation, with the instrument offered and
 *       the consent solicitation stated beside an exchange or tender
 *   N3  a pending liability-management event on any instrument gets a line in the call box. CHS reads exactly:
 *       "Exchange offer announced: any and all of the $1,244MM 6⅞% junior-priority secured notes due 2029, for new
 *       10.250% senior secured notes due 2035, with a consent solicitation to amend the indenture."
 *   N4  the possible-move net keeps press-release sentences and flags pending moves: CHS's Nov 10 8-K sentence is
 *       located as a pending exchange offer
 *   N5  over every card that can be shown or signed, no pending move is rendered as done
 *   controls: the current CHS card ("Nov 9, 2026 · Issued, confirmed by 8-K") fails N5; a pending move rendered as done
 *   fails; the old net (press release discarded) misses the Nov 10 sentence
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/pendingMoves.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { buildCard } from "./build";
import { factsReadSetOf } from "./factsValidity";
import { locateMoveSentences } from "./moveSentences";
import { pendingShownAsDone } from "./pendingMoves";
import { SCHEMA, SYSTEM } from "./capture/facts";
import { everyShownCard } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");

const chs = read("sessions/27/chs_refresh_v3/input.json");
const BRIEF = "2026-11-16";
const U8K = "https://www.sec.gov/Archives/edgar/data/1108109/000119312526454058/d266722d8k.htm";
const S = (chs.docs[U8K].text as string).replace(/\s+/g, " ").match(/On November 9, 2026, Community Health Systems[^]*?governing the Old Notes\./)![0];
const fact = (value: string) => ({ value, src: { sentence: S, url: U8K } });
const base = read("sessions/27/chs_refresh/facts.json");
const factsWith = (moves: any[]) => ({ ...base, anchorUrl: chs.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url, readSet: factsReadSetOf(chs.result), moves: [...base.moves.filter((m: any) => m.date.value !== "November 9, 2026"), ...moves] });
const week = (chs.laterFilings ?? []).filter((f: any) => f.filingDate >= "2026-11-10" && f.filingDate <= BRIEF).map((f: any) => ({ form: f.form, filingDate: f.filingDate, items: f.items ?? "", primaryDocUrl: f.url, accessionNumber: "", reportDate: "", primaryDocument: "" }));
const cardWith = (facts: any) => buildCard({ result: chs.result, briefDate: BRIEF, previousBrief: null, weekFilings: week, cash: chs.cash, textByUrl: new Map(Object.entries(chs.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: chs.periodSentence, laterUrls: (chs.laterFilings ?? []).filter((x: any) => x.filingDate <= BRIEF).map((x: any) => x.url), facts });
const exchange = { date: fact("November 9, 2026"), type: "exchange offer", status: "pending", instrument: fact("6.875% Junior-Priority Secured Notes due 2029"), face: null, funding: null, use: null, price: null, offered: fact("10.250% Senior Secured Notes due 2035"), consent: fact("to solicit consents to certain proposed amendments to the indenture governing the Old Notes") };

// N1: every type, pending
const DONE = /\b(?:Issued|Redeemed|Repurchased|Repaid|Amended|Entered|Terminated|Drew|Exchanged|Tendered|Refinanced|Consents received)\b|confirmed by/;
const TYPES: [string, string][] = [["issuance", "10.250% Senior Secured Notes due 2035"], ["tender or repurchase", "6.875% Junior-Priority Secured Notes due 2029"], ["repayment at maturity", "6.875% Junior-Priority Secured Notes due 2029"], ["paydown", "6.875% Junior-Priority Secured Notes due 2029"], ["facility amendment", "the indenture governing the Old Notes"], ["exchange offer", "6.875% Junior-Priority Secured Notes due 2029"], ["tender offer", "6.875% Junior-Priority Secured Notes due 2029"], ["consent solicitation", "6.875% Junior-Priority Secured Notes due 2029"], ["redemption", "6.875% Junior-Priority Secured Notes due 2029"]];
for (const [type, inst] of TYPES) {
  const facts = factsWith([{ ...exchange, type, instrument: fact(inst), offered: type === "exchange offer" ? exchange.offered : null, consent: null }]);
  const card = cardWith(facts);
  const mv = card.v3!.moves.find((m: any) => /Nov 9, 2026/.test(txt(m.meta)));
  const meta = mv ? txt(mv.meta) + " | " + mv.title.map(txt).join(" ") : "(no move card)";
  assert(!!mv && /announced, awaiting confirmation/.test(meta) && !DONE.test(meta) && pendingShownAsDone(card, facts).length === 0, `[N1:${type}] ${meta}`);
}

// N2: schema
const types: string[] = (SCHEMA as any).properties.moves.items.properties.type.enum;
const props = Object.keys((SCHEMA as any).properties.moves.items.properties);
assert(["exchange offer", "tender offer", "consent solicitation"].every((x) => types.includes(x)) && props.includes("offered") && props.includes("consent") && /exchange offer/.test(SYSTEM), `[N2] move types ${types.filter((x) => /offer|consent/.test(x)).join(", ")}; fields offered, consent`);

// N3: the call box
const want = "Exchange offer announced: any and all of the $1,244MM 6⅞% junior-priority secured notes due 2029, for new 10.250% senior secured notes due 2035, with a consent solicitation to amend the indenture.";
const card = cardWith(factsWith([exchange]));
const lines = (card.v3!.call?.notes ?? []).map(txt);
assert(lines.includes(want), `[N3] CHS call box: ${lines.find((l) => /announced/.test(l)) ?? "(no line)"}`);

// N4: the possible-move net
const located = locateMoveSentences([{ url: U8K, label: "8-K 2026-11-10", text: chs.docs[U8K].text }], "2026-01-01", BRIEF);
const hit = located.find((m) => m.sentence.includes("offer to exchange"));
assert(!!hit && hit.kind === "exchange" && hit.status === "pending" && hit.date === "2026-11-09", `[N4] Nov 10 8-K: ${hit ? `${hit.kind}, ${hit.status}, ${hit.date}` : "not located"}`);
assert(/\bpress release\b/i.test(S), `[N4 control] the old net discarded this sentence: it names a press release`);

// N5: every shown card, and the controls
const factsOf = (s: any) => {
  const p = s.label === "published" ? `lib/cards/inputs/facts/${s.cik}.json` : s.cik === "0001179929" ? "sessions/27/molina_review_facts/0001179929.json" : `sessions/27/refresh/facts/${s.cik}.json`;
  return existsSync(p) ? read(p) : null;
};
for (const s of everyShownCard()) { const v = pendingShownAsDone(s.card, factsOf(s)); assert(v.length === 0, `[N5:${s.key}] ${v.length ? v.join("; ") : "no pending move shown as done"}`); }
const old = pendingShownAsDone(read("sessions/27/chs_refresh/card.json"), base);
assert(old.some((x) => /Issued, confirmed by 8-K/.test(x)), `[N5 control] the current CHS card fails: ${old.join("; ")}`);
const broken = JSON.parse(JSON.stringify(card)); for (const m of broken.v3.moves) for (const sg of m.meta) if (/announced, awaiting confirmation/.test(sg.t ?? "")) sg.t = " · Exchanged";
assert(pendingShownAsDone(broken, factsWith([exchange])).length > 0, `[N5 control] a pending move rendered as done is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
