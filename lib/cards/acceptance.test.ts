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
import type { BarSegment, Card, Line, Segment } from "./types";
import { reachable as reach } from "./reach";
const reachable = (entry: string, read?: (p: string) => string | null) => reach(entry, ROOT, read);
const readDisk = undefined;

const ROOT = process.cwd();
const GEN = join(ROOT, "lib", "cards", "generated");
const FIX = join(ROOT, "lib", "cards", "fixtures");
const cards: Card[] = JSON.parse(readFileSync(process.env.CARDS_JSON ?? join(GEN, "all.json"), "utf-8"));
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
  for (const l of v3Lines(card)) out.push({ section: "v3", line: l });
  return out;
}
/** card_spec v3.0: every line of the redesigned card, so the link, lint, precision and hedge checks reach every tile, bar label and cell. */
function v3Lines(card: Card): Line[] {
  const v = card.v3;
  if (!v) return [];
  const out: Line[] = [v.header.position, [v.header.filing], v.header.status, ...v.header.actionable];
  if (v.rolledNote) out.push(v.rolledNote);
  out.push(v.call.headline, ...v.call.tiles.flatMap((x) => [[x.value], x.sub]), ...v.call.rows.flatMap((r) => [r.when, r.body, ...(r.tag ? [r.tag.text] : [])]), ...v.call.notes);
  if (v.call.nextTile) out.push([...(v.call.nextTile.value ? [v.call.nextTile.value] : []), ...(v.call.nextTile.date ? [v.call.nextTile.date] : [])], v.call.nextTile.instrument);
  for (const m of v.moves) out.push(m.meta, ...m.title, ...(m.detail ? [m.detail] : []), ...(m.retires ? [m.retires.meta, ...m.retires.items] : []));
  for (const d of [v.totalDebt, v.liquidity]) out.push(...(d.figure ? [[d.figure]] : []), ...d.legend.flatMap((l) => [l.label, [l.amount]]), ...d.notes);
  out.push(...v.chart.bars.map((b) => [b.total]), ...v.chart.captions);
  for (const r of v.table.rows) out.push(r.matures, r.instrument, ...(r.face ? [[r.face]] : []), ...(r.status ? [r.status.text] : []));
  for (const f of v.facilities) out.push(f.bold, ...(f.sub ? [f.sub] : []));
  out.push(...v.notShown, v.footnote);
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
  // v3.0: the week's status in the header, its actionable list and "Not shown" are This week and the trust section, redesigned.
  const strip = (c: Card) => JSON.stringify({ ...c, thisWeek: null, withheld: null, v3: c.v3 ? { ...c.v3, header: { ...c.v3.header, status: null, actionable: null }, notShown: null } : null });
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
      // v2.1 §3.3: at the source's precision, with no trailing zero after the point.
      const want = (owed.usd / 1e6).toLocaleString("en-US", { minimumFractionDigits: owed.decimals, maximumFractionDigits: owed.decimals }).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
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

/** Results that are reported, not failed: a year not comparable at face, with its reason. */
const NOT_COMPARABLE: string[] = [];
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
      // Ruling, Oct 16: a year holding an instrument stated only at carrying value is
      // not comparable at face. It is reported with the instrument named, not failed.
      const carrying = b ? b.lines.filter((l) => /\(carrying value\)/.test(text(l))) : [];
      if (carrying.length) {
        const named = b!.lines.map(text).find((l) => /Not comparable at face, stated only at carrying value: the .+/.test(l));
        if (!named) bad.push(`${y}: carrying-value lines with no "not comparable at face" line naming them`);
        else NOT_COMPARABLE.push(`5.7 ${card.company.split(/\s/)[0]} ${y}: not comparable at face — ${named.replace(/^.*Not comparable at face, /, "")}`);
        continue;
      }
      const got = b ? blockSum(b) : 0;
      if (Math.abs(got - want) > 0.05e6 * (f.table.scale === "thousand" ? 10 : 1)) bad.push(`${y}: card ${got / 1e6}MM, schedule ${want / 1e6}MM`);
      if (b && Math.abs(got - want) <= 0.5e6 && want - b.lines.filter((l) => !/other scheduled principal/i.test(text(l))).reduce((s, l) => { const a = amountSeg(l); return s + ((a && shownUsd(a.t)) ?? 0); }, 0) > 0.5e6 && !b.lines.some((l) => /other scheduled principal/i.test(text(l)))) bad.push(`${y}: remainder not shown as "other scheduled principal"`);
    }
    return bad;
  },
};

/**
 * 5.8, AS THE CARD NOW SHOWS IT (Oct 19, 2026). Every debt move the filings
 * state is on a move card: its date, its move word, its face, its instrument,
 * and its funding or use where stated. Checked against the card's own
 * content, not against the text of an earlier version: each move amount the
 * sentence states is a figure on a move card, and a sentence that spends
 * proceeds or cash has its funding or use on that card. An offering
 * announcement is the issuance it announces, covered by that issuance's card
 * (an offering can be upsized between announcement and close). A balance "as
 * of" a date, the prior principal "in outstanding principal amount" and a
 * net-proceeds figure are not moves.
 */
const MOVE_MONEY = /(?:approximately\s+)?\$\s?[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand))?/gi;
function moveAmounts(sentence: string, scale: number): number[] {
  const out: number[] = [];
  for (const m of sentence.matchAll(MOVE_MONEY)) {
    const at = m.index ?? 0;
    const before = sentence.slice(Math.max(0, at - 60), at), after = sentence.slice(at + m[0].length, at + m[0].length + 45);
    if (/\bAs of [A-Z][a-z]+ \d{1,2}, \d{4},?\s*$/i.test(before) || /^\s*(?:million|billion)?\s*in (?:outstanding principal|net proceeds)/i.test(after) || /net proceeds(?: to the Company)? of\s*(?:approximately\s*)?$/i.test(before)) continue;
    const v = parseMoneyAmount(m[0].replace(/approximately\s+/i, "")) ?? 0;
    // A unitless figure already in the millions is dollars ("$2,000,000,000"); a smaller one is in the table's scale.
    out.push(/million|billion|thousand/i.test(m[0]) || v >= 1e6 ? v : v * scale);
  }
  return out.filter((v) => v >= 1e6);
}
const T8_MOVES: Test = {
  id: "5.8", name: "moves are complete — every stated debt move is on a move card: date, word, face, instrument, funding or use",
  run: (card, f) => {
    const bad: string[] = [];
    const v = card.v3;
    if (!v) return ["no v3 card"];
    const cards = v.moves.map((m) => ({ m, lines: [m.meta, ...m.title, ...(m.detail ? [m.detail] : []), ...(m.retires ? [m.retires.meta, ...m.retires.items] : [])] }));
    const figuresOf = (ls: Line[]) => ls.flatMap((l) => l.filter((x) => x.k === "figure" || x.k === "computed").map((x) => (x.k === "computed" ? x.usd : parseMoneyAmount((x as any).printed) ?? 0)));
    // Every card shows a date, a move word and an instrument.
    for (const { m } of cards) {
      if (!m.meta.some((x) => x.k === "label" || x.k === "date")) bad.push(`a move card with no linked date: "${text(m.meta)}"`);
      if (!m.title.some((l) => l.some((x) => x.k === "label"))) bad.push(`a move card with no instrument: "${text(m.title[0] ?? [])}"`);
    }
    const scale = f.table.scale === "thousand" ? 1e3 : 1e6;
    const groups = new Map<string, any[]>();
    for (const m of f.moveSentences ?? []) groups.set(squash(m.sentence).slice(0, 120), [...(groups.get(squash(m.sentence).slice(0, 120)) ?? []), m]);
    for (const [, ms] of groups) {
      const s0: string = ms[0].sentence;
      if (/press release announcing|commencement of|pricing of|upsize/i.test(s0)) {
        const years = s0.match(/notes due (20\d\d)/gi) ?? [];
        const covered = cards.some(({ m, lines }) => /Issued/.test(text(m.meta)) && years.some((y) => text(lines.flat()).includes(y.replace(/^notes /i, ""))));
        if (!covered) bad.push(`an announced offering with no issuance card: "${s0.slice(0, 80)}"`);
        continue;
      }
      const amounts = moveAmounts(s0, scale);
      for (const amt of amounts) {
        const hit = cards.find(({ lines }) => figuresOf(lines).some((x) => Math.abs(x - amt) <= Math.max(0.6e6, amt * 0.005)));
        if (!hit) { bad.push(`not on a move card: $${amt / 1e6}MM in "${s0.slice(0, 80)}"`); continue; }
        if (/net proceeds|cash on hand|proceeds from/i.test(s0) && !hit.m.retires && !(hit.m.detail && /^(?:With |Used |Funded |At )|used to|, with /i.test(text(hit.m.detail)))) bad.push(`funding or use not shown for $${amt / 1e6}MM: "${s0.slice(0, 70)}"`);
      }
      if (!amounts.length && !cards.some(({ lines }) => /amended|credit agreement|revolver/i.test(text(lines.flat())))) bad.push(`not on a move card: "${s0.slice(0, 80)}"`);
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


// ── card_spec v2.1 (round 2): each rule asserted over all six cards ──────
const CARDVIEW = readFileSync(join(ROOT, "app", "cards", "CardView.tsx"), "utf-8");
const refiOf = (card: Card): Line[] => (card.headlines.refi ?? card.headlines.due24)?.lines ?? [];
/** The box's parts: summary first, then rows, then the leftovers line, Next and the legend. */
function boxParts(card: Card) {
  const ls = refiOf(card);
  const summary = ls[0] ?? [];
  const rest = ls.slice(1);
  const role = (l: Line) => (/^Plus /.test(text(l)) ? "plus" : /^Next/.test(text(l)) ? "next" : /^† /.test(text(l)) ? "legend" : "row");
  return { summary, rows: rest.filter((l) => role(l) === "row"), plus: rest.filter((l) => role(l) === "plus"), next: rest.filter((l) => role(l) === "next"), legend: rest.filter((l) => role(l) === "legend"), all: ls };
}

/** A1 — the box follows This week, above moves and the headlines, in its own container. */
function boxPlacement(view: string): string[] {
  const at = (re: RegExp) => { const m = re.exec(view); return m ? m.index : -1; };
  const week = at(/card\.thisWeek/), box = at(/className=\{styles\.refiBox\}/), moves = at(/card\.moves/), heads = at(/card\.headlines\.totalDebt/);
  return week >= 0 && box > week && moves > box && heads > box ? [] : ["the refinance box is not rendered directly after This week, in its own container, above moves and the headlines"];
}
const R1_BOX: Test = { id: "A1", name: "refinance box: after This week, in its own container", run: (card) => [...boxPlacement(CARDVIEW), ...(refiOf(card).length ? [] : ["no refinance box"])] };

const R2_SUMMARY: Test = {
  id: "A2", name: "refinance box: a summary line first, from stated facts, every figure linked",
  run: (card) => {
    const { summary, rows } = boxParts(card);
    const st = text(summary);
    if (/^Nothing matures within 18 months\.?$/.test(st)) return rows.some((r) => !/commercial paper/i.test(text(r))) ? ["says nothing matures, but the box lists maturing rows"] : [];
    const m = /^(\S+) across (\d+) (notes?|instruments?) in the next 18 months/.exec(st);
    if (!m) return [`summary does not follow the template: "${st.slice(0, 80)}"`];
    const bad: string[] = [];
    const maturing = rows.filter((r) => !/commercial paper outstanding/i.test(text(r)));
    const sumRows = maturing.reduce((a, r) => a + (shownUsd(amountSeg(r)?.t ?? "") ?? 0), 0);
    const shown = shownUsd(m[1].replace(/†$/, "")) ?? -1;
    if (Math.abs(shown - sumRows) > 0.5e6) bad.push(`summary ${m[1]} but the maturing rows sum to ${sumRows / 1e6}MM`);
    if (Number(m[2]) !== maturing.length) bad.push(`summary counts ${m[2]} but the box lists ${maturing.length} maturing rows`);
    if (/\$\d/.test(summary.filter((x) => x.k === "text").map((x) => x.t).join(""))) bad.push("a figure in the summary is plain text, not linked");
    return bad;
  },
};

/**
 * A2b (v2.2) — BOTH HALVES OF THE SUMMARY COUNT THE SAME INSTRUMENTS. The
 * redemption figure equals the stated redemptions (pending, or completed
 * since the position date) on the box's own in-window rows; a redemption of
 * anything outside the window is a separate clause or is left to the moves.
 */
function summaryScope(card: Card): string[] {
  const { summary, rows } = boxParts(card);
  const st = text(summary);
  const figs = summary.filter((x) => x.k === "figure" || x.k === "computed");
  // The in-window redemption figure is the amount right before "already being redeemed" / "already redeemed".
  const at = summary.findIndex((x, n) => x.k === "text" && /^ already (?:being )?redeemed/.test(x.t) && n > 0);
  const claimed = at > 0 ? shownUsd(summary[at - 1].t) : null;
  let owed = 0;
  for (const r of rows) {
    if (/commercial paper outstanding/i.test(text(r))) continue;
    r.forEach((x, n) => {
      if (x.k === "label" && x.t === "pending redemption") { const f = r.slice(n + 1).find((y) => y.k === "figure" || y.k === "computed"); if (f) owed += shownUsd(f.t) ?? 0; }
      if ((x.k === "figure" || x.k === "computed") && /since the position date/.test(r.slice(n + 1, n + 4).map((y) => y.t).join(""))) owed += shownUsd(x.t) ?? 0;
    });
  }
  if (claimed === null) return owed > 0 ? [`the box's rows carry $${owed / 1e6}MM of stated redemptions, but the summary states none`] : [];
  if (Math.abs(claimed - owed) > 0.5e6) return [`summary says ${summary[at - 1].t} already being redeemed; the in-window rows carry ${owed / 1e6}MM ("${st.slice(0, 90)}")`];
  void figs;
  return [];
}
const R2B_SCOPE: Test = { id: "A2b", name: "refinance summary: both halves count the same in-window instruments", run: (card) => summaryScope(card) };


// ── card_spec v3.0: the redesign, each rule over all six cards ───────────
const V3VIEW = readFileSync(join(ROOT, "app", "cards", "CardV3View.tsx"), "utf-8");
const noV3 = (card: Card) => (card.v3 ? null : ["no v3 card"]);
const num = (x: Segment | null | undefined) => (x && (x.k === "computed" ? x.usd : x.k === "figure" ? parseMoneyAmount(x.printed) : null)) ?? null;

/** §2 layout order, read from the page itself. */
function layoutOrder(view: string): string[] {
  const marks = ["1. Header", "2. Rolled-position note", "3. The call box", "4. Recent debt moves", "5. Total debt and liquidity", "6. Maturity ladder: chart, then table", "7. Facilities, and what was not shown", "8. Footnote"];
  const at = marks.map((m) => view.indexOf(`{/* ${m}`));
  return at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])) ? [] : [`layout out of order: ${marks.filter((_, i) => at[i] < 0 || (i > 0 && at[i] < at[i - 1])).join("; ")}`];
}
const V1_LAYOUT: Test = { id: "V1", name: "v3 layout: header, note, call box, moves, debt and liquidity, ladder, facilities, footnote", run: (card) => noV3(card) ?? layoutOrder(V3VIEW) };

/** §2.2 the case follows its rule, from the table's own rows (named, in window) and the ladder's schedule leftovers. */
function expectedCase(card: Card): "A" | "B" | "C" | "D" {
  const named = card.v3!.table.rows.filter((r) => r.inWindow && !/^Short-term$/.test(text(r.matures)));
  if (named.length) return named.some((r) => r.status?.tone === "orange") ? "A" : "B";
  const leftovers = refiOf(card).some((l) => /^Plus /.test(text(l)));
  return leftovers ? "C" : "D";
}
const HEADLINE: Record<string, RegExp> = {
  A: /^~?\$[\d,.]+MM of .+ (?:is|are) not yet refinanced\./,
  B: /^Everything due in the next 18 months is refinanced\./,
  C: /^No notes or loans mature in the next 18 months\. \$[\d,.]+MM†? of scheduled amortization\./,
  D: /^Nothing matures in the next 18 months\./,
};
const V2_CASE: Test = {
  id: "V2", name: "call box: the case (A to D) matches its rule, with its template",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const want = expectedCase(card), got = card.v3.call.case;
    const bad: string[] = [];
    if (want !== got) bad.push(`case ${got}, rule says ${want}`);
    if (!HEADLINE[got].test(text(card.v3.call.headline))) bad.push(`case ${got} headline off template: "${text(card.v3.call.headline).slice(0, 80)}"`);
    if ((got === "C" || got === "D") && (card.v3.call.tiles.length || !card.v3.call.nextTile)) bad.push("cases C and D show the Next maturity tile, not the three tiles");
    if ((got === "A" || got === "B") && !card.v3.call.tiles.length) bad.push("cases A and B show three tiles");
    return bad;
  },
};

const V3_TILES: Test = {
  id: "V3", name: "tiles: due = refinanced + not yet refinanced, in-window named instruments only, never commercial paper",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const tl = card.v3.call.tiles;
    if (!tl.length) return [];
    const due = tl.find((x) => x.key === "due"), refi = tl.find((x) => x.key === "refinanced"), ny = tl.find((x) => x.key === "notYet");
    const bad: string[] = [];
    if (!due || !refi) return ["missing a tile"];
    const nyUsd = ny?.usd ?? 0;
    if (Math.abs(due.usd - refi.usd - nyUsd) > 0.5e6) bad.push(`due ${due.usd / 1e6} ≠ refinanced ${refi.usd / 1e6} + not yet ${nyUsd / 1e6}`);
    if (ny && ny.usd <= 0.5e6) bad.push("the orange tile shows at zero");
    if (!ny && due.usd - refi.usd > 0.5e6) bad.push("not yet refinanced is above zero but has no tile");
    if (refi.usd === 0 && !/none stated in any filing/i.test(text(refi.sub))) bad.push('refinanced is $0 without "none stated in any filing"');
    const inWindow = card.v3.table.rows.filter((r) => r.inWindow && !/^Short-term$/.test(text(r.matures))).reduce((a, r) => a + (num(r.face) ?? 0), 0);
    if (Math.abs(inWindow - due.usd) > 0.5e6) bad.push(`due ${due.usd / 1e6} but the in-window table rows sum to ${inWindow / 1e6} (commercial paper is never counted)`);
    if (tl.some((x) => x.value.k === "computed" && x.value.parts.some((p) => /commercial paper/i.test(p.src.sentence) && !/notes/i.test(p.src.sentence)))) bad.push("a tile counts commercial paper");
    return bad;
  },
};

const VOCAB = /^(?:Refinanced(?: · (?:redemption set for .+|redeemed [A-Z][a-z]+ \d{4}))?|Not yet refinanced|Backed by revolver|Short-term|~?\$[\d,.]+MM (?:refinanced|repurchased in \d{4}|retired in \d{4}) · ~?\$[\d,.]+MM remains|(?:Seniority|Security|Seniority and security) not stated)$/;
const MOVE_WORD = /· (?:Issued, confirmed by \S+|Refinanced|Repaid(?: at maturity)?|Repurchased|Redeemed|Amended|Drew|Redemption announced, awaiting confirmation in a filing)$/;
const V4_VOCAB: Test = {
  id: "V4", name: "status and move words only from the §2.10 list; \"redeemed\" only with a confirming filing",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const bad: string[] = [];
    const tags = [...card.v3.call.rows.map((r) => r.tag), ...card.v3.table.rows.map((r) => r.status)].filter((x): x is NonNullable<typeof x> => !!x);
    for (const tg of tags) {
      const tt = text(tg.text);
      if (!VOCAB.test(tt)) bad.push(`status "${tt}" is not in the vocabulary`);
      if (/\bredeemed\b/i.test(tt)) {
        const d = tg.text.find((x) => x.k === "label" && /redeemed/.test(x.t));
        if (!d || d.k !== "label" || /\bintends?\b|\bwill be\b|\bexpected to be\b|\bnotice of\b/i.test(d.src.sentence)) bad.push(`"${tt}" without a confirming sentence`);
      }
    }
    for (const m of card.v3.moves) {
      const meta = text(m.meta);
      if (!MOVE_WORD.test(meta)) bad.push(`move word in "${meta}" is not in the vocabulary`);
      const r = m.retires ? text(m.retires.meta) : "";
      if (r && !/^Refinanced · (?:redemption set for .+, awaiting confirmation in a filing|redeemed [A-Z][a-z]+ \d{4})$/.test(r)) bad.push(`retire line "${r}" off vocabulary`);
      if (/\bredeemed\b/.test(r) && m.retires!.meta.some((x) => x.k === "label" && /\bintends?\b|\bwill be\b|\bexpected to be\b|\bnotice of\b/i.test(x.src.sentence))) bad.push(`"${r}" without a confirming sentence`);
    }
    return bad;
  },
};

const PALETTE_SET = new Set(["#1F4E79", "#2E8B8B", "#5C8DBF", "#9AA3AD", "#C9CED4", "#B4440C", "#2E7D6B", "#9CCBBE"]);
const V5_LEGEND: Test = {
  id: "V5", name: "every chart color and pattern has a legend entry, and nothing else; a caption explains it",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const ch = card.v3.chart;
    // Stripes are one pattern over whichever shade they cover: one legend entry for the pattern.
    const key = (c: string, p?: string) => (p ? `|${p}` : c);
    const used = new Set(ch.bars.filter((b) => b.source !== "cp").flatMap((b) => b.segments.map((x) => key(x.color, x.pattern))));
    // The CP bar's shade is a seniority shade; it needs an entry too.
    for (const b of ch.bars.filter((b) => b.source === "cp")) for (const x of b.segments) used.add(key(x.color, x.pattern));
    const legend = new Set(ch.legend.map((l) => key(l.color, l.pattern)));
    const bad: string[] = [];
    for (const u of used) if (!legend.has(u)) bad.push(`color ${u} shown with no legend entry`);
    for (const l of legend) if (!used.has(l)) bad.push(`legend entry ${l} for a color not shown`);
    for (const b of ch.bars) for (const x of b.segments) if (!PALETTE_SET.has(x.color)) bad.push(`color ${x.color} is not in the palette`);
    for (const d of [card.v3.totalDebt, card.v3.liquidity]) for (const x of d.segments) if (!PALETTE_SET.has(x.color)) bad.push(`bar color ${x.color} is not in the palette`);
    if (!ch.captions.length || !/^Color shows/.test(text(ch.captions[0]))) bad.push("no caption explaining the encoding");
    return bad;
  },
};

const V6_BARS: Test = {
  id: "V6", name: "each bar's total equals its source: the filer's schedule, or the named instruments",
  run: (card, f) => {
    if (!card.v3) return ["no v3 card"];
    const bad: string[] = [];
    const scale = f.table.scale === "thousand" ? 1e3 : 1e6;
    const rows = card.v3.table.rows;
    const rowYear = (r: (typeof rows)[number]) => (/(20\d\d)/.exec(text(r.matures)) ?? [])[1];
    for (const b of card.v3.chart.bars) {
      const total = num(b.total) ?? NaN;
      const segSum = b.segments.reduce((a, x) => a + x.usd, 0);
      if (Math.abs(segSum - total) > 0.5e6) bad.push(`${b.label}: segments sum to ${segSum / 1e6}, label says ${total / 1e6}`);
      if (b.source === "cp") { const cp = rows.find((r) => /^Short-term$/.test(text(r.matures))); if (!cp || Math.abs((num(cp.face) ?? 0) - total) > 0.5e6) bad.push("CP bar is not the CP outstanding"); continue; }
      // v3.2: the schedule's thereafter is a final "YYYY+" bar, equal to the schedule's thereafter amount.
      if (/^\d{4}\+$/.test(b.label)) {
        const th = (f.schedule?.entries ?? []).find((e: any) => /thereafter/i.test(e.period));
        const want = th ? Number(th.amount.replace(/[$,\s]/g, "")) * scale : NaN;
        if (!(Math.abs(want - total) <= 0.05e6 * (scale === 1e3 ? 10 : 1))) bad.push(`${b.label}: bar ${total / 1e6}, the schedule's thereafter ${want / 1e6}`);
        continue;
      }
      const years = /^\d{4}$/.test(b.label) ? [b.label] : (() => { const m = /^(\d{4})–(\d{2})$/.exec(b.label)!; const out: string[] = []; for (let y = Number(m[1]); y <= Number(m[1].slice(0, 2) + m[2]); y++) out.push(String(y)); return out; })();
      if (b.source === "schedule") {
        const want = years.reduce((a, y) => a + (f.schedule?.entries ?? []).filter((e: any) => !/thereafter/i.test(e.period) && (/(20\d\d)/.exec(e.period) ?? [])[1] === y).reduce((x: number, e: any) => x + Number(e.amount.replace(/[$,\s]/g, "")) * scale, 0), 0);
        if (Math.abs(want - total) > 0.05e6 * (scale === 1e3 ? 10 : 1)) bad.push(`${b.label}: bar ${total / 1e6}, the filer's schedule ${want / 1e6}`);
      } else {
        const want = rows.filter((r) => years.includes(rowYear(r) ?? "") && !/^Short-term$/.test(text(r.matures)) && !/–/.test(text(r.matures))).reduce((a, r) => a + (num(r.face) ?? 0), 0);
        if (Math.abs(want - total) > 0.5e6) bad.push(`${b.label}: bar ${total / 1e6}, the named instruments ${want / 1e6}`);
      }
    }
    return bad;
  },
};

const V7_TABLE: Test = {
  id: "V7", name: "table: every filer row once; every in-window row before any \"Show all\" cut",
  run: (card, f) => {
    if (!card.v3) return ["no v3 card"];
    const tb = card.v3.table;
    const bad: string[] = [];
    tb.rows.forEach((r, i) => { if (r.inWindow && i >= tb.visible) bad.push(`in-window row ${i + 1} ("${text(r.instrument)}") is behind the cut at ${tb.visible}`); });
    // v3.1: cut only above 12 rows.
    if (tb.rows.length > 12 && tb.visible > Math.max(8, tb.rows.reduce((a, r, i) => (r.inWindow ? i + 1 : a), 0))) bad.push(`${tb.rows.length} rows, ${tb.visible} shown before the cut`);
    if (tb.rows.length <= 12 && tb.visible !== tb.rows.length) bad.push("12 rows or fewer, but some are cut");
    for (const e of expectedRows(f)) {
      // An undrawn facility row is capacity, not debt (§2.5): it is in Facilities, never a $0 table row.
      if (e.faceUsd === 0 && e.kind === "facility") continue;
      const n = tb.rows.filter((r) => norm(r.name) === norm(e.label)).length;
      if (n !== 1) bad.push(`"${e.label}" appears ${n} times in the table`);
    }
    return bad;
  },
};

const V8_HEADBARS: Test = {
  id: "V8", name: "total-debt and liquidity bars sum to their figures; carrying and uncommitted amounts stay out",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const bad: string[] = [];
    const td = card.v3.totalDebt;
    const tdSum = td.segments.reduce((a, x) => a + x.usd, 0);
    if (Math.abs(tdSum - (num(td.figure) ?? 0)) > 0.5e6) bad.push(`total-debt bar ${tdSum / 1e6} ≠ figure ${td.figure.t}`);
    if (td.segments.some((x) => /carrying/i.test(x.title))) bad.push("a carrying-value segment in the total-debt bar");
    const lq = card.v3.liquidity;
    if (lq.figure) { const s = lq.segments.reduce((a, x) => a + x.usd, 0); if (Math.abs(s - (num(lq.figure) ?? 0)) > 0.5e6) bad.push(`liquidity bar ${s / 1e6} ≠ figure ${lq.figure.t}`); }
    if (lq.segments.some((x) => /commercial paper|uncommitted|incremental/i.test(x.title))) bad.push("commercial paper or uncommitted capacity in the liquidity bar");
    return bad;
  },
};

const V9_NEXT: Test = {
  id: "V9", name: "next-maturity tile: months away counted from the brief date, never for a year-only date",
  run: (card) => {
    const nt = card.v3?.call.nextTile;
    if (!card.v3) return ["no v3 card"];
    if (!nt) return [];
    const d = nt.date;
    if (!d || d.k !== "date") return ["next tile has no linked date"];
    if (d.granularity === "year") return nt.away ? ["months shown for a year-only date"] : [];
    const end = d.granularity === "month" ? `${d.date.slice(0, 8)}01` : d.date, b = card.briefDate;
    const months = (Number(end.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(b.slice(5, 7)) - (Number(end.slice(8, 10)) < Number(b.slice(8, 10)) ? 1 : 0);
    return new RegExp(`^${months} months? away`).test(nt.away ?? "") ? [] : [`"${nt.away}", but ${months} months from the brief date`];
  },
};

/**
 * G1 (v3.1) — SEGMENTS BY EACH ROW'S OWN LABELS. Color follows the stated
 * security label: a row whose own line states one (secured, unsecured, first
 * lien) is never in a grey segment, and every row of a colored segment states
 * one. Read from the table's own instrument lines.
 */
function ownLabels(card: Card): string[] {
  const v = card.v3!;
  const secOf = new Map(v.table.rows.map((r) => [norm(r.name), /\b(?:secured|unsecured|first[- ]lien)\b/i.test(text(r.instrument))]));
  const bad: string[] = [];
  const check = (where: string, segs: BarSegment[]) => {
    for (const sg of segs) for (const row of sg.rows ?? []) {
      const stated = secOf.get(norm(row));
      if (stated === undefined) continue;
      if (stated && sg.color === "#9AA3AD") bad.push(`${where}: "${row}" states its security but is in a grey segment`);
      if (!stated && ["#1F4E79", "#2E8B8B", "#5C8DBF"].includes(sg.color)) bad.push(`${where}: "${row}" states no security but is colored ${sg.color}`);
    }
  };
  check("total debt", v.totalDebt.segments);
  for (const b of v.chart.bars) check(`chart ${b.label}`, b.segments);
  if (!v.totalDebt.segments.some((s) => s.rows?.length)) bad.push("total-debt segments carry no rows");
  return bad;
}
const G1_OWNLABELS: Test = { id: "G1", name: "segments by each row's own labels: no stated-security row is ever grey", run: (card) => (card.v3 ? ownLabels(card) : ["no v3 card"]) };


// ── card_spec v3.2 (round 3): each rule over all six cards ───────────────
const segUsd = (x: Segment) => (x.k === "computed" ? x.usd : x.k === "figure" ? parseMoneyAmount(x.printed) ?? 0 : 0);
const notShownLine = (card: Card) => card.v3!.chart.captions.find((l) => /^Not shown on the chart/.test(text(l))) ?? null;

/** W1 — every dollar of face in exactly one place: a bar, or the not-shown list. */
function ladderEquation(card: Card): string[] {
  const v = card.v3!;
  const bars = v.chart.bars.reduce((a, b) => a + b.segments.reduce((x, sg) => x + sg.usd, 0), 0);
  const ns = notShownLine(card);
  const notShown = ns ? ns.filter((x) => x.k === "computed" || x.k === "figure").reduce((a, x) => a + segUsd(x), 0) : 0;
  const face = segUsd(v.totalDebt.figure);
  const bad: string[] = [];
  if (Math.abs(bars + notShown - face) > 0.5e6) bad.push(`bars ${Math.round(bars / 1e5) / 10} + not shown ${Math.round(notShown / 1e5) / 10} = ${Math.round((bars + notShown) / 1e5) / 10}, face total ${Math.round(face / 1e5) / 10}`);
  if (ns && /carrying value/i.test(text(ns))) bad.push("a carrying-value item counted among the not-shown face");
  const inBars = new Set(v.chart.bars.flatMap((b) => b.segments.flatMap((sg) => sg.rows ?? [])).map(norm));
  if (ns) for (const r of v.table.rows) if (text(ns).includes(text(r.instrument).replace(/ \(carrying value\)/, "")) && inBars.has(norm(r.name))) bad.push(`"${r.name}" is both in the bars and in the not-shown list`);
  const included = v.chart.captions.find((l) => /included in scheduled other principal/.test(text(l)));
  if (ns && included) for (const x of ns.filter((y) => y.k === "label")) if (text(included).includes(x.t)) bad.push(`"${x.t}" is listed as not shown and as included in scheduled other principal`);
  return bad;
}
const W1_LADDER: Test = { id: "W1", name: "ladder reconciles: bars + not shown = face total; nothing both charted and listed", run: (card) => (card.v3 ? ladderEquation(card) : ["no v3 card"]) };

/** W2 — a move retiring part of an instrument and the instrument's row show the same remainder. */
const couponYear = (t0: string) => { const c = (/(\d{1,2}(?:\.\d+|[⅛¼⅜½⅝¾⅞])?%)/.exec(t0) ?? [])[1]; const y = (/\b(20\d\d)\b/.exec(t0.replace(/\b(?:Jan|Feb|Mar|Apr|May|June|July|Aug|Sept|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}/g, "")) ?? [])[1]; return c && y ? `${c} ${y}` : null; };
function remainsIn(l: Line): number | null { const i = l.findIndex((x, n) => x.k === "text" && /^ remains/.test(x.t) && n > 0); return i > 0 ? segUsd(l[i - 1]) : null; }
function moveRowAgree(card: Card): string[] {
  const v = card.v3!;
  const bad: string[] = [];
  const rows = v.table.rows.map((r) => ({ r, key: couponYear(`${text(r.instrument)} ${text(r.matures)}`) }));
  for (const m of v.moves) {
    const retiring: Line[] = m.retires ? m.retires.items : /Refinanced|Repurchased|Redeemed|Repaid/.test(text(m.meta)) ? m.title : [];
    const pending = /redemption set for|awaiting confirmation/.test(text(m.retires?.meta ?? m.meta));
    for (const it of retiring) {
      const key = couponYear(text(it));
      const row = key ? rows.find((x) => x.key === key) : undefined;
      if (!row) continue;
      // Partial only: a confirmed retirement whose instrument still has a row, or a pending one smaller than the row's face.
      const retired = segUsd(it.find((x) => x.k === "figure" || x.k === "computed") ?? ({ k: "text", t: "" } as Segment));
      if (pending && retired >= segUsd(row.r.face!) - 0.5e6) continue;
      const rowRemains = row.r.status ? remainsIn(row.r.status.text) : null;
      const moveRemains = remainsIn(it);
      if (rowRemains === null) bad.push(`"${text(row.r.instrument)}" (${key}) is retired in part by a move, but its row states no remainder`);
      if (moveRemains === null) bad.push(`the move retiring ${key} states no remainder`);
      if (rowRemains !== null && moveRemains !== null && Math.abs(rowRemains - moveRemains) > 0.5e6) bad.push(`${key}: the move says $${moveRemains / 1e6}MM remains, the row $${rowRemains / 1e6}MM`);
    }
  }
  return bad;
}
const W2_MOVEROW: Test = { id: "W2", name: "a move and its row agree on what remains", run: (card) => (card.v3 ? moveRowAgree(card) : ["no v3 card"]) };

const W3_FACECELL: Test = {
  id: "W3", name: "no Face cell holds a carrying value without its tag",
  run: (card) => (card.v3 ? card.v3.table.rows.filter((r) => /carrying value/i.test(text(r.instrument)) && !(r.face && /carrying value/i.test(r.face.t))).map((r) => `"${r.name}": Face cell ${r.face?.t} is a carrying value without its tag`) : ["no v3 card"]),
};

/** W4 — no figure in "Not shown" is an input to any displayed computation. */
const W4_WITHHELD: Test = {
  id: "W4", name: "a withheld figure never enters any displayed computation",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const withheld = card.v3.notShown.flatMap((l) => [...text(l).matchAll(/\$([\d,]+(?:\.\d+)?)MM/g)].map((m) => Number(m[1].replace(/,/g, "")) * 1e6));
    const bad: string[] = [];
    for (const { line } of linesOf(card)) for (const x of line) if (x.k === "computed") for (const p of x.parts) if (withheld.some((w) => Math.abs(Math.abs(p.usd) - w) < 0.05e6)) bad.push(`withheld $${Math.abs(p.usd) / 1e6}MM is an input to ${x.t}`);
    return bad;
  },
};

/** W5 — nothing labelled "not stated" is named with that attribute in a cited sentence or in the card's own text. */
const W5_NOTSTATED: Test = {
  id: "W5", name: "no \"not stated\" for an attribute a cited sentence or the card itself names; withheld is never \"not stated\"",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const v = card.v3;
    const bad: string[] = [];
    const cited = [...new Set(linesOf(card).flatMap((w) => w.line.flatMap((x) => ("src" in x ? [x.src.sentence] : []))))];
    const cardText = v3Lines(card).map(text).join(" \n ");
    // Every "not stated" claim about a row's seniority or security, wherever the card makes it.
    const claims: { name: string; words: string[] }[] = [];
    for (const r of v.table.rows) {
      const st = r.status ? text(r.status.text) : "";
      if (/Seniority and security not stated/.test(st)) claims.push({ name: r.name, words: ["senior", "secured"] });
      else if (/Seniority not stated/.test(st)) claims.push({ name: r.name, words: ["senior"] });
      else if (/Security not stated/.test(st)) claims.push({ name: r.name, words: ["secured"] });
    }
    v.totalDebt.segments.forEach((sg, i) => { if (/seniority not stated/i.test(text(v.totalDebt.legend[i]?.label ?? []))) for (const n of sg.rows ?? []) claims.push({ name: n, words: ["senior", "secured"] }); });
    for (const { name, words } of claims) {
      const isFacility = kindOf(name) === "facility";
      const cy = couponYear(name);
      const namesIt = (sn: string) => (isFacility ? /credit agreement|revolving credit facility|revolver/i.test(sn) : cy ? sn.includes(cy.split(" ")[0].replace("%", "")) && sn.includes(cy.split(" ")[1]) : containsWord(sn, name));
      for (const word of words) {
        const re = word === "senior" ? /\bsenior secured (?:borrowing|obligations|capacity|credit|revolving|loans|notes|facilit)|\bare (?:senior)\b/i : /\bobligations under [^.]{0,60}\bare secured\b|\b(?:senior )?secured (?:borrowing|obligations|capacity|credit|revolving|loans|notes|facilit)|\bare (?:senior )?(?:secured|unsecured)\b/i;
        const named = cited.find((sn) => namesIt(sn) && re.test(sn));
        const self = isFacility && /\bsenior secured revolv/i.test(cardText);
        if (named || self) bad.push(`"${name}": ${word === "senior" ? "seniority" : "security"} shown as not stated, but ${named ? `a cited sentence states it: "${named.slice(0, 70)}"` : "the card itself names it senior secured"}`);
      }
    }
    // Withheld is never "not stated".
    const withheldLC = v.notShown.some((l) => /letters of credit/i.test(text(l)));
    if (withheldLC && v.facilities.some((f) => /letters of credit outstanding not stated/i.test(text(f.sub ?? [])))) bad.push('letters of credit are withheld (Not shown) but Facilities calls them "not stated"');
    return [...new Set(bad)];
  },
};

/** W6 — the grey-bar caption names exactly the causes present in the grey face. */
function greyCauses(card: Card): string[] {
  const v = card.v3!;
  const rowsByName = new Map(v.table.rows.map((r) => [norm(r.name), r]));
  const charted = v.chart.bars.reduce((a, b) => a + b.segments.reduce((x, sg) => x + sg.usd, 0), 0);
  const greyRows = v.chart.bars.flatMap((b) => b.segments.filter((sg) => sg.color === "#9AA3AD").flatMap((sg) => (sg.rows ?? []).map((n) => ({ n, usd: sg.usd / Math.max(1, (sg.rows ?? []).length) }))));
  const securityOnly = greyRows.filter(({ n }) => /\bsenior\b|junior/i.test(text(rowsByName.get(norm(n))?.instrument ?? [])));
  const neither = greyRows.filter(({ n }) => !/\bsenior\b|junior|secured|unsecured/i.test(text(rowsByName.get(norm(n))?.instrument ?? [])));
  const inBars = new Set(v.chart.bars.flatMap((b) => b.segments.flatMap((sg) => sg.rows ?? [])).map(norm));
  const scheduleBars = v.chart.bars.some((b) => b.source === "schedule");
  const absorbed = scheduleBars && v.table.rows.some((r) => !inBars.has(norm(r.name)) && /term loan|revolv|line of credit|advances/i.test(r.name));
  const caps = v.chart.captions.map(text).join(" ");
  const bad: string[] = [];
  const want = (cond: boolean, re: RegExp, what: string) => { if (cond && !re.test(caps)) bad.push(`missing cause: ${what}`); if (!cond && re.test(caps)) bad.push(`cause stated but not present: ${what}`); };
  want(absorbed, /appear as scheduled principal: the filer's schedule doesn't split them by instrument/, "debt carried only in the schedule's yearly totals");
  want(securityOnly.length > 0, /security is not stated/, "grey rows whose security is not stated");
  want(neither.length > 0, /seniority and security are not stated/, "grey rows stating neither label");
  const neitherFace = neither.reduce((a, x) => a + x.usd, 0);
  want(neitherFace > charted / 2, /state (?:seniority or security|labels) for few/i, "most charted face states neither label");
  return bad;
}
const W6_GREY: Test = { id: "W6", name: "the grey-bar caption states the causes the grey face actually has", run: (card) => (card.v3 ? greyCauses(card) : ["no v3 card"]) };

/** W7 — commercial paper a facility backs is netted from that facility's undrawn capacity in liquidity. */
const W7_CPNET: Test = {
  id: "W7", name: "liquidity nets the commercial paper a facility backs",
  run: (card) => {
    const v = card.v3;
    if (!v) return ["no v3 card"];
    const cp = v.table.rows.find((r) => /^Short-term$/.test(text(r.matures)) && r.status && /Backed by revolver/.test(text(r.status.text)));
    if (!cp) return [];
    const cpUsd = segUsd(cp.face!);
    const bad: string[] = [];
    const rev = v.liquidity.legend.find((l) => /Undrawn/.test(text(l.label)));
    if (!rev || rev.amount.k !== "computed" || !rev.amount.parts.some((p) => p.usd < 0 && Math.abs(Math.abs(p.usd) - cpUsd) < 0.5e6)) bad.push("the backing facility's undrawn capacity is not shown net of the commercial paper it backs");
    const sum = v.liquidity.legend.reduce((a, l) => a + segUsd(l.amount), 0);
    if (!v.liquidity.figure || Math.abs(segUsd(v.liquidity.figure) - sum) > 0.5e6) bad.push("liquidity total is not cash plus net undrawn capacity");
    if (!v.liquidity.notes.some((l) => /shown net of .+ commercial paper it backs/.test(text(l)))) bad.push('no "shown net of … commercial paper it backs" note');
    return bad;
  },
};

/** W8 — one coupon format per card: a rate printed as a fraction in the table is never a decimal elsewhere. */
const FRAC: Record<string, string> = { "⅛": ".125", "¼": ".25", "⅜": ".375", "½": ".5", "⅝": ".625", "¾": ".75", "⅞": ".875" };
const W8_COUPON: Test = {
  id: "W8", name: "one coupon format per card",
  run: (card) => {
    if (!card.v3) return ["no v3 card"];
    const fr = new Map<string, string>();
    for (const r of card.v3.table.rows) for (const m of text(r.instrument).matchAll(/(\d{1,2})([⅛¼⅜½⅝¾⅞])%/g)) fr.set(String(Number(`${m[1]}${FRAC[m[2]]}`)), m[0]);
    const bad: string[] = [];
    for (const { line } of linesOf(card).filter((w) => w.section === "v3")) for (const m of text(line).matchAll(/(\d{1,2}\.\d+)%/g)) if (fr.has(String(Number(m[1])))) bad.push(`${m[0]} beside the table's ${fr.get(String(Number(m[1])))}`);
    return [...new Set(bad)];
  },
};
const W9_NAME: Test = { id: "W9", name: "company name in one form (registered name, capitals)", run: (card) => (card.v3 && card.v3.header.company === card.v3.header.company.toUpperCase() ? [] : [`"${card.v3?.header.company}" is not in the one form`]) };
const W10_PRICE: Test = {
  id: "W10", name: "a price phrase attaches to the issuance or redemption it describes",
  run: (card) => (card.v3 ? card.v3.moves.flatMap((m) => (m.detail && /\bat \d{1,3}(?:\.\d+)?% of principal/.test(text(m.detail)) && !/^(?:Issued|Redeemed|Repurchased) at \d/.test(text(m.detail)) ? [`price detached: "${text(m.detail).slice(0, 80)}"`] : [])) : ["no v3 card"]),
};

const NAMED_TYPE = /\b(notes|debentures|term loan|revolver|ABL|credit (?:facility|agreement)|line of credit|commercial paper)\b/i;
const R3_NAMED: Test = {
  id: "A3", name: "refinance box: named instruments only, no \"not stated\" fallbacks",
  run: (card) => {
    const bad: string[] = [];
    for (const r of boxParts(card).rows) {
      const t = text(r);
      if (/other scheduled principal|over a range of years|\bdue \d{4} to \d{4}\b/i.test(t) || !NAMED_TYPE.test(t)) bad.push(`not a named instrument: "${t.slice(0, 70)}"`);
    }
    for (const l of refiOf(card)) if (l.some((x) => x.k === "notStated")) bad.push(`a "not stated" fallback in the box: "${text(l).slice(0, 60)}"`);
    return bad;
  },
};

const R4_LEFTOVERS: Test = {
  id: "A4", name: "refinance box: schedule leftovers and ranged items in one line",
  run: (card) => {
    const { plus, all } = boxParts(card);
    const bad: string[] = [];
    if (plus.length > 1) bad.push(`${plus.length} leftover lines`);
    for (const l of plus) if (!/^Plus \S+ of scheduled amortization and other principal, per the filer's schedule \(see maturity ladder\)/.test(text(l))) bad.push(`leftover line off template: "${text(l).slice(0, 80)}"`);
    const windowEnd = /\(to ([A-Z][a-z]+ \d+, \d{4})\)/.exec((card.headlines.refi ?? card.headlines.due24)?.heading ?? "")?.[1];
    const endYear = windowEnd ? Number(windowEnd.slice(-4)) : 0;
    const inWindowOther = (card.ladder.blocks ?? []).filter((b) => /^\d{4}$/.test(text(b.heading)) && Number(text(b.heading)) <= endYear).some((b) => b.lines.some((l) => /other scheduled principal/.test(text(l))));
    if (inWindowOther && plus.length !== 1) bad.push("the ladder has other scheduled principal inside the window, but the box has no leftover line");
    if (all.some((l) => /other scheduled principal, per the filer's schedule for/.test(text(l)))) bad.push("a schedule bucket has its own box row");
    return bad;
  },
};

const R5_MARKERS: Test = {
  id: "A5", name: "refinance box: flags as a marker, with one legend line",
  run: (card) => {
    const { all, legend } = boxParts(card);
    const bad: string[] = [];
    for (const l of all) if (/year only stated|month only stated|may fall within 18 months, see source/.test(text(l)) && !/^† /.test(text(l))) bad.push(`a flag spelled out in a row: "${text(l).slice(0, 70)}"`);
    const used = all.some((l) => !/^† /.test(text(l)) && text(l).includes("†"));
    if (used && legend.length !== 1) bad.push(`marker used, ${legend.length} legend lines`);
    if (!used && legend.length) bad.push("a legend with no marker");
    return bad;
  },
};

const R6_CP: Test = {
  id: "A6", name: "refinance box: commercial paper outstanding is a row",
  run: (card) => {
    const cpOnCard = linesOf(card).some((w) => w.section === "ladder" && /commercial paper/i.test(text(w.line)) && !!amountSeg(w.line));
    const row = boxParts(card).rows.find((r) => /commercial paper outstanding/i.test(text(r)));
    return cpOnCard && !row ? ["commercial paper is outstanding but has no box row"] : [];
  },
};

const R7_NEXT: Test = { id: "A7", name: "refinance box: a Next line after the rows", run: (card) => (boxParts(card).next.length === 1 ? [] : ["no single Next line"]) };

const R8_PREPERIOD: Test = {
  id: "B8", name: "no pre-period lines and no mechanics sentences",
  run: (card, f) => {
    const bad: string[] = [];
    const all = linesOf(card).map((w) => text(w.line));
    if (f.rolled) {
      const nil = f.rolled.rows.filter((r: any) => !r.amount || /^\$?\s*[—–-]\s*$/.test(r.amount)).map((r: any) => r.label);
      // A $0 row of the referenced filing would surface as one of its own lines ("from the 10-K") or inside a
      // list sentence (no amount of its own) — never as a current instrument line of the same kind.
      const suspect = linesOf(card).filter((w) => /from the 10-K/.test(text(w.line)) || (!amountSeg(w.line) && ["ladder", "withheld", "refi"].includes(w.section) && !w.block)).map((w) => norm(text(w.line)));
      for (const n of nil) if (suspect.some((t) => t.includes(norm(n)))) bad.push(`a line stated at $0 in the referenced filing appears: "${n}"`);
    }
    for (const t of all) if (/states at \$0|stated in both|each is shown once|stated as done in the|already outside the list/i.test(t)) bad.push(`mechanics or pre-period copy: "${t.slice(0, 70)}"`);
    return bad;
  },
};

const LABEL_WORD = /\b(senior|junior[- ]priority|subordinated|secured|unsecured|first[- ]lien)\b/gi;
const typeOfLine = (t: string) => norm(t.replace(/\$[\d,.~<]+MM.*$/, "").replace(LABEL_WORD, "").replace(/\s+/g, " "));
const R9_GROUPING: Test = {
  id: "B9", name: "total debt: never two lines with the same label (v3.1: segments by each row's own labels)",
  run: (card) => {
    const bad: string[] = [];
    const lines = card.headlines.totalDebt.lines.slice(1).filter((l) => !!amountSeg(l) && !/^Lines marked/.test(text(l)));
    // Never two lines with the same label (a type split by basis or by a label's source).
    const labelOf = (l: Line) => norm(text(l).replace(/\s*[~<]?\$[\d,.]+MM.*$/, ""));
    const seen = new Map<string, number>();
    for (const l of lines) seen.set(labelOf(l), (seen.get(labelOf(l)) ?? 0) + 1);
    for (const [k, n] of seen) if (n > 1) bad.push(`"${k}" shows as ${n} lines`);
    // v3.1 replaces the v2.1 "split only when every row carries the label" rule: a labelled and an unlabelled line of one type are now the rule.
    return bad;
  },
};

const TIER = (t: string) => (/\b(?:finance|financing) lease|\bother\b|obligations|notes payable|mortgages/i.test(t) ? 3 : /\bunsecured\b/i.test(t) ? 1 : /\b(?:secured|first[- ]lien)\b/i.test(t) ? 0 : 2);
const R14_ORDER: Test = {
  id: "C14", name: "total debt: ordered secured, unsecured, unlabelled, then leases and other",
  run: (card) => {
    const lines = card.headlines.totalDebt.lines.slice(1).filter((l) => !!amountSeg(l) && !/^Lines marked/.test(text(l)));
    const tiers = lines.map((l) => TIER(text(l).replace(/\$.*$/, "")));
    return tiers.every((t, i) => i === 0 || t >= tiers[i - 1]) ? [] : [`order by tier is ${tiers.join(",")}: "${lines.map((l) => text(l).replace(/\s*\$.*$/, "")).join(" / ")}"`];
  },
};

const R11_MOVEFORMAT: Test = {
  id: "B11", name: "moves in card format: no filer prose, no defined terms, no agreement titles",
  run: (card) => {
    const bad: string[] = [];
    for (const l of (card.moves?.blocks ?? []).flatMap((b) => b.lines)) {
      const t = text(l);
      if (/[“”"]|\(the |\bthe Company\b|\bwe\b|\bour\b|, dated |Amended and Restated|aggregate principal amount/i.test(t)) bad.push(`filer prose in a move: "${t.slice(0, 90)}"`);
      for (const x of l) if (x.k === "label" && x.t.split(/\s+/).length > 9) bad.push(`a long phrase in a move: "${x.t.slice(0, 60)}"`);
      if (/\$ \d|\d million|\d billion/.test(t)) bad.push(`an amount not in $MM: "${t.slice(0, 70)}"`);
    }
    return bad;
  },
};

const R12_MERGE: Test = {
  id: "B12", name: "related moves are one event: one line per date, and no part of a funded event on its own line",
  run: (card) => {
    const bad: string[] = [];
    for (const b of card.moves?.blocks ?? []) {
      const dates = b.lines.map((l) => (l[0]?.t ?? "").trim());
      for (const d of new Set(dates)) if (dates.filter((x) => x === d).length > 1) bad.push(`${dates.filter((x) => x === d).length} move lines dated ${d}`);
    }
    return bad;
  },
};

const R13_DECIMALS: Test = {
  id: "C13", name: "no trailing \".0\" on any amount",
  run: (card) => linesOf(card).flatMap((w) => w.line.filter((x) => (x.k === "figure" || x.k === "computed") && /\.\d*0MM/.test(x.t)).map((x) => `"${x.t}" in "${text(w.line).slice(0, 50)}"`)),
};

const R15_ONCE: Test = {
  id: "C15", name: "\"not stated\" once per group when every row of the group shares it",
  run: (card) => {
    const bad: string[] = [];
    for (const b of card.ladder.blocks ?? []) {
      const rows = b.lines.filter((l) => l.some((x) => x.k === "label") && !!amountSeg(l));
      const ns = rows.map((l) => l.find((x) => x.k === "notStated")?.t ?? null);
      if (rows.length >= 2 && ns.every((x) => x !== null && x === ns[0])) bad.push(`${text(b.heading)}: every row repeats "${ns[0]}"`);
    }
    const rolled = (card.ladder.blocks ?? []).flatMap((b) => b.lines).filter((l) => /from the 10-K/.test(text(l)) && !!amountSeg(l));
    const rns = rolled.map((l) => l.find((x) => x.k === "notStated")?.t ?? null);
    if (rolled.length >= 2 && rns.every((x) => x !== null && x === rns[0])) bad.push(`every "from the 10-K" line repeats "${rns[0]}"`);
    return bad;
  },
};

const R16_TAGS: Test = {
  id: "C16", name: "no cryptic tags",
  run: (card) => linesOf(card).map((w) => text(w.line)).filter((t) => /\(also stated here\)|\(use of proceeds\)/.test(t)).map((t) => `"${t.slice(0, 70)}"`),
};

const TESTS = [T1_PURITY, T2_LINKS, T3_TABLE, T4_NOTSTATED, T5_ONEMATURITY, T6_PRECISION, T7_SCHEDULE, T8_MOVES, T9_LINT, T10_HEDGES,
  R1_BOX, R2_SUMMARY, R2B_SCOPE, R3_NAMED, R4_LEFTOVERS, R5_MARKERS, R6_CP, R7_NEXT, R8_PREPERIOD, R9_GROUPING, R11_MOVEFORMAT, R12_MERGE, R13_DECIMALS, R14_ORDER, R15_ONCE, R16_TAGS,
  V1_LAYOUT, V2_CASE, V3_TILES, V4_VOCAB, V5_LEGEND, V6_BARS, V7_TABLE, V8_HEADBARS, V9_NEXT, G1_OWNLABELS,
  W1_LADDER, W2_MOVEROW, W3_FACECELL, W4_WITHHELD, W5_NOTSTATED, W6_GREY, W7_CPNET, W8_COUPON, W9_NAME, W10_PRICE];

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
  // 5.7: "not comparable at face" must not hide a genuine face gap. A carrying year whose
  // lines are relabelled face is compared again and must fail; a carrying year with no
  // line naming the instrument must fail too.
  {
    const ehc = cards.find((c) => /encompass/i.test(c.company));
    if (ehc) {
      const fe = fixtureOf(ehc.cik);
      const year = (ehc.ladder.blocks ?? []).find((b) => b.lines.some((l) => /\(carrying value\)/.test(text(l))))!;
      const y = text(year.heading);
      const asFace = clone(ehc);
      const bf = asFace.ladder.blocks!.find((b) => text(b.heading) === y)!;
      bf.lines = bf.lines.filter((l) => !/Not comparable at face/.test(text(l))).map((l) => l.map((s) => (s.k === "text" ? { ...s, t: s.t.replace("(carrying value) ", "") } : s)));
      out.push({ id: "5.7", failed: T7_SCHEDULE.run(asFace, fe).length > 0, what: "a carrying year relabelled face, whose genuine face gap must fail" });
      const unnamed = clone(ehc);
      const bu = unnamed.ladder.blocks!.find((b) => text(b.heading) === y)!;
      bu.lines = bu.lines.filter((l) => !/Not comparable at face/.test(text(l)));
      out.push({ id: "5.7", failed: T7_SCHEDULE.run(unnamed, fe).length > 0, what: "a carrying year with no line naming the instrument" });
    }
  }
  // 5.8: a stated move missing from the card.
  { const f = clone(f0); f.moveSentences.push({ doc: "x", url: "x", sentence: "In May 2026, we issued $999 million of 9.999% Phantom Notes due 2099." }); out.push({ id: "5.8", failed: T8_MOVES.run(c0, f).length > 0, what: "a stated move the card omits" }); }
  // 5.8: a card that drops its funding must fail.
  { const chs = cards.find((c) => /community/i.test(c.company)); if (chs?.v3) { const c = clone(chs); for (const m of c.v3!.moves) m.detail = null; out.push({ id: "5.8", failed: T8_MOVES.run(c, fixtureOf(chs.cik)).length > 0, what: "a move card with its stated funding removed" }); } }
  // 5.9: an engine term.
  { const c = clone(c0); c.coverage.lines.push([{ k: "text", t: "Rule 58 applies to the base row." }]); out.push({ id: "5.9", failed: T9_LINT.run(c, f0).length > 0, what: "\"Rule 58\" and \"base row\" in card copy" }); }
  // 5.10: a dropped hedge.
  { const c = clone(c0); const s = linesOf(c).flatMap((w) => w.line).find((x) => x.k === "figure") as any; s.src.sentence = `There was approximately ${s.printed} outstanding.`; s.t = s.t.replace(/^~/, ""); out.push({ id: "5.10", failed: T10_HEDGES.run(c, f0).length > 0, what: "an \"approximately\" figure shown without \"~\"" }); }

  // ── v2.1 negative controls: each corrupts one card and the test must fail ──
  {
    const pick = (re: RegExp) => cards.find((c) => re.test(c.company))!;
    const tenet = pick(/tenet/i), cigna = pick(/cigna/i), ehc = pick(/encompass/i), chs = pick(/community/i), dva = pick(/davita/i);
    out.push({ id: "A1", failed: boxPlacement(CARDVIEW.replace(/card\.thisWeek/, "XX").replace(/card\.moves/, "card.thisWeek")).length > 0, what: "a page rendering the box after the moves" });
    { const c = clone(tenet); const s0 = c.headlines.refi!.lines[0]; const a = s0.find((x) => x.k === "figure" || x.k === "computed")!; a.t = "$9,999MM"; out.push({ id: "A2", failed: R2_SUMMARY.run(c, null).length > 0, what: "a summary whose total is not its rows' sum" }); }
    // A2b: Tenet's v2.1 sentence — the redemption of its October 2028 notes, outside the window, added into the in-window figure.
    { const c = clone(tenet); const s0 = c.headlines.refi!.lines[0]; const i = s0.findIndex((x, n) => x.k === "text" && /^ already being redeemed/.test(x.t) && n > 0); if (i > 0) (s0[i - 1] as any).t = "$2,000MM"; else s0.push({ k: "text", t: "; " }, { k: "computed", t: "$2,000MM", usd: 2e9, parts: [] }, { k: "text", t: " already being redeemed" }); out.push({ id: "A2b", failed: R2B_SCOPE.run(c, null).length > 0, what: "Tenet's v2.1 summary, counting the $500MM October 2028 redemption in the in-window figure" }); }
    { const c = clone(dva); c.headlines.refi!.lines.splice(1, 0, [{ k: "computed", t: "$62.3MM", usd: 62.3e6, parts: [] }, { k: "text", t: " other scheduled principal, per the filer's schedule for 2026" }]); out.push({ id: "A3", failed: R3_NAMED.run(c, null).length > 0, what: "a schedule bucket as its own box row" }); }
    { const c = clone(dva); const pl = c.headlines.refi!.lines.find((l) => /^Plus /.test(text(l))); c.headlines.refi!.lines.push(pl ? clone(pl) : [{ k: "text", t: "Plus $1MM of scheduled amortization and other principal, per the filer's schedule (see maturity ladder)" }], [{ k: "text", t: "Plus $1MM of scheduled amortization and other principal, per the filer's schedule (see maturity ladder)" }]); out.push({ id: "A4", failed: R4_LEFTOVERS.run(c, null).length > 0, what: "two leftover lines" }); }
    { const c = clone(tenet); c.headlines.refi!.lines = c.headlines.refi!.lines.filter((l) => !/^† /.test(text(l))); c.headlines.refi!.lines[1].push({ k: "text", t: " †" }); out.push({ id: "A5", failed: R5_MARKERS.run(c, null).length > 0, what: "a marker with no legend" }); }
    { const c = clone(cigna); c.headlines.refi!.lines = c.headlines.refi!.lines.filter((l) => !/commercial paper outstanding/i.test(text(l))); out.push({ id: "A6", failed: R6_CP.run(c, null).length > 0, what: "commercial paper outstanding with no box row" }); }
    { const c = clone(tenet); c.headlines.refi!.lines = c.headlines.refi!.lines.filter((l) => !/^Next/.test(text(l))); out.push({ id: "A7", failed: R7_NEXT.run(c, null).length > 0, what: "a box with no Next line" }); }
    { const c = clone(cigna); c.ladder.lines.push([{ k: "text", t: "6 lines the Dec 31, 2025 10-K states at $0, not debt: Commercial paper." }]); out.push({ id: "B8", failed: R8_PREPERIOD.run(c, fixtureOf(cigna.cik)).length > 0, what: "a line listing instruments stated at $0" }); }
    { const c = clone(ehc); const td = c.headlines.totalDebt.lines; const l = td.find((x, n) => n > 0 && !!amountSeg(x))!; td.push(clone(l)); out.push({ id: "B9", failed: R9_GROUPING.run(c, null).length > 0, what: "one type on two lines" }); }
    { const c = clone(chs); const b = c.moves!.blocks![0]; b.lines[0].push({ k: "label", t: "the Company used approximately $ 600 million of cash on hand", stated: "x", src: { sentence: "x", url: "x", doc: "x" } }); out.push({ id: "B11", failed: R11_MOVEFORMAT.run(c, null).length > 0, what: "filer prose in a move line" }); }
    { const c = clone(ehc); const b = c.moves!.blocks![c.moves!.blocks!.length - 1]; b.lines.push(clone(b.lines[0])); out.push({ id: "B12", failed: R12_MERGE.run(c, null).length > 0, what: "two move lines for one dated event" }); }
    { const c = clone(dva); const a = c.headlines.totalDebt.lines[0].find((x) => x.k === "computed")!; a.t = "$10,847.0MM"; out.push({ id: "C13", failed: R13_DECIMALS.run(c, null).length > 0, what: "an amount with a trailing .0" }); }
    { const c = clone(tenet); const td = c.headlines.totalDebt.lines; const body = td.slice(1).reverse(); c.headlines.totalDebt.lines = [td[0], ...body]; out.push({ id: "C14", failed: R14_ORDER.run(c, null).length > 0, what: "the breakdown in reverse priority" }); }
    { const c = clone(cigna); const b = (c.ladder.blocks ?? []).find((x) => x.lines.filter((l) => !!amountSeg(l)).length >= 2)!; for (const l of b.lines) if (amountSeg(l)) l.push({ k: "notStated", t: "seniority and security not stated, please refer to sources", src: { sentence: "x", url: "x", doc: "x" } }); out.push({ id: "C15", failed: R15_ONCE.run(c, null).length > 0, what: "every row of a group repeating one fallback" }); }
    { const c = clone(chs); c.moves!.blocks![0].lines[0].push({ k: "text", t: " (also stated here)" }); out.push({ id: "C16", failed: R16_TAGS.run(c, null).length > 0, what: "a cryptic tag" }); }
  }

  // ── v3.0 negative controls ──
  {
    const pick = (re: RegExp) => cards.find((c) => re.test(c.company))!;
    const tenet = pick(/tenet/i), cigna = pick(/cigna/i), molina = pick(/molina/i), dva = pick(/davita/i);
    if (tenet.v3) {
      out.push({ id: "V1", failed: layoutOrder(V3VIEW.replace("{/* 3. The call box", "{/* X").replace("{/* 4. Recent debt moves", "{/* 3. The call box")).length > 0, what: "a page with the call box after the moves" });
      { const c = clone(tenet); c.v3!.call.case = "B"; out.push({ id: "V2", failed: V2_CASE.run(c, null).length > 0, what: "Tenet called case B with debt not yet refinanced" }); }
      { const c = clone(tenet); const r = c.v3!.call.tiles.find((x) => x.key === "refinanced")!; r.usd += 100e6; out.push({ id: "V3", failed: V3_TILES.run(c, null).length > 0, what: "tiles that do not sum" }); }
      { const c = clone(tenet); c.v3!.call.rows[0].tag = { text: [{ k: "text", t: "Refinanced · redeemed September 2026" }], tone: "refinanced" }; out.push({ id: "V4", failed: V4_VOCAB.run(c, null).length > 0, what: "\"redeemed\" for a redemption no filing confirms" }); }
      { const c = clone(tenet); c.v3!.chart.legend = c.v3!.chart.legend.slice(1); out.push({ id: "V5", failed: V5_LEGEND.run(c, null).length > 0, what: "a chart color with no legend entry" }); }
      { const c = clone(tenet); const b = c.v3!.chart.bars.find((x) => x.source === "schedule")!; (b.total as any).usd += 50e6; b.segments[0].usd += 50e6; out.push({ id: "V6", failed: V6_BARS.run(c, fixtureOf(tenet.cik)).length > 0, what: "a bar that does not equal the filer's schedule" }); }
    }
    if (cigna.v3) { const c = clone(cigna); c.v3!.table.visible = 2; out.push({ id: "V7", failed: V7_TABLE.run(c, fixtureOf(cigna.cik)).length > 0, what: "an in-window row behind the Show all cut" }); }
    if (cigna.v3) { const c = clone(cigna); c.v3!.liquidity.segments.push({ usd: 1000e6, color: "#9CCBBE", title: "commercial paper outstanding" }); out.push({ id: "V8", failed: V8_HEADBARS.run(c, null).length > 0, what: "commercial paper in the liquidity bar" }); }
    // G1: CHS's senior secured notes painted grey must fail.
    { const chs = pick(/community/i); if (chs.v3) { const c = clone(chs); for (const sg of c.v3!.totalDebt.segments) if (sg.color === "#1F4E79") sg.color = "#9AA3AD"; out.push({ id: "G1", failed: G1_OWNLABELS.run(c, null).length > 0, what: "stated-security rows in a grey segment" }); } }
    if (molina.v3) { const c = clone(molina); c.v3!.call.nextTile!.away = "3 months away"; out.push({ id: "V9", failed: V9_NEXT.run(c, null).length > 0, what: "a wrong month count" }); }
    void dva;
  }

  // ── v3.2 negative controls ──
  {
    const pick = (re: RegExp) => cards.find((c) => re.test(c.company))!;
    const tenet = pick(/tenet/i), ehc = pick(/encompass/i), dva = pick(/davita/i), chs = pick(/community/i), cigna = pick(/cigna/i);
    if (tenet.v3) {
      { const c = clone(tenet); c.v3!.chart.bars.pop(); out.push({ id: "W1", failed: W1_LADDER.run(c, null).length > 0, what: "the thereafter bar removed" }); }
      { const c = clone(tenet); const r = c.v3!.table.rows.find((x) => /Finance leases/.test(x.name))!; c.v3!.chart.captions.push([{ k: "text", t: "Not shown on the chart, with no single maturity: " }, r.face!, { k: "text", t: " " }, ...r.instrument]); out.push({ id: "W1", failed: W1_LADDER.run(c, null).length > 0, what: "a caption re-listing scheduled principal" }); }
      { const c = clone(tenet); const r = c.v3!.table.rows.find((x) => /5\.500/.test(text(x.instrument)))!; r.status = { text: [{ k: "notStated", t: "Seniority not stated", src: { sentence: "x", url: "x", doc: "x" } }], tone: "neutral" }; c.v3!.chart.captions.push([{ k: "label", t: "senior", stated: "senior", src: { sentence: "The 5.500% senior secured first lien notes due 2032 are senior secured obligations.", url: "x", doc: "x" } }]); r.name = "5.500% senior secured notes due 2032"; out.push({ id: "W5", failed: W5_NOTSTATED.run(c, null).length > 0, what: "\"not stated\" for an attribute a cited sentence states" }); }
    }
    if (ehc.v3) {
      { const c = clone(ehc); const strip = (l: Line) => { const i = l.findIndex((x) => x.k === "text" && /·/.test(x.t)); return i > 0 ? l.slice(0, i) : l; }; for (const m of c.v3!.moves) { if (m.retires) m.retires.items = m.retires.items.map(strip); } for (const r of c.v3!.table.rows) if (r.status && / remains/.test(text(r.status.text))) r.status = { text: [{ k: "text", t: "Not yet refinanced" }], tone: "orange" }; out.push({ id: "W2", failed: W2_MOVEROW.run(c, null).length > 0, what: "the partial note stripped" }); }
      { const c = clone(ehc); for (const r of c.v3!.table.rows) if (r.face) r.face = { ...r.face, t: r.face.t.replace(/ \(carrying value\)/, "") }; for (const r of c.v3!.table.rows) if (!/carrying value/.test(text(r.instrument))) { r.instrument = [...r.instrument, { k: "text", t: " (carrying value)" }]; break; } out.push({ id: "W3", failed: W3_FACECELL.run(c, null).length > 0, what: "an untagged carrying value in the Face column" }); }
      { const c = clone(ehc); const lf = c.v3!.liquidity.figure as any; if (lf && lf.k === "computed") lf.parts = [...lf.parts, { printed: "$ 53.6 million", usd: -53.6e6, src: { sentence: "x", url: "x", doc: "x" } }]; c.v3!.notShown = [[{ k: "text", t: "Senior secured revolver letters of credit, $53.6MM: withheld." }]]; out.push({ id: "W4", failed: W4_WITHHELD.run(c, null).length > 0, what: "a withheld figure used in liquidity" }); }
      { const c = clone(ehc); const m = c.v3!.moves.find((x) => /Aug 13/.test(text(x.meta))); if (m) m.detail = [{ k: "text", t: "Used to repay part of the revolver, at 98.75% of principal, adding to the existing notes." }]; out.push({ id: "W10", failed: W10_PRICE.run(c, null).length > 0, what: "the price on the use clause" }); }
    }
    if (dva.v3) { const c = clone(dva); c.v3!.chart.captions = [c.v3!.chart.captions[0], [{ k: "text", t: "This company's filings state seniority or security for few of these instruments, so most bars are grey." }]]; out.push({ id: "W6", failed: W6_GREY.run(c, null).length > 0, what: "DaVita with the old grey sentence" }); }
    if (cigna.v3) { const c = clone(cigna); const l = c.v3!.liquidity.legend.find((x) => /Undrawn/.test(text(x.label)))!; l.amount = { k: "figure", t: "$6,500MM", printed: "$ 6.5 billion", src: { sentence: "x", url: "x", doc: "x" } }; out.push({ id: "W7", failed: W7_CPNET.run(c, null).length > 0, what: "the revolver counted gross of the CP it backs" }); }
    if (chs.v3) { const c = clone(chs); c.v3!.moves[0].title.push([{ k: "text", t: "~$231MM 10.875% senior secured notes due 2032" }]); out.push({ id: "W8", failed: W8_COUPON.run(c, null).length > 0, what: "10.875% beside the table's 10⅞%" }); }
    if (cigna.v3) { const c = clone(cigna); c.v3!.header.company = "Cigna Group"; out.push({ id: "W9", failed: W9_NAME.run(c, null).length > 0, what: "a mixed-case name" }); }
  }
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
const reported = [...new Set(NOT_COMPARABLE)];
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
if (reported.length) console.log("\nReported, not failed (ruling, Oct 16):\n" + reported.map((r) => `  ${r}`).join("\n"));
const broken = ctl.filter((c) => !c.failed);
for (const c of broken) console.log(`\n  ✗ NEGATIVE CONTROL ${c.id} DID NOT FAIL — ${c.what}: this test cannot fail as written`);
console.log(`\n${TESTS.length * run.length - Object.values(counts).reduce((a, o) => a + Object.values(o).filter((n) => n > 0).length, 0)} passed, ${Object.values(counts).reduce((a, o) => a + Object.values(o).filter((n) => n > 0).length, 0) + broken.length} failed.`);
if (totalFail > 0 || broken.length > 0) process.exit(1);
