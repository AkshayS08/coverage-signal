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
import { sentenceSupportsMaturity } from "../events/position";
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
  if (dm?.priorPeriodBase?.filingUrl) docs.set(dm.priorPeriodBase.filingUrl, `10-K for ${dm.priorPeriodBase.periodOfReport}`);
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
      else if (it.row?.facilityMaturityNote) out.push(t(", maturity stated as a relative term, not a date"));
      else out.push(t(", no maturity stated"));
    }
    if (it.isCapacity) out.push(t(" · undrawn commitment, not debt"));
    if (it.rolled && rolledLabel) out.push(t(" · from the 10-K"));
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
  if (rolledLabel) header.push([t(`This company's ${anchor.form} does not list its notes; it refers to its annual report. ${rolledSentence(rolledLabel)}`)]);

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
  if (other.length > 0) {
    const line: Line = [t(`${other.length} other filing${other.length === 1 ? "" : "s"} this week, none affecting debt: `)];
    other.forEach((f, n) => {
      const items = f.items.split(",").map((s) => s.trim()).filter(Boolean);
      if (n > 0) line.push(t(" "));
      line.push({ k: "filing", t: `[${formName(f.form)}${items.length ? `, Item${items.length > 1 ? "s" : ""} ${items.join(", ")}` : ""}]`, url: f.primaryDocUrl });
    });
    thisWeekLines.push(line);
  } else if (actionable.length > 0) thisWeekLines.push([t("No other filings this week.")]);

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
  const scheduleScale = (sentence: string) => (/in thousands/i.test(sentence) ? "thousand" : /in billions/i.test(sentence) ? "billion" : "million");
  const scheduleParts: Part[] = rc.counts
    ? []
    : (i.facts?.schedule ?? [])
        .filter((e) => e.amount.src.url === anchor.url)
        .map((e) => {
          const printed = `$ ${e.amount.value.replace(/[$\s]/g, "")} ${scheduleScale(e.amount.src.sentence)}`;
          return { printed, usd: parseMoneyAmount(printed) ?? 0, src: src(e.amount.src.sentence, e.amount.src.url) };
        });
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
    ],
  };

  // ── 2.3 liquidity ──
  const liqLines: Line[] = [];
  const liqParts: { printed: string; usd: number; src: Source }[] = [];
  let liqComputable = true;
  if (i.cash.usd !== null && i.cash.printedLine && i.cash.printed) {
    const printed = i.cash.printed;
    const s = anchorSrc(i.cash.printedLine);
    liqLines.push([t("Cash "), { k: "figure", t: displayAmount(printed, i.cash.printedLine), printed, src: s }, t(" as of "), periodDate()]);
    liqParts.push({ printed, usd: i.cash.usd, src: s });
  } else {
    liqComputable = false;
    liqLines.push([t(`Cash: not shown — ${i.cash.reason ?? "no printed line states the tagged figure"}.`)]);
  }
  for (const f of facilities) {
    const kind = classifyInstrument({ headings: [], instrumentName: f.name }).instrumentType;
    if (f.category === "commercial-paper" || kind === "commercial-paper") {
      liqLines.push([t(`${f.name}: not counted. Commercial paper is an issuance program, not a lender commitment.`)]);
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
  const liqUsd = liqParts.reduce((a, p) => a + p.usd, 0);
  liqLines.unshift(
    liqComputable && liqParts.length > 0
      ? [t("Liquidity "), { k: "computed", t: displayUsd(liqUsd, false, dp(liqParts)), usd: liqUsd, parts: liqParts }, t(" as of "), periodDate()]
      : [t("No liquidity total: cash and every facility's availability are not all stated as of the position date.")]
  );
  if (liqComputable && liqParts.length > 0) liqLines.splice(1, 0, [t("Cash plus stated availability, both stated as of the position date.")]);

  // ── 2.3 due in 24 months, from the brief date ──
  const windowEnd = addMonths(briefDate, 24);
  const dueLines: { sort: string; line: Line }[] = [];
  const candidates = [...anchorItems, ...rolledItems].filter((it) => it.maturity);
  for (const it of candidates) {
    const m = it.maturity!;
    const [start, end] = spanOf(m.date, m.granularity);
    if (end <= briefDate && start > periodEnd && !it.isCapacity) {
      dueLines.push({ sort: start, line: describe(it, { flags: ["matured since the position date, repayment not yet confirmed in a filing"] }) });
      continue;
    }
    if (end <= briefDate || start > windowEnd) continue;
    const partial = start <= briefDate || end > windowEnd;
    const flag = partial && m.granularity !== "day" ? ` · ${m.granularity === "year" ? "year" : "month"} only stated, may fall within 24 months, see source` : "";
    dueLines.push({ sort: start, line: describe(it, { flags: flag ? [flag.replace(/^ · /, "")] : [] }) });
  }
  dueLines.sort((a, b) => a.sort.localeCompare(b.sort));
  const due: Line[] = dueLines.map((d) => d.line);
  if (due.length === 0) due.push([t(`Nothing due between ${shortDate(briefDate)} and ${shortDate(windowEnd)}.`)]);
  const next = allDebtItems.filter((it) => it.maturity && spanOf(it.maturity.date, it.maturity.granularity)[1] > briefDate).sort((a, b) => spanOf(a.maturity!.date, a.maturity!.granularity)[0].localeCompare(spanOf(b.maturity!.date, b.maturity!.granularity)[0]))[0];
  if (next) due.push([t("next: "), ...describe(next)]);
  if (allDebtItems.some((it) => /term loan/.test(it.labels.type.t))) due.push([t("Scheduled term-loan amortization: not read. Only final maturities are counted here.")]);

  // ── 2.4 maturity ladder ──
  const byYear = new Map<string, Line[]>();
  for (const it of allDebtItems) {
    const y = it.maturity ? it.maturity.date.slice(0, 4) : "No maturity stated";
    const lines = byYear.get(y) ?? [];
    lines.push(describe(it));
    byYear.set(y, lines);
  }
  const ladderBlocks = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([y, lines]) => ({ heading: [t(y)] as Line, lines }));
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
  if (events.length) ladderLines.push([t("Events:")], ...events);
  if (rolledLabel) ladderLines.push([t(`Lines marked "from the 10-K": ${rolledSentence(rolledLabel).replace(/^This list comes from/, "stated in")}`)]);
  if (rolledNil.length) ladderLines.push([t(`${rolledNil.length} line${rolledNil.length === 1 ? "" : "s"} the ${rolledFrom(rolledLabel ?? "")} 10-K states at $0, not debt: ${rolledNil.join("; ")}.`)]);
  if (dedupNotes.length) ladderLines.push([t(`${dedupNotes.length} note${dedupNotes.length === 1 ? " is" : "s are"} stated in both the ${anchor.form} and the 10-K; each is shown once, as the ${anchor.form} states it.`)]);

  // ── 2.5 facilities ──
  const facBlocks = facilities.map((f) => {
    const fsrc = (field: string, sentence: string) => src(sentence, f.figureSources?.[field] ?? f.citedUrl);
    const own = fsrc("facilitySize", f.facilitySize?.sourceLine ?? f.name);
    const fig = (label: string, field: "facilitySize" | "drawn" | "lettersOfCredit" | "available"): Line => {
      const v = f[field];
      return v ? [t(`${label} `), { k: "figure", t: displayAmount(v.value, v.sourceLine), printed: v.value, src: fsrc(field, v.sourceLine), field }] : [t(`${label} `), { k: "notStated", t: "not stated", src: own }];
    };
    const lines: Line[] = [fig("Size", "facilitySize"), fig("Drawn", "drawn"), fig("Letters of credit", "lettersOfCredit"), fig("Available", "available")];
    const m = facilityMaturityAtItsSentence(f);
    lines.push(m.kind === "dated" ? [t("Maturity "), { k: "date", t: displayDate(m.date, m.granularity), date: m.date, granularity: m.granularity, src: fsrc("maturity", m.sentence) }] : [t("Maturity "), { k: "notStated", t: m.kind === "relative" ? "stated as a relative term, not a date" : "not stated", src: own }]);
    const bb = borrowingBaseOf(f);
    if (bb) {
      const full = widen(bb.statement, [f.facilitySize, f.drawn, f.lettersOfCredit, f.available, f.maturity].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.sourceLine));
      lines.push([{ k: "label", t: "Borrowing-base limited", stated: bb.limitedBy, src: src(full, f.figureSources?.facilitySize ?? f.citedUrl) }, t(": stated availability is authoritative.")]);
    }
    const kind = classifyInstrument({ headings: [], instrumentName: f.name }).instrumentType;
    if (kind === "letter-of-credit") lines.push([t("Letters of credit only: capacity, not borrowed money.")]);
    if (f.category === "commercial-paper" || kind === "commercial-paper") lines.push([t("Issuance program, not a lender commitment: never counted as liquidity.")]);
    const pseudo = { instrument: f.name, classification: classifyInstrument({ headings: [], instrumentName: f.name }) };
    return { heading: [typeLabel(pseudo, own), t(` — ${f.name}`)] as Line, lines };
  });

  // ── 2.6 what the tool did not show ──
  const withheld: Line[] = [];
  const FIELD_NAMES: Record<string, string> = { facilitySize: "size", drawn: "drawn", lettersOfCredit: "letters of credit", available: "available", maturity: "maturity" };
  for (const r of dm?.facilityRejections ?? []) withheld.push([t(`${r.facility}, ${FIELD_NAMES[r.field] ?? r.field} ${displayAmount(r.value, "")}: withheld — ${r.reason}. `), { k: "notStated", t: "see the sentence offered", src: src(r.sourceLine ?? r.facility, anchor.url) }]);
  // A claimed date that a sourced one replaced is no longer withheld: the card shows the sourced date.
  for (const r of pos.rows) if (r.maturityWithheld && !r.maturityDate) withheld.push([t(`${r.instrument}: maturity ${r.maturityWithheld.claimed} withheld — ${r.maturityWithheld.why}.`)]);
  if (rawStatement && !statement) withheld.push([t(`Seniority and security are stated only in an earlier annual report, which this card does not use for labels: “${rawStatement.statement}”`)]);
  if (i.cash.usd === null || !i.cash.printedLine) withheld.push([t(`Cash: ${i.cash.reason ?? "not stated for this date"}.`)]);
  const unread = actionable.length;
  if (unread) withheld.push([t(`${unread} filing${unread === 1 ? "" : "s"} this week affecting debt: text not read, so amount and instrument are not shown.`)]);
  if (allDebtItems.some((it) => /term loan/.test(it.labels.type.t))) withheld.push([t("Term-loan scheduled amortization: not read.")]);
  // "Stated but not captured" is a claim about the card, so it is checked
  // against the card: a category any ladder row carries — debt or capacity —
  // is captured (the known misfire on tabulated facilities, BRD 13.2c item 9).
  const onCard = (c: string) => pos.rows.some((r) => (r.classification.instrumentType ?? "").startsWith(c.split("-")[0]) || (c === "revolver" && r.classification.instrumentType === "credit-facility"));
  for (const c of cov.categoriesMissing ?? []) if (!onCard(c)) withheld.push([t(`Stated in the note but not captured: ${c}.`)]);
  if (rc.counts) for (const m of rc.movements.filter((x) => x.placement === "excluded-not-completed" || x.placement === "undated")) withheld.push([t(`Not counted in the totals: ${m.instrument}, ${m.placement === "undated" ? "no date stated" : "stated as an intention, not completed"}.`)]);
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
    // A difference the filer's own bridge does not explain is stated, with its arithmetic.
    if (Math.abs(residual) >= 0.5 * 10 ** -decimals * 1e6) {
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
    headlines: {
      totalDebt,
      liquidity: { heading: "Liquidity", lines: liqLines },
      due24: { heading: `Due in 24 months (to ${shortDate(windowEnd)})`, lines: due },
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
function formName(form: string): string {
  return /^\d/.test(form) ? `Form ${form}` : form;
}

/** A facility-kind row (revolver, term loan, delayed draw, credit facility). */
function isFacilityType(row: LadderRow): boolean {
  return ["revolver", "credit-facility", "term-loan", "term-loan-a", "term-loan-b", "delayed-draw"].includes(row.classification.instrumentType ?? "");
}
