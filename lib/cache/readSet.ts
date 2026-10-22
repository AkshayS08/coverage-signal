/**
 * SESSION 27, STAGE 1 — THE CACHE IS KEYED ON WHAT EXTRACTION READ.
 *
 * corpusFingerprint hashed the company's whole EDGAR catalog, so a filing
 * the extraction never read orphaned every answer: Cigna's Oct 9 Item 5.02
 * officer change, and on Oct 19 nine Encompass Form 4s that pushed 2018
 * filings out of EDGAR's count-capped "recent" block. Measured over the last
 * 90 days on the six signed names (sessions/27/stage1_measurement.txt): the
 * old key moved 25 times, the read set 11, and every one of the 11 was a new
 * 10-Q or a new high-signal 8-K.
 *
 * ONE DECIDING FUNCTION. `readSetOf` is the only thing that decides what the
 * extraction reads, and `resolveReadSet` the only thing that turns that into
 * a key. The loop reads through it and checkFree/preflight key through it, so
 * "would this filing change what is read" has one answer, never two.
 *
 * The key covers exactly the inputs that shape the base call:
 *   - the registered name (it opens the prompt);
 *   - each read document: form, filing date, period, 8-K items, accession,
 *     URL, a hash of its full text, and a hash of the excerpt the model is
 *     shown (which also covers the locator's code and the XBRL bound);
 *   - the XBRL stated total that bounds the debt-note excerpt;
 *   - the extraction prompt version and the note-locator version.
 * The prompt's filing catalog is the read set itself (v32), so no filing
 * outside it reaches the model either.
 */
import { createHash } from "node:crypto";
import { getRecentFilings, getFilingText, type FilingEntry, type RecentFilingsResult } from "../fetch";
import { fetchXbrlDebtTotal, type XbrlDebtTotal } from "../fetch/xbrlDebt";
import { buildExtractionText, NOTE_LOCATOR_VERSION, type FilingExtractionResult } from "../fetch/noteLocation";
import { selectBaselineFilings } from "../agent/selectFilings";
import { EXTRACTION_PROMPT_VERSION } from "./promptVersion";

const sha = (s: string, n = 24) => createHash("sha256").update(s).digest("hex").slice(0, n);
const newestFirst = (a: FilingEntry, b: FilingEntry) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0);

/**
 * THE deciding function: what the extraction reads, from the filing list
 * alone (form, filing date, 8-K items). The two most recent 10-Qs, the most
 * recent 10-K, and the six most recent 8-Ks carrying an item the triggers
 * read (selectFilings.ts names them; three newest 8-Ks when none does).
 */
export function readSetOf(filings: FilingEntry[]): FilingEntry[] {
  return selectBaselineFilings([...filings].sort(newestFirst));
}

/** The anchor: the most recent 10-Q or 10-K in the read set. */
export function anchorOf(readSet: FilingEntry[]): FilingEntry | undefined {
  return [...readSet].filter((f) => f.form === "10-Q" || f.form === "10-K").sort(newestFirst)[0];
}

/** Would going from one filing list to another change what the extraction reads? */
export function wouldChangeReads(before: FilingEntry[], after: FilingEntry[]): boolean {
  const ids = (f: FilingEntry[]) => readSetOf(f).map((x) => x.accessionNumber).join(",");
  return ids(before) !== ids(after);
}

export interface ReadSetKeyInputs {
  cik: string;
  company: string;
  /** The catalog; only its read set reaches the key. */
  filings: FilingEntry[];
  /** Hash of a read document's full text. */
  contentHash: (url: string) => string;
  /** Hash of the excerpt the model is shown for that document; defaults to the content hash. */
  excerptHash?: (url: string) => string;
  xbrlDebtTotal: number | null;
  promptVersion: number;
  locatorVersion: number;
}

/** The key's material, one line per input, in the order the prompt reads them. */
export function readSetKeyMaterial(i: ReadSetKeyInputs): string {
  const ex = i.excerptHash ?? i.contentHash;
  return [
    `cik ${i.cik}`,
    `company ${i.company}`,
    `extraction prompt v${i.promptVersion}`,
    `note locator v${i.locatorVersion}`,
    `xbrl stated total ${i.xbrlDebtTotal ?? "none"}`,
    ...readSetOf(i.filings).map((f) => `read ${f.form}|${f.filingDate}|${f.reportDate}|${f.items}|${f.accessionNumber}|${f.primaryDocUrl}|text ${i.contentHash(f.primaryDocUrl)}|excerpt ${ex(f.primaryDocUrl)}`),
  ].join("\n");
}

export function readSetFingerprint(i: ReadSetKeyInputs): string {
  return sha(readSetKeyMaterial(i));
}

export interface ResolvedReadSet {
  filingsResult: RecentFilingsResult;
  readSet: FilingEntry[];
  anchor: FilingEntry | undefined;
  /** The XBRL stated total at the anchor's period end; bounds the debt-note excerpt. */
  anchorXbrl: XbrlDebtTotal | null;
  /** Per read document, in read order: its full text and the excerpt built from it. */
  docs: Map<string, { fullText: string; extraction: FilingExtractionResult }>;
  fingerprint: string;
  material: string;
}

/**
 * Everything the base call reads, resolved once. The loop builds its corpus
 * from this and checkFree keys from this, so the two cannot disagree about
 * what was read. Every read in here fails closed (ReadFailedError).
 */
export async function resolveReadSet(company: string): Promise<ResolvedReadSet> {
  const filingsResult = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
  const readSet = readSetOf(filingsResult.filings);
  const anchor = anchorOf(readSet);
  const anchorXbrl = anchor ? await fetchXbrlDebtTotal(filingsResult.cik, anchor.reportDate) : null;
  const docs = new Map<string, { fullText: string; extraction: FilingExtractionResult }>();
  for (const f of readSet) {
    const { text: fullText } = await getFilingText(f.primaryDocUrl);
    docs.set(f.primaryDocUrl, { fullText, extraction: buildExtractionText({ form: f.form, url: f.primaryDocUrl, fullText, xbrlStatedTotal: anchorXbrl?.total ?? null }) });
  }
  const inputs: ReadSetKeyInputs = {
    cik: filingsResult.cik,
    company: filingsResult.company,
    filings: filingsResult.filings,
    contentHash: (u) => sha(docs.get(u)!.fullText, 64),
    excerptHash: (u) => sha(docs.get(u)!.extraction.text, 64),
    xbrlDebtTotal: anchorXbrl?.total ?? null,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    locatorVersion: NOTE_LOCATOR_VERSION,
  };
  return { filingsResult, readSet, anchor, anchorXbrl, docs, fingerprint: readSetFingerprint(inputs), material: readSetKeyMaterial(inputs) };
}
