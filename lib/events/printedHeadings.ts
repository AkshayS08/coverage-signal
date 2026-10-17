/**
 * PRINTED TABLE HEADINGS AND THE ROWS THEY GOVERN — card_spec v2.0 §3.5.
 *
 * A heading is a label source only where the filer PRINTED it: its text sits
 * directly before the first row it governs. A heading the stored answer
 * records but the table does not print is invented text and counts for
 * nothing (audit-spine instance 12: CHS "senior-priority secured", Molina and
 * Encompass "senior unsecured" — recorded, never printed, and each fed a
 * row's class).
 *
 * WHAT A HEADING GOVERNS (Akshay, Oct 15 2026): a contiguous block of rows,
 * ending at the next heading or at the first row whose own label names a
 * DIFFERENT instrument type. A row that names no type ("5.125 % due 2027")
 * continues the block. So DaVita's "Senior Notes:" governs its four notes and
 * not "Acquisition obligations and other notes payable" or "Financing lease
 * obligations" that follow it with no heading of their own.
 *
 * INSTRUMENT KIND, for that boundary only: a closed set of four kinds, read
 * from words in the label. "Notes payable" and "obligations" are the other
 * kind, not notes in the bond sense: an acquisition obligation is not a
 * senior note because both contain the word "notes".
 */

export type Kind = "bond" | "facility" | "lease" | "other";

/** The kind a label NAMES, or null when it names none. Order matters: the narrower word wins. */
export function kindOf(label: string): Kind | null {
  const s = label.toLowerCase();
  if (/\b(?:finance|financing|capital) lease/.test(s)) return "lease";
  if (/\bnotes payable\b|\bobligations\b|\bmortgages?\b|^\s*other\b/.test(s)) return "other";
  if (/\bterm loans?\b|\brevolv|\bcredit (?:facilit|agreement)|\bline of credit\b|\babl\b|\bdelayed[- ]draw\b/.test(s)) return "facility";
  if (/\bnotes?\b|\bdebentures?\b|\bbonds?\b/.test(s)) return "bond";
  return null;
}

export interface TableRow { label: string; sourceLine?: string; recordedHeading?: string | null }
export interface PrintedHeading { text: string; governs: string[] }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flat = (s: string) => s.replace(/[\s ]+/g, " ").trim();

/** Is `heading` printed directly before `rowLabel` in the table text (a colon, dash or footnote mark between)? */
export function printedBefore(tableText: string, heading: string, rowLabel: string): boolean {
  const h = flat(heading).replace(/[:—–-]+$/, "");
  const r = flat(rowLabel).slice(0, 14);
  return new RegExp(`${esc(h)}\\s*[:—–-]?\\s*(?:\\(\\d\\)\\s*)?${esc(r)}`, "i").test(flat(tableText));
}

/**
 * Every printed heading and the rows it governs, from the stored answer's
 * recorded headings checked against the table text. A recorded heading that
 * is not printed before its first row is dropped here, whatever it says.
 */
export function printedHeadings(tableText: string, rows: TableRow[]): PrintedHeading[] {
  const out: PrintedHeading[] = [];
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i].recordedHeading;
    if (!h || (i > 0 && rows[i - 1].recordedHeading === h)) continue; // a block starts where its heading first appears
    if (!printedBefore(tableText, h, rows[i].label)) continue;
    const hk = kindOf(h);
    const governs: string[] = [];
    for (let j = i; j < rows.length; j++) {
      if (j > i && rows[j].recordedHeading && rows[j].recordedHeading !== h && printedBefore(tableText, rows[j].recordedHeading!, rows[j].label)) break; // the next printed heading
      const rk = kindOf(rows[j].label);
      if (rk !== null && hk !== null && rk !== hk) break; // a row naming a different instrument type ends the block
      governs.push(rows[j].label);
    }
    out.push({ text: flat(h).replace(/[:—–-]+$/, ""), governs });
  }
  return out;
}

/** The printed heading governing this row, or null. */
export function headingFor(headings: PrintedHeading[], rowLabel: string): PrintedHeading | null {
  return headings.find((h) => h.governs.includes(rowLabel)) ?? null;
}

/**
 * The table's own text: from just before its first row to just after its
 * last, found by each row's own line in the filing (`find` returns an index,
 * or null where the line is not in the text).
 */
export function tableTextAround(text: string, rowLines: string[], find: (line: string) => number | null): string {
  const at = rowLines.map((l) => find(l)).filter((x): x is number => x !== null);
  return at.length ? flat(text.slice(Math.max(0, Math.min(...at) - 600), Math.max(...at) + 300)) : "";
}

/**
 * EACH ROW'S PRINTED HEADING, RECORDED ON THE ROW (Oct 17, 2026). The stored
 * answer's recorded `section` and `seniority` are what the model said a row
 * sits under; `printedHeading` is the one of them the table actually prints
 * before the row's block, or null. A class is read from `printedHeading`
 * alone — a heading the filer never printed classes nothing.
 *
 * Pure: the caller supplies the anchor's text and a locator over it. A row
 * whose table cannot be found in the text gets null, never its recorded text.
 */
export function annotatePrintedHeadings<E extends { kind: string; label?: string | null; sourceLine: string; section?: string | null; seniority?: string | null }>(
  entries: E[],
  text: string | null | undefined,
  find: (line: string) => number | null
): (E & { printedHeading?: string | null })[] {
  const rows = entries.filter((e) => e.kind === "row");
  const tableText = text ? tableTextAround(text, rows.map((e) => e.sourceLine), find) : "";
  const headings = tableText
    ? printedHeadings(tableText, rows.map((e) => {
        const cands = [e.section, e.seniority].filter((x): x is string => !!x);
        return { label: e.label ?? "", recordedHeading: cands.find((h) => printedBefore(tableText, h, e.label ?? "")) ?? cands[0] ?? null };
      }))
    : [];
  return entries.map((e) => (e.kind === "row" ? { ...e, printedHeading: headingFor(headings, e.label ?? "")?.text ?? null } : e));
}
