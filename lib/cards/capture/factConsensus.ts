/**
 * SESSION 27 (Akshay, Nov 16): FACTS CONSENSUS BY IDENTITY, NOT WORDING (factConsensus.test).
 *
 * A fact reaches the card only when all three reads state it. Until Nov 16 "the same fact" meant the same words,
 * squashed: Cigna's third read named "$1,000 million 4.500% notes due September 2030" where the others said "4.500%
 * Senior Notes due 2030", and "approximately $1.0 billion" where they said "$1.0 billion", so its March repayment and
 * its commercial paper outstanding fell to the residual. The same principle deltaIdentity applies to positions: a fact
 * is the same when its identity is.
 *   - instrument: its coupon (a fraction or a decimal), and its maturity year where both state one; a facility by its
 *     kind (revolver, credit agreement, term loan, commercial paper, …)
 *   - amount: its value in dollars
 *   - date: at its stated precision (a month is not a day in it)
 *   - a move: type, status, instrument, amount, date
 *   - funding: its source kinds and its amount
 * The fact kept is the first read's, with its sentence.
 */
import { couponsIn } from "../labels";
import { parseMoneyAmount } from "../../events/position";
import type { CardFacts, Fact } from "../types";

type Raw = any;
const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s $,]+/g, "");
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Maturity year a name states: "due 2032", "due September 15, 2032", "matured in March 2026", "2034 Notes". */
function maturityYear(s: string): string | null {
  const m = /\b(?:due|matur\w*(?:\s+(?:in|on))?)\s+(?:[A-Za-z]+\.?\s+)?(?:\d{1,2},\s*)?(20\d\d)\b/i.exec(s) ?? /\b(20\d\d)\s+(?:senior\s+)?(?:secured\s+)?notes\b/i.exec(s);
  return m ? m[1] : null;
}
const FACILITY: [string, RegExp][] = [["commercial paper", /commercial paper/i], ["revolver", /revolv|line of credit/i], ["abl", /\bABL\b|asset-based/i], ["term loan", /term loan/i], ["receivables", /receivable|factoring|securitization/i], ["credit agreement", /credit agreement|credit facilit/i], ["indenture", /indenture/i]];
const facilityKind = (s: string) => FACILITY.find(([, re]) => re.test(s))?.[0] ?? null;

export function sameInstrument(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ?? "", y = b ?? "";
  const ca = couponsIn(x)[0]?.rate, cb = couponsIn(y)[0]?.rate;
  if (ca !== undefined || cb !== undefined) {
    if (ca === undefined || cb === undefined || Math.abs(ca - cb) > 1e-9) return false;
    const ya = maturityYear(x), yb = maturityYear(y);
    return !ya || !yb || ya === yb;
  }
  const ka = facilityKind(x), kb = facilityKind(y);
  if (ka || kb) { const ya = /\b(20\d\d)\b/.exec(x)?.[1], yb = /\b(20\d\d)\b/.exec(y)?.[1]; return ka === kb && (!ya || !yb || ya === yb); }
  return squash(x) === squash(y);
}

export function sameAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const x = parseMoneyAmount(a), y = parseMoneyAmount(b);
  if (x !== null && y !== null) return Math.abs(x - y) <= 1e-6 * Math.max(Math.abs(x), Math.abs(y), 1);
  return squash(a) === squash(b);
}

const MONTH_ABBR: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/**
 * Nov 18 (Akshay): ONE FORM FOR A DATE, before verification and comparison — ISO ("2026-06-08", "2026-06"), written
 * ("June 8, 2026") and abbreviated ("Jun. 8, 2026", "Sept 2026") read as the written form. Anything else is unchanged.
 */
export function normaliseDate(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  const iso = /^(20\d\d)-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (iso) return iso[3] ? `${FULL[+iso[2] - 1]} ${+iso[3]}, ${iso[1]}` : `${FULL[+iso[2] - 1]} ${iso[1]}`;
  const w = /^([A-Za-z]+)\.?\s+(?:(\d{1,2})\s*,\s*)?(20\d\d)$/.exec(v);
  if (w) {
    const k = w[1].toLowerCase();
    const mo = MONTHS.indexOf(k) + 1 || MONTH_ABBR[k] || MONTH_ABBR[k.slice(0, 3)] && MONTHS[MONTH_ABBR[k.slice(0, 3)] - 1].startsWith(k) && MONTH_ABBR[k.slice(0, 3)];
    if (mo) return w[2] ? `${FULL[mo - 1]} ${+w[2]}, ${w[3]}` : `${FULL[mo - 1]} ${w[3]}`;
  }
  return v;
}
/** A date at its stated precision: "2026-03" for "March 2026", "2026-03-15" for "March 15, 2026" (any form). */
export function dateId(s: string | null | undefined): string {
  const n = normaliseDate(s);
  const m = new RegExp(`\\b(${MONTHS.join("|")})\\s+(?:(\\d{1,2}),\\s*)?(20\\d\\d)\\b`, "i").exec(n);
  if (!m) return squash(s);
  const mm = String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0");
  return m[2] ? `${m[3]}-${mm}-${m[2].padStart(2, "0")}` : `${m[3]}-${mm}`;
}
/** Nov 18 (Akshay): the same date — equal at their precision, or a day within a month stated for the same move. */
export const sameDate = (a: string | null | undefined, b: string | null | undefined) => {
  const x = dateId(a), y = dateId(b);
  return x === y || (/^\d{4}-\d{2}$/.test(x) && y.startsWith(`${x}-`)) || (/^\d{4}-\d{2}$/.test(y) && x.startsWith(`${y}-`));
};
const isMonth = (s: string) => /^\d{4}-\d{2}$/.test(dateId(s));

/**
 * Nov 18 (Akshay): MOVE-TYPE FAMILIES. Types describing the same event resolve to one family; a disagreement across
 * families (an issuance against a repayment) is flagged, never merged.
 */
const FAMILIES: Record<string, string> = {
  "facility amendment": "amendment adding debt", "incremental add-on": "amendment adding debt",
  redemption: "redemption", "special call": "redemption",
  "tender or repurchase": "repurchase", "tender offer": "repurchase",
  "repayment at maturity": "repayment", paydown: "repayment",
  "facility entry": "new facility", "facility refinancing": "new facility",
};
export const moveFamily = (type: string): string => FAMILIES[type] ?? type;
/** The family's type the card renders: an amendment adding debt renders as an amendment (its sentence says incremental). */
const CANONICAL: Record<string, string> = { "amendment adding debt": "facility amendment" };

const SOURCE_KINDS: [string, RegExp][] = [
  ["new debt", /\bproceeds\s+(?:from|of)\s+(?:the\s+|our\s+)?(?:[\w%.\s-]{0,40})?(?:notes|offering|issuance|debentures|term loan)\b|\bissuance proceeds\b|\bnew notes\b/i],
  ["cash on hand", /\bcash\b/i],
  ["borrowings", /\bborrow\w*|\bdraw\w*\b/i],
  ["divestiture proceeds", /\bdivestiture\w*|\bsale of\b/i],
];
const kindsOf = (s: string) => SOURCE_KINDS.filter(([, re]) => re.test(s)).map(([k]) => k).join("+") || squash(s);
const firstMoney = (s: string) => /(?:approximately\s+)?\$\s?[\d,.]+\s*(?:million|billion|thousand)?/i.exec(s)?.[0] ?? null;
/** Funding: the same source kinds and the same amount (where either states one). */
export function sameFunding(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (kindsOf(a) !== kindsOf(b)) return false;
  const ma = firstMoney(a), mb = firstMoney(b);
  return !ma && !mb ? true : sameAmount(ma, mb);
}
const percentOf = (s: string) => /(\d+(?:\.\d+)?)\s*%/.exec(s)?.[1] ?? (/\bpar\b/i.test(s) ? "100" : null);
const samePrice = (a: string | null | undefined, b: string | null | undefined) => (!a && !b) || (!!a && !!b && (percentOf(a) !== null && percentOf(b) !== null ? Number(percentOf(a)) === Number(percentOf(b)) : squash(a) === squash(b)));
const sameRate = samePrice;

/** The items all reads state, matched by `same`: one group per fact, each read's own item; the rest to the residual. */
function consensus<T>(kind: string, lists: T[][], same: (a: T, b: T) => boolean, label: (x: T) => string, residual: CardFacts["residual"]): T[][] {
  const used = lists.map(() => new Set<number>());
  const groups: T[][] = [];
  for (let i = 0; i < lists.length; i++) for (let j = 0; j < lists[i].length; j++) {
    if (used[i].has(j)) continue;
    const x = lists[i][j];
    const hits = lists.map((l, k) => (k === i ? j : l.findIndex((y, n) => !used[k].has(n) && same(x, y))));
    hits.forEach((n, k) => { if (n >= 0) used[k].add(n); });
    if (hits.every((n) => n >= 0)) groups.push(hits.map((n, k) => lists[k][n]));
    else residual.push({ fact: `${kind}: ${label(x)}`, why: `stated in ${hits.filter((n) => n >= 0).length} of ${lists.length} asks`, variation: hits.map((n, k) => `ask ${k + 1}: ${n >= 0 ? "present" : "absent"}`) });
  }
  return groups;
}

/** Keep only what all three verified asks state, by identity; everything else is residual, with the variation. */
export function reproduceFacts(asks: Raw[], residual: CardFacts["residual"]): Omit<CardFacts, "cik" | "promptVersion" | "asks" | "costUsd" | "residual"> {
  const f = (x: any): Fact => ({ value: x.value ?? x, src: x.src });
  const first = <T>(g: T[][]) => g.map((x) => x[0]);
  const schedule = first(consensus("schedule", asks.map((a) => a.schedule ?? []), (a: any, b: any) => squash(a.period) === squash(b.period) && sameAmount(a.amount, b.amount), (x: any) => `${x.period} ${x.amount}`, residual)).map((x: any) => ({ period: x.period, amount: { value: x.amount, src: x.src } }));
  const subFacilities = first(consensus("sub-facility", asks.map((a) => a.subFacilities ?? []), (a: any, b: any) => a.kind === b.kind && sameAmount(a.amount, b.amount), (x: any) => `${x.kind} ${x.amount}`, residual)).map((x: any) => ({ facility: x.facility, kind: x.kind, amount: { value: x.amount, src: x.src } }));
  const uncommitted = first(consensus("uncommitted", asks.map((a) => a.uncommitted ?? []), (a: any, b: any) => sameAmount(a.amount, b.amount) && (facilityKind(a.description) ? facilityKind(a.description) === facilityKind(b.description) : squash(a.description) === squash(b.description)), (x: any) => `${x.description} ${x.amount ?? ""}`, residual)).map((x: any) => ({ description: { value: x.description, src: x.src }, amount: x.amount ? { value: x.amount, src: x.src } : null }));
  const cash = first(consensus("cash", asks.map((a) => a.cash ?? []), (a: any, b: any) => sameAmount(a.amount, b.amount), (x: any) => `${x.label} ${x.amount}`, residual)).map((x: any) => ({ label: { value: x.label, src: x.src }, amount: { value: x.amount, src: x.src } }));
  const faces = first(consensus("face", asks.map((a) => a.faces ?? []), (a: any, b: any) => sameInstrument(a.instrument, b.instrument) && sameAmount(a.face, b.face), (x: any) => `${x.instrument} ${x.face}`, residual)).map((x: any) => ({ instrument: x.instrument, face: { value: x.face, src: x.src } }));
  const maturities = first(consensus("maturity", asks.map((a) => a.maturities ?? []), (a: any, b: any) => sameInstrument(a.instrument, b.instrument) && sameDate(a.maturity, b.maturity), (x: any) => `${x.instrument} ${x.maturity}`, residual)).map((x: any) => ({ instrument: x.instrument, maturity: { value: x.maturity, src: x.src } }));
  const sameEvent = (a: any, b: any) => a.status === b.status && sameInstrument(a.instrument.value, b.instrument.value) && sameAmount(a.face?.value, b.face?.value) && sameDate(a.date.value, b.date.value);
  const sameMove = (a: any, b: any) => moveFamily(a.type) === moveFamily(b.type) && sameEvent(a, b);
  const lists = asks.map((a) => a.moves ?? []);
  // Nov 18: the same event typed in different families by different reads is flagged, never merged.
  const flagged = new Set<string>();
  for (let i = 0; i < lists.length; i++) for (let j = i + 1; j < lists.length; j++) for (const a of lists[i]) for (const b of lists[j]) {
    if (moveFamily(a.type) === moveFamily(b.type) || !sameEvent(a, b)) continue;
    const k = [moveFamily(a.type), moveFamily(b.type)].sort().join(" / ") + `|${a.instrument.value}|${dateId(a.date.value)}`;
    if (flagged.has(k)) continue;
    flagged.add(k);
    residual.push({ fact: `move: ${a.instrument.value} ${a.date.value}`, why: `move types disagree across reads: ${a.type} (ask ${i + 1}) / ${b.type} (ask ${j + 1}); not merged`, variation: [] });
  }
  const moves = consensus("move", lists, sameMove, (x: any) => `${x.type} ${x.status} ${x.date.value} ${x.face?.value ?? ""} ${x.instrument.value}`, residual).map((g: any[]) => {
    // Nov 18: one type for the family (the most often read, the family's canonical where it has one); one date — where
    // the reads differ in precision, the month: the card keeps the day only where a sentence states completion on it.
    const fam = moveFamily(g[0].type);
    const counts = new Map<string, number>(); for (const y of g) counts.set(y.type, (counts.get(y.type) ?? 0) + 1);
    const type = CANONICAL[fam] ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const monthly = g.find((y) => isMonth(y.date.value));
    const m = { ...g[0], type, date: monthly && g.some((y) => !isMonth(y.date.value)) ? monthly.date : g[0].date };
    // A move reproduces on its identity; each detail must reproduce on its own identity, or it is dropped to the residual.
    const detail = (k: "funding" | "use" | "price" | "offered" | "consent", same: (a: string | null, b: string | null) => boolean) => {
      const vals = g.map((y) => y[k]?.value ?? null);
      if (vals.every((v) => same(v, vals[0]))) return m[k] ? f(m[k]) : null;
      residual.push({ fact: `${k} of the ${m.type} of ${m.instrument.value}`, why: "varied across asks", variation: vals.map((v, i) => `ask ${i + 1}: ${v ?? "null"}`) });
      return null;
    };
    return { date: m.date, type: m.type, status: m.status, instrument: { value: m.instrument.value, src: m.instrument.src }, face: m.face, funding: detail("funding", sameFunding), use: detail("use", (a, b) => squash(a) === squash(b)), price: detail("price", samePrice), offered: detail("offered", (a, b) => (!a && !b) || (!!a && !!b && sameInstrument(a, b))), consent: detail("consent", (a, b) => !a === !b) };
  });
  const cps = asks.map((a) => a.commercialPaper);
  let commercialPaper: CardFacts["commercialPaper"] = null;
  if (cps.every(Boolean)) {
    const field = (k: "programSize" | "outstanding" | "averageRate" | "backedBy", same: (a: string | null, b: string | null) => boolean) => {
      const v = cps.map((c: any) => c[k]?.value ?? null);
      if (v.every((x: any) => same(x, v[0]))) return cps[0][k] ? f(cps[0][k]) : null;
      residual.push({ fact: `commercial paper ${k}`, why: "varied across asks", variation: v.map((x: any, i: number) => `ask ${i + 1}: ${x ?? "null"}`) });
      return null;
    };
    commercialPaper = { programSize: field("programSize", sameAmount), outstanding: field("outstanding", sameAmount), averageRate: field("averageRate", sameRate), backedBy: field("backedBy", (a, b) => (!a && !b) || (!!a && !!b && sameInstrument(a, b))) };
  } else if (cps.some(Boolean)) residual.push({ fact: "commercial paper program", why: `stated in ${cps.filter(Boolean).length} of ${asks.length} asks`, variation: cps.map((c, i) => `ask ${i + 1}: ${c ? "present" : "absent"}`) });
  return { schedule, subFacilities, uncommitted, commercialPaper, cash, faces, maturities, moves };
}
