/**
 * CARD_SPEC v2.0 §5 — THE ACCEPTANCE TESTS, written before the build.
 *
 * Every test runs over all six cards, never a named subset, and checks the
 * card against the FIXTURES (lib/cards/fixtures/<cik>.json: the filer's table,
 * printed headings, printed schedule, permitted class sentences and stated
 * debt moves, captured from the signed answers and filing text) — never
 * against what the builder says it did.
 *
 * Every test has a negative control: a deliberately corrupted card or fixture
 * that MUST fail. A test whose control passes cannot fail, and is reported as
 * broken rather than green (the audit-spine rule).
 *
 * §5.11 (goldens through the loop) is goldenThroughLoop.test.ts. §5.12 is
 * Akshay's read.
 *
 * Run: npx tsx lib/cards/acceptance.test.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { amountSupportOf, sentenceSupportsMaturity, parseMoneyAmount } from "../events/position";
import { statementHead } from "../events/instrumentClass";
import { isZeroValue, zeroSupportFor } from "../agent/statedZero";
import { sentenceStatesFigure } from "../agent/verifyFacility";
import { containsWord } from "./labels";
import { buildCard } from "./build";
import { kindOf } from "./headings";
import type { Card, Line, Segment } from "./types";
import { reachable as reach } from "./reach";
const reachable = (entry: string, read?: (p: string) => string | null) => reach(entry, ROOT, read);
const readDisk = undefined;

const ROOT = process.cwd();
const GEN = join(ROOT, "lib", "cards", "generated");
const FIX = join(ROOT, "lib", "cards", "fixtures");
const cards: Card[] = JSON.parse(readFileSync(join(GEN, "all.json"), "utf-8"));
const fixtureOf = (cik: string) => JSON.parse(readFileSync(join(FIX, `${cik}.json`), "utf-8"));

// ── reading a card ──────────────────────────────────────────────────────
type Where = { section: string; block?: string; line: Line };
function linesOf(card: Card): Where[] {
  const out: Where[] = [];
  const sec = (name: string, s?: { lines: Line[]; blocks?: { heading: Line; lines: Line[] }[] }) => {
    if (!s) return;
    s.lines.forEach((l) => out.push({ section: name, line: l }));
    for (const b of s.blocks ?? []) {
      const bh = b.heading.map((x) => x.t).join("");
      out.push({ section: name, block: bh, line: b.heading });
      b.lines.forEach((l) => out.push({ section: name, block: bh, line: l }));
    }
  };
  card.header.forEach((l) => out.push({ section: "header", line: l }));
  sec("this week", card.thisWeek);
  sec("moves", card.moves);
  sec("total debt", card.headlines.totalDebt);
  sec("liquidity", card.headlines.liquidity);
  sec("refi", card.headlines.refi ?? card.headlines.due24);
  sec("ladder", card.ladder);
  sec("facilities", card.facilities);
  sec("withheld", card.withheld);
  sec("coverage", card.coverage);
  return out;
}
const text = (l: Line) => l.map((s) => s.t).join("");
const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/ %/g, "%").trim();
const squash = (s: string) => s.toLowerCase().replace(/[\s ]+/g, "");

/** Does this line stand for the filer row `label`? Its `row` tag, or a label segment carrying the full filer label. */
function represents(l: Line, label: string): boolean {
  return l.some((s) => ((s.k === "figure" || s.k === "computed") && s.row === label) || (s.k === "label" && norm(s.t) === norm(label)));
}
const amountSeg = (l: Line) => l.find((s) => s.k === "figure" || s.k === "computed") as Extract<Segment, { k: "figure" | "computed" }> | undefined;

/** A displayed amount as dollars: "$1,549MM", "~$1.0B", "$396.9M", "<$1MM", "$0", "nil". */
function shownUsd(t: string): number | null {
  const s = t.replace(/^[~<]/, "").trim();
  if (/^nil$/i.test(s) || /^\$0(?:MM)?$/.test(s)) return 0;
  const m = /^\(?\$([\d,]+(?:\.\d+)?)\s*(MM|M|B|K)?\)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return n * ({ MM: 1e6, M: 1e6, B: 1e9, K: 1e3 } as Record<string, number>)[m[2] ?? ""] || (m[2] ? n : n);
}

// ── the oracle: what the filer's table says the card must carry (§5.3) ──
interface Expected { label: string; faceUsd: number | null; carryingUsd: number | null; kind: string | null }
function expectedRows(f: any): Expected[] {
  const scale = f.table.scale === "thousand" ? 1e3 : 1e6;
  const cell = (a: string) => {
    if (!a || /^\$?\s*[—–-]\s*$/.test(a)) return 0;
    const p = parseMoneyAmount(a);
    if (p !== null) return p;
    const n = Number(a.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n * scale : null;
  };
  const rows: { label: string; amount: number | null; face: number | null }[] = [];
  if (f.rolled) {
    const retired = f.rolled.changes.filter((c: any) => c.amountMillions < 0);
    for (const r of f.rolled.rows) {
      const amt = cell(r.amount);
      if (!amt) continue; // stated at nil at the base date: not debt
      const rate = (/(\d+\.\d+)\s?%/.exec(r.label) ?? [])[1];
      if (rate && retired.some((c: any) => c.instrument.includes(rate))) continue; // retired by a stated change
      const faceTok = /\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)/i.exec(r.label);
      rows.push({ label: r.label, amount: amt, face: faceTok ? Number(faceTok[1].replace(/,/g, "")) * (/billion/i.test(faceTok[2]) ? 1e9 : 1e6) : null });
    }
    for (const c of f.rolled.changes.filter((c: any) => c.amountMillions > 0)) rows.push({ label: c.instrument, amount: c.amountMillions * 1e6, face: c.amountMillions * 1e6 });
  } else {
    const faceTable = /^face/.test(f.table.basis);
    for (const r of f.table.rows) { const a = cell(r.amount); rows.push({ label: r.label, amount: a, face: faceTable ? a : null }); }
  }
  // One instrument, one line: rows printed under the same label (a current and a long-term portion) are one.
  const by = new Map<string, Expected>();
  for (const r of rows) {
    const e = by.get(r.label);
    if (e) { e.carryingUsd = (e.carryingUsd ?? 0) + (r.amount ?? 0); e.faceUsd = e.faceUsd === null || r.face === null ? null : e.faceUsd + r.face; }
    else by.set(r.label, { label: r.label, faceUsd: r.face, carryingUsd: r.amount, kind: kindOf(r.label) });
  }
  return [...by.values()];
}

/** Two builds agree on everything a new filing must not touch: all but This week and its count in the trust section. */
function sameOutsideThisWeek(a: Card, b: Card): boolean {
  const strip = (c: Card) => JSON.stringify({ ...c, thisWeek: null, withheld: null });
  return strip(a) === strip(b);
}

// ── the tests: each returns failure messages for one card ───────────────
type Test = { id: string; name: string; run: (card: Card, f: any) => string[] };

const T1_PURITY: Test = {
  id: "5.1", name: "renders at $0 — a new filing changes only This week",
  run: (card, f) => {
    // Build the same card twice from the PINNED answer with two different
    // weeks of filings and nothing else loaded. Everything but This week must
    // be identical — and the build must not need the network to do it.
    const g = JSON.parse(readFileSync(join(ROOT, "baselines", "golden", `${card.cik}.json`), "utf-8"));
    const base = { result: g.sourceResult, briefDate: card.briefDate, previousBrief: null, cash: { usd: null, printed: null, printedLine: null, reason: "not loaded" }, textByUrl: new Map<string, string>(), periodSentence: null };
    try {
      const quiet = buildCard({ ...base, weekFilings: [] } as any);
      const busy = buildCard({ ...base, weekFilings: [{ form: "8-K", filingDate: card.briefDate, reportDate: "", accessionNumber: "x", primaryDocument: "x.htm", primaryDocUrl: "https://www.sec.gov/x.htm", items: "1.01,2.03" }] } as any);
      return sameOutsideThisWeek(quiet, busy) ? [] : ["a new filing changed something other than This week (and its count in the trust section)"];
    } catch (e) {
      return [`building from the pinned answer failed: ${(e as Error).message.slice(0, 120)}`];
    }
  },
};

const T2_LINKS: Test = {
  id: "5.2", name: "every figure, date and label links to a source containing it",
  run: (card) => {
    const bad: string[] = [];
    for (const { line } of linesOf(card)) for (const s of line) {
      if (s.k === "figure") {
        const ok = isZeroValue(s.printed) ? zeroSupportFor(s.src.sentence, s.field ?? "drawn").kind === "asserts-absence" : amountSupportOf(s.printed, s.src.sentence).kind !== "unsupported" || (!!s.field && sentenceStatesFigure(s.printed, s.src.sentence));
        if (!ok) bad.push(`figure ${s.t}`);
      } else if (s.k === "date" && !sentenceSupportsMaturity(s.date, s.granularity, s.src.sentence)) bad.push(`date ${s.t}`);
      else if (s.k === "label" && !containsWord(s.src.sentence, s.stated)) bad.push(`label ${s.t}`);
      else if (s.k === "computed" && (Math.abs(s.parts.reduce((a, p) => a + p.usd, 0) - s.usd) >= 1 || s.parts.some((p) => amountSupportOf(p.printed, p.src.sentence).kind === "unsupported"))) bad.push(`computed ${s.t}`);
    }
    return bad;
  },
};

const T3_TABLE: Test = {
  id: "5.3", name: "table reconciliation — every filer row once, at face, with its label; face total = sum",
  run: (card, f) => {
    const bad: string[] = [];
    const ladder = linesOf(card).filter((w) => w.section === "ladder").map((w) => w.line);
    const exp = expectedRows(f);
    for (const e of exp) {
      const reps = ladder.filter((l) => represents(l, e.label));
      if (reps.length !== 1) { bad.push(`"${e.label}" appears ${reps.length} times`); continue; }
      const a = amountSeg(reps[0]);
      const shown = a ? shownUsd(a.t) : null;
      // §2.5: an undrawn facility sits in the capacity group, never as $0 debt.
      if (e.faceUsd === 0 && e.kind === "facility" && /undrawn commitment/.test(text(reps[0]))) continue;
      if (e.faceUsd !== null) {
        // §3.3: compared at the precision the card shows ("$188,482 thousand" is "$188.5MM").
        const dec = ((/\.(\d+)MM/.exec(a?.t ?? "") ?? [])[1] ?? "").length;
        const tol = Math.max(1, 0.5 * 10 ** -dec * 1e6 + 1);
        if (shown === null || Math.abs(shown - e.faceUsd) > tol) bad.push(`"${e.label}" shows ${a?.t ?? "no amount"}, face is ${e.faceUsd}`);
      } else if (!/carrying value/i.test(text(reps[0])) && !(a && a.k === "computed" && a.parts.length > 0 && a.parts.every((p) => /principal|face amount/i.test(p.src.sentence))) && !(a && a.k === "figure" && (/principal|face amount/i.test(a.src.sentence) || (a.field === "drawn" && /\bdrawn\b|borrowings? outstanding/i.test(a.src.sentence))))) bad.push(`"${e.label}" shows ${a?.t ?? "no amount"} with no face source and no "carrying value" label`);
    }
    const faceTotal = exp.every((e) => e.faceUsd !== null)
      ? exp.reduce((s, e) => s + (e.faceUsd ?? 0), 0)
      : f.schedule && !f.rolled ? f.schedule.entries.reduce((s: number, x: any) => s + Number(x.amount.replace(/,/g, "")) * (f.table.scale === "thousand" ? 1e3 : 1e6), 0) : null;
    const tot = amountSeg(card.headlines.totalDebt.lines[0] ?? []);
    const shownTot = tot ? shownUsd(tot.t) : null;
    if (faceTotal !== null && (shownTot === null || Math.abs(shownTot - faceTotal) > 0.5e6)) bad.push(`face total shows ${tot?.t ?? "nothing"}, rows sum to ${faceTotal}`);
    return bad;
  },
};

const SENIORITY = /\b(senior(?:[- ]priority)?|junior[- ]priority|subordinated)\b/i;
const SECURITY = /\b(unsecured|secured|first[- ]lien|first[- ]priority)\b/i;
function permittedSources(f: any, label: string): string[] {
  const out = [label];
  const h = (f.headings ?? []).find((x: any) => x.governs.includes(label));
  if (h) out.push(h.text);
  const coupon = (/(\d+(?:\.\d+)?)\s?%/.exec(label) ?? [])[1];
  const lk = kindOf(label);
  for (const c of f.classSentences ?? []) {
    // Table text is not a sentence: a run of cells names every row and states nothing about one.
    if ((c.sentence.match(/\d[\d,.]*/g) ?? []).length > 14) continue;
    // A guarantee clause states the GUARANTEE's class ("guaranteed on a senior,
    // unsecured basis"), not the instrument's: the span is cut where it starts.
    // "obligations … and the related guarantees are secured by…" is not that.
    const head = statementHead(c.sentence).split(/\bguaranteed on an?\b/i)[0];
    // A head naming two or more classes of notes classes nothing (Rule 38).
    if ((head.match(/\b(?:senior|junior[- ]priority|subordinated)(?:\s+(?:secured|unsecured))?\s+notes\b/gi) ?? []).length >= 2) continue;
    const named =
      (coupon && new RegExp(`\\b${coupon.replace(".", "\\.")}0*\\s?%`).test(head)) ||
      (/senior notes/i.test(label) && /senior notes/i.test(head)) ||
      (lk === "bond" && /\b(?:each of )?these notes\b/i.test(head)) ||
      (/commercial paper/i.test(label) && /commercial paper/i.test(head)) ||
      (/\babl\b/i.test(label) && /\babl\b/i.test(head));
    if (named) out.push(head);
  }
  return out;
}
const T4_NOTSTATED: Test = {
  id: "5.4", name: "no false \"not stated\" — no permitted source states the missing label",
  run: (card, f) => {
    const bad: string[] = [];
    for (const { line } of linesOf(card)) {
      const ns = line.find((s) => s.k === "notStated" && /seniority|security/.test(s.t));
      if (!ns) continue;
      const lbl = line.filter((s) => s.k === "label").map((s) => s.t);
      const label = [...lbl].reverse().find((t) => expectedRows(f).some((e) => norm(e.label) === norm(t))) ?? lbl[lbl.length - 1];
      if (!label) continue;
      const src = permittedSources(f, label);
      // A priority word qualifying a LIEN or security interest ("a perfected
      // junior-priority third lien security interest") states security — the
      // collateral's ranking — never the debt's seniority in right of payment.
      const ranks = (s: string) => SENIORITY.test(s.replace(/\b(?:senior|junior)[- ]priority\s+(?:(?:first|second|third)\s+)?(?:lien|security interest)\b/gi, ""));
      if (/seniority/.test(ns.t) && src.some(ranks)) bad.push(`"${label}": seniority shown as not stated, but "${src.find(ranks)!.slice(0, 60)}" states it`);
      if (/security/.test(ns.t) && src.some((s) => SECURITY.test(s))) bad.push(`"${label}": security shown as not stated, but "${src.find((s) => SECURITY.test(s))!.slice(0, 60)}" states it`);
    }
    return bad;
  },
};

/**
 * §3.4's PRECISION HALF, as an oracle independent of the builder: the most
 * precise maturity stated for this instrument in the anchor or a later filing.
 * The instrument is matched by coupon and year, or by a defined term ("the 2034
 * Notes") that names exactly one row; a date counts only where the clause
 * predicates maturity ("due", "mature on"), never an interest or redemption date.
 */
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
function mostPreciseMaturity(f: any, label: string): { shown: string; precision: number } | null {
  const snapPath = join(ROOT, "lib", "cards", "inputs", `${f.cik}.json`);
  if (!existsSync(snapPath)) return null;
  const snap = JSON.parse(readFileSync(snapPath, "utf-8"));
  const year = (/\b(20\d\d)\b/.exec(label) ?? [])[1];
  if (!year) return null;
  const coupon = (/(\d+(?:\.\d+)?)\s?%/.exec(label) ?? [])[1] ?? (/(\d+)\s*([⅛¼⅜½⅝¾⅞])\s?%/.exec(label) ? (() => { const m = /(\d+)\s*([⅛¼⅜½⅝¾⅞])/.exec(label)!; return String(Number(m[1]) + ({ "⅛": .125, "¼": .25, "⅜": .375, "½": .5, "⅝": .625, "¾": .75, "⅞": .875 } as any)[m[2]]); })() : null);
  const anchorUrl = snap.result.results.find((r: any) => r.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
  const urls = [anchorUrl, ...(snap.laterFilings ?? []).filter((x: any) => x.filingDate <= f.briefDate).map((x: any) => x.url)];
  let best: { shown: string; precision: number } | null = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d\d/.test(label) ? null : { shown: year, precision: 0 };
  const consider = (shown: string, precision: number) => { if (!best || precision > best.precision) best = { shown, precision }; };
  for (const u of urls) {
    const text = (snap.docs[u]?.text ?? "").replace(/\s+/g, " ");
    for (const s of text.split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)/)) {
      const couponHit = coupon && new RegExp(`\\b${coupon.replace(".", "\\.")}0*\\s?%`).test(s);
      const aliasHit = new RegExp(`\\bthe ${year} Notes\\b`, "i").test(s);
      if (!couponHit && !aliasHit) continue;
      for (const m of s.matchAll(new RegExp(`\\b(?:due|matur\\w*(?:\\s+on)?)\\s+((${MONTH})(?:\\s+(\\d{1,2}),)?\\s+(${year}))\\b`, "g"))) {
        consider(m[3] ? `${m[2]} ${Number(m[3])}, ${year}` : `${m[2]} ${year}`, m[3] ? 2 : 1);
      }
    }
  }
  const dayInLabel = new RegExp(`(${MONTH})\\s+(\\d{1,2}),\\s*(${year})`).exec(label);
  if (dayInLabel) consider(`${dayInLabel[1]} ${Number(dayInLabel[2])}, ${year}`, 2);
  return best;
}

const T5_ONEMATURITY: Test = {
  id: "5.5", name: "one maturity per instrument, everywhere on the card",
  run: (card, f) => {
    const bad: string[] = [];
    const all = linesOf(card).map((w) => w.line);
    // Instruments are the filer's rows, never type words ("notes" names a kind, not an instrument).
    const labels = new Set<string>(expectedRows(f).map((e) => e.label));
    for (const label of labels) {
      const dates = new Set(all.filter((l) => represents(l, label)).flatMap((l) => l.filter((s) => s.k === "date").map((s) => s.t)));
      if (dates.size > 1) bad.push(`"${label}" shows ${[...dates].join(" and ")}`);
      // The precision half: the one maturity shown is the most precise one stated.
      const want = mostPreciseMaturity(f, label);
      const shown = [...dates][0];
      if (want && want.precision > 0 && shown !== undefined && shown !== want.shown) bad.push(`"${label}" shows ${shown}; the filings state ${want.shown}`);
    }
    return bad;
  },
};

/** The display a source figure owes: $MM, thousands separators, decimals only where the source has them (one where thousands convert). */
function owedShape(printed: string): { usd: number; decimals: number } | null {
  const usd = parseMoneyAmount(printed);
  if (usd === null) return null;
  const digits = (/([\d,]+)(?:\.(\d+))?/.exec(printed) ?? []);
  const dec = (digits[2] ?? "").length;
  if (/thousand/i.test(printed)) return { usd, decimals: 1 };
  if (/billion/i.test(printed)) return { usd, decimals: Math.max(0, dec - 3) };
  if (/million/i.test(printed)) return { usd, decimals: dec };
  return { usd, decimals: Math.max(0, dec) };
}
const T6_PRECISION: Test = {
  id: "5.6", name: "no precision loss — $MM at the source's precision; different faces never share a string",
  run: (card, f) => {
    const bad: string[] = [];
    for (const { line } of linesOf(card)) for (const s of line) {
      if (s.k !== "figure" || isZeroValue(s.printed)) continue;
      const owed = owedShape(s.printed);
      if (!owed) continue;
      const shown = s.t.replace(/^[~<]/, "");
      const want = (owed.usd / 1e6).toLocaleString("en-US", { minimumFractionDigits: owed.decimals, maximumFractionDigits: owed.decimals });
      if (shown !== `$${want}MM`) bad.push(`${s.t} for "${s.printed.trim()}" (owed $${want}MM)`);
    }
    const ladder = linesOf(card).filter((w) => w.section === "ladder").map((w) => w.line);
    const byString = new Map<string, Set<number>>();
    for (const e of expectedRows(f)) {
      const rep = ladder.find((l) => represents(l, e.label));
      const a = rep && amountSeg(rep);
      const v = e.faceUsd ?? e.carryingUsd;
      if (a && v !== null) byString.set(a.t, (byString.get(a.t) ?? new Set()).add(v));
    }
    for (const [t, vals] of byString) if (vals.size > 1) bad.push(`"${t}" stands for ${vals.size} different amounts`);
    return bad;
  },
};

const T7_SCHEDULE: Test = {
  id: "5.7", name: "schedule reconciliation — per-year amounts tie to the filer's schedule, remainder shown",
  run: (card, f) => {
    if (!f.schedule) return [];
    const bad: string[] = [];
    const scale = f.table.scale === "thousand" ? 1e3 : 1e6;
    const blocks = card.ladder.blocks ?? [];
    const yearOf = (p: string) => (/(20\d\d)/.exec(p) ?? [])[1];
    const blockSum = (b: { lines: Line[] }) => b.lines.reduce((s, l) => { const a = amountSeg(l); const v = a ? shownUsd(a.t) : null; return s + (v ?? 0); }, 0);
    const retiredByYear = new Map<string, number>();
    if (f.rolled) for (const c of f.rolled.changes.filter((c: any) => c.amountMillions < 0)) { const y = (/(20\d\d)/.exec(c.sourceLine) ?? [])[1]; if (y) retiredByYear.set(y, (retiredByYear.get(y) ?? 0) + Math.abs(c.amountMillions) * 1e6); }
    for (const e of f.schedule.entries) {
      if (/thereafter|after/i.test(e.period)) continue;
      const y = yearOf(e.period)!;
      const want = Number(e.amount.replace(/,/g, "")) * scale - (retiredByYear.get(y) ?? 0);
      const b = blocks.find((x) => x.heading.map((s) => s.t).join("").startsWith(y));
      const got = b ? blockSum(b) : 0;
      if (Math.abs(got - want) > 0.05e6 * (f.table.scale === "thousand" ? 10 : 1)) bad.push(`${y}: card ${got / 1e6}MM, schedule ${want / 1e6}MM`);
      if (b && Math.abs(got - want) <= 0.5e6 && want - b.lines.filter((l) => !/other scheduled principal/i.test(text(l))).reduce((s, l) => { const a = amountSeg(l); return s + ((a && shownUsd(a.t)) ?? 0); }, 0) > 0.5e6 && !b.lines.some((l) => /other scheduled principal/i.test(text(l)))) bad.push(`${y}: remainder not shown as "other scheduled principal"`);
    }
    return bad;
  },
};

const T8_MOVES: Test = {
  id: "5.8", name: "moves are complete — every stated debt move appears in Recent debt moves, with funding and use",
  run: (card, f) => {
    const bad: string[] = [];
    const moveLines = (card.moves?.lines ?? []).concat((card.moves?.blocks ?? []).flatMap((b) => b.lines));
    const groups = new Map<string, any[]>();
    for (const m of f.moveSentences ?? []) groups.set(squash(m.sentence).slice(0, 120), [...(groups.get(squash(m.sentence).slice(0, 120)) ?? []), m]);
    for (const [, ms] of groups) {
      const keys = ms.map((m) => squash(m.sentence));
      const line = moveLines.find((l) => l.some((s) => "src" in s && keys.some((k) => k.includes(squash(s.src.sentence)) || squash(s.src.sentence).includes(k.slice(0, 120)))));
      if (!line) { bad.push(`not on the card: "${ms[0].sentence.slice(0, 90)}"`); continue; }
      if (/net proceeds|cash on hand|proceeds from/i.test(ms[0].sentence) && !/funded by|used to|use of proceeds/i.test(text(line))) bad.push(`funding or use not shown: "${ms[0].sentence.slice(0, 70)}"`);
    }
    return bad;
  },
};

const ENGINE = /\bRule \d+\b|\bbase rows?\b|\broll(?:ed|s|ing)?\b|\bties?\b|\banchor\b|\bidentity\b|\bfingerprint\b|Σ/i;
const T9_LINT: Test = {
  id: "5.9", name: "plain language — no rule numbers or engine terms",
  run: (card) => linesOf(card).map((w) => text(w.line)).filter((t) => ENGINE.test(t)).map((t) => `"${(ENGINE.exec(t) ?? [""])[0]}" in "${t.slice(0, 70)}"`),
};

const T10_HEDGES: Test = {
  id: "5.10", name: "hedges survive; every label is the filer's full label",
  run: (card, f) => {
    const bad: string[] = [];
    for (const { line } of linesOf(card)) for (const s of line) {
      if (s.k !== "figure") continue;
      const digits = (/[\d,]+(?:\.\d+)?/.exec(s.printed) ?? [""])[0];
      const at = digits ? s.src.sentence.indexOf(digits) : -1;
      if (at < 0) continue;
      const before = s.src.sentence.slice(Math.max(0, at - 30), at);
      if (/(?:approximately|about|approx\.?)\s*\$?\s*$/i.test(before) && !s.t.startsWith("~")) bad.push(`${s.t} lost "approximately"`);
      if (/(?:less than|fewer than|under)\s*\$?\s*$/i.test(before) && !s.t.startsWith("<")) bad.push(`${s.t} lost "less than"`);
    }
    const all = linesOf(card).filter((w) => w.section === "ladder").map((w) => w.line);
    for (const e of expectedRows(f)) {
      if (/%/.test(e.label)) continue; // a note is named by coupon, labels, type and maturity (§3.7)
      const rep = all.find((l) => represents(l, e.label));
      if (rep && !norm(text(rep)).includes(norm(e.label))) bad.push(`"${e.label}" not shown in full`);
    }
    return bad;
  },
};

const TESTS = [T1_PURITY, T2_LINKS, T3_TABLE, T4_NOTSTATED, T5_ONEMATURITY, T6_PRECISION, T7_SCHEDULE, T8_MOVES, T9_LINT, T10_HEDGES];

// ── negative controls: a corrupted card or fixture each test MUST fail ──
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }
function controls(): { id: string; failed: boolean; what: string }[] {
  const out: { id: string; failed: boolean; what: string }[] = [];
  const c0 = cards[0], f0 = fixtureOf(c0.cik);
  // 5.1: the page importing the loop must be caught.
  const fake = new Map<string, string>([[join(ROOT, "app", "fake", "page.tsx"), `import x from "@/lib/agent/loop";`], [join(ROOT, "lib", "agent", "loop.ts"), ""]]);
  out.push({ id: "5.1 page", failed: reachable(join(ROOT, "app", "fake", "page.tsx"), (p) => fake.get(p) ?? null).length > 0, what: "a page importing lib/agent/loop" });
  // 5.1: a build whose ladder moved with the week's filings must be caught.
  { const b = clone(c0); b.ladder.lines.push([{ k: "text", t: "moved by a new filing" }]); out.push({ id: "5.1", failed: !sameOutsideThisWeek(c0, b), what: "a card whose ladder changed with the week's filings" }); }
  // 5.2: a figure beside a sentence that does not state it.
  { const c = clone(c0); const seg = linesOf(c).flatMap((w) => w.line).find((s) => s.k === "figure") as any; seg.src.sentence = "The board met four times."; out.push({ id: "5.2", failed: T2_LINKS.run(c, f0).length > 0, what: "a figure with a sentence that does not state it" }); }
  // 5.3: a fixture row the card does not carry.
  { const f = clone(f0); (f.rolled ? f.rolled.rows : f.table.rows).push({ label: "9.999% Phantom Notes due 2099", amount: "$ 123 million", sourceLine: "" }); out.push({ id: "5.3", failed: T3_TABLE.run(c0, f).length > 0, what: "a filer row missing from the card" }); }
  // 5.4: a permitted sentence stating the class the card calls not stated.
  { const c = clone(c0); const f = clone(f0); const couponLabel = (l: Line) => l.find((s) => s.k === "label" && /%/.test(s.t)); const named = (w: { line: Line }) => !!couponLabel(w.line); const line = linesOf(c).find((w) => named(w) && w.line.some((s) => s.k === "notStated")) ?? linesOf(c).find((w) => w.section === "ladder" && named(w))!; if (!line.line.some((s) => s.k === "notStated")) line.line.push({ k: "notStated", t: "seniority and security not stated, please refer to sources", src: { sentence: "x", url: "x", doc: "x" } }); const lbl = couponLabel(line.line)!.t; f.classSentences.push({ doc: "x", url: "x", sentence: `${lbl} are senior secured obligations.` }); f.table.rows.push({ label: lbl, amount: "$ 1 million" }); out.push({ id: "5.4", failed: T4_NOTSTATED.run(c, f).length > 0, what: "a sentence stating the class beside a \"not stated\" line" }); }
  // 5.5: one instrument shown with two maturities.
  { const c = clone(c0); const rowLabels = expectedRows(f0).map((e) => e.label); const l = linesOf(c).find((w) => w.section === "ladder" && w.line.some((s) => s.k === "date") && rowLabels.some((r) => represents(w.line, r)))!; const copy = clone(l.line); (copy.find((s) => s.k === "date") as any).t = "January 1, 2099"; (c.headlines.refi ?? c.headlines.due24)!.lines.push(copy); out.push({ id: "5.5", failed: T5_ONEMATURITY.run(c, f0).length > 0, what: "one instrument with two different maturities" }); }
  // 5.5, the precision half: an instrument shown at year precision where a filing states its day.
  {
    const ehc = cards.find((c) => /encompass/i.test(c.company));
    if (ehc) {
      const c = clone(ehc), f = fixtureOf(ehc.cik);
      const label = "5.875 % Senior Notes due 2034";
      const line = linesOf(c).find((w) => represents(w.line, label))?.line ?? [];
      const d = line.find((s) => s.k === "date") as any;
      if (d) d.t = "2034";
      else line.push({ k: "date", t: "2034", date: "2034", granularity: "year", src: { sentence: "due 2034", url: "x", doc: "x" } } as any);
      if (!linesOf(c).some((w) => represents(w.line, label))) c.ladder.lines.push([{ k: "label", t: label, stated: label, src: { sentence: label, url: "x", doc: "x" } }, ...line]);
      out.push({ id: "5.5 precision", failed: T5_ONEMATURITY.run(c, f).some((x) => /the filings state/.test(x)), what: "the 2034 notes at \"2034\" where the anchor says they mature on June 1, 2034" });
    }
  }
  // 5.6: a rounded figure.
  { const c = clone(c0); const s = linesOf(c).flatMap((w) => w.line).find((x) => x.k === "figure" && !isZeroValue((x as any).printed)) as any; s.t = "$1.5B"; s.printed = "$ 1,549 million"; out.push({ id: "5.6", failed: T6_PRECISION.run(c, f0).length > 0, what: "$1,549 million shown as $1.5B" }); }
  // 5.7: a schedule year the card does not reconcile.
  { const f = clone(f0); f.schedule = { entries: [{ period: "2098", amount: "777" }, { period: "Thereafter", amount: "1" }] }; out.push({ id: "5.7", failed: T7_SCHEDULE.run(c0, f).length > 0, what: "a schedule year with no matching ladder amount" }); }
  // 5.8: a stated move missing from the card.
  { const f = clone(f0); f.moveSentences.push({ doc: "x", url: "x", sentence: "In May 2026, we issued $999 million of 9.999% Phantom Notes due 2099." }); out.push({ id: "5.8", failed: T8_MOVES.run(c0, f).length > 0, what: "a stated move the card omits" }); }
  // 5.9: an engine term.
  { const c = clone(c0); c.coverage.lines.push([{ k: "text", t: "Rule 58 applies to the base row." }]); out.push({ id: "5.9", failed: T9_LINT.run(c, f0).length > 0, what: "\"Rule 58\" and \"base row\" in card copy" }); }
  // 5.10: a dropped hedge.
  { const c = clone(c0); const s = linesOf(c).flatMap((w) => w.line).find((x) => x.k === "figure") as any; s.src.sentence = `There was approximately ${s.printed} outstanding.`; s.t = s.t.replace(/^~/, ""); out.push({ id: "5.10", failed: T10_HEDGES.run(c, f0).length > 0, what: "an \"approximately\" figure shown without \"~\"" }); }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────
const order = ["0000070318", "0000785161", "0001179929", "0000927066", "0001108109", "0001739940"];
const short: Record<string, string> = { "0000070318": "Tenet", "0000785161": "Encompass", "0001179929": "Molina", "0000927066": "DaVita", "0001108109": "CHS", "0001739940": "Cigna" };
const run = order.map((cik) => ({ cik, card: cards.find((c) => c.cik === cik)!, f: fixtureOf(cik) }));
const counts: Record<string, Record<string, number>> = {};
const details: string[] = [];
let totalFail = 0;

// §5.1, once for the whole app rather than per card: what the card page and
// the card generator can REACH. Reachable model code is code one change away
// from billing on render; a generator that can run the extraction loop lets a
// newly landed filing decide what a card shows.
const pageBad = [...new Set(["page.tsx", "[cik]/page.tsx", "CardView.tsx"].flatMap((p) => reachable(join(ROOT, "app", "cards", p), readDisk)))];
const genBad = [...new Set(reachable(join(ROOT, "lib", "cards", "generate.ts"), readDisk))];
for (const t of TESTS) {
  counts[t.id] = {};
  for (const { cik, card, f } of run) {
    const fails = t.run(card, f);
    counts[t.id][cik] = fails.length;
    totalFail += fails.length;
    for (const x of fails.slice(0, 4)) details.push(`  ${t.id} ${short[cik].padEnd(9)} ${x}`);
    if (fails.length > 4) details.push(`  ${t.id} ${short[cik].padEnd(9)} … and ${fails.length - 4} more`);
  }
}
const ctl = controls();

console.log("§5 ACCEPTANCE — failures per test per card (0 = passes)\n");
console.log(`  test  ${order.map((c) => short[c].padStart(9)).join("")}   control`);
for (const t of TESTS) {
  const c = ctl.find((x) => x.id === t.id);
  console.log(`  ${t.id.padEnd(5)} ${order.map((cik) => String(counts[t.id][cik]).padStart(9)).join("")}   ${c ? (c.failed ? "fails ✓" : "PASSES ✗ (cannot fail)") : "—"}   ${t.name}`);
}
const pageCtl = ctl.find((c) => c.id === "5.1 page")!;
console.log(`\n  5.1 page   the card page reaches ${pageBad.length} model, cache or network module(s)   control ${pageCtl.failed ? "fails ✓" : "PASSES ✗"}`);
pageBad.slice(0, 6).forEach((b) => console.log(`             ${b.replace(ROOT, "").replace(/\\/g, "/")}`));
console.log(`  5.1 gen    the card generator reaches ${genBad.length} extraction module(s)`);
genBad.slice(0, 4).forEach((b) => console.log(`             ${b.replace(ROOT, "").replace(/\\/g, "/")}`));
totalFail += pageBad.length + genBad.length;
console.log("\nFirst failures:\n" + details.join("\n"));
const broken = ctl.filter((c) => !c.failed);
for (const c of broken) console.log(`\n  ✗ NEGATIVE CONTROL ${c.id} DID NOT FAIL — ${c.what}: this test cannot fail as written`);
console.log(`\n${TESTS.length * run.length - Object.values(counts).reduce((a, o) => a + Object.values(o).filter((n) => n > 0).length, 0)} passed, ${Object.values(counts).reduce((a, o) => a + Object.values(o).filter((n) => n > 0).length, 0) + broken.length} failed.`);
if (totalFail > 0 || broken.length > 0) process.exit(1);
