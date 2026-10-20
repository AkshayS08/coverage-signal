/**
 * BUILD ONE CARD — card_spec.md v1.2. Pure: no network, no model.
 *
 * Inputs are the signed name's result re-derived from cache (`generate.ts`
 * checks it against the golden before building), this week's filings as
 * EDGAR metadata, and the filer's tagged cash with its printed line. Output
 * is a `Card` whose every figure, date and label carries its own sentence.
 *
 * Rules this file applies, each over the class:
 *   - every instrument appears once; where two sources state one instrument
 *     (an anchor row and a rolled base row), identity is rate + compatible
 *     maturity + stated face, and an ambiguous match is never merged
 *   - no bare amount: every amount line names its type
 *   - capacity is never debt; commercial paper is never liquidity
 *   - a date is shown at the precision of the sentence it links to
 *   - nothing withheld disappears: section 2.6 lists it, and says so when empty
 */
import type { CompanyResult } from "../agent";
import type { FilingEntry } from "../fetch/filings";
import type { DateGranularity } from "../agent/claude";
import type { VerifiedFacility } from "../agent/verifyFacility";
import { assemblePosition, amountProvenanceFor, facilityMaturityAtItsSentence, matchFacility, parseMoneyAmount, type LadderRow } from "../events/position";
import { computeCoverage } from "../events/coverage";
import { rolledCoverageFor } from "../events/rolledCoverage";
import { borrowingBaseOf } from "../agent/borrowingBase";
import { classifyInstrument, type NoteSeniorityStatement } from "../events/instrumentClass";
import { extractFactTokens, factTokensMatch } from "../agent/factTokens";
import { createTextLocator } from "../agent/verifyQuote";

import type { BarSegment, Card, CardFacts, CardSection, CardV3, ChartBar, Fact, Line, PaletteColor, Segment, Source, Tag } from "./types";
import { PALETTE } from "./types";
import { classLabels, couponsIn, headingClass, notStatedSuffix, sentenceClass, statementReaches, typeLabel, containsWord } from "./labels";
import { amountSupportOf, sentenceSupportsMaturity } from "../events/position";
import { headingFor as printedHeadingFor, kindOf, printedBefore, printedHeadings } from "./headings";
import { addDays, addMonths, displayAmount, displayDate, displayUsd, hedgedIn, mmDecimals, shortDate, weekRange } from "./format";

export interface CardInputs {
  result: CompanyResult;
  briefDate: string;
  previousBrief: string | null;
  weekFilings: FilingEntry[];
  /** `printed` is the balance-sheet cell with the scale its caption declares (Rule 67), e.g. "$ 149 million". */
  cash: { usd: number | null; printed: string | null; printedLine: string | null; reason: string | null };
  /** The text of every document a row cites, preloaded so this function stays pure. */
  textByUrl: Map<string, string>;
  /** The anchor's own sentence stating its period end (its cover line), for every "as of" date. */
  periodSentence: string | null;
  /** Filings after the anchor through the brief date: permitted label sources (§3.5). */
  laterUrls?: string[];
  /** Verified card facts (capture/facts.ts), where captured. */
  facts?: CardFacts | null;
}

/** 8-K items that change, or could change, debt, liquidity or maturities (card_spec 2.2). */
const ACTIONABLE_ITEMS: Record<string, string> = {
  "1.01": "a material agreement entered into or amended",
  "1.02": "a material agreement terminated",
  "2.03": "a new direct financial obligation",
  "2.04": "an event accelerating an obligation",
  "2.01": "an acquisition or disposition completed",
};
const WHY: Record<string, string> = {
  "1.01": "may change a facility, a commitment or the debt terms",
  "1.02": "may end a facility or commitment",
  "2.03": "adds debt or an off-balance-sheet obligation",
  "2.04": "may make debt due early",
  "2.01": "counts only if financed with debt, which needs the filing's text",
};

const t = (text: string): Segment => ({ k: "text", t: text });

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = MONTH_NAMES.join("|");

/** A table line bridging face to carrying value: issue costs, discounts, premium. */
const BRIDGE = /discount|premium|issu(?:e|ance) costs|financing costs/i;

/** A display row: one instrument, wherever it came from. */
interface Item {
  row: LadderRow | null;
  name: string;
  /** The sentence holding the instrument's own name — which note this is, linked (Rule 19: same size is not same instrument). */
  nameSrc: Source;
  amountPrinted: string | null;
  amountSrc: Source;
  maturity: { date: string; granularity: DateGranularity; src: Source } | null;
  labels: { type: Segment; seniority: Segment | null; security: Segment | null };
  isCapacity: boolean;
  rolled: boolean;
  /**
   * CARD_SPEC §3.2 — what the amount IS. "face" where a permitted source
   * states principal: a table that prints its own bridge to carrying value, a
   * sentence, a drawn figure, or the instrument's own name. Otherwise
   * "carrying", and the line says so. The two never mix in one figure.
   */
  basis: "face" | "carrying";
  /** The filer row this line stands for, where it is not the line's own name (a base row shown under its anchor twin). */
  rowLabel?: string;
  /** A maturity stated as a range of years ("2026-2038"): a stated maturity, shown as the range (§2.5). */
  range?: { from: string; to: string; stated: string; src: Source };
  /** What a stated debt move did to this instrument, linked (§2.3): shown on its own line. */
  moveFlags?: Line;
  /** The facility field the amount is, where it is one ("drawn"). */
  amountField?: string;
  note?: string;
  /** Set when one instrument is stated in two rows (a current and a long-term portion): the amount shown is their sum. */
  amountParts?: { printed: string; usd: number; src: Source }[];
}

export function buildCard(i: CardInputs): Card {
  const { result, briefDate } = i;
  const dm = result.results.find((r) => r.triggerId === "debt-maturity") as any;
  const anchor = dm?.debtScheduleSourceFiling as { form: string; date: string; reportDate: string; url: string } | undefined;
  if (!anchor) throw new Error(`${result.company}: no anchor filing — a card states where its position comes from or it is not built`);
  const periodEnd = anchor.reportDate;
  const pos = assemblePosition(result, new Date(`${briefDate}T00:00:00Z`));
  const rc = rolledCoverageFor(result);
  const cov = computeCoverage(dm, undefined, undefined, rc);
  const facilities: VerifiedFacility[] = dm?.facilities ?? [];
  // A note's seniority sentence is a label source only where the ANCHOR states
  // it. One found only in a prior 10-K is the Rule 66 interaction deferred for
  // days from a prior 10-K, and a security label is the same kind of standing
  // term, so it is not used and the trust section says so.
  const rawStatement: NoteSeniorityStatement | null = dm?.seniorityStatement ?? null;
  const statementInAnchor = (s: NoteSeniorityStatement | null) => {
    const text = i.textByUrl.get(anchor.url);
    return !!s && !!text && createTextLocator(text).find(s.statement) !== null;
  };
  const statement: NoteSeniorityStatement | null = statementInAnchor(rawStatement) ? rawStatement : null;

  // ── document labels: every URL the result cites, named for the reader ──
  const docs = new Map<string, string>();
  for (const r of result.results) for (const c of (r as any).citations ?? []) if (c?.url) docs.set(c.url, `${c.form} ${c.date}`);
  docs.set(anchor.url, `${anchor.form} ${anchor.date}`);
  if (dm?.priorPeriodBase?.filingUrl) docs.set(dm.priorPeriodBase.filingUrl, `10-K for ${shortDate(dm.priorPeriodBase.periodOfReport)}`);
  // RULE 44 ON THE CARD — a sentence's document is the one it is FOUND in.
  // The URL a caller proposes is tried first; where the sentence is not in it
  // but is in another document this card holds, that document is cited. The
  // proposal is kept only where no held document can answer.
  const locators = new Map<string, ReturnType<typeof createTextLocator>>();
  const foundIn = (url: string, sentence: string): boolean => {
    const text = i.textByUrl.get(url);
    if (!text) return false;
    if (!locators.has(url)) locators.set(url, createTextLocator(text));
    return locators.get(url)!.find(sentence) !== null;
  };
  const src = (sentence: string, url: string): Source => {
    const where = foundIn(url, sentence) ? url : [...i.textByUrl.keys()].find((u) => foundIn(u, sentence)) ?? url;
    return { sentence, url: where, doc: docs.get(where) ?? where.split("/").pop() ?? where };
  };
  const anchorSrc = (sentence: string) => src(sentence, anchor.url);
  // A table that prints its own bridge line (issue costs, discounts, premium)
  // states its rows at face: the bridge is what takes them to carrying value.
  // A table with no bridge line states carrying value (card_spec §3.2).
  const bridgeLines: any[] = (dm?.scheduleSequence ?? []).filter((e: any) => e.kind === "adjustment" && BRIDGE.test(e.label ?? ""));
  const periodSrc = i.periodSentence ? anchorSrc(i.periodSentence) : null;
  const periodDate = (): Segment => (periodSrc ? { k: "date", t: displayDate(periodEnd, "day"), date: periodEnd, granularity: "day", src: periodSrc } : t(displayDate(periodEnd, "day")));

  const facilityFor = (row: LadderRow) =>
    facilities.find((f) => f.name === row.instrument) ?? (row.maturityFromFacility ? facilities.find((f) => f.name === row.maturityFromFacility!.facility) : undefined);
  // PRINTED HEADINGS ONLY (§3.5). A heading the stored answer records is a
  // label source only where the table prints it directly before the rows it
  // governs; a recorded heading the filer never printed counts for nothing
  // (audit-spine instance 12).
  const anchorText = i.textByUrl.get(anchor.url) ?? "";
  const rowEntries: any[] = (dm?.scheduleSequence ?? []).filter((e: any) => e.kind === "row");
  /** The scale the note's table prints its cells in (Rule 67). */
  const tableScale = /thousand/i.test(rowEntries[0]?.amount ?? "") ? "thousand" : "million";
  const tableText = (() => {
    const loc = createTextLocator(anchorText);
    const at = rowEntries.map((e) => loc.find(e.sourceLine)).filter((x): x is number => x !== null);
    return at.length ? anchorText.slice(Math.max(0, Math.min(...at) - 600), Math.max(...at) + 300).replace(/[\s\u00a0]+/g, " ").trim() : "";
  })();
  const headings = printedHeadings(tableText, rowEntries.map((e) => {
    const cands = [e.section, e.seniority].filter(Boolean) as string[];
    return { label: e.label ?? "", recordedHeading: cands.find((h) => printedBefore(tableText, h, e.label ?? "")) ?? cands[0] ?? null };
  }));
  const headingFor = (name: string): string | null => printedHeadingFor(headings, name)?.text ?? null;
  // The sentences a label may come from: the anchor, every later filing through
  // the brief date, and the row's own cited document (§3.5, Rule 66).
  const sentencePools = new Map<string, Source[]>();
  const sentencesOf = (url: string): Source[] => {
    if (!sentencePools.has(url)) {
      const text = i.textByUrl.get(url) ?? "";
      const ss = text.replace(/[\s\u00a0]+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(\u201c"])/).filter((x) => x.length < 900);
      sentencePools.set(url, ss.map((x) => ({ sentence: x, url, doc: docs.get(url) ?? url.split("/").pop() ?? url })));
    }
    return sentencePools.get(url)!;
  };
  const labelSentences = (ownUrl: string | null): Source[] => [...new Set([anchor.url, ...(i.laterUrls ?? []), ...(ownUrl ? [ownUrl] : [])])].filter((u) => i.textByUrl.has(u)).flatMap(sentencesOf);
  /** Name, then printed heading, then a naming sentence, then the note's statement: the first that states each label. */
  const withSources = (name: string, base: { seniority: Segment | null; security: Segment | null }, ownUrl: string | null) => {
    const h = headingFor(name);
    const hc = headingClass(h, h ? anchorSrc(h) : null);
    const sc = base.seniority && base.security ? { seniority: null, security: null } : sentenceClass(name, labelSentences(ownUrl));
    return { seniority: base.seniority ?? hc.seniority ?? sc.seniority, security: base.security ?? hc.security ?? sc.security };
  };

  // ── one Item per ladder row ──
  const fromRow = (row: LadderRow): Item => {
    const f = row.isCapacity ? facilityFor(row) : undefined;
    const amtSentence = f && row.isCapacity ? amountProvenanceFor(f).sourceLine : row.sourceLine;
    const amtUrl = f && row.isCapacity ? f.figureSources?.facilitySize ?? f.citedUrl : row.citedUrl || anchor.url;
    const amountSrc = src(amtSentence, amtUrl);
    const mf = row.maturityFromFacility ? facilityFor(row) : undefined;
    const matUrl = mf ? mf.figureSources?.maturity ?? mf.citedUrl : row.citedUrl || anchor.url;
    const maturity =
      row.maturityDate && row.dateGranularity && row.maturitySourceLine
        ? { date: row.maturityDate, granularity: row.dateGranularity, src: src(row.maturitySourceLine, matUrl) }
        : null;
    const stated = row.classification.instrumentTypeStatedAs ?? "";
    const heading = headingFor(row.instrument);
    // The sentence naming the instrument: its amount or maturity sentence where
    // either carries the name, otherwise the sentence in its own document that
    // does (an 8-K's amount sentence can stop before the name it belongs to).
    const nameSentence = [amtSentence, maturity?.src.sentence].find((s) => s && containsWord(s, row.instrument));
    const nameUrl = row.citedUrl || anchor.url;
    const found = nameSentence ?? findSentenceWith(i.textByUrl.get(nameUrl), row.instrument);
    const nameSrc = found ? (found === amtSentence ? amountSrc : found === maturity?.src.sentence ? maturity!.src : src(found, nameUrl)) : amountSrc;
    const typeSrc = [amountSrc, maturity?.src, nameSrc].find((s) => s && stated && containsWord(s.sentence, stated)) ?? (heading && containsWord(heading, stated) ? anchorSrc(heading) : nameSrc);
    const st = statementReaches(statement, row) && statement ? { s: statement, src: anchorSrc(statement.statement) } : null;
    const fromName = classLabels(row.instrument, nameSrc, null);
    const named = withSources(row.instrument, fromName, row.citedUrl || null);
    const fromStatement = classLabels(row.instrument, nameSrc, st);
    const cls = { seniority: named.seniority ?? fromStatement.seniority, security: named.security ?? fromStatement.security };
    // A row drawn under a facility ("Advances under revolving credit facility")
    // is that facility: the facility's own name is the instrument's own name,
    // linked to the facility sentence that carries it.
    const fac = facilityFor(row) ?? (isFacilityType(row) ? (matchFacility({ name: row.instrument, category: null }, facilities) as VerifiedFacility | null) : null);
    if (fac && (!cls.seniority || !cls.security)) {
      const ownFig = [fac.facilitySize, fac.available, fac.drawn, fac.maturity].find((x) => x && containsWord(x.sourceLine, fac.name));
      const facUrl = fac.figureSources?.facilitySize ?? fac.citedUrl;
      const own = ownFig ? { sentence: ownFig.sourceLine, url: facUrl } : (() => {
        for (const url of [facUrl, fac.citedUrl, ...Object.values(fac.figureSources ?? {})]) {
          const s = findSentenceWith(i.textByUrl.get(url), fac.name);
          if (s) return { sentence: s, url };
        }
        return null;
      })();
      if (own) {
        const fcls = classLabels(fac.name, src(own.sentence, own.url), null);
        cls.seniority = cls.seniority ?? fcls.seniority;
        cls.security = cls.security ?? fcls.security;
      }
    }
    const printed = row.isCapacity ? f?.facilitySize?.value ?? row.amount : row.amount;
    const item: Item = { row, name: row.instrument, nameSrc, amountPrinted: printed, amountSrc, maturity, labels: { type: typeLabel(row, typeSrc), ...cls }, isCapacity: !!row.isCapacity, rolled: false, basis: "face" };
    // A RANGE IS A STATED MATURITY (§2.5): "2026-2038" in the row's own line.
    const range = !maturity && !row.isCapacity ? /\b(20\d\d)\s*(?:-|–|—|to|through)\s*(20\d\d)\b/.exec(amtSentence ?? "") : null;
    if (range && range[1] < range[2]) item.range = { from: range[1], to: range[2], stated: range[0], src: amountSrc };
    // FACE FIRST. A row of a table with no bridge line is carrying value —
    // unless the facility it is drawn under states its drawn amount for the
    // position date, which is principal borrowed.
    if (!row.isCapacity && row.provenance === "note" && bridgeLines.length === 0) {
      const drawn = fac?.drawn && fac.asOfDate === periodEnd ? fac.drawn : null;
      if (drawn) {
        item.amountPrinted = drawn.value;
        item.amountSrc = src(drawn.sourceLine, fac!.figureSources?.drawn ?? fac!.citedUrl);
        item.amountField = "drawn";
      } else item.basis = "carrying";
    }
    return item;
  };
  const anchorItems = pos.rows.filter((r) => r.status === "live").map(fromRow);

  // ── the rolled base, where coverage rests on one (card_spec 2.4, BRD 8.14) ──
  const rolledLabel = rc.counts ? rc.label : null;
  const rolledItems: Item[] = [];
  const rolledEvents: Line[] = [];
  const rolledNil: string[] = [];
  const dedupNotes: string[] = [];
  if (rc.counts) {
    const base = rc.entries.filter((e) => e.kind === "base-row");
    const counted = rc.movements.filter((m) => m.placement === "delta");
    const live = base.filter((b) => b.amountMillions !== 0);
    for (const b of base.filter((b) => b.amountMillions === 0)) rolledNil.push(b.label);
    // A counted retirement nets the base row it retires: identity by rate and stated maturity, unique, or not at all.
    const retired = new Set<typeof live[number]>();
    for (const m of counted.filter((m) => m.amountMillions < 0)) {
      const hits = live.filter((b) => sameInstrument(b.label, `${m.instrument} ${m.sourceLine}`, { face: false }));
      if (hits.length === 1) {
        retired.add(hits[0]);
        rolledEvents.push([
          t("Repaid: "),
          { k: "figure", t: displayAmount(m.statedAs, m.sourceLine), printed: m.statedAs, src: src(m.sourceLine, m.citedUrl) },
          t(` ${tidyCoupon(m.instrument)}, between ${rolledFrom(rolledLabel ?? "")} and ${displayDate(periodEnd, "day")}. Not on the ladder.`),
        ]);
      }
    }
    for (const b of live) {
      if (retired.has(b)) continue;
      // EACH INSTRUMENT APPEARS ONCE. A base row stating the same instrument as an anchor row is shown under the anchor.
      const twins = anchorItems.filter((a) => !a.isCapacity && sameInstrument(b.label, `${a.name} ${a.amountPrinted ?? ""}`, { face: true }));
      const rivals = live.filter((x) => twins.length === 1 && sameInstrument(x.label, `${twins[0].name} ${twins[0].amountPrinted ?? ""}`, { face: true }));
      if (twins.length === 1 && rivals.length === 1) {
        twins[0].rowLabel = b.label;
        dedupNotes.push(`${b.label} — shown once, under the anchor's own row ("${twins[0].name}")`);
        continue;
      }
      const bsrc = src(b.sourceLine, b.citedUrl);
      const dt = extractFactTokens(b.label).find((x) => x.kind === "date" && x.dateValue);
      const gran: DateGranularity | null = dt?.dateValue ? (dt.dateValue.day !== null ? "day" : dt.dateValue.month !== null ? "month" : "year") : null;
      const date = dt?.dateValue ? isoOf(dt.dateValue) : null;
      const pseudo = { instrument: b.label, classification: classifyInstrument({ headings: [], instrumentName: b.label }), provenance: "note" as const, maturityDate: date };
      // The base row's label states its face ("$1,500 million, 3.400% Notes
      // due March 2027"); its cell is carrying value. Face where the label
      // states it, carrying value labelled where it does not.
      const faceTok = extractFactTokens(b.label).find((x) => x.kind === "money" && x.moneyValue !== undefined && x.moneyValue > 0);
      rolledItems.push({
        row: null,
        name: b.label,
        nameSrc: bsrc,
        basis: faceTok ? "face" : "carrying",
        amountPrinted: faceTok ? faceTok.raw : `$ ${b.amountMillions.toLocaleString("en-US")} million`,
        amountSrc: bsrc,
        maturity: date && gran ? { date, granularity: gran, src: bsrc } : null,
        labels: { type: typeLabel(pseudo, bsrc), ...withSources(b.label, classLabels(b.label, bsrc, null), b.citedUrl) },
        isCapacity: false,
        rolled: true,
      });
    }
  }
  // ONE INSTRUMENT, ONE LINE. A base table states some instruments twice —
  // once in its short-term section, once in its long-term section — under the
  // same label. They are two portions of one instrument; the line shows their
  // sum, computed and declared (Rule 27), each portion linked to its row.
  const byName = new Map<string, Item[]>();
  for (const it of rolledItems) byName.set(it.name, [...(byName.get(it.name) ?? []), it]);
  rolledItems.splice(0, rolledItems.length, ...[...byName.values()].map((group) => {
    if (group.length === 1) return group[0];
    const parts = group.map((g) => ({ printed: g.amountPrinted!, usd: parseMoneyAmount(g.amountPrinted) ?? 0, src: g.amountSrc }));
    return { ...group[0], amountParts: parts, note: `${group.length} portions of one instrument (short- and long-term sections), summed` };
  }));
  const allDebtItems = [...anchorItems.filter((x) => !x.isCapacity), ...rolledItems];

  // ONE INSTRUMENT, ONE MATURITY (card_spec §3.4): the most precise maturity
  // stated for it in the anchor or a later filing, linked to the sentence
  // that states it. Every mention on the card reads this one value.
  const maturityPool = [...new Set([anchor.url, ...(i.laterUrls ?? [])])].filter((u) => i.textByUrl.has(u)).flatMap(sentencesOf);
  const yearOf = (it: Item) => it.maturity?.date.slice(0, 4) ?? (/\b(20\d\d)\b/.exec(it.name) ?? [])[1] ?? null;
  for (const it of allDebtItems) {
    const year = yearOf(it);
    if (!year || it.maturity?.granularity === "day") continue;
    const own = couponsIn(it.name)[0]?.rate ?? null;
    // "the 2034 Notes" names an instrument only where one instrument of the card matures that year.
    const aliasOk = allDebtItems.filter((x) => x !== it && yearOf(x) === year).length === 0;
    let best: { date: string; granularity: DateGranularity; src: Source; rank: number } | null = null;
    let conflict = false;
    for (const s of maturityPool) {
      const cs = couponsIn(s.sentence);
      let stretch: string | null = null;
      if (own !== null) {
        const hit = cs.findIndex((c) => Math.abs(c.rate - own) < 1e-9);
        if (hit >= 0) {
          const next = cs.find((c, n) => n > hit && Math.abs(c.rate - own) > 1e-9);
          stretch = s.sentence.slice(cs[hit].at, next ? next.at : undefined);
        }
      }
      if (stretch === null && aliasOk && cs.every((c) => own !== null && Math.abs(c.rate - own) < 1e-9) && new RegExp(`\\bthe ${year} Notes\\b`, "i").test(s.sentence)) stretch = s.sentence;
      if (stretch === null) continue;
      for (const m of stretch.matchAll(new RegExp(`\\b(?:due|matur\\w*(?:\\s+on)?)\\s+(${MONTHS})(?:\\s+(\\d{1,2}),)?\\s+(${year})\\b`, "g"))) {
        const mm = String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, "0");
        const granularity: DateGranularity = m[2] ? "day" : "month";
        const date = m[2] ? `${year}-${mm}-${m[2].padStart(2, "0")}` : `${year}-${mm}-01`;
        const rank = m[2] ? 2 : 1;
        if (!sentenceSupportsMaturity(date, granularity, s.sentence)) continue;
        if (best && rank === best.rank && best.date !== date) conflict = true;
        if (!best || rank > best.rank) { best = { date, granularity, src: src(s.sentence, s.url), rank }; conflict = false; }
      }
    }
    const current = it.maturity ? (it.maturity.granularity === "month" ? 1 : 0) : -1;
    // Two sentences stating different dates at the same precision: neither is chosen.
    if (best && best.rank > current && !conflict) it.maturity = { date: best.date, granularity: best.granularity, src: best.src };
  }

  // ── an instrument line (card_spec §3.7): face amount, coupon, labels, type,
  // maturity, then flags, then the "not stated" fallback last (§3.5). A note
  // is told apart by its coupon; a line with no coupon carries the filer's
  // full label in place of the type word (§3.6). The name never repeats.
  /** Items whose "not stated" fallback is stated once for their group (v2.1 §2.5), not on their own line. */
  const groupedFallback = new Set<Item>();
  const describe = (it: Item, opts: { withDate?: boolean; flags?: string[]; fallback?: boolean } = {}): Line => {
    const out: Line = [];
    if (it.amountParts) {
      const usd = it.amountParts.reduce((a, p) => a + p.usd, 0);
      out.push({ k: "computed", t: displayUsd(usd, false, dp(it.amountParts)), usd, parts: it.amountParts, row: it.rowLabel ?? it.name }, t(" "));
    } else if (it.amountPrinted) out.push({ k: "figure", t: displayAmount(it.amountPrinted, it.amountSrc.sentence), printed: it.amountPrinted, src: it.amountSrc, row: it.rowLabel ?? it.name, ...(it.amountField ? { field: it.amountField } : {}) }, t(" "));
    if (it.basis === "carrying" && !it.isCapacity) out.push(t("(carrying value) "));
    const coupon = couponOf(it.name);
    if (coupon) out.push({ k: "label", t: coupon.shown, stated: coupon.printed, src: it.nameSrc }, t(" "));
    const showName = !coupon && it.labels.type.t !== it.name;
    // A label the shown name already states is not repeated beside it.
    for (const l of [it.labels.seniority, it.labels.security]) if (l && !(showName && l.k === "label" && containsWord(it.name, l.stated))) out.push(l, t(" "));
    out.push(showName ? { k: "label", t: it.name, stated: it.name, src: it.nameSrc } : it.labels.type);
    if (opts.withDate !== false) {
      if (it.maturity) out.push(t(", due "), { k: "date", t: displayDate(it.maturity.date, it.maturity.granularity), date: it.maturity.date, granularity: it.maturity.granularity, src: it.maturity.src });
      else if (it.range) out.push(t(", due "), { k: "label", t: `${it.range.from} to ${it.range.to}`, stated: it.range.stated, src: it.range.src });
      else if (it.row?.facilityMaturityNote) out.push(t(", maturity stated as a relative term, not a date"));
      else out.push(t(", no maturity stated"));
    }
    if (it.isCapacity) out.push(t(" · undrawn commitment, not debt"));
    if (it.rolled && rolledLabel) out.push(t(" · from the 10-K"));
    if (it.moveFlags) out.push(...it.moveFlags);
    for (const f of opts.flags ?? []) out.push(t(` · ${f}`));
    const suffix = opts.fallback === false || groupedFallback.has(it) ? null : notStatedSuffix(it.labels.seniority, it.labels.security);
    if (suffix) out.push(t(" · "), { k: "notStated", t: suffix, src: it.amountSrc });
    return out;
  };

  // ── 2.1 header ──
  const weekFrom = i.previousBrief ? addDays(i.previousBrief, 1) : addDays(briefDate, -6);
  const header: Line[] = [
    [t(result.company)],
    [t(`Brief week: ${weekRange(weekFrom, briefDate)}${i.previousBrief ? "" : " (first brief for this name: the trailing seven days)"}`)],
    [t("Position from "), { k: "filing", t: `${anchor.form} for the ${anchor.form === "10-K" ? "year" : "quarter"} ended ${displayDate(periodEnd, "day")}, filed ${shortDate(anchor.date)}`, url: anchor.url }],
  ];
  if (rolledLabel) header.push([t(`This company's ${anchor.form} does not list its notes. ${rolledSentence(rolledLabel)}`)]);

  // ── 2.2 this week ──
  const actionable: Line[] = [];
  const other: FilingEntry[] = [];
  for (const f of i.weekFilings) {
    const items = f.items.split(",").map((s) => s.trim()).filter(Boolean);
    const hit = items.filter((it) => ACTIONABLE_ITEMS[it]);
    const meta = `${formName(f.form)}${items.length ? `, Item${items.length > 1 ? "s" : ""} ${items.join(", ")}` : ""} · ${shortDate(f.filingDate)}`;
    if (f.form === "10-Q" || f.form === "10-K") {
      actionable.push([{ k: "filing", t: meta, url: f.primaryDocUrl }, t(` — a new ${f.form}, which carries a new position. Not yet read: this card's position is still the ${anchor.form} for ${displayDate(periodEnd, "day")}.`)]);
    } else if (hit.length > 0) {
      actionable.push([
        { k: "filing", t: meta, url: f.primaryDocUrl },
        t(` — ${hit.map((h) => ACTIONABLE_ITEMS[h]).join("; ")}. Amount and instrument: not read (filing text not yet extracted). Why it matters: ${hit.map((h) => WHY[h]).join("; ")}.`),
      ]);
    } else other.push(f);
  }
  const thisWeekLines: Line[] = [...actionable];
  if (actionable.length === 0) thisWeekLines.push([t(`No new filings affecting debt since ${shortDate(i.previousBrief ?? weekFrom)}.`)]);
  // §2.2: everything else in one line, grouped by form, each filing one click deeper.
  if (other.length > 0) {
    const byForm = new Map<string, FilingEntry[]>();
    for (const f of other) byForm.set(f.form, [...(byForm.get(f.form) ?? []), f]);
    const line: Line = [];
    [...byForm.entries()].forEach(([form, fs], n) => {
      if (n > 0) line.push(t("; "));
      const items = [...new Set(fs.flatMap((f) => f.items.split(",").map((x) => x.trim()).filter(Boolean)))];
      const what = FORM_WHAT[form] ?? (items.length ? items.map((it) => `Item ${it}${ITEM_WHAT[it] ? `, ${ITEM_WHAT[it]}` : ""}`).join("; ") : "");
      line.push(t(`${fs.length} ${formName(form)}${fs.length === 1 ? "" : "s"}${what ? ` (${what})` : ""} `));
      fs.forEach((f, k) => line.push(...(k ? [t(" ")] : []), { k: "filing", t: `[${shortDate(f.filingDate)}]`, url: f.primaryDocUrl }));
    });
    line.push(t(", none affecting debt."));
    thisWeekLines.push(line);
  } else if (actionable.length > 0) thisWeekLines.push([t("No other filings this week.")]);


  // ── 2.3 RECENT DEBT MOVES (card_spec v2.0 §2.3) ──
  // Every debt transaction the filings state from the start of the anchor's
  // fiscal year through the brief date, from the verified card facts (each
  // copied with its sentence, checked in code, reproduced across three asks).
  // Linked both ways: a move that funds or retires another names it, and an
  // instrument a move touches carries that fact on its own ladder line.
  type Move = {
    when: string; sort: string; type: string; status: "completed" | "pending"; inPeriod: boolean;
    dateSeg: Segment; instrument: string; instSeg: Segment; face: Segment | null; faceUsd: number | null;
    sentence: string; url: string; funding: Line; use: Line; price: Segment | null; extra: Line;
    /** v2.1: the raw facts, rendered by template, never as prose (§2.3). */
    fundFact?: Fact; useFact?: Fact; priceFact?: Fact;
    /** The issuance this retirement spends, and the retirements an issuance funds. */
    fundedBy?: Move; retires: Move[]; spendSrc?: Source;
    /** Another filing sentence stating the same move, linked from the move's verb. */
    altSrc?: Source;
  };
  const fyStart = `${periodEnd.slice(0, 4)}-01-01`;
  // A fact's sentence is linked as the FILER printed it: the document's own
  // sentence containing the copied text (typography aside), which also widens
  // a copied fragment to its whole sentence.
  const normQ = (x: string) => x.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[\s\u00a0]+/g, " ").replace(/ %/g, "%").trim();
  const ownSentence = (fragment: string, url: string): Source | null => {
    const want = normQ(fragment);
    return sentencesOf(url).find((x) => normQ(x.sentence).includes(want)) ?? null;
  };
  /** The value as the filer's sentence prints it (quotes, spacing): what a label states is the filer's text. */
  const filerSpan = (value: string, sentence: string): string => {
    const SP = String.raw`[\s ]+`;
    const parts: string[] = [];
    for (const ch of value.trim().replace(/[\s ]+/g, " ").replace(/ %/g, "%")) {
      if (/["“”]/.test(ch)) parts.push(`["“”]`);
      else if (/['‘’]/.test(ch)) parts.push(`['‘’]`);
      else if (ch === " ") parts.push(SP);
      else if (ch === "%") parts.push(String.raw`[\s ]*%`);
      else parts.push(ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    const pat = parts.join("");
    const m = new RegExp(pat, "i").exec(sentence);
    return m ? m[0] : value;
  };
  const factLabel = (text: string, fact: { value: string; src: { sentence: string; url: string } }): Segment => {
    const where = factSrc(fact);
    return { k: "label", t: text, stated: filerSpan(fact.value, where.sentence), src: where };
  };
  const factSrc = (x: { src: { sentence: string; url: string } }) => ownSentence(x.src.sentence, x.src.url) ?? src(x.src.sentence, x.src.url);
  const moveDocs = () => [...new Set([anchor.url, ...(i.laterUrls ?? [])])].filter((u) => i.textByUrl.has(u));
  /** The instrument as a label linked to a sentence that prints it: its own sentence, else one in a filing that names it, else the longest end of the name that sentence does print. */
  const instrumentSeg = (value: string, own: Source): Segment => {
    if (containsWord(own.sentence, filerSpan(value, own.sentence))) return { k: "label", t: tidyCoupon(value), stated: filerSpan(value, own.sentence), src: own };
    for (const u of [own.url, ...moveDocs()]) {
      const hit = sentencesOf(u).find((x) => containsWord(x.sentence, value));
      if (hit) return { k: "label", t: tidyCoupon(value), stated: value, src: hit };
    }
    const words = value.split(/\s+/);
    for (let n = words.length - 1; n > 0; n--) {
      for (const part of [words.slice(words.length - n).join(" "), words.slice(0, n).join(" ")]) if (containsWord(own.sentence, part)) return { k: "label", t: tidyCoupon(part), stated: part, src: own };
    }
    return t(tidyCoupon(value));
  };
  // A bare figure in a note printed "in thousands" carries the caption's scale (Rule 67).
  const scaled = (value: string, url: string) => (url === anchor.url && !/thousand|million|billion/i.test(value) && /\d/.test(value) ? `${value.trim()} ${tableScale}` : value);
  const moneyIn = (sentence: string) => extractFactTokens(sentence).filter((x) => x.kind === "money" && x.moneyValue !== undefined && x.moneyValue > 0);
  const isoOfText = (v: string): { iso: string; g: DateGranularity } | null => {
    const m = new RegExp(`(${MONTHS})(?:\\s+(\\d{1,2}),)?\\s+(20\\d\\d)`).exec(v);
    if (!m) return null;
    const mm = String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, "0");
    return { iso: `${m[3]}-${mm}-${(m[2] ?? "1").padStart(2, "0")}`, g: m[2] ? "day" : "month" };
  };
  /** Does `text` name the note `instrument`: its coupon, and its year where the instrument states one. */
  const sameNote = (text: string, instrument: string) => {
    const cb = couponsIn(instrument)[0]?.rate;
    const yb = (/\b(20\d\d)\b/.exec(instrument.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*/g, "")) ?? [])[1];
    return cb !== undefined && couponsIn(text).some((c) => Math.abs(c.rate - cb) < 1e-9) && (!yb || text.includes(yb));
  };
  const RETIRES = new Set(["redemption", "special call", "tender or repurchase", "repayment at maturity", "paydown"]);
  const TYPE_WORD: Record<string, [string, string]> = {
    issuance: ["Issued", "Issuance announced"], redemption: ["Redeemed", "Redemption announced"], "special call": ["Special call redemption", "Special call announced"],
    "tender or repurchase": ["Repurchased", "Repurchase announced"], "repayment at maturity": ["Repaid at maturity", "Repayment announced"],
    "facility entry": ["Entered", "Entry announced"], "facility amendment": ["Amended", "Amendment announced"], "facility termination": ["Terminated", "Termination announced"],
    refinancing: ["Refinanced", "Refinancing announced"], draw: ["Drew on", "Draw announced"], paydown: ["Repaid", "Repayment announced"], "incremental add-on": ["Incremental add-on", "Add-on announced"],
  };
  const movesAll: Move[] = [];
  for (const m of i.facts?.moves ?? []) {
    const url = m.date.src.url;
    if (!(url === anchor.url || (i.laterUrls ?? []).includes(url))) continue;
    const d = isoOfText(m.date.value);
    if (!d || d.iso < fyStart || d.iso > briefDate) continue;
    // A face the extraction did not return is read from the move's own sentence where it states exactly one amount.
    const faceVal = m.face ? scaled(m.face.value, m.face.src.url) : null;
    let face: Segment | null = m.face && faceVal ? { k: "figure", t: displayAmount(faceVal, m.face.src.sentence), printed: faceVal, src: factSrc(m.face) } : null;
    if (!face) {
      const one = moneyIn(m.instrument.src.sentence);
      if (one.length === 1) face = { k: "figure", t: displayAmount(one[0].raw, m.instrument.src.sentence), printed: one[0].raw, src: factSrc(m.instrument) };
    }
    const instSrc = factSrc(m.instrument);
    movesAll.push({
      when: m.date.value, sort: d.iso, type: m.type, status: m.status, inPeriod: url === anchor.url,
      dateSeg: factLabel(m.date.value, m.date),
      instrument: m.instrument.value, instSeg: instrumentSeg(m.instrument.value, instSrc),
      face, faceUsd: face && face.k === "figure" ? parseMoneyAmount(face.printed) : null,
      sentence: instSrc.sentence, url,
      funding: m.funding ? [t("funded by "), factLabel(m.funding.value, m.funding)] : [],
      use: m.use ? [t("used "), factLabel(m.use.value, m.use)] : [],
      price: m.price ? factLabel(`at ${m.price.value.replace(/\s+%/, "%")}`, m.price) : null,
      extra: [], retires: [],
      fundFact: m.funding ?? undefined, useFact: m.use ?? undefined, priceFact: m.price ?? undefined,
    });
  }
  // A pending redemption's size, from the cached answer's own redemption sentence for the same note.
  for (const r of result.results.flatMap((x: any) => x.redeems ?? []) as { instrument: string; amount: string | null; sourceLine: string }[]) {
    const mv = movesAll.find((m) => !m.face && RETIRES.has(m.type) && sameNote(m.instrument, r.instrument));
    if (mv && r.amount && amountSupportOf(r.amount, r.sourceLine).kind !== "unsupported") {
      mv.face = { k: "figure", t: displayAmount(r.amount, r.sourceLine), printed: r.amount, src: src(r.sourceLine, mv.url) };
      mv.faceUsd = parseMoneyAmount(r.amount);
    }
  }
  // FUNDED BY / USED TO, both ways. A retirement whose sentence spends "net
  // proceeds" is funded by the issuance stated in its own document, where
  // that document states exactly one; otherwise by the issuance whose stated
  // use names the retired note.
  for (const r of movesAll.filter((m) => RETIRES.has(m.type))) {
    const linked = [r.sentence, r.instSeg.k === "label" ? r.instSeg.src.sentence : "", r.dateSeg.k === "label" ? r.dateSeg.src.sentence : ""];
    if (!linked.some((x) => /net proceeds/i.test(x)) || r.funding.length) continue;
    const issuances = movesAll.filter((m) => m.type === "issuance");
    const sameDoc = issuances.filter((m) => m.url === r.url);
    const by = (sameDoc.length === 1 ? sameDoc[0] : null) ?? issuances.find((m) => m.use.some((x) => x.k === "label" && sameNote(x.stated, r.instrument)));
    if (!by) continue;
    const spend = linked.find((x) => /net proceeds/i.test(x))!;
    const spendSrc = [r.instSeg, r.dateSeg].map((x) => (x.k === "label" ? x.src : null)).find((x) => x && x.sentence === spend) ?? src(spend, r.url);
    r.fundedBy = by;
    by.retires.push(r);
    r.spendSrc = spendSrc;
  }
  for (const is of movesAll.filter((m) => m.type === "issuance" && !m.use.length)) {
    if (movesAll.filter((m) => m.type === "issuance" && m.url === is.url).length !== 1) continue;
    const uses = sentencesOf(is.url).map((x) => ({ x, m: /\bused? the net proceeds\b.*?\bto\s+(.+?)\.?$/i.exec(x.sentence) })).filter((u) => u.m);
    if (uses.length === 1) is.useFact = { value: uses[0].m![1], src: { sentence: uses[0].x.sentence, url: uses[0].x.url } };
  }
  // (Oct 19, 2026) An offering's launch and pricing dates appear nowhere on the card; the move's own date is the one shown.
  // An add-on: the further-issuance sentence and the price, from the same filing.
  for (const is of movesAll.filter((m) => m.type === "issuance")) {
    for (const sx of sentencesOf(is.url)) {
      if (sx.sentence === is.sentence || !sameNote(sx.sentence, is.instrument) && !/additional notes/i.test(sx.sentence)) continue;
      if (/further issuance/i.test(sx.sentence)) is.extra.push(t(", "), { k: "label", t: "adding to the existing notes", stated: "further issuance", src: sx });
      else if (!is.price && /purchase price|issue price|offering price/i.test(sx.sentence)) {
        const pct = /\b\d{1,3}(?:\.\d+)?\s?%/.exec(sx.sentence);
        if (pct) is.price = { k: "label", t: `at ${pct[0].replace(/\s+%/, "%")} of principal`, stated: pct[0], src: sx };
      }
    }
  }
  // Base events the facts do not state, kept rather than dropped.
  for (const e of pos.tier2.events) {
    if (movesAll.some((m) => sameNote(m.instrument, e.instrument) || containsWord(m.instrument, e.instrument))) continue;
    const s0 = src(e.sourceLine, e.citedUrl);
    movesAll.push({
      when: e.date ?? "date not stated", sort: e.date ?? "", type: e.kind, status: e.nets === "unconfirmed" ? "pending" : "completed", inPeriod: false,
      dateSeg: t(e.date ? displayDate(e.date, "day") : "Date not stated"), instrument: e.instrument, instSeg: { k: "label", t: tidyCoupon(e.instrument), stated: e.instrument, src: s0 },
      face: e.effect !== null ? { k: "figure", t: displayAmount(`$${Math.abs(e.effect).toLocaleString("en-US")}`, e.sourceLine), printed: `$${Math.abs(e.effect).toLocaleString("en-US")}`, src: s0 } : null,
      faceUsd: e.effect !== null ? Math.abs(e.effect) : null, sentence: e.sourceLine, url: e.citedUrl, funding: [], use: [], price: null, extra: [], retires: [],
    });
  }
  for (const w of pos.withinPeriodRepayments) {
    if (movesAll.some((m) => sameNote(m.instrument, w.instrument) || containsWord(m.instrument, w.instrument))) continue;
    const s0 = src(w.sourceLine, w.citedUrl);
    movesAll.push({
      when: "during the period", sort: periodEnd, type: "paydown", status: "completed", inPeriod: true,
      dateSeg: t("During the period"), instrument: w.instrument, instSeg: { k: "label", t: tidyCoupon(w.instrument), stated: w.instrument, src: s0 },
      face: { k: "figure", t: displayAmount(w.priorAmount, w.sourceLine), printed: w.priorAmount, src: s0 }, faceUsd: parseMoneyAmount(w.priorAmount),
      sentence: w.sourceLine, url: w.citedUrl, funding: [], use: [], price: null, extra: [t(", the prior balance, repaid inside the period")], retires: [],
    });
  }
  for (const m of movesAll) {
    const dateText = m.dateSeg.k === "label" ? m.dateSeg.stated : null;
    if (!dateText || !couponsIn(m.instrument).length) continue;
    const seen = new Set([m.sentence, m.dateSeg.k === "label" ? m.dateSeg.src.sentence : ""].map(normQ));
    const again = moveDocs().flatMap(sentencesOf).filter((x) => !seen.has(normQ(x.sentence)) && containsWord(x.sentence, dateText) && sameNote(x.sentence, m.instrument) && !movesAll.some((o) => o !== m && sameNote(x.sentence, o.instrument) && o.when === m.when && o.type !== m.type));
    if (again.length) m.altSrc = again[0];
  }
  // v2.1 §2.3 CARD FORMAT: date, type, face in $MM, coupon, labels, instrument,
  // then funding, use and price as short clauses. Never filer prose, defined
  // terms or agreement titles; each figure and phrase links to its sentence.
  const instPhrase = (m: Move, where?: Source): Segment => {
    const own = where ?? (m.instSeg.k === "label" ? m.instSeg.src : null);
    if (!own) return t(tidyCoupon(m.instrument));
    const c = couponOf(m.instrument);
    let shown: string, cands: string[];
    if (c) {
      const item = allDebtItems.find((it) => sameNote(`${it.name} ${it.maturity?.date.slice(0, 4) ?? ""}`, m.instrument));
      const labels = item ? [item.labels.seniority?.t, item.labels.security?.t] : (m.instrument.match(/\b(senior|junior[- ]priority|subordinated|secured|unsecured|first[- ]lien)\b/gi) ?? []).map((x) => x.toLowerCase());
      const type = item && couponOf(item.name) ? item.labels.type.t : /debenture/i.test(m.instrument) ? "debentures" : "notes";
      const due = item?.maturity ? displayDate(item.maturity.date, item.maturity.granularity) : (new RegExp(`due ((?:(?:${MONTHS})\\s+(?:\\d{1,2},\\s*)?)?20\\d\\d)`, "i").exec(m.instrument) ?? [])[1];
      shown = [c.shown, ...labels.filter(Boolean), type].join(" ") + (due ? ` due ${due}` : "");
      cands = [filerSpan(c.printed, own.sentence), c.printed];
    } else {
      const year = (/dated\s+[A-Z][a-z]+\s+\d{1,2},\s*(20\d\d)/.exec(m.instrument) ?? /\b(20\d\d)\s+Credit Agreement/i.exec(m.instrument) ?? [])[1];
      shown = /revolving|line of credit|credit facility/i.test(m.instrument) ? "revolver"
        : /credit agreement/i.test(m.instrument) ? `${year ? `${year} ` : ""}credit agreement`
        : /term loan/i.test(m.instrument) ? (/(term loan [a-z]-?\d?)/i.exec(m.instrument) ?? [m.instrument])[0]
        : m.instrument.split(/\s+/).slice(0, 6).join(" ");
      cands = [m.instSeg.k === "label" ? m.instSeg.stated : "", "revolving credit facility", "revolving line of credit", "credit agreement", "term loan", "commercial paper"];
    }
    const stated = cands.find((x) => x && containsWord(own.sentence, x));
    return stated ? { k: "label", t: tidyCoupon(shown), stated, src: own } : t(tidyCoupon(shown));
  };
  const verbOf = (m: Move): Segment => {
    const [done, pending] = TYPE_WORD[m.type] ?? [m.type.charAt(0).toUpperCase() + m.type.slice(1), `${m.type} announced`];
    // An amendment that adds an incremental tranche says so.
    const word = m.type === "facility amendment" && /\bincremental\b/i.test(m.sentence) && m.status !== "pending" ? "Added an incremental" : m.status === "pending" ? pending : done;
    // The same move stated again in another sentence (a note and MD&A) is linked from its verb, not tagged.
    const kw = m.altSrc ? ["special call", "repurchase", "redeem", "redemption", "repaid", "issued", "drew", "entered", "terminated"].find((x) => containsWord(m.altSrc!.sentence, x)) : undefined;
    return kw ? { k: "label", t: word, stated: kw, src: m.altSrc! } : t(word);
  };
  // The source named in the funding clause: the most specific the filer states, in this order.
  const KEYWORDS = [/divestiture proceeds/i, /proceeds of (?:the |our )?[a-z ]+?(?=,|$)/i, /borrowings under (?:the |our )?[a-z ]+?facility/i, /net proceeds/i, /cash on hand/i];
  const fundClause = (m: Move): Line => {
    if (m.fundedBy) {
      const by = m.fundedBy;
      const spend = m.spendSrc ?? (m.instSeg.k === "label" ? m.instSeg.src : null);
      return [t(", "), spend ? { k: "label", t: "funded by", stated: "net proceeds", src: spend } : t("funded by"), t(" the "), instPhrase(by), t(` issued ${by.when}`), ...(spend && /cash on hand/i.test(spend.sentence) ? [t(" and cash on hand")] : [])];
    }
    if (!m.fundFact) return [];
    const where = factSrc(m.fundFact);
    const money = moneyIn(m.fundFact.value)[0];
    const kw = KEYWORDS.map((re) => (re.exec(m.fundFact!.value) ?? [])[0]).find(Boolean);
    const out: Line = [t(", funded by ")];
    if (money) out.push({ k: "figure", t: displayAmount(money.raw, m.fundFact.value), printed: filerSpan(money.raw, where.sentence), src: where }, t(kw ? ` of ${kw.replace(/^cash on hand$/i, "cash on hand")}` : ""));
    else out.push({ k: "label", t: kw ?? "a stated source", stated: kw ?? m.fundFact.value.split(/\s+/).slice(0, 3).join(" "), src: where });
    return out;
  };
  const RETIRE_VERB: Record<string, string> = { redemption: "redeem", "special call": "redeem", "tender or repurchase": "repurchase", "repayment at maturity": "repay", paydown: "repay" };
  const useClause = (m: Move): Line => {
    if (m.retires.length) {
      const rs = m.retires;
      const allPending = rs.every((r) => r.status === "pending");
      const out: Line = [t(allPending ? ", proceeds to be used to redeem " : ", used to ")];
      rs.forEach((r, n) => {
        if (n) out.push(t(" and "));
        if (!allPending) out.push(t(`${RETIRE_VERB[r.type] ?? "retire"} `));
        if (r.face) out.push(r.face, t(allPending ? " " : " of the "));
        out.push(instPhrase(r));
      });
      if (allPending) out.push(t(`, set for ${rs[0].when}`));
      return out;
    }
    if (!m.useFact) return [];
    const where = factSrc(m.useFact);
    const verb = /\b(repay|redeem|refinance|fund|finance|retire)\b/i.exec(m.useFact.value);
    const obj = /revolving|line of credit|credit facility/i.test(m.useFact.value) ? "the revolver" : /term loan/i.test(m.useFact.value) ? "the term loan" : null;
    if (!verb || !obj) return [t(", "), { k: "label", t: "use of the proceeds stated", stated: verb?.[0] ?? m.useFact.value.split(/\s+/).slice(0, 2).join(" "), src: where }];
    const part = /a portion|partial|part of/i.test(m.useFact.value) ? "part of " : "";
    return [t(", used to "), { k: "label", t: `${verb[1].toLowerCase()} ${part}${obj}`, stated: verb[0], src: where }];
  };
  const priceClause = (m: Move): Line => {
    if (m.priceFact) {
      const where = factSrc(m.priceFact);
      const pct = /\d{1,3}(?:\.\d+)?\s?%/.exec(m.priceFact.value);
      if (pct) return [t(", "), { k: "label", t: `at ${pct[0].replace(/\s+%/, "%")} of principal`, stated: filerSpan(pct[0], where.sentence), src: where }];
    }
    return m.price ? [t(", "), m.price] : [];
  };
  const one = (m: Move, withDate = true): Line => [
    ...(withDate ? [m.dateSeg, t(": ")] : []), verbOf(m), t(" "), ...(m.face ? [m.face, t(" ")] : []), instPhrase(m),
    ...fundClause(m), ...useClause(m), ...priceClause(m), ...m.extra,
  ];
  // v2.1 §2.3 RELATED MOVES ARE ONE EVENT: the same date, a retirement and the
  // issuance it spends, or facility moves (entry, termination, draw, paydown)
  // in the same month.
  const isFacilityMove = (m: Move) => !couponOf(m.instrument) && ["facility entry", "facility termination", "draw", "paydown"].includes(m.type);
  const parent = new Map<Move, Move>();
  const root = (m: Move): Move => { let r = m; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const join = (a: Move, b: Move) => { if (a.inPeriod === b.inPeriod) parent.set(root(b), root(a)); };
  for (const a of movesAll) for (const b of movesAll) {
    if (a === b || a.inPeriod !== b.inPeriod) continue;
    if (a.when === b.when || b.fundedBy === a || (isFacilityMove(a) && isFacilityMove(b) && a.sort.slice(0, 7) === b.sort.slice(0, 7))) join(a, b);
  }
  const moveEvents = new Map<Move, Move[]>();
  for (const m of movesAll) moveEvents.set(root(m), [...(moveEvents.get(root(m)) ?? []), m]);
  const eventLine = (ms: Move[]): Line => {
    const issuance = ms.find((m) => m.type === "issuance");
    const entry = ms.find((m) => m.type === "facility entry"), term = ms.find((m) => m.type === "facility termination");
    const anyPending = ms.some((m) => m.status === "pending");
    const tail: Line = anyPending ? [t(issuance && issuance.status !== "pending" ? " · redemption pending, not yet confirmed by a filing" : " · pending, not yet confirmed by a filing")] : [];
    if (entry && term) {
      // A refinanced facility: the new agreement, the one it replaced, and any draw used to retire it.
      const lender = facilities.filter((f) => !/commercial paper|letter of credit/i.test(f.name));
      const fac = lender.length === 1 ? lender[0] : null;
      const draw = ms.find((m) => m.type === "draw");
      const oldYear = (/dated\s+[A-Z][a-z]+\s+\d{1,2},\s*(20\d\d)/.exec(term.instrument) ?? /\b(20\d\d)\b/.exec(term.instrument) ?? [])[1];
      const line: Line = [entry.dateSeg, t(`: Refinanced ${fac && /revolv/i.test(fac.name) ? "revolver" : "credit facility"}: new `)];
      if (fac?.facilitySize) line.push({ k: "figure", t: displayAmount(fac.facilitySize.value, fac.facilitySize.sourceLine), printed: fac.facilitySize.value, src: src(fac.facilitySize.sourceLine, fac.figureSources?.facilitySize ?? fac.citedUrl) }, t(" "));
      line.push(entry.instSeg.k === "label" ? { k: "label", t: "credit agreement", stated: containsWord(entry.instSeg.src.sentence, "credit agreement") ? "credit agreement" : entry.instSeg.stated, src: entry.instSeg.src } : t("credit agreement"));
      line.push(t(" replaced the "), term.instSeg.k === "label" && oldYear ? { k: "label", t: `${oldYear} agreement`, stated: oldYear, src: term.instSeg.src } : t("earlier agreement"));
      if (draw) line.push(t("; "), ...(draw.face ? [draw.face, t(" ")] : []), draw.instSeg.k === "label" ? { k: "label", t: "drawn to retire it", stated: "drew", src: draw.instSeg.src } : t("drawn to retire it"));
      for (const other of ms.filter((m) => m !== entry && m !== term && m !== draw)) line.push(t("; "), ...one(other, false));
      return [...line, ...tail];
    }
    if (issuance) {
      const rest = ms.filter((m) => m !== issuance && !issuance.retires.includes(m));
      const line = one(issuance);
      for (const other of rest) line.push(t("; "), ...one(other, false));
      return [...line, ...tail];
    }
    // Several moves of one dated event, each in card format, funding shared where it is the same.
    const sorted = [...ms].sort((a, b) => a.sort.localeCompare(b.sort));
    const line: Line = [sorted[0].dateSeg, t(": ")];
    const sharedFund = sorted.every((m) => m.fundFact && m.fundFact.value === sorted[0].fundFact?.value);
    sorted.forEach((m, n) => {
      if (n) line.push(t(" and "));
      const v = verbOf(m);
      line.push(n && v.k === "text" ? t(v.t.toLowerCase()) : n ? { ...v, t: v.t.toLowerCase() } : v, t(" "), ...(m.face ? [m.face, t(" ")] : []), instPhrase(m));
      if (!sharedFund) line.push(...fundClause(m));
      line.push(...useClause(m), ...priceClause(m), ...m.extra);
    });
    if (sharedFund) line.push(...fundClause(sorted[0]));
    return [...line, ...tail];
  };
  const eventSort = (ms: Move[]) => (ms.find((m) => m.type === "issuance") ?? ms.find((m) => m.type === "facility entry") ?? ms[0]).sort;
  const evs = [...moveEvents.values()].sort((a, b) => eventSort(b).localeCompare(eventSort(a)));
  const since = evs.filter((ms) => !ms[0].inPeriod);
  const during = evs.filter((ms) => ms[0].inPeriod);
  const moves: CardSection = {
    heading: "Recent debt moves",
    lines: movesAll.length ? [] : [[t(`No debt moves stated between ${shortDate(fyStart)} and ${shortDate(briefDate)}.`)]],
    blocks: [
      ...(since.length ? [{ heading: [t(`Since ${displayDate(periodEnd, "day")}: not yet in the position totals`)] as Line, lines: since.map(eventLine) }] : []),
      ...(during.length ? [{ heading: [t(`During the period, ${shortDate(fyStart)} to ${shortDate(periodEnd)}: already in the position`)] as Line, lines: during.map(eventLine) }] : []),
    ],
  };
  // ON THE INSTRUMENT'S OWN LINE: what a move did to it. A carrying-value line
  // whose retirement sentence states the outstanding principal before it
  // ("$400 million … of the $800 million in outstanding principal amount")
  // shows its remaining face, computed from both.
  for (const it of allDebtItems) {
    for (const m of movesAll.filter((x) => RETIRES.has(x.type) && sameNote(x.instrument, it.name) && (!it.maturity || !/\b20\d\d\b/.test(x.instrument) || x.instrument.includes(it.maturity.date.slice(0, 4))))) {
      const verb = (TYPE_WORD[m.type]?.[0] ?? m.type).toLowerCase();
      if (m.status === "pending") { it.moveFlags = [...(it.moveFlags ?? []), t(" · "), { k: "label", t: "pending redemption", stated: m.instSeg.k === "label" ? m.instSeg.stated : m.instrument, src: m.instSeg.k === "label" ? m.instSeg.src : src(m.sentence, m.url) }, ...(m.face ? [t(" "), m.face] : []), t(", not yet confirmed by a filing")]; continue; }
      const prior = moneyIn(m.sentence).filter((x) => new RegExp(`${x.raw.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&")}\\s+in\\s+outstanding principal`, "i").test(m.sentence));
      if (it.basis === "carrying" && m.inPeriod && m.faceUsd && prior.length === 1) {
        const before = { printed: prior[0].raw, usd: prior[0].moneyValue!, src: src(m.sentence, m.url) };
        const retired = { printed: (m.face as any).printed, usd: -m.faceUsd, src: (m.face as any).src };
        it.amountParts = [before, retired];
        it.basis = "face";
        it.moveFlags = [...(it.moveFlags ?? []), t(" · "), m.face!, t(" of "), { k: "figure", t: displayAmount(before.printed, m.sentence), printed: before.printed, src: before.src }, t(` ${verb} ${m.when}`)];
      } else {
        it.moveFlags = [...(it.moveFlags ?? []), t(" · "), ...(m.face ? [m.face, t(" ")] : []), { k: "label", t: verb, stated: m.instrument, src: m.instSeg.k === "label" ? m.instSeg.src : src(m.sentence, m.url) }, t(` ${m.when}${m.inPeriod ? "" : ", since the position date"}`)];
      }
    }
  }

  // ── 2.3 total debt, at face (card_spec §3.2) ──
  // Every line is one basis. Face where every line states face; where some
  // lines state only carrying value, the face total is the filer's own
  // maturity schedule for the position date, where printed — otherwise the
  // face lines are totalled and the carrying lines stated beside them, never
  // added in.
  type Part = { printed: string; usd: number; src: Source };
  const partOf = (it: Item): Part[] => it.amountParts ?? [{ printed: it.amountPrinted!, usd: parseMoneyAmount(it.amountPrinted) ?? 0, src: it.amountSrc }];
  // v2.1 §2.4: ONE LINE PER TYPE. A type splits by seniority or security only
  // when every row of it carries the label; otherwise it groups by type alone
  // and the labels stay per row in the ladder. Rows on different bases stay on
  // their type's one line, with the carrying portion named inside it.
  const hedgedPart = (p: Part) => hedgedIn(p.src.sentence, p.printed);
  type Group = { type: Segment; items: Item[]; first: number };
  const byType = new Map<string, Group>();
  allDebtItems.forEach((it, n) => {
    const key = it.labels.type.t.toLowerCase();
    const g = byType.get(key) ?? { type: it.labels.type, items: [], first: n };
    g.items.push(it);
    byType.set(key, g);
  });
  // v3.1 §2.4: SEGMENTS BY EACH ROW'S OWN LABELS (replaces the v2.1 rule that
  // split a type only where every row carried the label). Rows stating no
  // label are their own group.
  const splitBy = (items: Item[], pick: (it: Item) => Segment | null): Item[][] => {
    const by = new Map<string, Item[]>();
    for (const it of items) by.set(pick(it)?.t ?? "", [...(by.get(pick(it)?.t ?? "") ?? []), it]);
    return [...by.values()];
  };
  /** "[type], seniority not stated" for a group stating no label, where the type is a type word (not a filer's full lease or other label). */
  const unlabelled = (g: { type: Segment; items: Item[] }, sen: Segment | null, sec: Segment | null): Segment[] =>
    !sen && !sec && kindOf(g.items[0].name) !== "lease" && kindOf(g.items[0].name) !== "other" ? [t(", seniority not stated")] : [];
  const faceParts = allDebtItems.filter((it) => it.basis === "face").flatMap(partOf);
  const carryingParts = allDebtItems.filter((it) => it.basis === "carrying").flatMap(partOf);
  // The filer's maturity schedule where the anchor itself prints it: principal by year, at the caption's scale (Rule 67).
  // The scale is the caption's; where the schedule's sentence carries none, the note's table scale (Rule 67).
  const scheduleScale = (sentence: string) => (/in thousands/i.test(sentence) ? "thousand" : /in billions/i.test(sentence) ? "billion" : /in millions/i.test(sentence) ? "million" : tableScale);
  const scheduleUrl = rc.counts ? dm?.priorPeriodBase?.filingUrl ?? null : anchor.url;
  const scheduleEntries = (i.facts?.schedule ?? [])
    .filter((e) => e.amount.src.url === scheduleUrl)
    .map((e) => {
      const cell = `$ ${e.amount.value.replace(/[$\s]/g, "")}`;
      const scaled = `${cell} ${scheduleScale(e.amount.src.sentence)}`;
      const usd = parseMoneyAmount(scaled) ?? 0;
      // A short cell whose scale is only in the caption ("$ 45" under "Dollars
      // in Millions") is cited as the cell itself, its value scaled here.
      const printed = amountSupportOf(scaled, e.amount.src.sentence).kind === "unsupported" ? cell : scaled;
      return { period: e.period, part: { printed, usd, src: src(e.amount.src.sentence, e.amount.src.url) } as Part };
    });
  const scheduleParts: Part[] = rc.counts ? [] : scheduleEntries.map((e) => e.part);
  const faceFromSchedule = carryingParts.length > 0 && scheduleParts.length > 0;
  const faceTotalParts = faceFromSchedule ? scheduleParts : faceParts;
  const faceTotal = sum(faceTotalParts);
  const carryingBeside = faceFromSchedule ? [] : carryingParts;
  const faceHedged = !faceFromSchedule && faceParts.some(hedgedPart);
  const faceSeg = (decimals = dp(faceTotalParts)): Segment => ({ k: "computed", t: displayUsd(faceTotal, faceHedged, decimals), usd: faceTotal, parts: faceTotalParts });
  const carryingSeg: Segment | null = carryingBeside.length
    ? { k: "computed", t: displayUsd(sum(carryingBeside), carryingBeside.some(hedgedPart), dp(carryingBeside)), usd: sum(carryingBeside), parts: carryingBeside }
    : null;
  const totalLine: Line = [t("Total debt "), faceSeg(), t(" at face")];
  if (faceFromSchedule) totalLine.push(t(", per the filer's maturity schedule"));
  if (carryingSeg) totalLine.push(t(", plus "), carryingSeg, t(" stated only at carrying value"));
  totalLine.push(t(" as of "), periodDate(), t(rc.counts ? `, ${rolledPhrase(rolledLabel!)}` : ""));
  const totalDebt: CardSection = {
    heading: "Total debt",
    lines: [
      totalLine,
      // v2.1 §2.4 ORDER BY PRIORITY: secured, then unsecured, then types with no
      // stated label, then leases and other obligations; within a tier, the
      // filer's table order (the order the rows were stated in).
      ...[...byType.values()]
        .flatMap((g) => splitBy(g.items, (it) => it.labels.security).flatMap((a) => splitBy(a, (it) => it.labels.seniority)).map((items) => ({ ...g, items, first: allDebtItems.indexOf(items[0]) })))
        .map((g) => {
          const all = (pick: (it: Item) => Segment | null) => (g.items.every((it) => pick(it) && pick(it)!.t === pick(g.items[0])!.t) ? pick(g.items[0]) : null);
          const sen = all((it) => it.labels.seniority), sec = all((it) => it.labels.security);
          const kind = kindOf(g.items[0].name);
          const tier = kind === "lease" || kind === "other" ? 3 : sec && /unsecured/i.test(sec.t) ? 1 : sec ? 0 : 2;
          return { g, sen, sec, tier };
        })
        .sort((a, b) => a.tier - b.tier || a.g.first - b.g.first)
        .map(({ g, sen, sec }): Line => {
          const line: Line = [];
          [sen, sec, g.type].filter((x): x is Segment => !!x).forEach((l, n) => line.push(...(n ? [t(" ")] : []), l));
          line.push(...unlabelled(g, sen, sec));
          const parts = g.items.flatMap(partOf);
          const carrying = g.items.filter((it) => it.basis === "carrying").flatMap(partOf);
          line.push(t(" "), { k: "computed", t: displayUsd(sum(parts), parts.some(hedgedPart), dp(parts)), usd: sum(parts), parts });
          if (carrying.length === parts.length) line.push(t(" (carrying value)"));
          else if (carrying.length) line.push(t(" (of which "), { k: "computed", t: displayUsd(sum(carrying), carrying.some(hedgedPart), dp(carrying)), usd: sum(carrying), parts: carrying }, t(" at carrying value)"));
          return line;
        }),
      // Where the face total and the lines shown are on different bases, the card says so, with the difference.
      ...(faceFromSchedule
        ? (() => {
            const lineParts = allDebtItems.flatMap(partOf);
            const diff = faceTotal - sum(lineParts);
            const parts = [...faceTotalParts, ...lineParts.map((p) => ({ ...p, usd: -p.usd }))];
            const seg: Segment = { k: "computed", t: displayUsd(Math.abs(diff), false, Math.max(dp(faceTotalParts), dp(lineParts))), usd: Math.abs(diff), parts: diff < 0 ? parts.map((p) => ({ ...p, usd: -p.usd })) : parts };
            return [[t("Lines marked carrying value do not sum to the face total; difference "), seg] as Line];
          })()
        : []),
    ],
  };

  // ── 2.3 liquidity ──
  const liqLines: Line[] = [];
  const liqParts: { printed: string; usd: number; src: Source }[] = [];
  let liqComputable = true;
  if (i.cash.usd !== null && i.cash.printedLine && i.cash.printed) {
    const printed = i.cash.printed;
    const s = anchorSrc(i.cash.printedLine);
    // §2.4: cash labeled exactly as the filer states it, from its own balance-sheet line.
    const filerLabel = (/^\s*([A-Za-z][A-Za-z ,&'’\-]*?[A-Za-z])\s*\$?\s*\(?\d/.exec(i.cash.printedLine) ?? [])[1];
    const label: Segment = filerLabel ? { k: "label", t: filerLabel, stated: filerLabel, src: s } : t("Cash");
    liqLines.push([label, t(" (balance sheet) "), { k: "figure", t: displayAmount(printed, i.cash.printedLine), printed, src: s }, t(" as of "), periodDate()]);
    liqParts.push({ printed, usd: i.cash.usd, src: s });
  } else {
    liqComputable = false;
    liqLines.push([t(`Cash: not shown — ${i.cash.reason ?? "no printed line states the tagged figure"}.`)]);
  }
  const liqPermitted = (url: string) => url === anchor.url || (i.laterUrls ?? []).includes(url);
  const liqFig = (fact: { value: string; src: { sentence: string; url: string } }): Segment => ({ k: "figure", t: displayAmount(fact.value, fact.src.sentence), printed: fact.value, src: src(fact.src.sentence, fact.src.url) });
  // A parent-company or unrestricted figure the filer also states sits beside the consolidated one, not added to it.
  for (const c of (i.facts?.cash ?? []).filter((x) => liqPermitted(x.amount.src.url))) {
    liqLines.push([{ k: "label", t: c.label.value, stated: c.label.value, src: src(c.label.src.sentence, c.label.src.url) }, t(" "), liqFig(c.amount), t(", as the filer states it; shown beside the balance-sheet figure, not added to it")]);
  }
  const cp = i.facts?.commercialPaper ?? null;
  const cpBacking = cp?.backedBy && cp.outstanding && liqPermitted(cp.backedBy.src.url) && liqPermitted(cp.outstanding.src.url) ? cp : null;
  const lenderFacilities = facilities.filter((f) => !(f.category === "commercial-paper" || classifyInstrument({ headings: [], instrumentName: f.name }).instrumentType === "commercial-paper"));
  for (const f of facilities) {
    const kind = classifyInstrument({ headings: [], instrumentName: f.name }).instrumentType;
    if (f.category === "commercial-paper" || kind === "commercial-paper") {
      liqLines.push([t(`${f.name}: not counted. Commercial paper is an issuance program, not a lender commitment.`)]);
      // §2.4: where the filer states a facility backs the program, both facts show side by side. Nothing is netted.
      const backer = cpBacking ? lenderFacilities.find((x) => containsWord(x.name, cpBacking.backedBy!.value)) ?? (lenderFacilities.length === 1 ? lenderFacilities[0] : null) : null;
      if (cpBacking && backer?.available) {
        const av = backer.available;
        liqLines.push([
          typeLabel({ instrument: backer.name, classification: classifyInstrument({ headings: [], instrumentName: backer.name }) }, src(av.sourceLine, backer.figureSources?.available ?? backer.citedUrl)),
          t(" "), { k: "figure", t: displayAmount(av.value, av.sourceLine), printed: av.value, src: src(av.sourceLine, backer.figureSources?.available ?? backer.citedUrl) },
          t(" undrawn; "), { k: "label", t: "backs", stated: cpBacking.backedBy!.value, src: src(cpBacking.backedBy!.src.sentence, cpBacking.backedBy!.src.url) },
          t(" "), liqFig(cpBacking.outstanding!), t(" commercial paper outstanding. Shown side by side, not netted."),
        ]);
      }
      continue;
    }
    if (kind === "letter-of-credit") continue; // capacity for letters of credit only; not cash a borrower can draw (Rule 48)
    const fsrc = (field: string, sentence: string) => src(sentence, f.figureSources?.[field] ?? f.citedUrl);
    const sizeSentence = f.facilitySize?.sourceLine ?? f.name;
    const pseudo = { instrument: f.name, classification: classifyInstrument({ headings: [], instrumentName: f.name }) };
    const line: Line = [typeLabel(pseudo, fsrc("facilitySize", sizeSentence)), t(" ")];
    if (f.facilitySize) line.push({ k: "figure", t: displayAmount(f.facilitySize.value, f.facilitySize.sourceLine), printed: f.facilitySize.value, src: fsrc("facilitySize", f.facilitySize.sourceLine) }, t(" facility, "));
    const bb = borrowingBaseOf(f);
    if (f.available) {
      const usd = parseMoneyAmount(f.available.value) ?? 0;
      line.push({ k: "figure", t: displayAmount(f.available.value, f.available.sourceLine), printed: f.available.value, src: fsrc("available", f.available.sourceLine) }, t(bb ? " available as stated (borrowing-base limited)" : " available as stated"));
      liqParts.push({ printed: f.available.value, usd, src: fsrc("available", f.available.sourceLine) });
      if (f.asOfDate !== periodEnd) liqComputable = false;
    } else if (f.facilitySize && !bb) {
      const parts = [{ printed: f.facilitySize.value, usd: parseMoneyAmount(f.facilitySize.value) ?? 0, src: fsrc("facilitySize", f.facilitySize.sourceLine) }];
      for (const [field, fig] of [["drawn", f.drawn], ["lettersOfCredit", f.lettersOfCredit]] as const) if (fig) parts.push({ printed: fig.value, usd: -(parseMoneyAmount(fig.value) ?? 0), src: fsrc(field, fig.sourceLine) });
      const usd = parts.reduce((a, p) => a + p.usd, 0);
      line.push({ k: "computed", t: displayUsd(usd, false, dp(parts)), usd, parts }, t(" available (size less drawn and letters of credit; no availability stated)"));
      liqParts.push(...parts);
    } else {
      line.push({ k: "notStated", t: "availability not stated", src: fsrc("facilitySize", sizeSentence) });
      liqComputable = false;
    }
    const m = facilityMaturityAtItsSentence(f);
    if (m.kind === "dated") line.push(t(", matures "), { k: "date", t: displayDate(m.date, m.granularity), date: m.date, granularity: m.granularity, src: fsrc("maturity", m.sentence) });
    else line.push(t(m.kind === "relative" ? ", maturity stated as a relative term, not a date" : ", no maturity stated"));
    liqLines.push(line);
  }
  for (const u of (i.facts?.uncommitted ?? []).filter((x) => liqPermitted(x.description.src.url))) {
    const line: Line = [...(/^uncommitted/i.test(u.description.value) ? [] : [t("Uncommitted: ")]), { k: "label", t: u.description.value, stated: u.description.value, src: src(u.description.src.sentence, u.description.src.url) }];
    if (u.amount && liqPermitted(u.amount.src.url)) line.push(t(", up to "), liqFig(u.amount));
    line.push(t(". Uncommitted, not counted in liquidity."));
    liqLines.push(line);
  }
  const liqUsd = liqParts.reduce((a, p) => a + p.usd, 0);
  liqLines.unshift(
    liqComputable && liqParts.length > 0
      ? [t("Liquidity "), { k: "computed", t: displayUsd(liqUsd, false, dp(liqParts)), usd: liqUsd, parts: liqParts }, t(" as of "), periodDate()]
      : [t("No liquidity total: cash and every facility's availability are not all stated as of the position date.")]
  );
  if (liqComputable && liqParts.length > 0) liqLines.splice(1, 0, [t("Cash plus stated availability, both stated as of the position date.")]);

  // ── 2.5 maturity ladder: drawn debt by year, reconciled to the filer's schedule where printed ──
  const RANGE = "Maturing over a range of years", NONE = "No maturity stated";
  /** Each year's principal the schedule shows and no line accounts for, for the refinance window. */
  const otherScheduled = new Map<string, { seg: Segment; period: string }>();
  const byYear = new Map<string, Item[]>();
  for (const it of allDebtItems) {
    const y = it.maturity ? it.maturity.date.slice(0, 4) : it.range ? RANGE : NONE;
    byYear.set(y, [...(byYear.get(y) ?? []), it]);
  }
  // Principal retired between a rolled base's date and the position date leaves the base's schedule for that year.
  const retiredByYear = new Map<string, Part[]>();
  if (rc.counts) for (const m of rc.movements.filter((x) => x.placement === "delta" && x.amountMillions < 0)) {
    const y = (/\b(20\d\d)\b/.exec(`${m.instrument} ${m.sourceLine}`) ?? [])[1];
    if (y) retiredByYear.set(y, [...(retiredByYear.get(y) ?? []), { printed: m.statedAs, usd: Math.abs(m.amountMillions) * 1e6, src: src(m.sourceLine, m.citedUrl) }]);
  }
  const scheduleByYear = new Map<string, { period: string; part: Part }>();
  for (const e of scheduleEntries) {
    const y = (/\b(20\d\d)\b/.exec(e.period) ?? [])[1];
    if (y && !/thereafter|after/i.test(e.period)) scheduleByYear.set(y, e);
  }
  const years = [...new Set([...byYear.keys(), ...scheduleByYear.keys()])].sort((a, b) => (/^\d/.test(a) ? 0 : a === RANGE ? 1 : 2) - (/^\d/.test(b) ? 0 : b === RANGE ? 1 : 2) || a.localeCompare(b));
  const neg = (ps: Part[]) => ps.map((p) => ({ ...p, usd: -p.usd }));
  // v2.1 §2.5 "NOT STATED" ONCE PER GROUP: a fallback every row of a group
  // shares is stated once at the group's top, not on each row. The "from the
  // 10-K" lines are one group; each ladder year is one group.
  const fallbackOf = (it: Item) => notStatedSuffix(it.labels.seniority, it.labels.security);
  const sharedFallback = (items: Item[]) => (items.length >= 2 && items.every((it) => fallbackOf(it) !== null && fallbackOf(it) === fallbackOf(items[0])) ? fallbackOf(items[0]) : null);
  const rolledFallback = sharedFallback(allDebtItems.filter((it) => it.rolled));
  if (rolledFallback) for (const it of allDebtItems.filter((x) => x.rolled)) groupedFallback.add(it);
  const ladderBlocks = years.map((y) => {
    const items = byYear.get(y) ?? [];
    const blockFallback = sharedFallback(items.filter((it) => !groupedFallback.has(it)).length === items.length ? items : []);
    const lines: Line[] = [];
    if (blockFallback) {
      lines.push([{ k: "notStated", t: `Every line in ${/^\d{4}$/.test(y) ? y : "this group"}: ${blockFallback}`, src: items[0].amountSrc }]);
      for (const it of items) groupedFallback.add(it);
    }
    lines.push(...items.map((it) => describe(it)));
    const sch = scheduleByYear.get(y);
    if (sch) {
      const retired = retiredByYear.get(y) ?? [];
      const faceItems = items.filter((it) => it.basis === "face");
      const rowParts = faceItems.flatMap(partOf);
      const period = /^20\d\d$/.test(sch.period.trim()) ? y : sch.period.trim();
      const decimals = Math.max(dp([sch.part]), dp(rowParts));
      const residual = sch.part.usd - sum(retired) - sum(rowParts);
      const unit = 0.5 * 10 ** -decimals * 1e6;
      const scheduleFig: Segment = { k: "computed", t: displayUsd(sch.part.usd, false, decimals), usd: sch.part.usd, parts: [sch.part] };
      if (items.some((it) => it.basis === "carrying")) {
        // Face and carrying are never netted: the schedule is shown, not compared.
        const named = items.filter((it) => it.basis === "carrying").map((it) => (couponOf(it.name) ? `${couponOf(it.name)!.shown} ${it.labels.type.t} due ${y}` : it.name));
        lines.push([t("The filer's schedule shows "), scheduleFig, t(` principal for ${period}. Not comparable at face, stated only at carrying value: the ${named.join("; the ")}.`)]);
      } else if (residual >= unit) {
        const parts = [sch.part, ...neg(retired), ...neg(rowParts)];
        const seg: Segment = { k: "computed", t: displayUsd(residual, false, decimals), usd: residual, parts };
        otherScheduled.set(y, { seg, period });
        lines.push([seg, t(` other scheduled principal, per the filer's schedule${period === y ? "" : ` for ${period}`}`)]);
      } else if (residual <= -unit) {
        const parts = [...rowParts, ...retired, ...neg([sch.part])];
        lines.push([t("The filer's schedule shows "), scheduleFig, t(` for ${period}: `), { k: "computed", t: displayUsd(-residual, false, decimals), usd: -residual, parts }, t(" less than the lines above. That much of them is scheduled in other years.")]);
      }
    }
    return { heading: [t(y)] as Line, lines };
  });

  // ── 2.4 POTENTIAL REFINANCE OPPORTUNITIES (card_spec v2.1): the card's call to
  // action, the next 18 months from the brief date. Summary first, from a
  // template over stated facts; named instruments only; the schedule's
  // leftovers in one line; flags as one marker with one legend; CP outstanding
  // as a row; then Next. No "not stated" fallback appears in the box.
  const windowEnd = addMonths(briefDate, 18);
  const MARK = "†";
  let marked = false;
  const kindOfItem = (it: Item) => kindOf(it.name);
  const isCP = (it: Item) => /commercial paper/i.test(it.labels.type.t);
  const boxRows: { sort: string; it: Item; maybe: boolean; flags: string[] }[] = [];
  for (const it of [...anchorItems, ...rolledItems]) {
    if (!it.maturity || it.range || isCP(it) || kindOfItem(it) === "lease" || kindOfItem(it) === "other") continue;
    const m = it.maturity;
    const [start, end] = spanOf(m.date, m.granularity);
    if (end <= briefDate && start > periodEnd && !it.isCapacity) { boxRows.push({ sort: start, it, maybe: false, flags: ["matured since the position date, repayment not yet confirmed in a filing"] }); continue; }
    if (end <= briefDate || start > windowEnd) continue;
    boxRows.push({ sort: start, it, maybe: (start <= briefDate || end > windowEnd) && m.granularity !== "day", flags: [] });
  }
  boxRows.sort((x, y) => x.sort.localeCompare(y.sort));
  const rowLine = (r: { it: Item; maybe: boolean; flags: string[] }): Line => {
    const line = describe(r.it, { fallback: false, flags: r.flags });
    if (r.maybe) {
      marked = true;
      // The marker sits on the date it qualifies.
      const at = line.findIndex((x) => x.k === "date");
      line.splice(at >= 0 ? at + 1 : line.length, 0, t(MARK));
    }
    return line;
  };
  const refi: Line[] = [];
  // 1. The summary: named instruments maturing in the window, and what stated redemptions already cover.
  const maturing = boxRows.filter((r) => !r.it.isCapacity);
  if (maturing.length === 0) refi.push([t("Nothing matures within 18 months.")]);
  else {
    const parts = maturing.flatMap((r) => partOf(r.it));
    const allNotes = maturing.every((r) => r.it.labels.type.t === "notes");
    const summary: Line = [{ k: "computed", t: displayUsd(sum(parts), parts.some(hedgedPart), dp(parts)), usd: sum(parts), parts }];
    if (maturing.some((r) => r.maybe)) { summary.push(t(MARK)); marked = true; }
    summary.push(t(` across ${maturing.length} ${allNotes ? (maturing.length === 1 ? "note" : "notes") : maturing.length === 1 ? "instrument" : "instruments"} in the next 18 months`));
    // v2.2 §2.4: BOTH HALVES COUNT THE SAME INSTRUMENTS. The redemption figure
    // counts only stated redemptions (pending, or done since the position date)
    // of the rows maturing in the window. One outside the window is its own
    // clause where the same issuance funds it, or is left to the moves.
    const stated = movesAll.filter((m) => !m.inPeriod && RETIRES.has(m.type) && m.face && m.faceUsd);
    const inWindow = (m: Move) => maturing.some((r) => sameNote(`${r.it.name} ${r.it.maturity?.date.slice(0, 4) ?? ""}`, m.instrument));
    const redeeming = stated.filter(inWindow);
    const partOfMove = (m: Move): Part => ({ printed: (m.face as any).printed as string, usd: m.faceUsd!, src: (m.face as any).src as Source });
    if (redeeming.length) {
      const rparts = redeeming.map(partOfMove);
      const pending = redeeming.every((m) => m.status === "pending");
      summary.push(t("; "), { k: "computed", t: displayUsd(sum(rparts), rparts.some(hedgedPart), dp(rparts)), usd: sum(rparts), parts: rparts }, t(pending ? " already being redeemed" : " already redeemed since the position date"));
      const by = redeeming[0].fundedBy;
      if (by && redeeming.every((m) => m.fundedBy === by)) {
        summary.push(t(" with the "), ...(by.face ? [by.face, t(" ")] : []), instPhrase(by), t(` issued ${by.when}`));
        const alsoFunds = stated.filter((m) => !inWindow(m) && m.fundedBy === by);
        alsoFunds.forEach((m, n) => summary.push(t(n === 0 ? ", which also fund " : " and "), m.face!, t(" of the "), instPhrase(m)));
      }
    }
    summary.push(t("."));
    refi.push(summary);
  }
  // 2. Named instruments, one line each, with their status.
  refi.push(...boxRows.map(rowLine));
  // 3. Commercial paper outstanding, with what the filer states about it.
  for (const it of anchorItems.filter((x) => isCP(x) && !x.isCapacity)) {
    const line: Line = [];
    if (it.amountPrinted) line.push({ k: "figure", t: displayAmount(it.amountPrinted, it.amountSrc.sentence), printed: it.amountPrinted, src: it.amountSrc }, t(" "));
    if (it.labels.security) line.push(it.labels.security, t(" "));
    line.push(it.labels.type, t(" outstanding"));
    const shortTerm = [it.labels.security?.k === "label" ? it.labels.security.src : null, it.amountSrc].find((x) => x && /short-term/i.test(x.sentence));
    if (shortTerm) line.push(t(", "), { k: "label", t: "short-term", stated: "short-term", src: shortTerm });
    const cpb = i.facts?.commercialPaper?.backedBy;
    const backer = cpb && (cpb.src.url === anchor.url || (i.laterUrls ?? []).includes(cpb.src.url)) ? facilities.find((f) => !/commercial paper/i.test(f.name) && f.facilitySize) : undefined;
    if (cpb && backer?.facilitySize) line.push(t(", "), { k: "label", t: "backed by", stated: cpb.value, src: src(cpb.src.sentence, cpb.src.url) }, t(" the "), { k: "figure", t: displayAmount(backer.facilitySize.value, backer.facilitySize.sourceLine), printed: backer.facilitySize.value, src: src(backer.facilitySize.sourceLine, backer.figureSources?.facilitySize ?? backer.citedUrl) }, t(" "), typeLabel({ instrument: backer.name, classification: classifyInstrument({ headings: [], instrumentName: backer.name }) }, src(backer.facilitySize.sourceLine, backer.figureSources?.facilitySize ?? backer.citedUrl)));
    refi.push(line);
  }
  // 4. Leftovers in one line: the schedule's other principal for every bucket the window reaches (ranged items and amortization are inside it).
  const leftParts: Part[] = [];
  let leftMaybe = false;
  for (const [y, o] of otherScheduled) {
    const [start, end] = [`${y}-01-01`, `${y}-12-31`];
    if (end < briefDate || start > windowEnd) continue;
    if (start < briefDate || end > windowEnd) leftMaybe = true;
    if (o.seg.k === "computed") leftParts.push({ printed: o.seg.t, usd: o.seg.usd, src: { sentence: `other scheduled principal, ${o.period}, maturity ladder`, url: "", doc: "this card" } });
  }
  const leftSegs = [...otherScheduled.entries()].filter(([y]) => `${y}-12-31` >= briefDate && `${y}-01-01` <= windowEnd).map(([, o]) => o.seg).filter((x): x is Extract<Segment, { k: "computed" }> => x.k === "computed");
  if (leftSegs.length) {
    const ps = leftSegs.flatMap((x) => x.parts);
    const usd = leftSegs.reduce((a, x) => a + x.usd, 0);
    refi.push([t("Plus "), { k: "computed", t: displayUsd(usd, false, Math.max(...leftSegs.map((x) => (/\.(\d+)MM/.exec(x.t)?.[1] ?? "").length))), usd, parts: ps }, ...(leftMaybe ? [t(MARK)] : []), t(" of scheduled amortization and other principal, per the filer's schedule (see maturity ladder).")]);
    if (leftMaybe) marked = true;
  } else {
    // No schedule: ranged items reaching the window, which only may fall inside it.
    const ranged = allDebtItems.filter((it) => it.range && it.range.from <= windowEnd.slice(0, 4) && it.range.to >= briefDate.slice(0, 4));
    if (ranged.length) {
      const ps = ranged.flatMap(partOf);
      refi.push([t("Plus "), { k: "computed", t: displayUsd(sum(ps), false, dp(ps)), usd: sum(ps), parts: ps }, t(MARK), t(" of other principal stated over a range of years (see maturity ladder).")]);
      marked = true;
    }
  }
  void leftParts;
  // 5. Next, after the window.
  const after = allDebtItems
    .filter((it) => it.maturity && spanOf(it.maturity.date, it.maturity.granularity)[0] > windowEnd)
    .sort((a, b) => a.maturity!.date.localeCompare(b.maturity!.date))[0];
  refi.push(after ? [t(`Next, after ${shortDate(windowEnd)}: `), ...describe(after, { fallback: false })] : [t(`Next, after ${shortDate(windowEnd)}: no later maturity is stated.`)]);
  // 6. One legend for the marker.
  if (marked) refi.push([t(`${MARK} Stated only to a year or month, or a schedule year only partly inside the window: may fall within 18 months, see source.`)]);
  const ladderLines: Line[] = [];
  const capacity = anchorItems.filter((x) => x.isCapacity);
  if (capacity.length) ladderLines.push([t("Capacity, not debt:")], ...capacity.map((c) => describe(c)));
  const events: Line[] = [...rolledEvents];
  for (const w of pos.withinPeriodRepayments) events.push([t(`Repaid inside the period: ${w.instrument}, prior balance `), { k: "figure", t: displayAmount(w.priorAmount, w.sourceLine), printed: w.priorAmount, src: src(w.sourceLine, w.citedUrl) }, t(`. ${w.note}`)]);
  for (const e of pos.tier2.events) {
    const line: Line = [t(`Since ${displayDate(periodEnd, "day")}: `), { k: "label", t: tidyCoupon(e.instrument), stated: e.instrument, src: src(e.sourceLine, e.citedUrl) }];
    if (e.effect !== null) line.push(t(", "), { k: "figure", t: displayAmount(`$${Math.abs(e.effect).toLocaleString("en-US")}`, e.sourceLine), printed: `$${Math.abs(e.effect).toLocaleString("en-US")}`, src: src(e.sourceLine, e.citedUrl) });
    line.push(t(` (${e.kind}${e.nets ? `, ${e.nets === "unsized" ? "amount not stated in the confirming filing" : "not yet confirmed by a filing"}` : ""}) — not in the position-date total.`));
    events.push(line);
  }
  void events;
  if (rolledLabel) {
    const firstRolled = allDebtItems.find((x) => x.rolled);
    ladderLines.push([t(`Lines marked "from the 10-K": ${rolledSentence(rolledLabel).replace(/^This list comes from/, "stated in")}`), ...(rolledFallback && firstRolled ? [t(" For every one of them: "), { k: "notStated", t: rolledFallback, src: firstRolled.amountSrc } as Segment, t(".")] : [])]);
  }
  // v2.1 §2.5: instruments the referenced filing states at $0 never appear, not
  // even as a list; how two filings' statements of one note were reconciled is
  // mechanics, not card copy. Both stay in the build (rolledNil, dedupNotes) for the detail view.
  void rolledNil; void dedupNotes;

  // ── 2.6 facilities: one block per facility, in the fields its kind has (card_spec §2.6) ──
  // A fact is a source only where it is stated in the anchor or a later filing (Rule 66).
  const permitted = (url: string) => url === anchor.url || (i.laterUrls ?? []).includes(url) || !!directedNote(url);
  /** The annual report the anchor directs to (Rule 66), named by its date and the note the anchor names. */
  function directedNote(url: string): string | null {
    const base = dm?.priorPeriodBase, ref = dm?.noteCrossReference;
    return base?.filingUrl === url && ref?.referencedNote ? `as of ${shortDate(base.periodOfReport)}, per 10-K ${ref.referencedNote}` : null;
  }
  const factFig = (fact: { value: string; src: { sentence: string; url: string } }): Segment => ({ k: "figure", t: displayAmount(fact.value, fact.src.sentence), printed: fact.value, src: src(fact.src.sentence, fact.src.url) });
  const unpermittedFacts: string[] = [];
  const kindOfFacility = (f: VerifiedFacility) => {
    const k = classifyInstrument({ headings: [], instrumentName: f.name }).instrumentType;
    return f.category === "commercial-paper" || k === "commercial-paper" ? "cp" : k === "letter-of-credit" || /\bletters? of credit facilit/i.test(f.name) ? "lc" : "facility";
  };
  // Sub-facilities and sub-limits are capacity inside a facility (Rule 48): matched by the
  // facility's own name, or to the only lender facility where there is one.
  const lenders = facilities.filter((f) => kindOfFacility(f) === "facility");
  const subsFor = new Map<VerifiedFacility, NonNullable<typeof i.facts>["subFacilities"]>();
  const orphanSubs: NonNullable<typeof i.facts>["subFacilities"] = [];
  for (const sf of i.facts?.subFacilities ?? []) {
    if (!permitted(sf.amount.src.url)) { unpermittedFacts.push(`${sf.kind.replace(/-/g, " ")} sub-facility of ${displayAmount(sf.amount.value, sf.amount.src.sentence)}`); continue; }
    const byName = lenders.filter((f) => containsWord(sf.amount.src.sentence, f.name) || containsWord(f.name, sf.facility));
    const host = byName.length === 1 ? byName[0] : lenders.length === 1 ? lenders[0] : null;
    if (host) subsFor.set(host, [...(subsFor.get(host) ?? []), sf]);
    else orphanSubs.push(sf);
  }
  const SUB_NAME: Record<string, string> = { "letter-of-credit": "Letter-of-credit sub-facility", swingline: "Swingline sub-facility" };
  const subLine = (sf: NonNullable<typeof i.facts>["subFacilities"][number], of?: string): Line => {
    const note = directedNote(sf.amount.src.url);
    return [t(`${SUB_NAME[sf.kind] ?? `${sf.kind} sub-facility`}${of ? ` of the ${of}` : ""} `), factFig(sf.amount), t(`: capacity within the facility, not drawn${note ? `, ${note}` : ""}`)];
  };
  const cpFacts = i.facts?.commercialPaper ?? null;
  const facBlocks = facilities.map((f) => {
    const fsrc = (field: string, sentence: string) => src(sentence, f.figureSources?.[field] ?? f.citedUrl);
    const own = fsrc("facilitySize", f.facilitySize?.sourceLine ?? f.name);
    const fig = (label: string, field: "facilitySize" | "drawn" | "lettersOfCredit" | "available"): Line => {
      const v = f[field];
      return v ? [t(`${label} `), { k: "figure", t: displayAmount(v.value, v.sourceLine), printed: v.value, src: fsrc(field, v.sourceLine), field }] : [t(`${label} `), { k: "notStated", t: "not stated", src: own }];
    };
    const m = facilityMaturityAtItsSentence(f);
    const maturityLine = (): Line => (m.kind === "dated" ? [t("Maturity "), { k: "date", t: displayDate(m.date, m.granularity), date: m.date, granularity: m.granularity, src: fsrc("maturity", m.sentence) }] : [t("Maturity "), { k: "notStated", t: m.kind === "relative" ? "stated as a relative term, not a date" : "not stated", src: own }]);
    const kind = kindOfFacility(f);
    const lines: Line[] = [];
    if (kind === "cp") {
      // A commercial paper program: program size, outstanding, average rate, backing. Never facility fields.
      const ok = (x: { src: { url: string } } | null | undefined) => !!x && permitted(x.src.url);
      if (ok(cpFacts?.programSize)) lines.push([t("Program size "), factFig(cpFacts!.programSize!)]);
      else if (f.facilitySize) lines.push(fig("Program size", "facilitySize"));
      if (ok(cpFacts?.outstanding)) lines.push([t("Outstanding "), factFig(cpFacts!.outstanding!)]);
      else if (f.drawn) lines.push(fig("Outstanding", "drawn"));
      if (ok(cpFacts?.averageRate)) lines.push([t("Average rate "), { k: "label", t: cpFacts!.averageRate!.value.replace(/\s+%/, "%"), stated: cpFacts!.averageRate!.value, src: src(cpFacts!.averageRate!.src.sentence, cpFacts!.averageRate!.src.url) }]);
      if (ok(cpFacts?.backedBy)) lines.push([t("Backed by the "), { k: "label", t: cpFacts!.backedBy!.value, stated: cpFacts!.backedBy!.value, src: src(cpFacts!.backedBy!.src.sentence, cpFacts!.backedBy!.src.url) }]);
      lines.push([t("Issuance program, not a lender commitment: never counted as liquidity.")]);
    } else if (kind === "lc") {
      // Letters of credit only: what is outstanding, and the size where stated. No drawn line.
      lines.push(fig("Letters of credit outstanding", "lettersOfCredit"));
      lines.push(f.facilitySize ? fig("Size", "facilitySize") : [{ k: "notStated", t: "facility size not stated", src: f.lettersOfCredit ? fsrc("lettersOfCredit", f.lettersOfCredit.sourceLine) : own }]);
      if (m.kind === "dated") lines.push(maturityLine());
      lines.push([t("Letters of credit only: capacity, not borrowed money.")]);
    } else {
      lines.push(fig("Size", "facilitySize"), fig("Drawn", "drawn"), fig("Letters of credit", "lettersOfCredit"), fig("Available", "available"), maturityLine());
      for (const sf of subsFor.get(f) ?? []) lines.push(subLine(sf));
    }
    const bb = borrowingBaseOf(f);
    if (bb) {
      const full = widen(bb.statement, [f.facilitySize, f.drawn, f.lettersOfCredit, f.available, f.maturity].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.sourceLine));
      lines.push([{ k: "label", t: "Borrowing-base limited", stated: bb.limitedBy, src: src(full, f.figureSources?.facilitySize ?? f.citedUrl) }, t(": stated availability is authoritative.")]);
    }
    const pseudo = { instrument: f.name, classification: classifyInstrument({ headings: [], instrumentName: f.name }) };
    return { heading: [typeLabel(pseudo, own), t(` — ${f.name}`)] as Line, lines };
  });
  for (const sf of orphanSubs) facBlocks.push({ heading: [t(`Sub-facility of the ${sf.facility}`)], lines: [subLine(sf)] });

  // ── 2.6 what the tool did not show ──
  const withheld: Line[] = [];
  const FIELD_NAMES: Record<string, string> = { facilitySize: "size", drawn: "drawn", lettersOfCredit: "letters of credit", available: "available", maturity: "maturity" };
  for (const r of dm?.facilityRejections ?? []) withheld.push([t(`${r.facility}, ${FIELD_NAMES[r.field] ?? r.field} ${displayAmount(r.value, "")}: withheld: ${r.reason}. `), { k: "notStated", t: "See the sentence offered", src: src(r.sourceLine ?? r.facility, anchor.url) }, t(".")]);
  // A claimed date that a sourced one replaced is no longer withheld: the card shows the sourced date.
  for (const r of pos.rows) if (r.maturityWithheld && !r.maturityDate) withheld.push([t(`${r.instrument}: maturity ${r.maturityWithheld.claimed} withheld — ${r.maturityWithheld.why}.`)]);
  if (rawStatement && !statement) withheld.push([t(`Seniority and security are stated only in an earlier annual report, which this card does not use for labels: “${rawStatement.statement}”`)]);
  for (const u of unpermittedFacts) withheld.push([t(`A ${u}: stated only in an earlier annual report, which this card does not use for facility terms.`)]);
  if (i.cash.usd === null || !i.cash.printedLine) withheld.push([t(`Cash: ${i.cash.reason ?? "not stated for this date"}.`)]);
  const unread = actionable.length;
  if (unread) withheld.push([t(`${unread} filing${unread === 1 ? "" : "s"} this week affecting debt: text not read, so amount and instrument are not shown.`)]);
  if (allDebtItems.some((it) => /term loan/i.test(it.labels.type.t))) withheld.push([t(scheduleByYear.size ? "Term-loan amortization by instrument: not stated. The filer's schedule shows it only inside its yearly totals, which the ladder carries as other scheduled principal." : "Term-loan scheduled amortization: not stated in a schedule, so not shown.")]);
  // "Stated but not captured" is a claim about the card, so it is checked
  // against the card: a category any ladder row carries — debt or capacity —
  // is captured (the known misfire on tabulated facilities, BRD 13.2c item 9).
  const onCard = (c: string) => pos.rows.some((r) => (r.classification.instrumentType ?? "").startsWith(c.split("-")[0]) || (c === "revolver" && r.classification.instrumentType === "credit-facility"));
  for (const c of cov.categoriesMissing ?? []) if (!onCard(c)) withheld.push([t(`Stated in the note but not captured: ${c}.`)]);
  // §2.7: A REASON MATCHES THE ITEM'S STATED STATUS. A move read from an
  // "intends to" sentence is called an intention only where no filing this
  // card holds states it done; where one does, that is the reason given,
  // linked, and a move done before the base date is not a change in this period.
  if (rc.counts) for (const m of rc.movements.filter((x) => x.placement === "excluded-not-completed" || x.placement === "undated")) {
    const done = m.placement === "excluded-not-completed"
      ? [...i.textByUrl.keys()].flatMap(sentencesOf).find((x) => containsWord(x.sentence, m.instrument) && /\b(?:were|was) used to repay|\b(?:was|were) repaid\b|\brepaid\b|\bredeemed\b|\bterminated\b/i.test(x.sentence) && !/\bintends?\b|\bwill\b|\bexpects?\b/i.test(x.sentence))
      : undefined;
    // v2.1 §2.3/§2.5: repaid before the referenced period end, so it never appears on the card.
    if (done) continue;
    withheld.push([t(`Not counted in the totals: ${m.instrument}, ${m.placement === "undated" ? "no date stated" : "stated as an intention, and no filing this card holds states it done"}.`)]);
  }
  if (withheld.length === 0) withheld.push([t("Nothing withheld this week.")]);

  // ── 2.8 coverage footnote: all bridging between face and the balance sheet is here ──
  const caps: any[] = dm?.balanceSheetDebtCaptions ?? [];
  const capParts: Part[] = caps.map((c) => ({ printed: c.amount as string, usd: parseMoneyAmount(c.amount) ?? 0, src: src(c.sourceLine, c.citedUrl || anchor.url) }));
  const capSum = sum(capParts);
  const coverageLines: Line[] = [];
  if (capParts.length === 0) {
    coverageLines.push([t("Face total "), faceSeg(), t(". Balance sheet: not measured, the anchor states no balance-sheet debt caption.")]);
  } else {
    // The bridge the filer prints, each line in its own words, with its sign.
    const bridge = bridgeLines.map((e) => {
      const digits = String(e.amount).replace(/[()$\s]+/g, " ").trim();
      const printed = `$ ${digits}`;
      const abs = parseMoneyAmount(printed) ?? 0;
      return { label: String(e.label).replace(/^less:\s*/i, ""), usd: /\(|−/.test(e.amount) ? -abs : abs, printed, src: src(e.sourceLine, e.citedUrl || anchor.url) };
    });
    const residual = capSum - (faceTotal + sum(carryingBeside) + sum(bridge));
    const decimals = Math.max(dp(faceTotalParts), dp(capParts), dp(carryingBeside), ...bridge.map((x) => mmDecimals(x.printed)));
    // The two numbers never render as one string when their values differ.
    let d = decimals;
    while (d < 3 && Math.abs(faceTotal - capSum) >= 1 && displayUsd(faceTotal, false, d) === displayUsd(capSum, false, d)) d++;
    const line: Line = [t("Face total "), faceSeg(d)];
    if (carryingSeg) line.push(t(", plus "), carryingSeg, t(" at carrying value"));
    line.push(t(". Balance sheet "), { k: "computed", t: displayUsd(capSum, false, d), usd: capSum, parts: capParts });
    bridge.forEach((x, n) => {
      const label = x.label.charAt(0).toLowerCase() + x.label.slice(1);
      line.push(t(n === 0 ? ", after " : " and "), { k: "figure", t: displayAmount(x.printed, x.src.sentence), printed: x.printed, src: x.src }, t(" of "), { k: "label", t: label, stated: x.label, src: x.src });
    });
    line.push(t("."));
    // Where the filer states its table is net of issuance costs, discounts or
    // premiums, the difference has a stated explanation: the footnote says so,
    // linked, and cites the carrying-basis check where it holds.
    const basisUrl = rc.counts ? dm?.priorPeriodBase?.filingUrl ?? anchor.url : anchor.url;
    const basisText = (i.textByUrl.get(basisUrl) ?? "").replace(/[\s\u00a0]+/g, " ");
    const basisHit = /[^.:]{0,200}\((net of [^)]{0,80}?(?:issuance costs|discounts?|premiums?)[^)]{0,40})\)[^.:]{0,200}:/i.exec(basisText) ?? /[^.:]{0,200}(net of (?:unamortized )?(?:debt )?(?:issuance costs|discounts?|premiums?)(?:(?:,| or| and) (?:unamortized )?(?:debt )?(?:issuance costs|discounts?|premiums?))*)[^.:]{0,200}:/i.exec(basisText);
    // A filer table printing face and net side by side states the basis too
    // (ruling, Oct 17): its face total must be the card's face total, and the
    // net total is then the filer's own carrying figure.
    const gap = Math.abs(residual) >= 0.5 * 10 ** -decimals * 1e6;
    const sideBySide = (() => {
      if (!gap) return null;
      const re = /[^.:]{0,240}\b(?:face|principal)(?: amount| value)?s?\s+(?:net|carrying)(?: amount| value)?s?\b[\s\S]{0,900}?\bTotal\s+(\$?\s*\(?[\d,]+(?:\.\d+)?\)?)\s+(\$?\s*\(?[\d,]+(?:\.\d+)?\)?)/gi;
      for (const m of basisText.matchAll(re)) {
        const span = m[0].trim();
        const scale = scheduleScale(span);
        const facePrinted = `$ ${m[1].replace(/[$\s()]/g, "")} ${scale}`, netPrinted = `$ ${m[2].replace(/[$\s()]/g, "")} ${scale}`;
        const faceUsd = parseMoneyAmount(facePrinted), netUsd = parseMoneyAmount(netPrinted);
        if (faceUsd !== null && netUsd !== null && Math.abs(faceUsd - faceTotal) < 0.5 * 10 ** -decimals * 1e6 + 1) return { span, facePrinted, netPrinted, netUsd };
      }
      return null;
    })();
    if (sideBySide) {
      const where = src(sideBySide.span, basisUrl);
      line.push(t(" The filer's schedule prints "), { k: "figure", t: displayAmount(sideBySide.facePrinted, where.sentence), printed: sideBySide.facePrinted, src: where }, t(" face and "), { k: "figure", t: displayAmount(sideBySide.netPrinted, where.sentence), printed: sideBySide.netPrinted, src: where }, t(" net, side by side"));
      line.push(t(Math.abs(sideBySide.netUsd - capSum) < 0.5 * 10 ** -decimals * 1e6 + 1 ? "; the net figure is the balance sheet's." : "."));
    }
    const explained = gap && (basisHit || sideBySide);
    if (gap && basisHit && !sideBySide) {
      const where = src(basisHit![0].trim(), basisUrl);
      line.push(t(" The filer states its debt table is "), { k: "label", t: basisHit![1], stated: basisHit![1], src: where }, t("."));
      // The carrying-basis check: the lines as the table states them, against the balance sheet.
      const carryParts: Part[] = rc.counts
        ? rc.entries.filter((e) => e.amountMillions !== 0).map((e) => ({ printed: printedIn(e.sourceLine, Math.abs(e.amountMillions) * 1e6) ?? `$ ${Math.abs(e.amountMillions).toLocaleString("en-US")} million`, usd: e.amountMillions * 1e6, src: src(e.sourceLine, e.citedUrl) }))
        : [];
      if (carryParts.length && cov.residualPasses) {
        const gap = capSum - sum(carryParts);
        const parts = [...capParts, ...carryParts.map((p) => ({ ...p, usd: -p.usd }))];
        line.push(t(" At carrying value, the lines match the balance sheet within "), { k: "computed", t: displayUsd(Math.abs(gap), false, dp(carryParts)), usd: Math.abs(gap), parts: gap < 0 ? parts.map((p) => ({ ...p, usd: -p.usd })) : parts }, t("."));
      }
    }
    // A difference nothing stated explains is shown as such, with its arithmetic.
    if (!explained && Math.abs(residual) >= 0.5 * 10 ** -decimals * 1e6) {
      const neg = (ps: Part[]) => ps.map((p) => ({ ...p, usd: -p.usd }));
      const parts = [...capParts, ...neg(faceTotalParts), ...neg(carryingBeside), ...neg(bridge)];
      line.push(t(" "), { k: "computed", t: displayUsd(Math.abs(residual), false, decimals), usd: Math.abs(residual), parts: residual < 0 ? neg(parts) : parts }, t(" is not accounted for."));
    }
    if (rolledLabel) line.push(t(` ${rolledFootnote(rolledLabel)}`));
    coverageLines.push(line);
  }


  // ════════════════════════════════════════════════════════════════════════
  // CARD_SPEC v3.0 — THE REDESIGNED CARD, built from the same items, moves and
  // schedule as the v2.2 sections above. Presentation only: no new data. Every
  // figure is a linked Segment; a chart label or table cell is a computed
  // figure whose parts are the source figures.
  // ════════════════════════════════════════════════════════════════════════
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  /** A move's date as the card shows it: "Sept 22, 2026" where a day is stated, "May 2026" where only a month is. */
  const whenShort = (m: Move): string => (/\d{1,2},\s*\d{4}/.test(m.when) ? shortDate(m.sort) : /^[A-Z][a-z]+ \d{4}$/.test(m.when) ? `${MON[Number(m.sort.slice(5, 7)) - 1]} ${m.sort.slice(0, 4)}` : m.when);
  const dateOf = (m: Move, text?: string): Segment => (m.dateSeg.k === "label" ? { ...m.dateSeg, t: text ?? whenShort(m) } : t(text ?? whenShort(m)));
  /** First letter up, for display only: what a label states is unchanged. */
  const capFirst = (l: Line): Line => l.map((x, n) => (n === 0 ? { ...x, t: x.t.replace(/^[,;\s]+/, "").replace(/^./, (c) => c.toUpperCase()) } : x));
  const whenOf = (m: Item["maturity"]): string => (!m ? "Various" : m.granularity === "year" ? m.date.slice(0, 4) : m.granularity === "month" ? `${MON[Number(m.date.slice(5, 7)) - 1]} ${m.date.slice(0, 4)}` : shortDate(m.date));
  const usdSeg = (parts: Part[], opts: { bare?: boolean; hedged?: boolean } = {}): Segment => {
    const usd = sum(parts);
    const shown = displayUsd(usd, opts.hedged ?? parts.some(hedgedPart), dp(parts));
    return { k: "computed", t: opts.bare ? shown.replace(/\$/, "").replace(/MM$/, "") : shown, usd, parts };
  };
  const nounPlural = (type: string) => /s$/.test(type);
  /** Coupon, labels, type: the instrument's own words, in §3.7 order, with no amount and no date. */
  const instrumentWords = (it: Item): Line => {
    const out: Line = [];
    const c = couponOf(it.name);
    if (c) out.push({ k: "label", t: c.shown, stated: c.printed, src: it.nameSrc }, t(" "));
    const showName = !c && !isCP(it) && it.labels.type.t !== it.name;
    for (const l of [it.labels.seniority, it.labels.security]) if (l && !(showName && l.k === "label" && containsWord(it.name, l.stated))) out.push(l, t(" "));
    out.push(showName ? { k: "label", t: it.name, stated: it.name, src: it.nameSrc } : it.labels.type);
    if (it.basis === "carrying") out.push(t(" (carrying value)"));
    return out;
  };
  const colorOf = (it: Item): PaletteColor => {
    const sec = it.labels.security?.t ?? "";
    if (/unsecured/i.test(sec)) return PALETTE.unsecured;
    if (/secured|lien/i.test(sec)) return /junior|second/i.test(`${it.labels.seniority?.t ?? ""} ${it.name}`) ? PALETTE.juniorSecured : PALETTE.seniorSecured;
    return PALETTE.notStated;
  };

  // ── what each instrument's stated moves did to it (§2.10) ──
  const retirementsOf = (it: Item) => movesAll.filter((x) => RETIRES.has(x.type) && x.faceUsd && sameNote(x.instrument, it.name) && (!it.maturity || !/\b20\d\d\b/.test(x.instrument) || x.instrument.includes(it.maturity.date.slice(0, 4))));
  const faceUsdOf = (it: Item) => sum(partOf(it));
  const inWindowItem = (it: Item) => boxRows.some((r) => r.it === it && !r.it.isCapacity);
  /** Face of the instrument set to be retired, or retired since the position date, with the stated proceeds of new debt. */
  const refinancedOf = (it: Item) => retirementsOf(it).filter((m) => m.fundedBy && !m.inPeriod).reduce((a, m) => a + m.faceUsd!, 0);
  const remainsUsd = (it: Item, retired: Move[]) => faceUsdOf(it) - retired.filter((m) => !m.inPeriod).reduce((a, m) => a + m.faceUsd!, 0);
  const statusOf = (it: Item): Tag | null => {
    if (isCP(it)) {
      const cpb = i.facts?.commercialPaper?.backedBy;
      return cpb && (cpb.src.url === anchor.url || (i.laterUrls ?? []).includes(cpb.src.url)) ? { text: [{ k: "label", t: "Backed by revolver", stated: cpb.value, src: src(cpb.src.sentence, cpb.src.url) }], tone: "neutral" } : { text: [t("Short-term")], tone: "neutral" };
    }
    const rs = retirementsOf(it);
    const refi = refinancedOf(it);
    if (inWindowItem(it) && faceUsdOf(it) - refi > 0.5e6) return { text: [t("Not yet refinanced")], tone: "orange" };
    if (!rs.length) return null;
    const funded = rs.every((m) => m.fundedBy);
    const retired = rs.reduce((a, m) => a + m.faceUsd!, 0);
    const remains = remainsUsd(it, rs);
    const fig = (usd: number, ms: Move[]): Segment => ({ k: "computed", t: displayUsd(usd, ms.some((m) => /~/.test(m.face?.t ?? "")), 0), usd, parts: ms.map((m) => ({ printed: (m.face as any).printed, usd: m.faceUsd!, src: (m.face as any).src })) });
    if (funded && remains < 0.5e6) {
      const pending = rs.some((m) => m.status === "pending");
      const m0 = rs[0];
      return pending
        ? { text: [t("Refinanced · "), dateOf(m0, `redemption set for ${whenShort(m0).replace(/, \d{4}$/, "")}`)], tone: "pending" }
        : { text: [t("Refinanced · "), dateOf(m0, `redeemed ${monthYear(m0.sort)}`)], tone: "refinanced" };
    }
    const remainFig: Segment = { k: "computed", t: displayUsd(remains, false, dp(partOf(it))), usd: remains, parts: [...partOf(it), ...rs.filter((m) => !m.inPeriod).map((m) => ({ printed: (m.face as any).printed, usd: -m.faceUsd!, src: (m.face as any).src }))] };
    const word = funded ? "refinanced" : rs.every((m) => m.type === "tender or repurchase") ? `repurchased in ${rs[0].sort.slice(0, 4)}` : `retired in ${rs[0].sort.slice(0, 4)}`;
    return { text: [fig(retired, rs), t(` ${word} · `), remainFig, t(" remains")], tone: funded ? "pending" : "neutral" };
  };
  const notStatedPhrase = (it: Item) => (!it.labels.seniority && !it.labels.security ? "Seniority not stated" : !it.labels.security ? "Security not stated" : !it.labels.seniority ? "Seniority not stated" : null);

  // ── 2.1 header and the rolled-position note ──
  const otherCount = other.length;
  const v3header: CardV3["header"] = {
    label: `Weekly coverage brief · ${weekRange(weekFrom, briefDate)}`,
    company: result.company,
    position: [t("Position as of "), periodDate()],
    filing: { k: "filing", t: `${anchor.form} filed ${shortDate(anchor.date)}`, url: anchor.url },
    status: actionable.length
      ? [t(`${actionable.length} filing${actionable.length === 1 ? "" : "s"} this week may affect debt`)]
      : otherCount
        ? [t(`${otherCount} filing${otherCount === 1 ? "" : "s"} this week, none affecting debt: `), ...other.flatMap((f, n) => [...(n ? [t(" ")] : []), { k: "filing", t: `${formName(f.form)} ${shortDate(f.filingDate)}`, url: f.primaryDocUrl } as Segment])]
        : [t("No new debt filings this week")],
    actionable,
  };
  const baseUrl = dm?.priorPeriodBase?.filingUrl as string | undefined;
  const rolledNote: Line | null = rolledLabel && baseUrl
    ? [t(`This company's ${anchor.form} does not list its notes. This list comes from the `), { k: "filing", t: `${rolledFrom(rolledLabel)} 10-K`, url: baseUrl }, t(`, updated for changes through ${displayDate(periodEnd, "day")}. Rows from the 10-K carry a 10-K tag.`)]
    : null;

  // ── 2.2 the call box ──
  const named = maturing.map((r) => r.it);
  const cpItems = anchorItems.filter((x) => isCP(x) && !x.isCapacity);
  const dueParts = named.flatMap(partOf);
  const refiItems = named.filter((it) => refinancedOf(it) > 0.5e6);
  const refiParts: Part[] = named.flatMap((it) => retirementsOf(it).filter((m) => m.fundedBy && !m.inPeriod).map((m) => ({ printed: (m.face as any).printed as string, usd: m.faceUsd!, src: (m.face as any).src as Source })));
  const notYetItems = named.filter((it) => faceUsdOf(it) - refinancedOf(it) > 0.5e6);
  const notYetUsd = sum(dueParts) - sum(refiParts);
  const leftoverSegs = [...otherScheduled.entries()].filter(([y]) => `${y}-12-31` >= briefDate && `${y}-01-01` <= windowEnd).map(([, o]) => o.seg).filter((x): x is Extract<Segment, { k: "computed" }> => x.k === "computed");
  const leftoverMaybe = [...otherScheduled.keys()].some((y) => `${y}-12-31` >= briefDate && `${y}-01-01` <= windowEnd && (`${y}-01-01` < briefDate || `${y}-12-31` > windowEnd));
  const callCase: CardV3["call"]["case"] = named.length ? (notYetItems.length ? "A" : "B") : leftoverSegs.length ? "C" : "D";
  let daggerUsed = false;
  const phraseFor = (its: Item[]): string => {
    if (its.length === 1) {
      const it = its[0];
      const words = instrumentWords(it).filter((x) => x.t.trim()).map((x) => x.t).join(" ").replace(/\s+/g, " ").replace(/ \(carrying value\)/, "");
      return `${words} due ${it.maturity ? (it.maturity.granularity === "day" ? displayDate(it.maturity.date, "day") : it.maturity.granularity === "month" ? displayDate(it.maturity.date, "month") : it.maturity.date.slice(0, 4)) : "in the window"}`;
    }
    const types = [...new Set(its.map((x) => x.labels.type.t))];
    const typeText = types.length === 1 ? types[0] : `${types.slice(0, -1).join(", ")} and ${types[types.length - 1]}`;
    const years = [...new Set(its.map((x) => x.maturity?.date.slice(0, 4)))];
    return `${typeText} due ${years.length === 1 && years[0] ? `in ${years[0]}` : `by ${shortDate(windowEnd)}`}`;
  };
  const verbFor = (its: Item[]) => (its.length > 1 || nounPlural(its[0].labels.type.t) ? "are" : "is");
  const headline: Line = [];
  if (callCase === "A") {
    const nyParts: Part[] = [...notYetItems.flatMap(partOf), ...refiParts.filter((p) => notYetItems.some((it) => retirementsOf(it).some((m) => (m.face as any)?.src === p.src))).map((p) => ({ ...p, usd: -p.usd }))];
    headline.push(usdSeg(nyParts), t(` of ${phraseFor(notYetItems)} ${verbFor(notYetItems)} not yet refinanced.`));
    const done = refiItems.filter((it) => !notYetItems.includes(it));
    if (done.length) headline.push(t(` ${done.length === 1 ? `The ${done[0].maturity?.date.slice(0, 4) ?? ""} ${done[0].labels.type.t}`.replace(/\s+/g, " ") : `The other ${done.length} instruments`} ${verbFor(done)} already refinanced.`));
  } else if (callCase === "B") headline.push(t("Everything due in the next 18 months is refinanced."));
  else if (callCase === "C") {
    const ps = leftoverSegs.flatMap((x) => x.parts);
    headline.push(t("No notes or loans mature in the next 18 months. "), { k: "computed", t: displayUsd(leftoverSegs.reduce((a, x) => a + x.usd, 0), false, Math.max(0, ...leftoverSegs.map((x) => (/\.(\d+)MM/.exec(x.t)?.[1] ?? "").length))), usd: leftoverSegs.reduce((a, x) => a + x.usd, 0), parts: ps }, ...(leftoverMaybe ? [t(MARK)] : []), t(" of scheduled amortization."));
    if (leftoverMaybe) daggerUsed = true;
  } else headline.push(t("Nothing matures in the next 18 months."));
  const cpb = i.facts?.commercialPaper?.backedBy;
  const cpBacker = cpb && (cpb.src.url === anchor.url || (i.laterUrls ?? []).includes(cpb.src.url)) ? facilities.find((f) => !/commercial paper/i.test(f.name) && f.facilitySize) : undefined;
  for (const cp of cpItems) {
    const parts = partOf(cp);
    headline.push(t(" About "), { k: "computed", t: displayUsd(sum(parts), false, dp(parts)), usd: sum(parts), parts }, t(" of commercial paper is also outstanding"));
    if (cpBacker?.facilitySize) headline.push(t(", "), { k: "label", t: "backed by", stated: cpb!.value, src: src(cpb!.src.sentence, cpb!.src.url) }, t(" the "), { k: "figure", t: displayAmount(cpBacker.facilitySize.value, cpBacker.facilitySize.sourceLine), printed: cpBacker.facilitySize.value, src: src(cpBacker.facilitySize.sourceLine, cpBacker.figureSources?.facilitySize ?? cpBacker.citedUrl) }, t(" revolver"));
    headline.push(t("."));
  }
  const tiles: CardV3["call"]["tiles"] = [];
  if (callCase === "A" || callCase === "B") {
    const years = [...new Set(named.map((x) => x.maturity?.date.slice(0, 4)))];
    tiles.push({ key: "due", label: "Due in window", value: usdSeg(dueParts), usd: sum(dueParts), sub: [t(`${named.length} ${named.every((x) => x.labels.type.t === "notes") ? "note issue" : "issue"}${named.length === 1 ? "" : "s"}${years.length === 1 && years[0] ? `, all in ${years[0]}` : ""}`)] });
    const by = named.flatMap(retirementsOf).find((m) => m.fundedBy)?.fundedBy;
    tiles.push(refiParts.length
      ? { key: "refinanced", label: "Refinanced", value: usdSeg(refiParts), usd: sum(refiParts), sub: [t(by ? `With the ${whenShort(by).replace(/, \d{4}$/, "")} notes` : "With stated proceeds of new debt"), t(named.flatMap(retirementsOf).some((m) => m.status === "pending") ? " · redemption awaiting confirmation" : "")] }
      : { key: "refinanced", label: "Refinanced", value: { k: "computed", t: "$0", usd: 0, parts: [] }, usd: 0, sub: [t("None stated in any filing")] });
    if (notYetUsd > 0.5e6) tiles.push({ key: "notYet", label: "Not yet refinanced", value: { k: "computed", t: displayUsd(notYetUsd, false, Math.max(dp(dueParts), dp(refiParts))), usd: notYetUsd, parts: [...dueParts, ...refiParts.map((p) => ({ ...p, usd: -p.usd }))] }, usd: notYetUsd, sub: [t("The refinancing conversation")] });
  }
  const afterItem = allDebtItems.filter((it) => it.maturity && spanOf(it.maturity.date, it.maturity.granularity)[0] > windowEnd).sort((a, b) => a.maturity!.date.localeCompare(b.maturity!.date))[0];
  const monthsFrom = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) - (Number(to.slice(8, 10)) < Number(from.slice(8, 10)) ? 1 : 0);
  const nextTile: CardV3["call"]["nextTile"] = (callCase === "C" || callCase === "D") && afterItem
    ? {
        value: usdSeg(partOf(afterItem)),
        instrument: instrumentWords(afterItem),
        date: { k: "date", t: displayDate(afterItem.maturity!.date, afterItem.maturity!.granularity), date: afterItem.maturity!.date, granularity: afterItem.maturity!.granularity, src: afterItem.maturity!.src },
        away: afterItem.maturity!.granularity === "year" ? null : (() => {
          const end = afterItem.maturity!.granularity === "month" ? `${afterItem.maturity!.date.slice(0, 8)}01` : afterItem.maturity!.date;
          const n = monthsFrom(briefDate, end), past = monthsFrom(windowEnd, end);
          return `${n} month${n === 1 ? "" : "s"} away${past > 0 ? ` · ${past} month${past === 1 ? "" : "s"} past the window` : ""}`;
        })(),
      }
    : null;
  const callRows: CardV3["call"]["rows"] = [];
  for (const cp of cpItems) {
    const body: Line = [usdSeg(partOf(cp)), t(" "), ...(cp.labels.security ? [cp.labels.security, t(" ")] : []), cp.labels.type];
    const rate = i.facts?.commercialPaper?.averageRate;
    if (rate && (rate.src.url === anchor.url || (i.laterUrls ?? []).includes(rate.src.url))) body.push(t(", "), { k: "label", t: `${rate.value.replace(/\s+%/, "%")} average rate`, stated: rate.value, src: src(rate.src.sentence, rate.src.url) });
    callRows.push({ when: [t("Short-term")], body, tenK: false, tag: statusOf(cp), usd: null, isCP: true });
  }
  for (const r of boxRows) {
    const when: Line = [r.it.maturity ? { k: "date", t: whenOf(r.it.maturity), date: r.it.maturity.date, granularity: r.it.maturity.granularity, src: r.it.maturity.src } : t("—")];
    if (r.maybe) { when.push(t(` ${MARK}`)); daggerUsed = true; }
    callRows.push({ when, body: [usdSeg(partOf(r.it)), t(" "), ...instrumentWords(r.it)], tenK: r.it.rolled, tag: statusOf(r.it), usd: faceUsdOf(r.it), isCP: false });
  }
  const callNotes: Line[] = [];
  if ((callCase === "A" || callCase === "B") && leftoverSegs.length) {
    callNotes.push([t("Also in window: "), { k: "computed", t: displayUsd(leftoverSegs.reduce((a, x) => a + x.usd, 0), false, Math.max(0, ...leftoverSegs.map((x) => (/\.(\d+)MM/.exec(x.t)?.[1] ?? "").length))), usd: leftoverSegs.reduce((a, x) => a + x.usd, 0), parts: leftoverSegs.flatMap((x) => x.parts) }, ...(leftoverMaybe ? [t(MARK)] : []), t(" of scheduled amortization and other principal.")]);
    if (leftoverMaybe) daggerUsed = true;
  }
  if ((callCase === "A" || callCase === "B") && afterItem) {
    const nx: Line = [t("Next after the window: "), usdSeg(partOf(afterItem)), t(" "), ...instrumentWords(afterItem), t(", "), { k: "date", t: displayDate(afterItem.maturity!.date, afterItem.maturity!.granularity), date: afterItem.maturity!.date, granularity: afterItem.maturity!.granularity, src: afterItem.maturity!.src }];
    const rf = refinancedOf(afterItem);
    if (rf > 0.5e6) {
      const rs = retirementsOf(afterItem).filter((m) => m.fundedBy && !m.inPeriod);
      nx.push(t(", of which "), { k: "computed", t: displayUsd(rf, false, 0), usd: rf, parts: rs.map((m) => ({ printed: (m.face as any).printed, usd: m.faceUsd!, src: (m.face as any).src })) }, t(" is refinanced, leaving "), { k: "computed", t: displayUsd(faceUsdOf(afterItem) - rf, false, 0), usd: faceUsdOf(afterItem) - rf, parts: [...partOf(afterItem), ...rs.map((m) => ({ printed: (m.face as any).printed, usd: -m.faceUsd!, src: (m.face as any).src }))] });
    }
    nx.push(t("."));
    callNotes.push(nx);
  }

  // ── 2.3 move cards ──
  const formOfUrl = (url: string) => (docs.get(url) ?? "").split(" ")[0] || "filing";
  const moveCards: CardV3["moves"] = [];
  for (const ms of evs) {
    const issuance = ms.find((m) => m.type === "issuance");
    const entry = ms.find((m) => m.type === "facility entry"), term = ms.find((m) => m.type === "facility termination");
    const faceInst = (m: Move): Line => [...(m.face ? [m.face, t(" ")] : []), instPhrase(m)];
    if (entry && term) {
      const lender = facilities.filter((f) => !/commercial paper|letter of credit/i.test(f.name));
      const fac = lender.length === 1 ? lender[0] : null;
      const draw = ms.find((m) => m.type === "draw");
      const oldYear = (/dated\s+[A-Z][a-z]+\s+\d{1,2},\s*(20\d\d)/.exec(term.instrument) ?? /\b(20\d\d)\b/.exec(term.instrument) ?? [])[1];
      const title: Line = [t(`${fac && /revolv/i.test(fac.name) ? "Revolver" : "Credit facility"}: new `)];
      if (fac?.facilitySize) title.push({ k: "figure", t: displayAmount(fac.facilitySize.value, fac.facilitySize.sourceLine), printed: fac.facilitySize.value, src: src(fac.facilitySize.sourceLine, fac.figureSources?.facilitySize ?? fac.citedUrl) }, t(" "));
      title.push(entry.instSeg.k === "label" ? { k: "label", t: "credit agreement", stated: containsWord(entry.instSeg.src.sentence, "credit agreement") ? "credit agreement" : entry.instSeg.stated, src: entry.instSeg.src } : t("credit agreement"), t(" replaced the "), term.instSeg.k === "label" && oldYear ? { k: "label", t: `${oldYear} agreement`, stated: oldYear, src: term.instSeg.src } : t("earlier agreement"));
      moveCards.push({ meta: [dateOf(entry), t(" · Refinanced")], title: [title], detail: draw ? [...(draw.face ? [draw.face, t(" ")] : []), draw.instSeg.k === "label" ? { k: "label", t: "drawn to retire it", stated: "drew", src: draw.instSeg.src } : t("drawn to retire it"), t(".")] : null, retires: null });
      continue;
    }
    if (issuance) {
      const left: CardV3["moves"][number] = { meta: [dateOf(issuance), t(` · Issued, confirmed by ${formOfUrl(issuance.url)}`)], title: [faceInst(issuance)], detail: null, retires: null };
      const extras: Line = [...priceClause(issuance), ...issuance.extra];
      if (issuance.retires.length) {
        const pending = issuance.retires.some((r) => r.status === "pending");
        const r0 = issuance.retires[0];
        left.retires = {
          meta: pending ? [t("Refinanced · "), dateOf(r0, `redemption set for ${whenShort(r0)}`), t(", awaiting confirmation in a filing")] : [t("Refinanced · "), dateOf(r0, `redeemed ${monthYear(r0.sort)}`)],
          items: issuance.retires.map((r) => (r.type === "paydown" ? [...(r.face ? [r.face, t(" ")] : []), t("of the "), instPhrase(r), t(", repaid")] : faceInst(r))),
        };
        const use = issuance.retires.length ? [] : useClause(issuance);
        if (extras.length || use.length) left.detail = [...capFirst([...use, ...extras]), t(".")];
      } else {
        const use = useClause(issuance);
        const d = [...use, ...extras];
        if (d.length) left.detail = [...capFirst(d), t(".")];
      }
      moveCards.push(left);
      for (const o of ms.filter((m) => m !== issuance && !issuance.retires.includes(m))) moveCards.push({ meta: [dateOf(o), t(` · ${vocab(o)}`)], title: [faceInst(o)], detail: detailOf(o), retires: null });
      continue;
    }
    const sorted = [...ms].sort((a, b) => a.sort.localeCompare(b.sort));
    const shared = sorted.every((m) => m.fundFact && m.fundFact.value === sorted[0].fundFact?.value);
    moveCards.push({ meta: [dateOf(sorted[0]), t(` · ${vocab(sorted[0])}`)], title: sorted.map((m) => faceInstOrName(m)), detail: shared || sorted.length === 1 ? detailOf(sorted[0]) : null, retires: null });
  }
  function vocab(m: Move): string {
    if (m.type === "facility amendment") return "Amended";
    if (m.type === "repayment at maturity") return "Repaid at maturity";
    if (m.type === "paydown") return "Repaid";
    if (m.type === "tender or repurchase") return "Repurchased";
    if (m.type === "special call" || m.type === "redemption") return m.fundedBy ? "Refinanced" : m.status === "pending" ? "Redemption announced, awaiting confirmation in a filing" : "Redeemed";
    if (m.type === "issuance") return `Issued, confirmed by ${formOfUrl(m.url)}`;
    if (m.type === "draw") return "Drew";
    return (TYPE_WORD[m.type]?.[0] ?? m.type).replace(/^./, (c) => c.toUpperCase());
  }
  function faceInstOrName(m: Move): Line {
    if (m.type === "facility amendment") {
      const incr = /\bincremental\b/i.test(m.sentence);
      return incr ? [t("Added an incremental "), ...(m.face ? [m.face, t(" ")] : []), instPhrase(m)] : [instPhrase(m), t(" amended")].map((x, n) => (n === 0 && x.k === "label" ? { ...x, t: x.t.replace(/^./, (c) => c.toUpperCase()) } : x));
    }
    return [...(m.face ? [m.face, t(" ")] : []), instPhrase(m)];
  }
  function detailOf(m: Move): Line | null {
    const parts = [...fundClause(m), ...useClause(m), ...priceClause(m), ...m.extra];
    if (m.type === "facility amendment" && !parts.length && !/\bincremental\b/i.test(m.sentence)) return [t("Terms of the amendment are not covered in this version.")];
    if (!parts.length) return m.type === "repayment at maturity" || m.type === "paydown" ? [t("Funding source not stated.")] : null;
    const out = capFirst(parts.map((x, n) => (n === 0 && x.k === "text" ? { ...x, t: x.t.replace(/^,\s*funded by/, "with") } : x)));
    out.push(t("."));
    return out;
  }

  // ── 2.4 total debt and liquidity bars ──
  const tdGroups = [...byType.values()]
    .flatMap((g) => splitBy(g.items, (it) => it.labels.security).flatMap((a) => splitBy(a, (it) => it.labels.seniority)).map((items) => ({ ...g, items, first: allDebtItems.indexOf(items[0]) })))
    .map((g) => {
      const all = (pick: (it: Item) => Segment | null) => (g.items.every((it) => pick(it) && pick(it)!.t === pick(g.items[0])!.t) ? pick(g.items[0]) : null);
      const sen = all((it) => it.labels.seniority), sec = all((it) => it.labels.security);
      const kind = kindOf(g.items[0].name);
      const junior = !!sec && /junior|second/i.test(`${sen?.t ?? ""}`);
      // Color follows the stated security label only (v3.1): a group without one is grey.
      const tier = kind === "lease" || kind === "other" ? 4 : sec && /unsecured/i.test(sec.t) ? 2 : sec ? (junior ? 1 : 0) : 3;
      const color: PaletteColor = tier === 0 ? PALETTE.seniorSecured : tier === 1 ? PALETTE.juniorSecured : tier === 2 ? PALETTE.unsecured : PALETTE.notStated;
      return { g, sen, sec, tier, color };
    })
    .sort((a, b) => a.tier - b.tier || a.g.first - b.g.first);
  const tdSegments: BarSegment[] = [];
  const tdLegend: CardV3["totalDebt"]["legend"] = [];
  const carryNotes: Line = [];
  for (const { g, sen, sec, color } of tdGroups) {
    const faceIt = g.items.filter((it) => it.basis === "face");
    const carryIt = g.items.filter((it) => it.basis === "carrying");
    const label: Line = [];
    [sen, sec, g.type].filter((x): x is Segment => !!x).forEach((l, n) => label.push(...(n ? [t(" ")] : []), l));
    label.push(...unlabelled(g, sen, sec));
    if (faceIt.length) {
      const ps = faceIt.flatMap(partOf);
      tdSegments.push({ usd: sum(ps), color, title: label.map((x) => x.t).join(""), rows: faceIt.map((it) => it.rowLabel ?? it.name) });
      tdLegend.push({ color, label, amount: usdSeg(ps) });
    }
    if (carryIt.length) carryNotes.push(...(carryNotes.length ? [t("; ")] : []), ...label, t(" "), usdSeg(carryIt.flatMap(partOf)));
  }
  const unattributed = faceTotal - tdSegments.reduce((a, x) => a + x.usd, 0);
  if (faceFromSchedule && unattributed > 0.5e6) {
    // v3.1: labelled by what it holds, the carrying rows whose face only the schedule states.
    const carryGroups = tdGroups.filter((x) => x.g.items.some((it) => it.basis === "carrying"));
    const first = carryGroups[0];
    const firstLabel = first ? [first.sen, first.sec, first.g.type].filter((x): x is Segment => !!x).map((x) => x.t).join(" ") : "debt";
    const what = `${firstLabel.charAt(0).toUpperCase()}${firstLabel.slice(1)}${carryGroups.length > 1 ? " and other debt" : ""}, face per the filer's schedule (individual face not stated)`;
    const carryRows = allDebtItems.filter((it) => it.basis === "carrying").map((it) => it.rowLabel ?? it.name);
    tdSegments.push({ usd: unattributed, color: PALETTE.scheduledOther, title: what, rows: carryRows });
    const parts = [...faceTotalParts, ...tdLegend.flatMap((l) => (l.amount.k === "computed" ? l.amount.parts.map((p) => ({ ...p, usd: -p.usd })) : []))];
    tdLegend.push({ color: PALETTE.scheduledOther, label: [t(what)], amount: { k: "computed", t: displayUsd(unattributed, false, dp(faceTotalParts)), usd: unattributed, parts } });
  }
  const tdNotes: Line[] = carryNotes.length ? [[t(faceFromSchedule ? "At carrying value, not in the bar: " : "Plus, at carrying value and not in the bar: "), ...carryNotes, t(".")]] : [];

  const liqSegments: BarSegment[] = [];
  const liqLegend: CardV3["liquidity"]["legend"] = [];
  const liqNotes: Line[] = [];
  if (i.cash.usd !== null && i.cash.printedLine && i.cash.printed) {
    const s0 = anchorSrc(i.cash.printedLine);
    const filerLabel = (/^\s*([A-Za-z][A-Za-z ,&'’\-]*?[A-Za-z])\s*\$?\s*\(?\d/.exec(i.cash.printedLine) ?? [])[1] ?? "Cash";
    liqSegments.push({ usd: i.cash.usd, color: PALETTE.cash, title: filerLabel });
    liqLegend.push({ color: PALETTE.cash, label: [{ k: "label", t: filerLabel, stated: filerLabel, src: s0 }], amount: { k: "figure", t: displayAmount(i.cash.printed, i.cash.printedLine), printed: i.cash.printed, src: s0 } });
  }
  for (const f of lenders) {
    if (!f.available) continue;
    const fsrc = src(f.available.sourceLine, f.figureSources?.available ?? f.citedUrl);
    const usd = parseMoneyAmount(f.available.value) ?? 0;
    const m = facilityMaturityAtItsSentence(f);
    // The type word links to a sentence of the facility's own that names it.
    const typeWord = classifyInstrument({ headings: [], instrumentName: f.name });
    const typeSrc = [fsrc, ...[f.facilitySize, f.drawn, f.maturity].filter((x): x is NonNullable<typeof x> => !!x).map((x) => src(x.sourceLine, f.figureSources?.facilitySize ?? f.citedUrl))].find((x) => containsWord(x.sentence, typeWord.instrumentTypeStatedAs ?? f.name) || containsWord(x.sentence, f.name));
    const type: Segment = typeSrc ? typeLabel({ instrument: f.name, classification: typeWord }, typeSrc) : t(typeLabel({ instrument: f.name, classification: typeWord }, fsrc).t);
    liqSegments.push({ usd, color: PALETTE.undrawn, title: f.name });
    liqLegend.push({ color: PALETTE.undrawn, label: [t("Undrawn "), type, ...(m.kind === "dated" ? [t(", matures "), { k: "date", t: displayDate(m.date, m.granularity), date: m.date, granularity: m.granularity, src: src(m.sentence, f.figureSources?.maturity ?? f.citedUrl) } as Segment] : [])], amount: { k: "figure", t: displayAmount(f.available.value, f.available.sourceLine), printed: f.available.value, src: fsrc } });
    if (borrowingBaseOf(f)) liqNotes.push([t("Borrowing-base limited; stated availability shown.")]);
  }
  for (const u of (i.facts?.uncommitted ?? []).filter((x) => liqPermitted(x.description.src.url))) {
    liqNotes.push([t("Not counted: "), ...(u.amount && liqPermitted(u.amount.src.url) ? [t("up to "), liqFig(u.amount), t(" of ")] : []), { k: "label", t: u.description.value.replace(/^uncommitted capacity to incur /i, "uncommitted "), stated: u.description.value, src: src(u.description.src.sentence, u.description.src.url) }, t(".")]);
  }
  if (cpItems.length && cpBacker?.available) liqNotes.push([t("The revolver also "), { k: "label", t: "backs", stated: cpb!.value, src: src(cpb!.src.sentence, cpb!.src.url) }, t(" "), usdSeg(partOf(cpItems[0])), t(" of commercial paper outstanding. Commercial paper itself is not counted as liquidity.")]);
  const liqFigure: Segment | null = liqComputable && liqParts.length ? { k: "computed", t: displayUsd(liqUsd, false, dp(liqParts)), usd: liqUsd, parts: liqParts } : null;
  if (!liqFigure) liqNotes.unshift([t("No liquidity total: cash and every facility's availability are not all stated as of the position date.")]);

  // ── 2.5 the maturity chart ──
  type Contrib = { usd: number; color: PaletteColor; pattern?: "stripes"; title: string; parts: Part[]; rows?: string[] };
  const anchorSchedule = !rc.counts && scheduleByYear.size > 0;
  const isBond = (it: Item) => !!couponOf(it.name) || kindOf(it.name) === "bond";
  const contribOf = (it: Item): Contrib[] => {
    const base = colorOf(it);
    const ps = partOf(it);
    const face = sum(ps);
    const refi = refinancedOf(it);
    const out: Contrib[] = [];
    const rows = [it.rowLabel ?? it.name];
    if (inWindowItem(it) && face - refi > 0.5e6) out.push({ usd: face - refi, color: PALETTE.notRefinanced, title: `${it.name}, not yet refinanced`, parts: ps, rows });
    else if (face - refi > 0.5e6) out.push({ usd: face - refi, color: base, title: it.name, parts: ps, rows });
    if (refi > 0.5e6) out.push({ usd: refi, color: base, pattern: "stripes", title: `${it.name}, refinanced, redemption pending confirmation`, parts: [], rows });
    return out;
  };
  const dated = allDebtItems.filter((it) => it.maturity && !isCP(it));
  const lastYear = Math.max(Number(briefDate.slice(0, 4)), ...dated.map((it) => Number(it.maturity!.date.slice(0, 4))), ...(anchorSchedule ? [...scheduleByYear.keys()].map(Number) : []));
  type YearCol = { year: number; label?: string; items: Item[]; contribs: Contrib[]; totalParts: Part[]; source: "schedule" | "named"; carryingBonds: Item[] };
  const cols: YearCol[] = [];
  // v3.2 §2.5: where the anchor prints a schedule, its years are the bars, and
  // its amount after the last year column ("thereafter") is a final bar.
  const lastScheduleYear = anchorSchedule ? Math.max(...[...scheduleByYear.keys()].map(Number)) : null;
  const thereafter = anchorSchedule ? scheduleEntries.find((e) => /thereafter|after/i.test(e.period)) : undefined;
  const lastColYear = lastScheduleYear !== null && thereafter ? lastScheduleYear : lastYear;
  for (let y = Number(briefDate.slice(0, 4)); y <= lastColYear; y++) {
    const items = dated.filter((it) => it.maturity!.date.startsWith(String(y)));
    const sch = anchorSchedule ? scheduleByYear.get(String(y)) : undefined;
    const retired = retiredByYear.get(String(y)) ?? [];
    if (sch) {
      const bonds = items.filter((it) => isBond(it) && it.basis === "face");
      const carryingBonds = items.filter((it) => isBond(it) && it.basis === "carrying");
      const contribs = bonds.flatMap(contribOf);
      if (carryingBonds.length) contribs.push({ usd: Math.max(0, sch.part.usd - sum(retired) - contribs.reduce((a, c) => a + c.usd, 0)), color: colorOf(carryingBonds[0]), title: `${carryingBonds.map((x) => x.name).join(", ")}: face only in the filer's schedule`, parts: [sch.part], rows: carryingBonds.map((x) => x.rowLabel ?? x.name) });
      else {
        const rest = sch.part.usd - sum(retired) - contribs.reduce((a, c) => a + c.usd, 0);
        if (rest > 0.5e6) contribs.push({ usd: rest, color: PALETTE.scheduledOther, title: "scheduled other principal", parts: [] });
      }
      cols.push({ year: y, items, contribs, totalParts: [sch.part, ...retired.map((p) => ({ ...p, usd: -p.usd }))], source: "schedule", carryingBonds });
    } else {
      cols.push({ year: y, items, contribs: items.flatMap(contribOf), totalParts: items.flatMap(partOf), source: "named", carryingBonds: [] });
    }
  }
  if (lastScheduleYear !== null && thereafter) {
    const items = dated.filter((it) => Number(it.maturity!.date.slice(0, 4)) > lastScheduleYear);
    const bonds = items.filter((it) => isBond(it) && it.basis === "face");
    const carryingBonds = items.filter((it) => isBond(it) && it.basis === "carrying");
    const contribs = bonds.flatMap(contribOf);
    const rest = thereafter.part.usd - contribs.reduce((a, c) => a + c.usd, 0);
    if (carryingBonds.length && rest > 0.5e6) contribs.push({ usd: rest, color: colorOf(carryingBonds[0]), title: `${carryingBonds.map((x) => x.name).join(", ")}: face only in the filer's schedule`, parts: [thereafter.part], rows: carryingBonds.map((x) => x.rowLabel ?? x.name) });
    else if (rest > 0.5e6) contribs.push({ usd: rest, color: PALETTE.scheduledOther, title: "scheduled other principal", parts: [] });
    cols.push({ year: lastScheduleYear + 1, label: `${lastScheduleYear + 1}+`, items, contribs, totalParts: [thereafter.part], source: "schedule", carryingBonds });
  }
  let shown = cols;
  if (shown.length > 10) shown = shown.filter((c) => c.contribs.length > 0 || c.totalParts.some((p) => p.usd));
  const bars: ChartBar[] = [];
  for (const cp of cpItems) bars.push({ label: "CP", total: usdSeg(partOf(cp), { bare: true }), segments: [{ usd: faceUsdOf(cp), color: colorOf(cp), title: "commercial paper outstanding" }], source: "cp", broken: false, drawUsd: faceUsdOf(cp), instruments: 1 });
  const merge = (cs: Contrib[]): BarSegment[] => {
    const out: BarSegment[] = [];
    for (const c of cs) {
      const prev = out.find((o) => o.color === c.color && o.pattern === c.pattern);
      if (prev) { prev.usd += c.usd; prev.rows = [...(prev.rows ?? []), ...(c.rows ?? [])]; } else out.push({ usd: c.usd, color: c.color, ...(c.pattern ? { pattern: c.pattern } : {}), title: c.title, rows: [...(c.rows ?? [])] });
    }
    // Bottom to top: not yet refinanced, then the seniority shades, then stripes, then scheduled other.
    const rank = (s: BarSegment) => (s.color === PALETTE.notRefinanced ? 0 : s.color === PALETTE.scheduledOther ? 3 : s.pattern ? 2 : 1);
    return out.sort((a, b) => rank(a) - rank(b));
  };
  const head = shown.length > 10 ? shown.slice(0, 9) : shown;
  const tail = shown.length > 10 ? shown.slice(9) : [];
  for (const c of head) bars.push({ label: c.label ?? String(c.year), total: usdSeg(c.totalParts, { bare: true }), segments: merge(c.contribs), source: c.source, broken: false, drawUsd: sum(c.totalParts), instruments: c.items.length });
  if (tail.length) {
    const ps = tail.flatMap((c) => c.totalParts);
    bars.push({ label: `${tail[0].year}–${String(tail[tail.length - 1].year).slice(2)}`, total: usdSeg(ps, { bare: true }), segments: merge(tail.flatMap((c) => c.contribs)), source: tail.every((c) => c.source === "schedule") ? "schedule" : "named", broken: false, drawUsd: sum(ps), instruments: tail.reduce((a, c) => a + c.items.length, 0) });
  }
  const heights = bars.map((b) => b.drawUsd).sort((a, b) => b - a);
  const captions: Line[] = [];
  if (heights.length > 1 && heights[0] > 2 * heights[1]) {
    const big = bars.find((b) => b.drawUsd === heights[0])!;
    const second = bars.find((b) => b.drawUsd === heights[1])!;
    big.broken = true;
    big.drawUsd = heights[1] * 1.15;
    captions.push([t(`The ${big.label} bar${big.instruments > 1 ? ` holds ${big.instruments} instruments and` : ""} is cut to fit; its full height would be about ${(heights[0] / heights[1]).toFixed(1)} times the ${second.label} bar.`)]);
  }
  const wy = Number(windowEnd.slice(0, 4));
  let endIndex = bars.findIndex((b) => b.label === String(wy));
  let endFraction = (Number(windowEnd.slice(5, 7)) - 1 + Number(windowEnd.slice(8, 10)) / 31) / 12;
  if (endIndex < 0) { endIndex = bars.findIndex((b) => /^\d{4}$/.test(b.label) && Number(b.label) > wy); endFraction = 0; if (endIndex < 0) { endIndex = bars.length - 1; endFraction = 1; } }
  const usedColors = new Set(bars.flatMap((b) => b.segments.map((s) => `${s.color}${s.pattern ? "|stripes" : ""}`)));
  const LEGEND: [string, CardV3["chart"]["legend"][number]][] = [
    [PALETTE.seniorSecured, { color: PALETTE.seniorSecured, label: "Secured" }],
    [PALETTE.juniorSecured, { color: PALETTE.juniorSecured, label: "Junior-priority secured" }],
    [PALETTE.unsecured, { color: PALETTE.unsecured, label: "Unsecured" }],
    [PALETTE.notStated, { color: PALETTE.notStated, label: "Seniority not stated" }],
    [PALETTE.scheduledOther, { color: PALETTE.scheduledOther, label: "Scheduled other" }],
  ];
  const chartLegend: CardV3["chart"]["legend"] = LEGEND.filter(([c]) => usedColors.has(c)).map(([, e]) => e);
  const striped = [...usedColors].filter((k) => k.endsWith("|stripes"));
  if (striped.length) chartLegend.push({ color: striped[0].split("|")[0] as PaletteColor, pattern: "stripes", label: "Refinanced, redemption pending confirmation" });
  if (usedColors.has(PALETTE.notRefinanced)) chartLegend.push({ color: PALETTE.notRefinanced, label: "Due in window, not yet refinanced" });
  const enc: string[] = ["Color shows seniority."];
  if (striped.length) enc.push("Stripes show debt refinanced with new notes, whose redemption a filing has yet to confirm.");
  if (usedColors.has(PALETTE.notRefinanced)) enc.push("Orange shows debt due inside the window that is not yet refinanced.");
  if (usedColors.has(PALETTE.scheduledOther)) enc.push(anchorSchedule ? "Where the filer prints a maturity schedule, each bar is the schedule's figure for its year: notes at full face, and term loans, leases and other amortizing debt in the scheduled other principal." : "");
  captions.unshift([t(enc.filter(Boolean).join(" "))]);
  // v3.2 §2.5: EVERY DOLLAR OF FACE IN ONE PLACE. Where the schedule places
  // all face year by year (it totals the face total), an item with no single
  // maturity is already inside the bars' scheduled other principal: the
  // caption says so, and lists nothing as not shown. Otherwise the face items
  // are listed as not shown. Carrying-only items are listed apart, never in
  // that equation.
  const undated = allDebtItems.filter((it) => !it.maturity && !isCP(it));
  const scheduleTotal = anchorSchedule ? sum(scheduleEntries.map((e) => e.part)) : null;
  const scheduleTies = scheduleTotal !== null && Math.abs(scheduleTotal - faceTotal) < 0.5e6;
  const itemList = (its: Item[]): Line => its.flatMap((it, n) => [...(n ? [t("; ")] : []), usdSeg(partOf(it)), t(" "), ...instrumentWords(it).filter((x) => !(x.k === "text" && /carrying value/.test(x.t))), ...(it.range ? [t(`, ${it.range.from} to ${it.range.to}`)] : [])]);
  if (undated.length && scheduleTies) captions.push([t("The principal of "), ...itemList(undated), t(" is included in scheduled other principal.")]);
  else if (undated.length) {
    const face = undated.filter((it) => it.basis === "face"), carrying = undated.filter((it) => it.basis === "carrying");
    if (face.length) captions.push([t("Not shown on the chart, with no single maturity: "), ...itemList(face), t(".")]);
    if (carrying.length) captions.push([t("At carrying value, not counted in the chart: "), ...itemList(carrying), t(".")]);
  }
  const carryingYears = cols.filter((c) => c.carryingBonds.length);
  if (carryingYears.length) captions.push([t(`The ${carryingYears.map((c) => c.label ?? c.year).join(" and ")} bar${carryingYears.length === 1 ? "" : "s"} show the filer's schedule total; the ${carryingYears.flatMap((c) => c.carryingBonds).map((it) => `${couponOf(it.name)?.shown ?? ""} ${it.labels.type.t}`.trim()).join(" and ")} in ${carryingYears.length === 1 ? "it are" : "them are"} stated only at carrying value.`)]);
  const greyShare = bars.reduce((a, b) => a + b.segments.filter((s) => s.color === PALETTE.notStated).reduce((x, s) => x + s.usd, 0), 0) / Math.max(1, bars.reduce((a, b) => a + b.segments.reduce((x, s) => x + s.usd, 0), 0));
  const notStatedRows = allDebtItems.filter((it) => notStatedPhrase(it));
  const mostlyNotStated = notStatedRows.length > allDebtItems.length / 2;
  if (greyShare > 0.5 || mostlyNotStated) captions.push([{ k: "notStated", t: `This company's filings state seniority or security for few of these instruments, so most ${greyShare > 0.5 ? "bars are grey" : "rows carry no label"}.`, src: notStatedRows[0]?.amountSrc ?? anchorSrc(anchor.form) }]);

  // ── 2.6 the table ──
  const tableItems = [...cpItems, ...allDebtItems.filter((it) => it.maturity && !isCP(it)).sort((a, b) => a.maturity!.date.localeCompare(b.maturity!.date)), ...allDebtItems.filter((it) => !it.maturity && !isCP(it)).sort((a, b) => (a.range ? 0 : 1) - (b.range ? 0 : 1))];
  const tableRows: CardV3["table"]["rows"] = tableItems.map((it) => {
    const st = statusOf(it);
    const ns = !st && !mostlyNotStated ? notStatedPhrase(it) : null;
    return {
      matures: isCP(it) ? [t("Short-term")] : it.maturity ? [{ k: "date", t: whenOf(it.maturity), date: it.maturity.date, granularity: it.maturity.granularity, src: it.maturity.src }] : it.range ? [{ k: "label", t: `${it.range.from}–${it.range.to}`, stated: it.range.stated, src: it.range.src }] : [t("Various")],
      instrument: instrumentWords(it),
      tenK: it.rolled,
      face: usdSeg(partOf(it), { bare: true }),
      status: st ?? (ns ? { text: [{ k: "notStated", t: ns, src: it.amountSrc }], tone: "neutral" } : null),
      inWindow: inWindowItem(it) || isCP(it),
      name: it.rowLabel ?? it.name,
    };
  });
  const lastWindow = tableRows.reduce((a, r, n) => (r.inWindow ? n : a), -1);
  // v3.1: the table is cut only above 12 rows.
  const visible = tableRows.length > 12 ? Math.max(8, lastWindow + 1) : tableRows.length;

  // ── 2.7 facilities, 2.8 not shown, 2.9 footnote ──
  const facLines: CardV3["facilities"] = [];
  for (const f of facilities) {
    const own = src(f.facilitySize?.sourceLine ?? f.name, f.figureSources?.facilitySize ?? f.citedUrl);
    const fig = (field: "facilitySize" | "drawn" | "lettersOfCredit" | "available", word: string): Line => { const v = f[field]; return v ? [{ k: "figure", t: displayAmount(v.value, v.sourceLine), printed: v.value, src: src(v.sourceLine, f.figureSources?.[field] ?? f.citedUrl), field }, t(` ${word}`)] : []; };
    const kind = kindOfFacility(f);
    const type = typeLabel({ instrument: f.name, classification: classifyInstrument({ headings: [], instrumentName: f.name }) }, own);
    const labels = classLabels(f.name, own, null);
    const nameLine: Line = [...[labels.seniority, labels.security].filter((x): x is Segment => !!x).flatMap((l) => [l, t(" ")]), kind === "cp" ? t("commercial paper program") : kind === "lc" ? t("letter of credit facility") : type];
    const facts: Line[] = [];
    const m = facilityMaturityAtItsSentence(f);
    if (kind === "cp") {
      if (cpFacts?.programSize && permitted(cpFacts.programSize.src.url)) facts.push([factFig(cpFacts.programSize), t(" size")]); else if (f.facilitySize) facts.push(fig("facilitySize", "size"));
      if (cpFacts?.outstanding && permitted(cpFacts.outstanding.src.url)) facts.push([factFig(cpFacts.outstanding), t(" outstanding")]); else if (f.drawn) facts.push(fig("drawn", "outstanding"));
      if (cpFacts?.averageRate && permitted(cpFacts.averageRate.src.url)) facts.push([{ k: "label", t: `${cpFacts.averageRate.value.replace(/\s+%/, "%")} average rate`, stated: cpFacts.averageRate.value, src: src(cpFacts.averageRate.src.sentence, cpFacts.averageRate.src.url) }]);
    } else if (kind === "lc") {
      if (f.lettersOfCredit) facts.push(fig("lettersOfCredit", "letters of credit outstanding"));
      facts.push(f.facilitySize ? fig("facilitySize", "size") : [{ k: "notStated", t: "facility size not stated", src: own }]);
    } else {
      for (const [field, word] of [["facilitySize", "size"], ["drawn", "drawn"], ["lettersOfCredit", "letters of credit"]] as const) if (f[field]) facts.push(fig(field, word));
      if (m.kind === "dated") facts.push([t("matures "), { k: "date", t: displayDate(m.date, m.granularity), date: m.date, granularity: m.granularity, src: src(m.sentence, f.figureSources?.maturity ?? f.citedUrl) }]);
    }
    const bold: Line = [...nameLine];
    for (const fl of facts) bold.push(t(" · "), ...fl);
    const sub: Line = [];
    for (const sf of subsFor.get(f) ?? []) { const note = directedNote(sf.amount.src.url); sub.push(...(sub.length ? [t(" ")] : []), t(`${SUB_NAME[sf.kind] ?? `${sf.kind} sub-facility`} `), factFig(sf.amount), t(`, capacity only${note ? `, ${note}` : ""}.`)); }
    if (kind === "facility" && !f.lettersOfCredit) sub.push(...(sub.length ? [t(" ")] : []), { k: "notStated", t: "Letters of credit outstanding not stated.", src: own });
    if (kind === "facility" && !f.available) sub.push(...(sub.length ? [t(" ")] : []), { k: "notStated", t: "Availability not stated.", src: own });
    const bb = borrowingBaseOf(f);
    if (bb) sub.push(...(sub.length ? [t(" ")] : []), { k: "label", t: "Borrowing-base limited", stated: bb.limitedBy, src: src(widen(bb.statement, [f.facilitySize, f.drawn, f.lettersOfCredit, f.available, f.maturity].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.sourceLine)), f.figureSources?.facilitySize ?? f.citedUrl) }, t("; stated availability shown."));
    facLines.push({ bold, sub: sub.length ? sub : null });
  }
  for (const sf of orphanSubs) facLines.push({ bold: [t(`Sub-facility of the ${sf.facility}`)], sub: [subLine(sf)].flat() });
  const notShown = withheld.filter((l) => !/^Nothing withheld/.test(l.map((x) => x.t).join("")));
  const footnote: Line = [...(coverageLines[0] ?? []), t(" Every figure links to the sentence it came from.")];

  const v3: CardV3 = {
    header: v3header,
    rolledNote,
    call: { label: `The call · next 18 months, to ${shortDate(windowEnd)}`, case: callCase, headline, tiles, nextTile, rows: callRows, notes: callNotes, legend: daggerUsed ? `${MARK} Year only stated; may fall inside the window.` : null },
    moves: moveCards,
    totalDebt: { figure: faceSeg(), segments: tdSegments, legend: tdLegend, notes: tdNotes },
    liquidity: { figure: liqFigure, segments: liqSegments, legend: liqLegend, notes: liqNotes },
    chart: { bars, window: { endIndex, endFraction, label: `18-month window${callCase === "D" ? " · nothing due" : ""}` }, legend: chartLegend, captions },
    table: { rows: tableRows, visible, schedule: anchorSchedule ? ladderBlocks : null },
    facilities: facLines,
    notShown: notShown.length ? notShown : [[t("Nothing withheld this week.")]],
    footnote,
  };

  return {
    cik: result.cik,
    company: result.company,
    briefDate,
    weekFrom,
    weekTo: briefDate,
    previousBrief: i.previousBrief,
    header,
    thisWeek: { heading: "This week", lines: thisWeekLines },
    moves,
    headlines: {
      totalDebt,
      liquidity: { heading: "Liquidity", lines: liqLines },
      refi: { heading: `Potential refinance opportunities (to ${shortDate(windowEnd)})`, lines: refi },
    },
    ladder: { heading: "Maturity ladder", lines: ladderLines, blocks: ladderBlocks },
    facilities: { heading: "Facilities", lines: facBlocks.length ? [] : [[t("No facility stated.")]], blocks: facBlocks },
    withheld: { heading: "What the tool did not show", lines: withheld },
    coverage: { heading: "Coverage", lines: coverageLines },
    v3,
  };
}

/** The finest $MM precision any part carries (§3.3: never rounded beyond the source). */
function dp(parts: { printed: string }[]): number {
  return parts.reduce((d, p) => Math.max(d, mmDecimals(p.printed)), 0);
}

function sum(parts: { usd: number }[]): number {
  return parts.reduce((a, p) => a + p.usd, 0);
}

function isoOf(v: { year: number; month: number | null; day: number | null }): string {
  if (v.month === null) return String(v.year);
  return `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day ?? 1).padStart(2, "0")}`;
}

/** The first and last day a date at this precision could be. */
function spanOf(date: string, g: DateGranularity): [string, string] {
  const y = date.slice(0, 4);
  if (g === "year") return [`${y}-01-01`, `${y}-12-31`];
  if (g === "month") {
    const m = Number(date.slice(5, 7));
    const last = new Date(Date.UTC(Number(y), m, 0)).getUTCDate();
    return [`${date.slice(0, 7)}-01`, `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`];
  }
  return [date, date];
}

/** "as of 2025-12-31, per 10-K debt note, rolled to 2026-06-30" → "Using the Dec 31, 2025 10-K, updated through June 30, 2026." */
function rolledFootnote(label: string): string {
  const m = /as of (\d{4}-\d{2}-\d{2}), per (\S+)/.exec(label);
  const to = /rolled to (\d{4}-\d{2}-\d{2})/.exec(label);
  return m && to ? `Using the ${shortDate(m[1])} ${m[2]}, updated through ${displayDate(to[1], "day")}.` : `Using the rolled position: ${label}.`;
}

/** "as of 2025-12-31, per 10-K debt note, rolled to 2026-06-30" → "Dec 31, 2025". */
function rolledFrom(label: string): string {
  const m = /as of (\d{4}-\d{2}-\d{2})/.exec(label);
  return m ? shortDate(m[1]) : "the earlier";
}
/** "This list comes from the Dec 31, 2025 10-K, updated for changes through June 30, 2026." (card_spec §2.1) */
function rolledSentence(label: string): string {
  const to = /rolled to (\d{4}-\d{2}-\d{2})/.exec(label);
  return `This list comes from the ${rolledFrom(label)} 10-K, updated for changes through ${to ? displayDate(to[1], "day") : "the position date"}.`;
}
/** "using the Dec 31, 2025 10-K, updated through June 30, 2026" */
function rolledPhrase(label: string): string {
  const to = /rolled to (\d{4}-\d{2}-\d{2})/.exec(label);
  return `using the ${rolledFrom(label)} 10-K, updated through ${to ? displayDate(to[1], "day") : "the position date"}`;
}

/** "2026-05-01" → "May 2026". */
function monthYear(iso: string): string {
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** No stray space inside a coupon in running text (§3.7): "1.250 % senior notes" → "1.250% senior notes". */
function tidyCoupon(s: string): string {
  return s.replace(/(\d)[\s ]+(?=[⅛¼⅜½⅝¾⅞]?%)/g, "$1").replace(/([⅛¼⅜½⅝¾⅞])[\s ]+%/g, "$1%");
}

/** A coupon as the filer printed it, and as the card shows it: no stray spaces ("5.125 %" → "5.125%", "10 ⅞%" → "10⅞%"). */
function couponOf(name: string): { printed: string; shown: string } | null {
  const m = /\b\d{1,2}(?:\.\d+|\s*[⅛¼⅜½⅝¾⅞])?\s?%/.exec(name);
  return m ? { printed: m[0], shown: m[0].replace(/[\s\u00a0]+/g, "") } : null;
}

/**
 * Two statements of one instrument? Rate and maturity must both be stated and
 * agree (maturity at compatible precision); with `face`, the stated face must
 * agree by value too. Rule 49's identity, applied across two sources.
 */
function sameInstrument(a: string, b: string, opts: { face: boolean }): boolean {
  const ta = extractFactTokens(a), tb = extractFactTokens(b);
  const rate = (ts: typeof ta) => ts.filter((x) => x.kind === "percent");
  const dates = (ts: typeof ta) => ts.filter((x) => x.kind === "date" && x.dateValue && x.dateValue.year > 2000);
  const ra = rate(ta), rb = rate(tb);
  if (ra.length === 0 || rb.length === 0 || !ra.some((x) => rb.some((y) => factTokensMatch(x, y)))) return false;
  const da = dates(ta), db = dates(tb);
  if (da.length === 0 || db.length === 0 || !da.some((x) => db.some((y) => factTokensMatch(x, y)))) return false;
  if (!opts.face) return true;
  const faceOf = (s: string) => parseMoneyAmount((/\$\s*[\d,]+(?:\.\d+)?\s*(?:million|billion|thousand)?/i.exec(s) ?? [""])[0]);
  const fa = faceOf(a), fb = faceOf(b);
  return fa !== null && fb !== null && Math.abs(fa - fb) < 1;
}

/** The money token in `sentence` stating `usd`, exactly as printed — so a part is checked in the sentence's own words. */
function printedIn(sentence: string, usd: number): string | null {
  const tok = extractFactTokens(sentence).find((x) => x.kind === "money" && x.moneyValue !== undefined && Math.abs(x.moneyValue - usd) < 1);
  return tok ? tok.raw : null;
}

/** The shortest sentence in `text` containing `phrase`, typography-insensitive. */
function findSentenceWith(text: string | undefined, phrase: string): string | null {
  if (!text || !phrase) return null;
  const hits = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"])/).filter((s) => s.length < 900 && containsWord(s, phrase));
  return hits.sort((a, b) => a.length - b.length)[0] ?? null;
}

/** A fragment shown as the shortest of the facility's own sentences that contains it (card_spec 2.5). */
function widen(fragment: string, sentences: string[]): string {
  const containing = sentences.filter((s) => containsWord(s, fragment)).sort((a, b) => a.length - b.length);
  return containing[0] ?? fragment;
}

/** EDGAR names some forms by number alone ("4", "144"); a reader sees "Form 4". */
/** What a form or an 8-K item is, in plain words, for the "everything else" line (§2.2). */
const FORM_WHAT: Record<string, string> = { "4": "insider trades", "3": "insider holdings", "144": "planned insider sales", "SC 13G": "ownership", "SC 13G/A": "ownership", "S-8": "employee share plans", "DEF 14A": "proxy statement" };
const ITEM_WHAT: Record<string, string> = { "2.02": "results", "5.02": "officer or director change", "5.07": "shareholder vote", "7.01": "Regulation FD disclosure", "8.01": "other events", "9.01": "exhibits" };

function formName(form: string): string {
  return /^\d/.test(form) ? `Form ${form}` : form;
}

/** A facility-kind row (revolver, term loan, delayed draw, credit facility). */
function isFacilityType(row: LadderRow): boolean {
  return ["revolver", "credit-facility", "term-loan", "term-loan-a", "term-loan-b", "delayed-draw"].includes(row.classification.instrumentType ?? "");
}
