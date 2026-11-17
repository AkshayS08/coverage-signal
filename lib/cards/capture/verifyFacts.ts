/**
 * SESSION 27 (Nov 13): THE CARD-FACTS VERIFIER, moved out of facts.ts so it can be tested without the billing script
 * (no environment, no client, no network). It decides quote matching, same-move identity and completed-move dating
 * by the card's own functions (lib/cards/moveEvidence.ts), with no separate copy (verifierParity.test).
 */
import { createTextLocator } from "../../agent/verifyQuote";
import { amountSupportOf } from "../../events/position";
import { containsWord } from "../labels";
import { placedInsideParent } from "../subFacility";
import { quoteFound, statesSameMove, datesCompletedMove } from "../moveEvidence";
import { paragraphSentences, antecedentWindow, REFERS, HEADING } from "../antecedent";
import type { Fact } from "../types";

type Raw = any;

/** Where a sentence is found among the card's documents, the URL hint first. */
function locate(snap: any, locs: Map<string, ReturnType<typeof createTextLocator>>, sentence: string, hint: string): string | null {
  const urls = [hint, ...Object.keys(snap.docs)].filter((u, i, a) => u && a.indexOf(u) === i && snap.docs[u]);
  for (const u of urls) {
    if (!locs.has(u)) locs.set(u, createTextLocator(snap.docs[u].text));
    if (locs.get(u)!.find(sentence) !== null || quoteFound(snap.docs[u].text, sentence)) return u;
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

const flatText = (t: string) => t.replace(/\s+/g, " ");

/**
 * WHERE A MOVE'S DETAIL IS STATED (Nov 13: the card's own deciding functions, no separate rule). The move's own
 * sentence; failing that, where the own sentence refers ("this offering", "this borrowing"), its antecedent in the same
 * paragraph (the card's antecedent rule, antecedent.ts); failing that, any held sentence that states the same move
 * (moveEvidence.statesSameMove). A completed move is never dated by a notice or a scheduled day (ruling A2). Replaces
 * the earlier "two sentences either side" rule, which the card never had.
 */
function evidenceFor(snap: any, url: string, sentence: string, value: string, move: { type: string; instrument: string; status?: string } | null, dating: boolean): { sentence: string; url: string } | null {
  const ok = (x: string) => !dating || move?.status !== "completed" || datesCompletedMove(x);
  if (states(sentence, value) && ok(sentence)) return { sentence, url };
  const text = snap.docs[url]?.text ?? "";
  const { sentences, hasBreaks } = paragraphSentences(text);
  const at = sentences.findIndex((x) => quoteFound(x.sentence, sentence) || quoteFound(sentence, x.sentence));
  if (at >= 0 && REFERS.test(sentences[at].sentence)) {
    for (const k of antecedentWindow(sentences, at, hasBreaks, (x) => HEADING.test(x))) if (states(sentences[k].sentence, value) && ok(sentences[k].sentence)) return { sentence: sentences[k].sentence, url };
  }
  if (move) for (const [u, d] of Object.entries(snap.docs as Record<string, { text: string }>)) {
    for (const x of paragraphSentences(d.text).sentences) if (statesSameMove(x.sentence, move, d.text) && states(x.sentence, value) && ok(x.sentence)) return { sentence: x.sentence, url: u };
  }
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
export function verifyAsk(snap: any, raw: Raw, rejected: { fact: string; why: string }[]): Raw {
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
      // Session 27 (Nov 1): its own sentence must place it INSIDE the parent; a separate facility's figure is not one.
      if (ok && !placedInsideParent(r.sourceLine)) { rejected.push({ fact: `sub-facility ${r.kind} ${r.amount}`, why: "its sentence does not place it inside the parent facility (a sub-facility, sub-limit or swingline, or capacity the parent provides for letters of credit; never a separate facility)" }); return null; }
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
      // Each detail is verified against the sentence the card's own functions accept for it, and links there.
      const mv = { type: m.type, instrument: m.instrument, status: m.status };
      const dateE = evidenceFor(snap, url, m.sourceLine, m.date, mv, true);
      if (!dateE) { rejected.push({ fact: label, why: `no sentence the card accepts for this move states the date "${m.date}"` }); return null; }
      const instE = evidenceFor(snap, url, m.sourceLine, m.instrument, null, false) ?? (containsWord(m.sourceLine, m.instrument) ? { sentence: m.sourceLine, url } : null);
      const faceE = m.face ? evidenceFor(snap, url, m.sourceLine, m.face, mv, false) : null;
      if (m.face && !faceE) rejected.push({ fact: `face of ${label}`, why: `no sentence the card accepts for this move states "${m.face}"` });
      return {
        type: m.type, status: m.status,
        date: { value: m.date, src: dateE },
        instrument: { value: m.instrument, src: instE ?? { sentence: m.sourceLine, url }, verified: !!instE },
        face: faceE ? { value: m.face, src: faceE } : null,
        funding: fact(m.funding, `funding of ${m.instrument}`), use: fact(m.use, `use of ${m.instrument}`), price: fact(m.price, `price of ${m.instrument}`),
        offered: fact(m.offered, `instrument offered for ${m.instrument}`), consent: fact(m.consent, `consent solicitation with ${m.instrument}`),
      };
    }).filter(Boolean),
  };
}

/** For verifierParity.test: one ask, verified, its rejections discarded. */
export function verifyAskForTest(snap: any, raw: Raw): Raw {
  return verifyAsk(snap, raw, []);
}
