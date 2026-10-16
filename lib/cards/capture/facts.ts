/**
 * THE CARD-FACTS EXTRACTION — approved by Akshay, Oct 15 2026, up to $2.10.
 *
 * One Haiku call per ask per name, THREE asks, over the anchor's debt note and
 * liquidity section, every later filing through the brief date, and (for a
 * rolled position) the note the anchor directs to. It reads what the base
 * extraction never asked for: the printed maturity schedule, sub-facilities and
 * sub-limits, uncommitted capacity, commercial paper facts and backing, parent
 * or unrestricted cash, face amounts where the table is carrying value, the
 * most precise maturity stated per instrument, and every debt move with its
 * funding, use and price.
 *
 * CONDITIONS, each enforced here:
 *   - Own cache key and prompt version (answerCache.cardFactsKey): it cannot
 *     touch a base answer or anything a golden was signed from.
 *   - Class sentences are NOT asked of the model; they are located in code.
 *   - Every fact is verified in code: its sentence is found in a document the
 *     card holds, and that sentence states the value. A fact that fails is
 *     dropped, with the reason, onto the residual list.
 *   - Every fact must reproduce across all three asks. One that varies stays
 *     off the card and goes on the residual list with the variation shown.
 *   - The per-name cost is DECLARED before anything bills, and the run stops if
 *     any name exceeds its band. Without --bill this file only declares.
 *
 * Run: npx tsx lib/cards/capture/facts.ts            (declare, $0)
 *      npx tsx lib/cards/capture/facts.ts --bill     (bill, within the bands)
 */
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cachedCardFacts, cardFactsKey } from "../../cache/answerCache";
import { beginCompanyCostScope, currentCompanySpend, persistCompanySpend, recordUsage } from "../../agent/costMeter";
import { locateDebtNoteSection } from "../../fetch/noteLocation";
import { locateLiquiditySection } from "../../fetch/liquiditySection";
import { createTextLocator } from "../../agent/verifyQuote";
import { amountSupportOf } from "../../events/position";
import { containsWord } from "../labels";
import type { CardFacts, Fact } from "../types";

export const CARD_FACTS_PROMPT_VERSION = 1;
const MODEL = "claude-haiku-4-5";
const ASKS = 3;
const BAND_PER_ASK = 0.12;
const BAND_PER_NAME = 0.35;
const OUTPUT_TOKENS_EST = 3500;
const BILL = process.argv.includes("--bill");
const BRIEF = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-10-15";
const ROOT = process.cwd();
const IN = join(ROOT, "lib", "cards", "inputs");

const SYSTEM = `You transcribe specific facts from SEC filings. You never compute, infer, round or summarize.

Rules for every fact:
- Copy every value VERBATIM as the filing prints it, with the unit the filing prints beside it.
- For every fact, copy the ONE sentence or table line that states it, verbatim, into sourceLine, and the document URL it came from into documentUrl. The value must appear inside that sourceLine.
- If the filing does not state a field, use null. Never fill a field from general knowledge or from another fact.
- Copy funding, use and price phrases verbatim as clauses of their sentence.

What to transcribe:
1. schedule: the filer's printed table or sentence of scheduled principal maturities by year (e.g. "2027 $46.9"). One entry per period as printed, including "thereafter". Use the FACE/principal column where two columns are printed. Empty if none is printed.
2. subFacilities: sub-facilities and sub-limits of a credit facility (letter-of-credit sub-facility, swingline sub-facility, other sub-limits), with the parent facility's name.
3. uncommitted: uncommitted capacity (accordion, incremental term loans or commitments, uncommitted facilities) with its amount if stated.
4. commercialPaper: program size, amount outstanding, average interest rate, and the facility the filer states backs or supports the program. Null if the company states no commercial paper program.
5. cash: cash figures stated for the parent company or as unrestricted cash, with the filer's own label.
6. faces: the principal (face) amount of a debt instrument where a sentence states it, e.g. "$400 million in aggregate principal amount ... remained outstanding".
7. maturities: the most precise maturity date a sentence states for a named debt instrument, e.g. "The 2034 Notes mature on June 1, 2034". Only where the sentence states it is the maturity (not an interest payment date or a redemption date).
8. moves: every debt transaction that HAPPENED or was ANNOUNCED from January 1 of the anchor period's year through ${BRIEF}: issuance, redemption (full, partial, special call), tender or repurchase, repayment at maturity, facility entry/amendment/refinancing/termination, incremental add-ons, material draws or paydowns. Do not include transactions completed before January 1 of that year. status is "pending" when the filing says the company intends, expects or will; otherwise "completed". For each move give the date as printed, the instrument as named, the face amount, and where stated: funding (how it was paid for), use (what the proceeds were used for), price (e.g. "at par", "103% of the principal amount").`;

const FACT = { type: ["object", "null"], properties: { value: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["value", "sourceLine", "documentUrl"] };
const SCHEMA = {
  type: "object",
  properties: {
    schedule: { type: "array", items: { type: "object", properties: { period: { type: "string" }, amount: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["period", "amount", "sourceLine", "documentUrl"] } },
    subFacilities: { type: "array", items: { type: "object", properties: { facility: { type: "string" }, kind: { type: "string", enum: ["letter-of-credit", "swingline", "other"] }, amount: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["facility", "kind", "amount", "sourceLine", "documentUrl"] } },
    uncommitted: { type: "array", items: { type: "object", properties: { description: { type: "string" }, amount: { type: ["string", "null"] }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["description", "amount", "sourceLine", "documentUrl"] } },
    commercialPaper: { type: ["object", "null"], properties: { programSize: FACT, outstanding: FACT, averageRate: FACT, backedBy: FACT } },
    cash: { type: "array", items: { type: "object", properties: { label: { type: "string" }, amount: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["label", "amount", "sourceLine", "documentUrl"] } },
    faces: { type: "array", items: { type: "object", properties: { instrument: { type: "string" }, face: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["instrument", "face", "sourceLine", "documentUrl"] } },
    maturities: { type: "array", items: { type: "object", properties: { instrument: { type: "string" }, maturity: { type: "string" }, sourceLine: { type: "string" }, documentUrl: { type: "string" } }, required: ["instrument", "maturity", "sourceLine", "documentUrl"] } },
    moves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          type: { type: "string", enum: ["issuance", "redemption", "special call", "tender or repurchase", "repayment at maturity", "facility entry", "facility amendment", "facility refinancing", "facility termination", "incremental add-on", "draw", "paydown"] },
          status: { type: "string", enum: ["completed", "pending"] },
          instrument: { type: "string" },
          face: { type: ["string", "null"] },
          sourceLine: { type: "string" },
          documentUrl: { type: "string" },
          funding: FACT,
          use: FACT,
          price: FACT,
        },
        required: ["date", "type", "status", "instrument", "face", "sourceLine", "documentUrl"],
      },
    },
  },
  required: ["schedule", "subFacilities", "uncommitted", "commercialPaper", "cash", "faces", "maturities", "moves"],
};

type Raw = any;

/** The text the model is shown: labelled regions of the documents the card holds. */
function inputFor(snap: any): string {
  const dm = snap.result.results.find((r: any) => r.triggerId === "debt-maturity");
  const anchor = dm.debtScheduleSourceFiling;
  const blocks: string[] = [];
  const block = (label: string, url: string, text: string) => blocks.push(`--- DOCUMENT: ${label} | ${url} ---\n${text}\n--- END DOCUMENT ---`);
  const at = (text: string, s: number, cap: number) => text.slice(s, Math.min(text.length, s + cap)).replace(/[ \t]+/g, " ");
  const a = snap.docs[anchor.url].text as string;
  const note = locateDebtNoteSection(a);
  if (note.status === "found") block(`${anchor.form} ${anchor.date}, debt note`, anchor.url, at(a, note.start, Math.min(note.end - note.start + 2000, 40000)));
  const liq = locateLiquiditySection(a);
  if (liq.status === "found") block(`${anchor.form} ${anchor.date}, liquidity and capital resources`, anchor.url, at(a, liq.start, 24000));
  // The market-risk section, where filers print a by-year maturity table
  // (Item 3). The LAST heading match is the section itself, not its line in
  // the table of contents.
  const mr = [...a.matchAll(/quantitative and qualitative disclosures? about market risk/gi)].pop();
  if (mr && mr.index !== undefined) block(`${anchor.form} ${anchor.date}, market risk`, anchor.url, at(a, mr.index, 7000));
  // A FILER STATES DEBT FACTS OUTSIDE ITS DEBT NOTE: a sub-facility in a
  // covenants section, factoring in a receivables note, commercial paper in an
  // MD&A paragraph. Every other anchor sentence that names a debt instrument
  // and states an amount is included, once — so a fixed region cannot decide
  // what the model is never shown.
  const shown = blocks.join("\n").replace(/\s+/g, " ");
  const INSTR = /credit agreement|credit facilit|revolving|commercial paper|sub-?facilit|swingline|swing line|letters? of credit|factoring|term loan|senior notes|notes due|accordion|incremental|borrowing capacity/i;
  const extra = a.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)/)
    .filter((s) => s.length > 30 && s.length < 1200 && INSTR.test(s) && /\$\s?[\d]/.test(s) && (s.match(/\d[\d,.]*/g) ?? []).length <= 14 && !shown.includes(s.slice(0, 80)));
  if (extra.length) block(`${anchor.form} ${anchor.date}, other sentences naming a debt instrument and an amount`, anchor.url, [...new Set(extra)].join("\n").slice(0, 16000));
  for (const f of snap.laterFilings ?? []) if (f.filingDate <= BRIEF && snap.docs[f.url]) block(`${f.form} ${f.filingDate}`, f.url, at(snap.docs[f.url].text, 0, 20000));
  const base = dm.priorPeriodBase;
  if (base?.filingUrl && snap.docs[base.filingUrl]) {
    const t = snap.docs[base.filingUrl].text as string;
    const n = locateDebtNoteSection(t);
    if (n.status === "found") block(`10-K for ${base.periodOfReport}, the debt note the anchor directs to`, base.filingUrl, at(t, n.start, 30000));
  }
  return [`Company: ${snap.company}`, `Anchor: ${anchor.form} for the period ended ${anchor.reportDate}, filed ${anchor.date}`, `Brief date: ${BRIEF}`, ``, ...blocks].join("\n\n");
}

/** Where a sentence is found among the card's documents, the URL hint first. */
function locate(snap: any, locs: Map<string, ReturnType<typeof createTextLocator>>, sentence: string, hint: string): string | null {
  const urls = [hint, ...Object.keys(snap.docs)].filter((u, i, a) => u && a.indexOf(u) === i && snap.docs[u]);
  for (const u of urls) {
    if (!locs.has(u)) locs.set(u, createTextLocator(snap.docs[u].text));
    if (locs.get(u)!.find(sentence) !== null) return u;
  }
  return null;
}

/** Does `sentence` state `value`? Money by Rule 58's test; anything else verbatim. */
function states(sentence: string, value: string): boolean {
  if (!value) return false;
  if (/\$|million|billion|thousand/i.test(value) && amountSupportOf(value, sentence).kind !== "unsupported") return true;
  return containsWord(sentence, value.trim()) || containsWord(sentence, value.replace(/^\$\s*/, "").trim());
}

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s $,]+/g, "");

const SPLIT = /(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)/;
const flatText = (t: string) => t.replace(/\s+/g, " ");

/**
 * A MOVE'S DETAIL MAY SIT IN THE NEXT SENTENCE OF ITS PARAGRAPH. "In May 2026,
 * we issued…" dates the use-of-proceeds sentence after it; "redemption of all
 * $1.5 billion…" sizes the notice sentence beside it. The value is verified
 * against the move's own sentence first, then the two on either side in the
 * same document, and links to whichever one states it. Never further.
 */
function neighbourStating(snap: any, url: string, sentence: string, value: string): string | null {
  if (states(sentence, value)) return sentence;
  const ss = flatText(snap.docs[url].text).split(SPLIT);
  const head = flatText(sentence).slice(0, 60);
  const i = ss.findIndex((s) => s.includes(head));
  if (i < 0) return null;
  for (const j of [i - 1, i + 1, i - 2, i + 2]) if (ss[j] && states(ss[j], value)) return ss[j];
  return null;
}

/**
 * A PRINTED SCHEDULE IS ONE TABLE. The model quotes each entry as "caption …
 * period amount" — a splice of text that is not contiguous in the filing. So
 * an entry is resolved structurally: its caption must be found in a document
 * and must name maturities or principal payments, and every entry's period and
 * amount must then appear IN ORDER within that one table. Each entry's
 * sentence becomes the real, contiguous table text from the caption through
 * that entry. Entries drawn from separate instrument rows share no such
 * caption and are not a schedule (the CHS and Molina answers).
 */
function resolveSchedule(snap: any, entries: any[], rejected: { fact: string; why: string }[]): any[] {
  if (entries.length === 0) return [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const num = (a: string) => esc(a.replace(/^\$\s*/, "").trim());
  const why = (w: string) => { for (const e of entries) rejected.push({ fact: `schedule ${e.period} ${e.amount}`, why: w }); return []; };
  for (const [url, d] of Object.entries(snap.docs as Record<string, { text: string }>)) {
    const t = flatText(d.text);
    // Where the table is: the model's own table line, located verbatim; failing
    // that, the caption it quoted before the first period.
    const line = flatText(entries[0].sourceLine);
    const quotedCaption = line.split(new RegExp(`\\s*${esc(entries[0].period)}`))[0].trim();
    let at = t.indexOf(line);
    if (at < 0 && quotedCaption.length > 20) at = t.indexOf(quotedCaption);
    if (at < 0) continue;
    // The caption above it must name maturities or principal payments.
    const before = t.slice(Math.max(0, at - 800), at + Math.min(line.length, 200));
    const capM = [...before.matchAll(/[^.]*(?:maturit|principal payments)[^.]*/gi)].pop();
    if (!capM) return why("not a printed schedule: no caption naming maturities or principal payments introduces its table");
    const start = Math.max(0, at - 800) + capM.index!;
    const span = t.slice(start, at + line.length + 1500);
    // Pairs shape: each period followed by its amount, in order.
    let pos = 0;
    const pairs: any[] = [];
    for (const e of entries) {
      const m = new RegExp(`${esc(e.period)}\\s*\\$?\\s*${num(e.amount)}`).exec(span.slice(pos));
      if (!m) break;
      pos += m.index + m[0].length;
      pairs.push({ ...e, src: { sentence: span.slice(0, pos), url } });
    }
    if (pairs.length === entries.length) return pairs;
    // Header shape: the periods in order in a header, the amounts in order on one row after it.
    let hp = 0;
    const headerOk = entries.every((e) => { const i = span.indexOf(e.period, hp); if (i < 0) return false; hp = i + e.period.length; return true; });
    const rowRe = new RegExp(entries.map((e) => `\\$?\\s*${num(e.amount)}`).join("\\s*"));
    const row = headerOk ? rowRe.exec(span.slice(hp)) : null;
    if (headerOk && row) {
      const sentence = span.slice(0, hp + row.index + row[0].length);
      return entries.map((e) => ({ ...e, src: { sentence, url } }));
    }
    return why("its entries are not, in order, in the one table its caption introduces");
  }
  return why("its table is in no document the card holds");
}

/** "to repay …" is a purpose clause: it says what the money was USED for, never how it was funded. */
function sortFundingAndUse(m: any): any {
  if (m.funding?.value && /^\s*(?:\(i\)\s*)?to\s+[a-z]+/i.test(m.funding.value)) return { ...m, use: m.use ?? m.funding, funding: null };
  return m;
}

/** Verify one ask: every kept fact's sentence is in a held document and states its values. */
function verifyAsk(snap: any, raw: Raw, rejected: { fact: string; why: string }[]): Raw {
  const locs = new Map<string, ReturnType<typeof createTextLocator>>();
  const fact = (f: any, label: string): Fact | null => {
    if (!f || !f.value || !f.sourceLine) return null;
    const url = locate(snap, locs, f.sourceLine, f.documentUrl);
    if (!url) { rejected.push({ fact: label, why: "its sentence is in no document the card holds" }); return null; }
    if (!states(f.sourceLine, f.value)) { rejected.push({ fact: label, why: `its sentence does not state "${f.value}"` }); return null; }
    return { value: f.value, src: { sentence: f.sourceLine, url } };
  };
  const row = (r: any, fields: string[], label: string) => {
    const url = r?.sourceLine ? locate(snap, locs, r.sourceLine, r.documentUrl) : null;
    if (!url) { rejected.push({ fact: label, why: "its sentence is in no document the card holds" }); return null; }
    const bad = fields.find((k) => r[k] !== null && r[k] !== undefined && !states(r.sourceLine, String(r[k])));
    if (bad) { rejected.push({ fact: label, why: `its sentence does not state ${bad} "${r[bad]}"` }); return null; }
    return { ...r, src: { sentence: r.sourceLine, url } };
  };
  const cp = raw.commercialPaper;
  return {
    schedule: resolveSchedule(snap, raw.schedule ?? [], rejected),
    // A sub-facility is one its own sentence NAMES as such: a facility's
    // overall size is not a sub-limit of itself (DaVita's answer).
    subFacilities: (raw.subFacilities ?? []).map((r: any) => {
      const ok = row(r, ["amount"], `sub-facility ${r.kind} ${r.amount}`);
      if (ok && !/sub-?facilit|sub-?limit|swing ?line|letters? of credit/i.test(r.sourceLine)) { rejected.push({ fact: `sub-facility ${r.kind} ${r.amount}`, why: "its sentence does not name a sub-facility or sub-limit" }); return null; }
      return ok;
    }).filter(Boolean),
    uncommitted: (raw.uncommitted ?? []).map((r: any) => row(r, ["description", "amount"], `uncommitted ${r.description}`)).filter(Boolean),
    commercialPaper: cp ? { programSize: fact(cp.programSize, "CP program size"), outstanding: fact(cp.outstanding, "CP outstanding"), averageRate: fact(cp.averageRate, "CP average rate"), backedBy: fact(cp.backedBy, "CP backing facility") } : null,
    // Only a parent-company or unrestricted figure belongs here; consolidated
    // cash comes from the filer's tag with its printed line (the snapshot).
    cash: (raw.cash ?? []).map((r: any) => {
      if (!/parent|unrestricted/i.test(`${r.label} ${r.sourceLine}`)) return null;
      return row(r, ["label", "amount"], `cash ${r.label}`);
    }).filter(Boolean),
    faces: (raw.faces ?? []).map((r: any) => row(r, ["instrument", "face"], `face of ${r.instrument}`)).filter(Boolean),
    maturities: (raw.maturities ?? []).map((r: any) => row(r, ["maturity"], `maturity of ${r.instrument}`)).filter(Boolean),
    moves: (raw.moves ?? []).map((m0: any) => {
      const m = sortFundingAndUse(m0);
      const label = `move ${m.type} ${m.instrument} ${m.date}`;
      const url = m.sourceLine ? locate(snap, locs, m.sourceLine, m.documentUrl) : null;
      if (!url) { rejected.push({ fact: label, why: "its sentence is in no document the card holds" }); return null; }
      // Each detail is verified against the sentence that states it — the
      // move's own or an adjacent one in the same paragraph — and links there.
      const dateS = neighbourStating(snap, url, m.sourceLine, m.date);
      if (!dateS) { rejected.push({ fact: label, why: `no sentence in its paragraph states the date "${m.date}"` }); return null; }
      const instS = neighbourStating(snap, url, m.sourceLine, m.instrument) ?? (containsWord(m.sourceLine, m.instrument) ? m.sourceLine : null);
      const faceS = m.face ? neighbourStating(snap, url, m.sourceLine, m.face) : null;
      if (m.face && !faceS) rejected.push({ fact: `face of ${label}`, why: `no sentence in its paragraph states "${m.face}"` });
      return {
        type: m.type, status: m.status,
        date: { value: m.date, src: { sentence: dateS, url } },
        instrument: { value: m.instrument, src: { sentence: instS ?? m.sourceLine, url }, verified: !!instS },
        face: faceS ? { value: m.face, src: { sentence: faceS, url } } : null,
        funding: fact(m.funding, `funding of ${m.instrument}`), use: fact(m.use, `use of ${m.instrument}`), price: fact(m.price, `price of ${m.instrument}`),
      };
    }).filter(Boolean),
  };
}

/** Keep only what all three verified asks state identically; everything else is residual, with the variation. */
function reproduce(asks: Raw[], residual: CardFacts["residual"]): Omit<CardFacts, "cik" | "promptVersion" | "asks" | "costUsd" | "residual"> {
  const keep = <T>(kind: string, key: (x: any) => string, pick: (x: any) => T, list: (a: Raw) => any[]): T[] => {
    const per = asks.map((a) => new Map(list(a).map((x) => [key(x), x])));
    const all = new Set(per.flatMap((m) => [...m.keys()]));
    const out: T[] = [];
    for (const k of all) {
      const present = per.map((m) => m.get(k));
      if (present.every(Boolean)) out.push(pick(present[0]));
      else residual.push({ fact: `${kind}: ${k}`, why: `stated in ${present.filter(Boolean).length} of ${asks.length} asks`, variation: present.map((p, i) => `ask ${i + 1}: ${p ? "present" : "absent"}`) });
    }
    return out;
  };
  const f = (x: any): Fact => ({ value: x.value ?? x, src: x.src });
  const schedule = keep("schedule", (x) => `${squash(x.period)}=${squash(x.amount)}`, (x) => ({ period: x.period, amount: { value: x.amount, src: x.src } }), (a) => a.schedule);
  const subFacilities = keep("sub-facility", (x) => `${x.kind}=${squash(x.amount)}`, (x) => ({ facility: x.facility, kind: x.kind, amount: { value: x.amount, src: x.src } }), (a) => a.subFacilities);
  const uncommitted = keep("uncommitted", (x) => `${squash(x.description)}=${squash(x.amount)}`, (x) => ({ description: { value: x.description, src: x.src }, amount: x.amount ? { value: x.amount, src: x.src } : null }), (a) => a.uncommitted);
  const cash = keep("cash", (x) => `${squash(x.label)}=${squash(x.amount)}`, (x) => ({ label: { value: x.label, src: x.src }, amount: { value: x.amount, src: x.src } }), (a) => a.cash);
  const faces = keep("face", (x) => `${squash(x.instrument)}=${squash(x.face)}`, (x) => ({ instrument: x.instrument, face: { value: x.face, src: x.src } }), (a) => a.faces);
  const maturities = keep("maturity", (x) => `${squash(x.instrument)}=${squash(x.maturity)}`, (x) => ({ instrument: x.instrument, maturity: { value: x.maturity, src: x.src } }), (a) => a.maturities);
  const moveKey = (x: any) => `${x.type}|${x.status}|${squash(x.date.value)}|${squash(x.face?.value)}|${squash(x.instrument.value).slice(0, 40)}`;
  const moves = keep("move", moveKey, (x) => x, (a) => a.moves).map((m: any) => {
    // A move reproduces on its core; each detail must reproduce on its own or it is dropped to the residual.
    const detail = (k: "funding" | "use" | "price") => {
      const vals = asks.map((a) => a.moves.find((y: any) => moveKey(y) === moveKey(m))?.[k]?.value ?? null);
      if (vals.every((v: any) => squash(v) === squash(vals[0]))) return m[k] ? f(m[k]) : null;
      residual.push({ fact: `${k} of the ${m.type} of ${m.instrument.value}`, why: "varied across asks", variation: vals.map((v: any, i: number) => `ask ${i + 1}: ${v ?? "null"}`) });
      return null;
    };
    return { date: m.date, type: m.type, status: m.status, instrument: { value: m.instrument.value, src: m.instrument.src }, face: m.face, funding: detail("funding"), use: detail("use"), price: detail("price") };
  });
  const cps = asks.map((a) => a.commercialPaper);
  let commercialPaper: CardFacts["commercialPaper"] = null;
  if (cps.every(Boolean)) {
    const field = (k: "programSize" | "outstanding" | "averageRate" | "backedBy") => {
      const v = cps.map((c: any) => c[k]?.value ?? null);
      if (v.every((x: any) => squash(x) === squash(v[0]))) return cps[0][k] ? f(cps[0][k]) : null;
      residual.push({ fact: `commercial paper ${k}`, why: "varied across asks", variation: v.map((x: any, i: number) => `ask ${i + 1}: ${x ?? "null"}`) });
      return null;
    };
    commercialPaper = { programSize: field("programSize"), outstanding: field("outstanding"), averageRate: field("averageRate"), backedBy: field("backedBy") };
  } else if (cps.some(Boolean)) residual.push({ fact: "commercial paper program", why: `stated in ${cps.filter(Boolean).length} of ${asks.length} asks`, variation: cps.map((c, i) => `ask ${i + 1}: ${c ? "present" : "absent"}`) });
  return { schedule, subFacilities, uncommitted, commercialPaper, cash, faces, maturities, moves };
}

(async () => {
  const snaps = readdirSync(IN).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(IN, f), "utf-8")));
  // DECLARE FIRST: every name's estimated cost, before anything bills.
  const plan = snaps.map((s) => {
    const input = inputFor(s);
    const inTok = Math.ceil((input.length + SYSTEM.length + JSON.stringify(SCHEMA).length) / 3.6);
    const perAsk = (inTok * 1.0 + OUTPUT_TOKENS_EST * 5.0) / 1e6;
    return { s, input, hash: createHash("sha256").update(input).digest("hex").slice(0, 24), inTok, perAsk, perName: perAsk * ASKS };
  });
  console.log(`DECLARED — card-facts extraction v${CARD_FACTS_PROMPT_VERSION}, ${MODEL}, ${ASKS} asks per name, bands $${BAND_PER_ASK}/ask and $${BAND_PER_NAME}/name`);
  for (const p of plan) console.log(`  ${p.s.company.padEnd(30)} ~${p.inTok.toLocaleString()} input tokens/ask   est $${p.perAsk.toFixed(4)}/ask   $${p.perName.toFixed(4)}/name${p.perAsk > BAND_PER_ASK || p.perName > BAND_PER_NAME ? "   OVER BAND" : ""}`);
  const total = plan.reduce((a, p) => a + p.perName, 0);
  console.log(`  total est $${total.toFixed(4)} against the approved $2.10`);
  if (plan.some((p) => p.perAsk > BAND_PER_ASK || p.perName > BAND_PER_NAME) || total > 2.1) { console.error("STOPPING: a declared estimate exceeds its band. Nothing billed."); process.exit(1); }
  // --dump <dir>: write each name's exact input, so what the model will be shown can be read before it is paid for.
  const dumpAt = process.argv.indexOf("--dump");
  if (dumpAt > 0) { for (const p of plan) writeFileSync(join(process.argv[dumpAt + 1], `input-${p.s.cik}.txt`), p.input, "utf-8"); console.log(`inputs written to ${process.argv[dumpAt + 1]}. Nothing billed.`); return; }
  // --reverify: re-run verification and reproduction over the SAVED raw
  // answers. No client is constructed, so nothing can bill.
  if (process.argv.includes("--reverify")) {
    if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run --reverify with ANTHROPIC_API_KEY="" so nothing can bill'); process.exit(1); }
    for (const p of plan) {
      const saved = JSON.parse(readFileSync(join(IN, "facts", `raw-${p.s.cik}.json`), "utf-8"));
      const prior = JSON.parse(readFileSync(join(IN, "facts", `${p.s.cik}.json`), "utf-8"));
      const rejected: { fact: string; why: string }[] = [];
      const asks = saved.asks.map((r: Raw, i: number) => verifyAsk(p.s, r, i === 0 ? rejected : []));
      const residual: CardFacts["residual"] = rejected.map((r) => ({ fact: r.fact, why: `not verified: ${r.why}`, variation: [] }));
      const facts: CardFacts = { cik: p.s.cik, promptVersion: CARD_FACTS_PROMPT_VERSION, asks: ASKS, costUsd: prior.costUsd, ...reproduce(asks, residual), residual };
      writeFileSync(join(IN, "facts", `${p.s.cik}.json`), JSON.stringify(facts, null, 1) + "\n", "utf-8");
      console.log(`  ${p.s.company.padEnd(30)} kept: ${facts.moves.length} moves, ${facts.schedule.length} schedule, ${facts.subFacilities.length} sub-facilities, ${facts.maturities.length} maturities, ${facts.faces.length} faces; residual ${facts.residual.length}`);
    }
    console.log("\nRe-verified from saved answers. $0, no client constructed.");
    return;
  }
  if (!BILL) { console.log("\nDeclared only. Re-run with --bill to extract. Nothing billed."); return; }

  const client = new Anthropic();
  mkdirSync(join(IN, "facts"), { recursive: true });
  let spent = 0;
  for (const p of plan) {
    beginCompanyCostScope(p.s.company);
    const asks: Raw[] = [];
    const raws: Raw[] = [];
    const rejected: { fact: string; why: string }[] = [];
    for (let ask = 1; ask <= ASKS; ask++) {
      const { data } = await cachedCardFacts(p.s.cik, p.hash, CARD_FACTS_PROMPT_VERSION, ask, async () => {
        const r = await client.messages.create({
          model: MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM,
          messages: [{ role: "user", content: p.input }],
          tools: [{ name: "submit_facts", description: "Submit the transcribed facts.", input_schema: SCHEMA as any }],
          tool_choice: { type: "tool", name: "submit_facts" },
        });
        recordUsage(MODEL, r.usage);
        if (r.stop_reason === "max_tokens") throw new Error(`TRUNCATED — ${p.s.company} ask ${ask}`);
        const tu = r.content.find((b) => b.type === "tool_use");
        if (!tu || tu.type !== "tool_use") throw new Error(`no tool call — ${p.s.company} ask ${ask}`);
        return tu.input as Raw;
      });
      raws.push(data);
      asks.push(verifyAsk(p.s, data, ask === 1 ? rejected : []));
    }
    const spend = currentCompanySpend();
    persistCompanySpend(spend);
    spent += spend.totalUsd;
    const residual: CardFacts["residual"] = rejected.map((r) => ({ fact: r.fact, why: `not verified: ${r.why}`, variation: [] }));
    const facts: CardFacts = { cik: p.s.cik, promptVersion: CARD_FACTS_PROMPT_VERSION, asks: ASKS, costUsd: Number(spend.totalUsd.toFixed(6)), ...reproduce(asks, residual), residual };
    writeFileSync(join(IN, "facts", `${p.s.cik}.json`), JSON.stringify(facts, null, 1) + "\n", "utf-8");
    writeFileSync(join(IN, "facts", `raw-${p.s.cik}.json`), JSON.stringify({ keys: [1, 2, 3].map((a) => cardFactsKey(p.s.cik, p.hash, CARD_FACTS_PROMPT_VERSION, a)), asks: raws }, null, 1) + "\n", "utf-8");
    console.log(`  ${p.s.company.padEnd(30)} $${spend.totalUsd.toFixed(4)} (${spend.totalCalls} calls)  kept: ${facts.moves.length} moves, ${facts.schedule.length} schedule, ${facts.subFacilities.length} sub-facilities, ${facts.maturities.length} maturities, ${facts.faces.length} faces; residual ${facts.residual.length}`);
    if (spend.totalUsd > BAND_PER_NAME) { console.error(`STOPPING: ${p.s.company} cost $${spend.totalUsd.toFixed(4)}, over its $${BAND_PER_NAME} band. No further name billed.`); process.exit(1); }
  }
  console.log(`\nSPEND: $${spent.toFixed(4)} across ${plan.length} names, each measured as it finished.`);
})();
