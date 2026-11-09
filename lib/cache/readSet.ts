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
 *   - the dig's candidate list (v33), by form, date, items, accession, URL.
 * The prompt's catalog lists the read set and the dig candidates, and nothing
 * else, so no other filing reaches the model.
 *
 * THE DIG (v33). The model may ask to read one more filing when the excerpts
 * leave a trigger ambiguous. What it may ask for is decided here, from the
 * filing list alone, by the same helpers as the read set: the latest 10-K,
 * the 10-Qs filed since it, and the 8-Ks filed since it that carry a trigger
 * item (the read window). The list is in the key, so an unrelated filing
 * moves neither; a new 10-K moves both. A document the dig opens is recorded
 * beside the read set with its content hash (`recordedReadSet`), and the dig
 * answer's own key carries that hash.
 */
import { createHash } from "node:crypto";
import { getRecentFilings, getFilingText, type FilingEntry, type RecentFilingsResult } from "../fetch";
import { fetchXbrlDebtTotal, type XbrlDebtTotal } from "../fetch/xbrlDebt";
import { buildExtractionText, NOTE_LOCATOR_VERSION, type FilingExtractionResult } from "../fetch/noteLocation";
import { selectBaselineFilings, has8KSignal } from "../agent/selectFilings";
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

/**
 * SESSION 27 (decision 11, Nov 9): THE DEBT-ITEM 8-KS SINCE THE LATEST 10-K — one deciding function for the card input
 * and the facts stage. An 8-K carrying Item 1.01, 1.02, 2.03, 2.04 or 8.01, filed on or after the latest 10-K in the
 * list, states move detail (the day, the amount, the funding) a 10-Q may give only by month. No second list exists.
 */
export const DEBT_8K_ITEMS = ["1.01", "1.02", "2.03", "2.04", "8.01"];
export function debtEightKsSinceTenK<T extends { form: string; filingDate: string; items?: string }>(filings: T[], since?: string): T[] {
  const lastTenK = since ?? [...filings].filter((f) => f.form === "10-K").sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1))[0]?.filingDate ?? "";
  return filings.filter((x) => x.form === "8-K" && x.filingDate >= lastTenK && String(x.items ?? "").split(",").some((it) => DEBT_8K_ITEMS.includes(it.trim())));
}

/** The anchor: the most recent 10-Q or 10-K in the read set. */
export function anchorOf(readSet: FilingEntry[]): FilingEntry | undefined {
  return [...readSet].filter((f) => f.form === "10-Q" || f.form === "10-K").sort(newestFirst)[0];
}

/**
 * What the dig may open, from the filing list alone: the latest 10-K, the
 * 10-Qs filed since it, and the trigger-item 8-Ks filed since it. With no
 * 10-K, nothing beyond the read set.
 */
export function digCandidatesOf(filings: FilingEntry[]): FilingEntry[] {
  const sorted = [...filings].sort(newestFirst);
  const tenK = sorted.find((f) => f.form === "10-K");
  if (!tenK) return readSetOf(filings);
  const since = sorted.filter((f) => f.filingDate >= tenK.filingDate);
  return [tenK, ...since.filter((f) => f.form === "10-Q"), ...since.filter((f) => f.form === "8-K" && has8KSignal(f))].sort(newestFirst);
}

export interface RecordedRead {
  url: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
  /** sha256 of the full text read. */
  contentHash: string;
  via: "base" | "dig";
}

/** Every document the build read, the read set and anything the dig opened, each with its content hash. */
export function recordedReadSet(base: { url: string; text: string; filing: FilingEntry }[], dug: { url: string; text: string; filing: FilingEntry }[]): RecordedRead[] {
  const rec = (d: { url: string; text: string; filing: FilingEntry }, via: RecordedRead["via"]): RecordedRead => ({ url: d.url, form: d.filing.form, filingDate: d.filing.filingDate, accessionNumber: d.filing.accessionNumber, contentHash: createHash("sha256").update(d.text).digest("hex"), via });
  return [...base.map((d) => rec(d, "base")), ...dug.filter((d) => !base.some((b) => b.url === d.url)).map((d) => rec(d, "dig"))];
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
    ...digCandidatesOf(i.filings).map((f) => `dig candidate ${f.form}|${f.filingDate}|${f.reportDate}|${f.items}|${f.accessionNumber}|${f.primaryDocUrl}`),
  ].join("\n");
}

export function readSetFingerprint(i: ReadSetKeyInputs): string {
  return sha(readSetKeyMaterial(i));
}

export interface ResolvedReadSet {
  filingsResult: RecentFilingsResult;
  readSet: FilingEntry[];
  /** What the dig may open (in the key); those not in the read set are listed to the model as not excerpted. */
  digCandidates: FilingEntry[];
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
  return { filingsResult, readSet, digCandidates: digCandidatesOf(filingsResult.filings), anchor, anchorXbrl, docs, fingerprint: readSetFingerprint(inputs), material: readSetKeyMaterial(inputs) };
}
