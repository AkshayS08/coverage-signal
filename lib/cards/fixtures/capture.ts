/**
 * CAPTURE THE ACCEPTANCE FIXTURES — card_spec v2.0 §5. $0, no model.
 *
 * For each signed name, everything the §5 tests check a card AGAINST, taken
 * from the signed golden's stored result (the pinned answer) and from filing
 * text in the document cache. Written to lib/cards/fixtures/<cik>.json and
 * committed, so the oracle is data a reviewer can read rather than logic
 * re-run each time.
 *
 * The oracles here are deliberately independent of lib/cards/build.ts: a test
 * that asks the builder what the builder did cannot fail.
 *
 * Run: npx tsx lib/cards/fixtures/capture.ts [briefDate]
 */
import { loadEnvQuietly } from "../../cache/loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getFilingText } from "../../fetch/filingText";
import { liveFilingsBetween } from "../../fetch/thisWeek";
import { createTextLocator } from "../../agent/verifyQuote";
import { statementHead } from "../../events/instrumentClass";
import { printedBefore, printedHeadings, type TableRow } from "../headings";

const BRIEF = process.argv[2] ?? "2026-10-15";
const P = process.cwd();
const OUT = join(P, "lib", "cards", "fixtures");
const flat = (s: string) => s.replace(/[\s ]+/g, " ");
// A sentence may begin with a year ("2026 Financing Activity On February 2…"):
// splitting only before a capital merged it into the sentence before, and the
// merged span carried one instrument's class onto another.
const sentences = (t: string) => flat(t).split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)/).filter((s) => s.length > 25 && s.length < 1500);

const CLASS_WORD = /\b(?:senior|junior|subordinated|secured|unsecured|first[- ]lien|first[- ]priority|second[- ]lien)\b/i;
const DEBT_NOUN = /\bnotes?\b|\bdebentures?\b|\bfacilit(?:y|ies)\b|\bterm loans?\b|\bcommercial paper\b|\bborrowings\b|\bcredit agreement\b|\bindebtedness\b/i;
const MOVE_VERB = /\b(?:issued|issuance|offering|priced|redeem(?:ed)?|redemption|repurchas(?:ed|e)|tender|repaid|repay(?:ment)?|retire[ds]?|drew|draws?|borrowed|entered into|amend(?:ed|ment)|refinanc(?:ed|ing)|terminat(?:ed|ion)|incremental|matured)\b/i;
const NOT_DEBT_MOVE = /\bshares?\b|\bcommon stock\b|\bdividends?\b|\bwarrants?\b|\bnoncontrolling\b|\bminority equity\b|\bauthoriz/i;
const MONEY = /\$\s?[\d,.]+\s*(?:million|billion|thousand)?/i;
const COMPLETED_MOVE = /\b(?:issued|completed|priced|redeemed|repurchased|repaid|drew|borrowed|retired|exercised|entered into|amended|modified|terminated|refinanced|incurred|incurrence|net draws|used\b[^.]{0,90}\bto (?:\(i\) )?(?:redeem|repay|repurchase|retire))\b/; // case-sensitive: "Amended and Restated … Agreement" is a title, not a verb
/** Instrument words only: a bare "facilities" is as often a hospital as a credit line. */
const INSTRUMENT = /\bnotes?\b|\bdebentures?\b|\bterm loans?\b|\bcommercial paper\b|\bcredit (?:facility|agreement)\b|\brevolving\b|\bline of credit\b|\bABL\b|\bborrowings\b/i;

/**
 * A DEBT MOVE, as the oracle reads one: a figure that is the transaction's OWN
 * amount — a transaction word and an instrument word within one clause of it,
 * and the figure not described as a loss, gain, fee or cost. Table text
 * (dense numerals) is not a sentence about a move.
 */
function isMoveSentence(s: string): boolean {
  if (NOT_DEBT_MOVE.test(s) || /\bguarantees? of\b/i.test(s)) return false;
  if ((s.match(/\d[\d,.]*/g) ?? []).length > 14) return false;
  if (!MOVE_VERB.test(s) || !INSTRUMENT.test(s)) return false;
  for (const m of s.matchAll(/\$\s?[\d,.]+\s*(?:million|billion|thousand)?/gi)) {
    const at = m.index!, end = at + m[0].length;
    const after = s.slice(end, end + 40), before = s.slice(Math.max(0, at - 50), at);
    if (/^\s*(?:of\s+)?(?:pre-tax\s+)?(?:loss|gain|fees?|costs?|expenses?)\b/i.test(after) || /\b(?:loss|gain|costs?|fees?|expenses?)\b[^$]{0,45}$/i.test(before)) continue;
    const clause = s.slice(Math.max(0, at - 160), end + 160);
    if (MOVE_VERB.test(clause) && INSTRUMENT.test(clause)) return true;
  }
  return false;
}

/** A sentence placed inside the window: a 2026 month/day/period phrase, and no exclusively-prior-year framing. */
function inWindow(s: string, fyStart: string, brief: string): boolean {
  const y0 = Number(fyStart.slice(0, 4)), y1 = Number(brief.slice(0, 4));
  const years = [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
  // The anchor narrates its own period: a sentence is OUT only when it points
  // to a year before the fiscal year and to none inside it. A maturity year
  // after the window ("due 2028") places nothing.
  if (years.some((y) => y >= y0 && y <= y1)) return true;
  return !years.some((y) => y < y0);
}

/** The filer's printed maturity schedule: a run of year-labelled amounts in a debt context. Pairs or header shape. */
function detectSchedule(text: string): { entries: { period: string; amount: string }[]; excerpt: string } | null {
  const t = flat(text);
  const LABEL = String.raw`(July 1 through December 31, 20\d\d|20\d\d \(remainder of the year\)|Remainder of 20\d\d|Thereafter|Maturities after 20\d\d|20\d\d)`;
  const pairRe = new RegExp(String.raw`${LABEL}\s*\$?\s*([\d,]+(?:\.\d+)?)`, "g");
  const good = (r: { period: string; at: number }[]) =>
    r.length >= 4 && r.some((e) => /thereafter|after/i.test(e.period)) &&
    /principal|maturit|long-term debt|debt/i.test(t.slice(Math.max(0, r[0].at - 400), r[0].at));
  // The longest run that IS a debt schedule — not the longest run, tested
  // afterwards: a longer year-run elsewhere (cash flows, investments) hid
  // DaVita's and Cigna's schedules behind it.
  type Run = { period: string; amount: string; at: number }[];
  let best = null as { entries: Run } | null;
  let run: { period: string; amount: string; at: number }[] = [];
  const close = () => { if (good(run) && (!best || run.length > best.entries.length)) best = { entries: run }; run = []; };
  for (const m of t.matchAll(pairRe)) {
    const at = m.index!;
    const prev = run[run.length - 1];
    if (prev && at - prev.at > 60) close();
    run.push({ period: m[1], amount: m[2], at });
  }
  close();
  const found = best as { entries: Run } | null;
  if (found) {
    const e = found.entries;
    return { entries: e.map(({ period, amount }) => ({ period, amount })), excerpt: t.slice(Math.max(0, e[0].at - 200), e[e.length - 1].at + 60) };
  }
  // Header shape: "Years Ending December 31, 2026 2027 … Thereafter Total" then one row of amounts.
  const hdr = /Years? Ending December 31,?\s+((?:20\d\d\s+){3,}Thereafter)\s+Total/i.exec(t);
  if (hdr) {
    const cols = hdr[1].trim().split(/\s+/);
    const after = t.slice(hdr.index! + hdr[0].length, hdr.index! + hdr[0].length + 600);
    const row = /(?:long-term debt|debt)[^$]{0,40}((?:\$\s*[\d,]+\s*){4,})/i.exec(after);
    if (row) {
      const nums = [...row[1].matchAll(/[\d,]+/g)].map((x) => x[0]);
      return { entries: cols.map((c, i) => ({ period: c, amount: nums[i] })), excerpt: t.slice(hdr.index!, hdr.index! + hdr[0].length + 300) };
    }
  }
  return null;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(join(P, "baselines", "golden"))) {
    const g = JSON.parse(readFileSync(join(P, "baselines", "golden", f), "utf-8"));
    if (g.extractionVersion !== 31) continue;
    const result = g.sourceResult;
    const dm = result.results.find((r: any) => r.triggerId === "debt-maturity");
    const anchor = dm.debtScheduleSourceFiling;
    const anchorText: string = (await getFilingText(anchor.url)).text;
    const loc = createTextLocator(anchorText);
    const seq = (dm.scheduleSequence ?? []) as any[];
    const rowEntries = seq.filter((e) => e.kind === "row");
    const at = rowEntries.map((e) => loc.find(e.sourceLine)).filter((x): x is number => x !== null);
    const tableText = at.length ? flat(anchorText.slice(Math.max(0, Math.min(...at) - 600), Math.max(...at) + 300)) : "";
    const rows: (TableRow & { amount: string })[] = rowEntries.map((e) => {
      const cands = [e.section, e.seniority].filter(Boolean) as string[];
      const printed = cands.find((h) => printedBefore(tableText, h, e.label ?? ""));
      return { label: e.label ?? "", amount: e.amount, sourceLine: e.sourceLine, recordedHeading: printed ?? cands[0] ?? null };
    });
    const bridge = seq.filter((e) => e.kind === "adjustment" && /discount|premium|issu(?:e|ance) costs|financing costs/i.test(e.label ?? ""));

    // The rolled position: the referenced table's rows plus the stated changes (card_spec §5.3).
    const base = dm.priorPeriodBase;
    const rolled = base
      ? {
          url: base.filingUrl,
          rows: (base.rows ?? []).filter((r: any) => r.kind === "row").map((r: any) => ({ label: r.label ?? r.instrument, amount: r.amount, sourceLine: r.sourceLine })),
          label: base.label,
          // The stated changes between the base date and the position date, as the signature pins them.
          changes: (g.state.rolled?.deltas ?? []).map((d: any) => ({ instrument: d.instrument, amountMillions: d.amountMillions, statedAs: d.statedAs, sourceLine: d.sourceLine })),
        }
      : null;

    // Documents in the moves window: the anchor and every later filing through the brief date.
    const fyStart = `${anchor.reportDate.slice(0, 4)}-01-01`;
    const later = (await liveFilingsBetween(result.cik, anchor.date, BRIEF)).filter((x) => x.primaryDocUrl !== anchor.url && ["8-K", "10-Q", "10-K"].includes(x.form));
    const docs = [{ doc: `${anchor.form} ${anchor.date}`, url: anchor.url, text: anchorText }];
    for (const x of later) docs.push({ doc: `${x.form} ${x.filingDate}`, url: x.primaryDocUrl, text: (await getFilingText(x.primaryDocUrl)).text });
    if (rolled) docs.push({ doc: `10-K for ${base.periodOfReport}`, url: rolled.url, text: (await getFilingText(rolled.url)).text });

    const classSentences: { doc: string; url: string; sentence: string }[] = [];
    const moveSentences: { doc: string; url: string; sentence: string }[] = [];
    for (const d of docs) {
      const isDirected = rolled && d.url === rolled.url;
      for (const s of sentences(d.text)) {
        if (CLASS_WORD.test(statementHead(s)) && DEBT_NOUN.test(s)) classSentences.push({ doc: d.doc, url: d.url, sentence: s });
        // In the window: a later filing by its own filing date; the anchor's sentences by their own dates.
        const isAnchor = d.url === anchor.url;
        // From the anchor, a move is something that HAPPENED in the period: a
        // completed transaction, not a standing description of a facility.
        const narrated = !isAnchor || COMPLETED_MOVE.test(s);
        if (!isDirected && isMoveSentence(s) && narrated && (!isAnchor || inWindow(s, fyStart, BRIEF))) moveSentences.push({ doc: d.doc, url: d.url, sentence: s });
      }
    }
    const scheduleDoc = rolled ? docs.find((d) => d.url === rolled.url)! : docs[0];
    const schedule = detectSchedule(scheduleDoc.text);

    const fixture = {
      cik: result.cik,
      company: result.company,
      briefDate: BRIEF,
      positionSource: "signed golden's stored result",
      anchor,
      table: {
        basis: rolled ? "rolled: referenced-table labels state face, cells carry carrying value" : bridge.length ? "face (the table prints its own bridge line)" : "carrying (no bridge line; face must come from a stated source or be labelled carrying value)",
        rows,
        /** The scale the table's cells are printed in, from the cells' own canonical unit word (Rule 67). */
        scale: /thousand/i.test(rows[0]?.amount ?? "") ? "thousand" : "million",
        bridge: bridge.map((b) => ({ label: b.label, amount: b.amount })),
        text: tableText,
      },
      headings: printedHeadings(tableText, rows),
      rolled,
      schedule: schedule ? { doc: scheduleDoc.doc, url: scheduleDoc.url, ...schedule } : null,
      classSentences,
      moveSentences,
      docs: docs.map((d) => ({ doc: d.doc, url: d.url })),
    };
    writeFileSync(join(OUT, `${result.cik}.json`), JSON.stringify(fixture, null, 1) + "\n", "utf-8");
    console.log(`${result.company}: ${rows.length} table rows, ${fixture.headings.length} printed heading(s), schedule ${schedule ? schedule.entries.length + " periods" : "none"}, ${classSentences.length} class sentence(s), ${moveSentences.length} move sentence(s), ${docs.length} doc(s)`);
  }
})();
