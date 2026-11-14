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
 *
 * SESSION 27 (Oct 30): a refresh runs this stage on the NEW anchor without
 * touching the committed facts:
 *      --input <card-input.json>   one name's card input (e.g. a review capture)
 *      --out <dir>                 where its facts are written (not lib/cards/inputs/facts)
 *      --price                     count every ask's input pre-call (spend guard, price-only) and stop: $0
 *      --limit <usd>               with --bill: the approved ceiling the guard holds, pre-call
 */
import { guardedCreate, setPriceOnly, setSpendLimits, pricedCalls } from "../../agent/spendGuard";
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { briefDateArg } from "../briefDate";
import { locateMoveSentences } from "../moveSentences";
import { placedInsideParent } from "../subFacility";
import { cachedCardFacts, cardFactsKey } from "../../cache/answerCache";
import { readCache } from "../../fetch/cache";
import { beginCompanyCostScope, currentCompanySpend, persistCompanySpend, recordUsage } from "../../agent/costMeter";
import { locateDebtNoteSection } from "../../fetch/noteLocation";
import { locateLiquiditySection } from "../../fetch/liquiditySection";
import { createTextLocator } from "../../agent/verifyQuote";
import { amountSupportOf } from "../../events/position";
import { containsWord } from "../labels";
import type { CardFacts, Fact } from "../types";
import { verifyAsk } from "./verifyFacts";
import { factsForBuild } from "./factsForBuild";

export const CARD_FACTS_PROMPT_VERSION = 1;
export const MODEL = "claude-haiku-4-5";
export const ASKS = 3;
const BAND_PER_ASK = 0.12;
const BAND_PER_NAME = 0.35;
const OUTPUT_TOKENS_EST = 3500;
const BILL = process.argv.includes("--bill");
const BRIEF = briefDateArg(); // Session 27: today's date in New York unless one is given
const ROOT = process.cwd();
const IN = join(ROOT, "lib", "cards", "inputs");

export const SYSTEM = `You transcribe specific facts from SEC filings. You never compute, infer, round or summarize.

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
export const SCHEMA = {
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

/** Session 27 (Oct 30): the anchor the facts are read from, recorded on them. */
const anchorUrlOf = (snap: any): string => snap.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;

/** The text the model is shown: labelled regions of the documents the card holds. */
export function inputFor(snap: any): string {
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
  // Decision 11 (Nov 9): the same read set as extraction — the debt-item 8-Ks filed since the latest 10-K, even those
  // before the anchor, which state move detail (the day, the amount, the funding) a 10-Q may give only by month. The
  // card input records them through the one deciding function (debtEightKsSinceTenK).
  const later = new Set((snap.laterFilings ?? []).map((f: any) => f.url));
  for (const f of snap.debtEightKs ?? []) if (f.filingDate <= BRIEF && snap.docs[f.url] && !later.has(f.url)) block(`${f.form} ${f.filingDate}, a debt-item 8-K since the latest 10-K`, f.url, at(snap.docs[f.url].text, 0, 20000));
  const base = dm.priorPeriodBase;
  if (base?.filingUrl && snap.docs[base.filingUrl]) {
    const t = snap.docs[base.filingUrl].text as string;
    const n = locateDebtNoteSection(t);
    if (n.status === "found") block(`10-K for ${base.periodOfReport}, the debt note the anchor directs to`, base.filingUrl, at(t, n.start, 30000));
  }
  // SESSION 27 (Akshay, Oct 31): THE CAUSE OF MOLINA'S MISSED MOVE. On its Q3 anchor all three asks omitted a move
  // sentence they were shown (year-scoped instruction; the Q2 asks returned it). Move sentences are located in code and
  // listed for the stage to account for; the card checks the same list (moveSentences.ts).
  const candidates = locateMoveSentences(Object.entries(snap.docs as Record<string, { label: string; text: string }>).map(([url, d]) => ({ url, label: d.label, text: d.text })), `${String(anchor.reportDate).slice(0, 4)}-01-01`, BRIEF);
  if (candidates.length) block(`CANDIDATE MOVE SENTENCES, located in code — return EACH one that states a debt transaction as a move (with this sentence as its sourceLine); omit one only if it is not a debt transaction`, anchor.url, candidates.map((c) => `${c.date} | ${c.label} | ${c.url} | ${c.sentence}`).join("\n"));
  return [`Company: ${snap.company}`, `Anchor: ${anchor.form} for the period ended ${anchor.reportDate}, filed ${anchor.date}`, `Brief date: ${BRIEF}`, ``, ...blocks].join("\n\n");
}

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s $,]+/g, "");

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

const argOf = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const INPUT = argOf("--input");
const OUT_DIR = argOf("--out") ?? join(IN, "facts");
const LIMIT = argOf("--limit");

// Nov 14: the script runs only as a script; the product imports its prompt and input to price a cold build.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("capture/facts.ts")) (async () => {
  const snaps = INPUT ? [JSON.parse(readFileSync(INPUT, "utf-8"))] : readdirSync(IN).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(IN, f), "utf-8")));
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
      const saved = JSON.parse(readFileSync(join(OUT_DIR, `raw-${p.s.cik}.json`), "utf-8"));
      const prior = JSON.parse(readFileSync(join(OUT_DIR, `${p.s.cik}.json`), "utf-8"));
      const rejected: { fact: string; why: string }[] = [];
      const asks = saved.asks.map((r: Raw, i: number) => verifyAsk(p.s, r, i === 0 ? rejected : []));
      const residual: CardFacts["residual"] = rejected.map((r) => ({ fact: r.fact, why: `not verified: ${r.why}`, variation: [] }));
      const facts: CardFacts = { cik: p.s.cik, anchorUrl: anchorUrlOf(p.s), promptVersion: CARD_FACTS_PROMPT_VERSION, asks: ASKS, costUsd: prior.costUsd, ...reproduce(asks, residual), residual };
      writeFileSync(join(OUT_DIR, `${p.s.cik}.json`), JSON.stringify(facts, null, 1) + "\n", "utf-8");
      console.log(`  ${p.s.company.padEnd(30)} kept: ${facts.moves.length} moves, ${facts.schedule.length} schedule, ${facts.subFacilities.length} sub-facilities, ${facts.maturities.length} maturities, ${facts.faces.length} faces; residual ${facts.residual.length}`);
    }
    console.log("\nRe-verified from saved answers. $0, no client constructed.");
    return;
  }
  // --status (Nov 13, Ring 1): which asks are already cached for this input, so a price counts only the calls the run
  // would make (the call-set rule). Reads the cache only; $0.
  if (process.argv.includes("--status")) {
    for (const p of plan) {
      // Nov 14: a rebuild uses the adopted facts where they were read from this anchor; nothing to run.
      if (factsForBuild(p.s).source === "adopted") { console.log(`STATUS ${p.s.cik} hash ${p.hash} uncached-asks none (adopted facts)`); continue; }
      const asks: number[] = [];
      for (let ask = 1; ask <= ASKS; ask++) if ((await readCache(cardFactsKey(p.s.cik, p.hash, CARD_FACTS_PROMPT_VERSION, ask), null)) === null) asks.push(ask);
      console.log(`STATUS ${p.s.cik} hash ${p.hash} uncached-asks ${asks.length ? asks.join(",") : "none"}`);
    }
    return;
  }
  // --price: each ask's real input counted by the Messages API (the guard in price-only mode), worst case at max_tokens.
  if (process.argv.includes("--price")) {
    setPriceOnly(true);
    const client = new Anthropic();
    for (const p of plan) {
      const n0 = pricedCalls().length;
      await guardedCreate(client, { model: MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: p.input }], tools: [{ name: "submit_facts", description: "Submit the transcribed facts.", input_schema: SCHEMA as any }], tool_choice: { type: "tool", name: "submit_facts" } }).catch((e) => { if (e?.name !== "PricedOnlyError") throw e; });
      const c = pricedCalls().slice(n0)[0];
      console.log(`PRICED ${p.s.company}: ${c?.inputTokens} input tokens/ask, 8000 max out → worst $${c?.worstUsd.toFixed(4)}/ask, $${((c?.worstUsd ?? 0) * ASKS).toFixed(4)} for ${ASKS} asks`);
    }
    console.log("Priced from pre-call counts. Nothing billed.");
    return;
  }
  if (!BILL) { console.log("\nDeclared only. Re-run with --bill to extract. Nothing billed."); return; }
  if (LIMIT) setSpendLimits({ totalUsd: Number(LIMIT) });

  const client = new Anthropic();
  mkdirSync(OUT_DIR, { recursive: true });
  let spent = 0;
  for (const p of plan) {
    beginCompanyCostScope(p.s.company);
    const asks: Raw[] = [];
    const raws: Raw[] = [];
    const rejected: { fact: string; why: string }[] = [];
    for (let ask = 1; ask <= ASKS; ask++) {
      const { data } = await cachedCardFacts(p.s.cik, p.hash, CARD_FACTS_PROMPT_VERSION, ask, async () => {
        const r = await guardedCreate(client, {
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
    const facts: CardFacts = { cik: p.s.cik, anchorUrl: anchorUrlOf(p.s), promptVersion: CARD_FACTS_PROMPT_VERSION, asks: ASKS, costUsd: Number(spend.totalUsd.toFixed(6)), ...reproduce(asks, residual), residual };
    writeFileSync(join(OUT_DIR, `${p.s.cik}.json`), JSON.stringify(facts, null, 1) + "\n", "utf-8");
    writeFileSync(join(OUT_DIR, `raw-${p.s.cik}.json`), JSON.stringify({ keys: [1, 2, 3].map((a) => cardFactsKey(p.s.cik, p.hash, CARD_FACTS_PROMPT_VERSION, a)), asks: raws }, null, 1) + "\n", "utf-8");
    console.log(`  ${p.s.company.padEnd(30)} $${spend.totalUsd.toFixed(4)} (${spend.totalCalls} calls)  kept: ${facts.moves.length} moves, ${facts.schedule.length} schedule, ${facts.subFacilities.length} sub-facilities, ${facts.maturities.length} maturities, ${facts.faces.length} faces; residual ${facts.residual.length}`);
    if (spend.totalUsd > BAND_PER_NAME) { console.error(`STOPPING: ${p.s.company} cost $${spend.totalUsd.toFixed(4)}, over its $${BAND_PER_NAME} band. No further name billed.`); process.exit(1); }
  }
  console.log(`\nSPEND: $${spent.toFixed(4)} across ${plan.length} names, each measured as it finished.`);
})();
