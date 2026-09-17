/**
 * SESSION 22, STAGE 0 — THE TEXT-BLOCK PRE-CHECK. $0.
 *
 * The question: how many of the ten expose a NON-EMPTY debt text-block tag —
 * the filer's own tagged debt-note boundary — in their most recent 10-Q's
 * inline XBRL. The answer decides whether the text block becomes the primary
 * locator anchor (if it is there on ~10 of 10) or a first-among-fallbacks.
 *
 * NOTHING IS BUILT HERE. This is measurement, and it is deliberately not
 * routed through runAgentLoop: the anchor's URL could be recovered from a
 * warm run, but a warm run can miss and a miss is a paid re-ask, and a
 * measurement stage that can accidentally bill is the wrong shape. The
 * filings list gives the 10-Q directly and costs nothing.
 *
 * RULE 22 GOVERNS WHAT IS MEASURED. Availability is decided by measuring the
 * source, not by naming the tag we hope is there — so this reports EVERY
 * us-gaap text block in the document whose name mentions debt, borrowing,
 * credit or leases, not only the two we would have guessed. A tag we did not
 * think to look for is exactly what this stage exists to find.
 *
 * RULE 24 GOVERNS WHAT "NON-EMPTY" MEANS. A text block's value is the span
 * between its opening ix element and its matching close, and inline XBRL
 * nests — so the span is found by counting opens and closes, never by the
 * first close encountered. A span measured to the wrong boundary is the same
 * defect as a note measured to the wrong boundary.
 *
 * AND THE BOUNDARY IS NOT ONE ELEMENT. Inline XBRL splits a single fact
 * across a `continuedAt` chain of `ix:continuation` elements, so the
 * declared element is routinely a stub. The first version of this probe
 * measured only the declared element and reported seven of eight level-1
 * blocks at 4 to 14 characters — which would have read as "the tag is there
 * and it is empty" when the tag is there and the note is in the chain behind
 * it. The chain is followed here, and a fact's length is the whole chain.
 *
 * Run: npx tsx lib/cache/s22stage0.ts
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, type FilingEntry } from "../fetch/filings";
import { secFetchText } from "../fetch/http";

const ALL = [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];
/** Names on the command line narrow the run; with none, the whole book. */
const BOOK = process.argv.slice(2).filter((a) => !a.startsWith("--")).length
  ? ALL.filter((c) => process.argv.slice(2).some((a) => c.toLowerCase().includes(a.toLowerCase())))
  : ALL;
/** --show prints each level-1 block's own text, so "non-empty" can be read rather than trusted. */
const SHOW = process.argv.includes("--show");

/**
 * The level-1 note boundary, which is what a locator anchor wants. Ordered
 * by how directly each names the debt note itself.
 */
const PRIMARY_TAGS = [
  "DebtDisclosureTextBlock",
  "LongTermDebtTextBlock",
  "DebtAndCapitalLeaseObligationsTextBlock",
  // Found by measuring rather than by guessing: CHS tags its whole debt note
  // under this name and would have counted as "no level-1 block" against the
  // three we would have asked for. Rule 22, on the reading side.
  "LongTermDebtAndCapitalLeasesDisclosuresTextBlock",
];

/** Anything else the filer tagged that touches debt — reported, not assumed. */
const RELEVANT = /^(?=.*TextBlock$)(?=.*(Debt|Borrowing|Credit|Lease|Note[sd]?Payable|Financing)).*$/i;

interface TextBlockHit {
  tag: string;
  /** The block's own visible text, kept so the report can show what the anchor would actually bound. */
  text: string;
  /** Characters of markup across the declared element AND its continuation chain. */
  spanChars: number;
  /** Visible text once markup is stripped — the figure that decides "non-empty". */
  textChars: number;
  /** How many continuation elements the fact runs through. 0 = declared inline. */
  continuations: number;
  /** True when a continuedAt names an id no continuation element carries. */
  brokenChain: boolean;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : null;
};

const stripToText = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&#\d+;|&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

/**
 * The content of one element, from just past its opening tag to its MATCHING
 * close. Text blocks wrap whole notes and notes contain further tagged
 * facts, so depth is counted rather than stopping at the first close.
 */
function elementBody(html: string, elem: string, openEnd: number): { body: string; end: number } {
  const scan = new RegExp(`<${elem}\\b[^>]*?(/?)>|</${elem}>`, "gi");
  scan.lastIndex = openEnd;
  let depth = 1, end = -1, s: RegExpExecArray | null;
  while ((s = scan.exec(html)) !== null) {
    if (s[0].startsWith("</")) { depth--; if (depth === 0) { end = s.index; break; } }
    else if (s[1] !== "/") depth++;           // a self-closing open opens nothing
  }
  if (end === -1) end = html.length;
  return { body: html.slice(openEnd, end), end };
}

/** Every `ix:continuation` in the document, indexed by its id, resolved once per filing. */
function indexContinuations(html: string): Map<string, { body: string; next: string | null }> {
  const map = new Map<string, { body: string; next: string | null }>();
  const open = /<(ix:continuation|continuation)\b[^>]*>/gi;
  for (const m of html.matchAll(open)) {
    const id = attr(m[0], "id");
    if (!id) continue;
    const elem = m[1];
    const { body } = elementBody(html, elem, m.index! + m[0].length);
    map.set(id, { body, next: attr(m[0], "continuedAt") });
  }
  return map;
}

/**
 * Every inline-XBRL text block in the document whose name touches debt, with
 * the length of the WHOLE fact — declared element plus continuation chain.
 * Handles both `ix:nonNumeric` and the rarer bare-namespace spelling.
 */
function findTextBlocks(html: string, conts: Map<string, { body: string; next: string | null }>): TextBlockHit[] {
  const out: TextBlockHit[] = [];
  const open = /<(ix:nonNumeric|nonNumeric)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(open)) {
    const rawName = m[2];
    const tag = rawName.includes(":") ? rawName.split(":")[1] : rawName;
    if (!RELEVANT.test(tag)) continue;

    const { body } = elementBody(html, m[1], m.index! + m[0].length);
    const parts = [body];
    let next = attr(m[0], "continuedAt");
    let hops = 0, broken = false;
    const seen = new Set<string>();
    while (next && !seen.has(next)) {
      seen.add(next);
      const c = conts.get(next);
      if (!c) { broken = true; break; }        // named an id nothing carries
      parts.push(c.body);
      hops++;
      next = c.next;
    }

    const span = parts.join("");
    const text = stripToText(span);
    out.push({ tag, text, spanChars: span.length, textChars: text.length, continuations: hops, brokenChain: broken });
  }
  return out;
}

/**
 * THE ROLL-FORWARD'S OTHER HALF, measured on the same document rather than in
 * a second script. That trigger is a CONJUNCTION — no ladder in the note AND
 * a verifiable, debt-specific pointer at a prior filing — and the second half
 * has its own failure mode: every 10-Q carries boilerplate telling the reader
 * to read it alongside the 10-K, and that sentence covers all notes at once.
 * Firing on it would be firing on nothing. So a pointer counts only when the
 * sentence itself names debt.
 *
 * Folded in here after the throwaway that first measured it disagreed with
 * this file on Cigna. Two implementations of one measurement is the defect
 * this project keeps re-learning; the fix is to have one.
 */
const DEBT_WORDS = /\bdebt\b|\bnotes payable\b|\bborrowing|\bcredit facilit|\bsenior notes\b/i;
const PRIOR_FILING = /[^.]{0,300}\b(Form 10-K|Annual Report on Form 10-K)\b[^.]{0,200}\./gi;

function priorFilingPointers(docText: string): { debtSpecific: string[]; boilerplate: number } {
  const debtSpecific: string[] = [];
  const seen = new Set<string>();
  let boilerplate = 0;
  for (const m of docText.matchAll(PRIOR_FILING)) {
    const sentence = m[0].trim();
    const key = sentence.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    if (DEBT_WORDS.test(sentence)) debtSpecific.push(sentence);
    else boilerplate++;
  }
  return { debtSpecific, boilerplate };
}

const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);

(async () => {
  console.log(`\n${"=".repeat(104)}`);
  console.log("SESSION 22, STAGE 0 — DEBT TEXT-BLOCK PRE-CHECK.  $0: no model calls, EDGAR fetches only.");
  console.log("=".repeat(104));

  // MEASURED-NO AND NOT-MEASURED ARE DIFFERENT ANSWERS, and a count that
  // cannot tell them apart is the Session 21 check-sheet defect wearing new
  // clothes: one transient fetch failure on UHS printed a reason in its row
  // while the totals still divided by ten, so "9 of 10" could have meant nine
  // yes and one no, or nine yes and one never looked at. The denominator is
  // what was measured; anything unmeasured is named.
  //
  // SESSION 22, STAGE 3 — this is the class `lib/agent/corpus.ts` now owns.
  // The per-document counting here predates it and is kept because it counts
  // COMPANIES rather than looking a sentence up in documents; the invariant
  // is the same one, stated in the same words, and any new lookup goes
  // through Corpus rather than being written again here.
  let withPrimary = 0, withAny = 0, measured = 0;
  const unmeasured: string[] = [];
  const rows: string[] = [];
  const detail: string[] = [];

  for (const company of BOOK) {
    let filings: FilingEntry[];
    let cik = "";
    try {
      const r = await getRecentFilings(company, ["10-Q", "10-K"]);
      filings = r.filings;
      cik = r.cik;
    } catch (e) {
      rows.push(`  ${pad(company, 28)} ${pad("NOT MEASURED — filings list unavailable", 42)} ${(e as Error).message}`);
      unmeasured.push(`${company} (filings list unavailable)`);
      continue;
    }

    const tenQs = filings.filter((f) => f.form === "10-Q").sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const anchorCandidates = filings.filter((f) => f.form === "10-Q" || f.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const q = tenQs[0];
    if (!q) {
      rows.push(`  ${pad(company, 28)} ${pad("NOT MEASURED — no 10-Q on file", 42)}`);
      unmeasured.push(`${company} (no 10-Q on file)`);
      continue;
    }
    // Stated where the newest filing is a 10-K, because then the pipeline's
    // anchor and the document measured here are not the same document.
    const newest = anchorCandidates[0];
    const anchorNote = newest && newest.form !== "10-Q" ? `  [newest is ${newest.form} ${newest.filingDate}]` : "";

    let html: string;
    try {
      html = await secFetchText(q.primaryDocUrl);
    } catch (e) {
      rows.push(`  ${pad(company, 28)} ${pad("NOT MEASURED — document unfetchable", 42)} ${(e as Error).message}`);
      unmeasured.push(`${company} (document unfetchable)`);
      continue;
    }

    const hits = findTextBlocks(html, indexContinuations(html));
    const xref = priorFilingPointers(stripToText(html));
    measured++;
    const primary = hits.filter((h) => PRIMARY_TAGS.includes(h.tag) && h.textChars > 0);
    const any = hits.filter((h) => h.textChars > 0);
    if (primary.length) withPrimary++;
    if (any.length) withAny++;

    const verdict = primary.length
      ? `YES — ${primary.map((h) => `${h.tag} (${h.textChars.toLocaleString("en-US")} chars)`).join(", ")}`
      : any.length
        ? `no level-1 block; ${any.length} related`
        : "NO — no debt text block at all";
    rows.push(`  ${pad(company, 28)} ${pad(`${q.form} ${q.filingDate}`, 18)} ${verdict}${anchorNote}`);

    detail.push(`\n  ${company}  (CIK ${cik}, ${q.form} filed ${q.filingDate}, period ${q.reportDate})`);
    detail.push(`    PRIOR-FILING POINTERS: ${xref.debtSpecific.length} debt-specific, ${xref.boilerplate} boilerplate — the roll-forward fires only on a debt-specific one`);
    for (const x of xref.debtSpecific) detail.push(`       >> ${x.slice(0, 300)}`);
    detail.push(`    ${q.primaryDocUrl}`);
    if (hits.length === 0) detail.push("      (no us-gaap text block naming debt, borrowing, credit or leases)");
    for (const h of hits) {
      detail.push(`      ${PRIMARY_TAGS.includes(h.tag) ? "*" : " "} ${pad(h.tag, 52)} text ${h.textChars.toLocaleString("en-US").padStart(9)} chars   span ${h.spanChars.toLocaleString("en-US").padStart(9)}   ${h.continuations ? `+${h.continuations} continuation${h.continuations > 1 ? "s" : ""}` : "inline"}${h.brokenChain ? "   BROKEN CHAIN — a continuedAt names an id nothing carries" : ""}`);
      if (SHOW && PRIMARY_TAGS.includes(h.tag)) {
        const cap = process.argv.includes("--full") ? h.text.length : 1400;
        detail.push(`          ${h.text.slice(0, cap)}${h.text.length > cap ? " …" : ""}`);
      }
    }
  }

  console.log("\nPER COMPANY\n");
  for (const r of rows) console.log(r);

  console.log(`\n${"=".repeat(104)}\nEVERY DEBT-RELATED TEXT BLOCK FOUND, whether or not we would have asked for it\n${"=".repeat(104)}`);
  for (const d of detail) console.log(d);

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  MEASURED:                                  ${measured} of ${BOOK.length}`);
  if (unmeasured.length) console.log(`  NOT MEASURED, and NOT a "no":              ${unmeasured.join("; ")}`);
  console.log(`  LEVEL-1 DEBT NOTE TEXT BLOCK, NON-EMPTY:   ${withPrimary} of ${measured} measured`);
  console.log(`  ANY DEBT-RELATED TEXT BLOCK, NON-EMPTY:    ${withAny} of ${measured} measured`);
  console.log(`  * marks a level-1 note boundary (${PRIMARY_TAGS.join(", ")})`);
  console.log(`${"=".repeat(104)}\n`);
})();
