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

import type { Card, CardFacts, CardSection, Line, Segment, Source } from "./types";
import { classLabels, couponsIn, headingClass, notStatedSuffix, sentenceClass, statementReaches, typeLabel, containsWord } from "./labels";
import { amountSupportOf, sentenceSupportsMaturity } from "../events/position";
import { headingFor as printedHeadingFor, printedBefore, printedHeadings } from "./headings";
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
  const describe = (it: Item, opts: { withDate?: boolean; flags?: string[] } = {}): Line => {
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
    const suffix = notStatedSuffix(it.labels.seniority, it.labels.security);
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
      extra: [],
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
    r.funding = [t("funded by the "), { k: "label", t: by.instSeg.t, stated: by.instSeg.k === "label" ? by.instSeg.stated : by.instrument, src: by.instSeg.k === "label" ? by.instSeg.src : spendSrc }, t(` issued ${by.when}`), ...(/cash on hand/i.test(spend) ? [t(", together with cash on hand")] : []), t(" ("), { k: "label", t: "use of proceeds", stated: "net proceeds", src: spendSrc }, t(")")];
    if (!by.use.length) by.use = [t("used to "), { k: "label", t: `${r.type === "paydown" ? "repay" : "retire"} the ${tidyCoupon(r.instrument)}`, stated: r.instrument, src: src(r.sentence, r.url) }];
  }
  for (const is of movesAll.filter((m) => m.type === "issuance" && !m.use.length)) {
    if (movesAll.filter((m) => m.type === "issuance" && m.url === is.url).length !== 1) continue;
    const uses = sentencesOf(is.url).map((x) => ({ x, m: /\bused? the net proceeds\b.*?\bto\s+(.+?)\.?$/i.exec(x.sentence) })).filter((u) => u.m);
    if (uses.length === 1) is.use = [t("used to "), { k: "label", t: uses[0].m![1], stated: uses[0].m![1], src: uses[0].x }];
  }
  // An issuance announced before it closed: the announcing sentences in later filings, linked on the same line.
  for (const is of movesAll.filter((m) => m.type === "issuance" && !m.inPeriod)) {
    const year = (/\b(20\d\d)\b/.exec(is.instrument) ?? [])[1];
    for (const u of (i.laterUrls ?? []).filter((x) => x !== is.url && i.textByUrl.has(x))) {
      for (const sx of sentencesOf(u)) {
        if (!/\b(?:pricing|offering|upsize)\b/i.test(sx.sentence) || !year || !new RegExp(`notes due ${year}`, "i").test(sx.sentence)) continue;
        const named = couponsIn(sx.sentence).length ? sameNote(sx.sentence, is.instrument) : movesAll.filter((m) => m.type === "issuance" && (/\b(20\d\d)\b/.exec(m.instrument) ?? [])[1] === year).length === 1;
        const when = isoOfText(sx.sentence);
        if (!named || !when) continue;
        const what = /pricing/i.test(sx.sentence) ? "priced" : "offering launched";
        is.extra.push(t(`; ${what} `), { k: "label", t: displayDate(when.iso, when.g), stated: (new RegExp(`(${MONTHS})(?:\\s+\\d{1,2},)?\\s+20\\d\\d`).exec(sx.sentence) ?? [""])[0], src: sx });
      }
    }
  }
  // An add-on: the further-issuance sentence and the price, from the same filing.
  for (const is of movesAll.filter((m) => m.type === "issuance")) {
    for (const sx of sentencesOf(is.url)) {
      if (sx.sentence === is.sentence || !sameNote(sx.sentence, is.instrument) && !/additional notes/i.test(sx.sentence)) continue;
      if (/further issuance/i.test(sx.sentence)) is.extra.push(t("; a "), { k: "label", t: "further issuance", stated: "further issuance", src: sx }, t(" of the existing notes"));
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
      faceUsd: e.effect !== null ? Math.abs(e.effect) : null, sentence: e.sourceLine, url: e.citedUrl, funding: [], use: [], price: null, extra: [],
    });
  }
  for (const w of pos.withinPeriodRepayments) {
    if (movesAll.some((m) => sameNote(m.instrument, w.instrument) || containsWord(m.instrument, w.instrument))) continue;
    const s0 = src(w.sourceLine, w.citedUrl);
    movesAll.push({
      when: "during the period", sort: periodEnd, type: "paydown", status: "completed", inPeriod: true,
      dateSeg: t("During the period"), instrument: w.instrument, instSeg: { k: "label", t: tidyCoupon(w.instrument), stated: w.instrument, src: s0 },
      face: { k: "figure", t: displayAmount(w.priorAmount, w.sourceLine), printed: w.priorAmount, src: s0 }, faceUsd: parseMoneyAmount(w.priorAmount),
      sentence: w.sourceLine, url: w.citedUrl, funding: [], use: [], price: null, extra: [t(" (the prior balance; repaid inside the period)")],
    });
  }
  for (const m of movesAll) {
    const dateText = m.dateSeg.k === "label" ? m.dateSeg.stated : null;
    if (!dateText || !couponsIn(m.instrument).length) continue;
    const seen = new Set([m.sentence, m.dateSeg.k === "label" ? m.dateSeg.src.sentence : ""].map(normQ));
    const again = moveDocs().flatMap(sentencesOf).filter((x) => !seen.has(normQ(x.sentence)) && containsWord(x.sentence, dateText) && sameNote(x.sentence, m.instrument) && !movesAll.some((o) => o !== m && sameNote(x.sentence, o.instrument) && o.when === m.when && o.type !== m.type));
    if (again.length) m.extra.push(t(" ("), { k: "label", t: "also stated here", stated: dateText, src: again[0] }, t(")"));
  }
  const moveLine = (m: Move): Line => {
    const [done, pending] = TYPE_WORD[m.type] ?? [m.type.charAt(0).toUpperCase() + m.type.slice(1), `${m.type} announced`];
    const line: Line = [m.dateSeg, t(`: ${m.status === "pending" ? pending : done} `)];
    if (m.face) line.push(m.face, t(" "));
    line.push(m.instSeg);
    for (const part of [m.funding, m.use]) if (part.length) line.push(t(", "), ...part);
    if (m.price) line.push(t(", "), m.price);
    line.push(...m.extra);
    if (m.status === "pending") line.push(t(" · pending, not yet confirmed by a filing"));
    return line;
  };
  const newestFirst = (a: Move, b: Move) => b.sort.localeCompare(a.sort);
  const since = movesAll.filter((m) => !m.inPeriod).sort(newestFirst);
  const during = movesAll.filter((m) => m.inPeriod).sort(newestFirst);
  const moves: CardSection = {
    heading: "Recent debt moves",
    lines: movesAll.length ? [] : [[t(`No debt moves stated between ${shortDate(fyStart)} and ${shortDate(briefDate)}.`)]],
    blocks: [
      ...(since.length ? [{ heading: [t(`Since ${displayDate(periodEnd, "day")}: not yet in the position totals`)] as Line, lines: since.map(moveLine) }] : []),
      ...(during.length ? [{ heading: [t(`During the period, ${shortDate(fyStart)} to ${shortDate(periodEnd)}: already in the position`)] as Line, lines: during.map(moveLine) }] : []),
    ],
  };
  // ON THE INSTRUMENT'S OWN LINE: what a move did to it. A carrying-value line
  // whose retirement sentence states the outstanding principal before it
  // ("$400 million … of the $800 million in outstanding principal amount")
  // shows its remaining face, computed from both.
  for (const it of allDebtItems) {
    for (const m of movesAll.filter((x) => RETIRES.has(x.type) && sameNote(x.instrument, it.name) && (!it.maturity || !/\b20\d\d\b/.test(x.instrument) || x.instrument.includes(it.maturity.date.slice(0, 4))))) {
      const verb = (TYPE_WORD[m.type]?.[0] ?? m.type).toLowerCase();
      if (m.status === "pending") { it.moveFlags = [...(it.moveFlags ?? []), t(" · "), ...(m.face ? [m.face, t(" ")] : []), { k: "label", t: "pending redemption", stated: m.instrument, src: m.instSeg.k === "label" ? m.instSeg.src : src(m.sentence, m.url) }, t(", not yet confirmed by a filing")]; continue; }
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
  const groups = new Map<string, { labels: Segment[]; basis: Item["basis"]; parts: Part[]; hedged: boolean }>();
  for (const it of allDebtItems) {
    const labels = [it.labels.seniority, it.labels.security, it.labels.type].filter((x): x is Segment => !!x);
    const key = `${it.basis} ${labels.map((l) => l.t).join(" ")}`;
    const g = groups.get(key) ?? { labels, basis: it.basis, parts: [], hedged: false };
    for (const p of partOf(it)) {
      g.parts.push(p);
      g.hedged = g.hedged || hedgedIn(p.src.sentence, p.printed);
    }
    groups.set(key, g);
  }
  const faceGroups = [...groups.values()].filter((g) => g.basis === "face");
  const carryingGroups = [...groups.values()].filter((g) => g.basis === "carrying");
  const faceParts = faceGroups.flatMap((g) => g.parts);
  const carryingParts = carryingGroups.flatMap((g) => g.parts);
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
  const faceHedged = !faceFromSchedule && faceGroups.some((g) => g.hedged);
  const faceSeg = (decimals = dp(faceTotalParts)): Segment => ({ k: "computed", t: displayUsd(faceTotal, faceHedged, decimals), usd: faceTotal, parts: faceTotalParts });
  const carryingSeg: Segment | null = carryingBeside.length
    ? { k: "computed", t: displayUsd(sum(carryingBeside), carryingGroups.some((g) => g.hedged), dp(carryingBeside)), usd: sum(carryingBeside), parts: carryingBeside }
    : null;
  const totalLine: Line = [t("Total debt "), faceSeg(), t(" at face")];
  if (faceFromSchedule) totalLine.push(t(", per the filer's maturity schedule"));
  if (carryingSeg) totalLine.push(t(", plus "), carryingSeg, t(" stated only at carrying value"));
  totalLine.push(t(" as of "), periodDate(), t(rc.counts ? `, ${rolledPhrase(rolledLabel!)}` : ""));
  const totalDebt: CardSection = {
    heading: "Total debt",
    lines: [
      totalLine,
      ...[...groups.values()]
        .sort((a, b) => (a.basis === b.basis ? sum(b.parts) - sum(a.parts) : a.basis === "face" ? -1 : 1))
        .map((g): Line => {
          const line: Line = [];
          g.labels.forEach((l, n) => line.push(...(n ? [t(" ")] : []), l));
          line.push(t(" "), { k: "computed", t: displayUsd(sum(g.parts), g.hedged, dp(g.parts)), usd: sum(g.parts), parts: g.parts });
          if (g.basis === "carrying") line.push(t(" (carrying value)"));
          return line;
        }),
      // Where the face total and the lines shown are on different bases, the card says so, with the difference.
      ...(faceFromSchedule
        ? (() => {
            const lineParts = [...groups.values()].flatMap((g) => g.parts);
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
  const ladderBlocks = years.map((y) => {
    const items = byYear.get(y) ?? [];
    const lines: Line[] = items.map((it) => describe(it));
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

  // ── 2.4 potential refinance opportunities: the next 18 months from the brief date ──
  const windowEnd = addMonths(briefDate, 18);
  const refiLines: { sort: string; line: Line }[] = [];
  const MAYBE = "may fall within 18 months, see source";
  for (const it of [...anchorItems, ...rolledItems]) {
    if (it.maturity) {
      const m = it.maturity;
      const [start, end] = spanOf(m.date, m.granularity);
      if (end <= briefDate && start > periodEnd && !it.isCapacity) {
        refiLines.push({ sort: start, line: describe(it, { flags: ["matured since the position date, repayment not yet confirmed in a filing"] }) });
        continue;
      }
      if (end <= briefDate || start > windowEnd) continue;
      const partial = (start <= briefDate || end > windowEnd) && m.granularity !== "day";
      refiLines.push({ sort: start, line: describe(it, { flags: partial ? [`${m.granularity} only stated, ${MAYBE}`] : [] }) });
    } else if (it.range && it.range.from <= windowEnd.slice(0, 4) && it.range.to >= briefDate.slice(0, 4)) {
      refiLines.push({ sort: `${it.range.from}-01-01`, line: describe(it, { flags: [`matures over a range of years, part ${MAYBE}`] }) });
    }
  }
  // Scheduled principal from the filer's own schedule (§2.5) for each year bucket the window reaches. A bucket partly inside is flagged, never pro-rated.
  for (const [y, o] of otherScheduled) {
    const [start, end] = [`${y}-01-01`, `${y}-12-31`];
    if (end < briefDate || start > windowEnd) continue;
    const partial = start < briefDate || end > windowEnd;
    refiLines.push({ sort: start, line: [o.seg, t(` other scheduled principal, per the filer's schedule for ${o.period}`), ...(partial ? [t(` · year bucket partly inside the window, not pro-rated, ${MAYBE}`)] : [])] });
  }
  refiLines.sort((a, b) => a.sort.localeCompare(b.sort));
  const refi: Line[] = refiLines.map((d) => d.line);
  // A Next line always shows: the first maturity after the window.
  const after = allDebtItems
    .filter((it) => it.maturity && spanOf(it.maturity.date, it.maturity.granularity)[0] > windowEnd)
    .sort((a, b) => a.maturity!.date.localeCompare(b.maturity!.date))[0];
  if (refi.length === 0) refi.push([t("Nothing matures within 18 months."), ...(after ? [t(" Next: "), ...describe(after)] : [t(" No later maturity is stated.")])]);
  else refi.push(after ? [t(`Next, after ${shortDate(windowEnd)}: `), ...describe(after)] : [t(`Nothing stated matures after ${shortDate(windowEnd)}.`)]);
  if (!scheduleByYear.size && allDebtItems.some((it) => /term loan/i.test(it.labels.type.t))) refi.push([t("Scheduled term-loan amortization is not stated in a schedule, so only final maturities are counted here.")]);
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
  if (rolledLabel) ladderLines.push([t(`Lines marked "from the 10-K": ${rolledSentence(rolledLabel).replace(/^This list comes from/, "stated in")}`)]);
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
