/**
 * SESSION 27 (Akshay, Nov 20): A PRINTED MATURITY SCHEDULE IS READ BY CODE WHERE THE TABLE PARSES — its years, its
 * columns and its total — and by the model only where it does not (omissionRules.test S1, S2).
 *
 * Tenet's three reads all left out the 2026 column of its market-risk table ("Years Ending December 31, 2026 2027 2028
 * 2029 2030 Thereafter Total … Fixed-rate long-term debt $ 27 $ 157 …"): a fact printed in a table the code can read
 * does not depend on the model noticing it.
 *
 * In the anchor (the document the card's position is read from): a header of at least three consecutive, ascending
 * years, then optionally "Thereafter" and "Total"; under it, the first debt row (long-term debt, principal, maturities,
 * notes, borrowings) with an amount for every column. Read only where the row's year (and thereafter) entries tie to its
 * printed total EXACTLY; with no total printed, or one that does not tie, the code declines and the model's schedule
 * stands. Each entry cites the table text from its header through its amount, as the model's verified entries do.
 */
type Entry = { period: string; amount: { value: string; src: { sentence: string; url: string } } };

const ROW = /(fixed[- ]rate long-term debt|long-term debt|total debt|principal (?:payments|maturities|amounts?)|scheduled (?:principal|maturities|payments)|debt maturities|maturities of (?:long-term )?debt|senior notes|notes payable|borrowings)/i;
const NUM = /\(?\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*\)?/y;

export function scheduleByCode(snap: any): Entry[] | null {
  const dm = snap.result.results.find((r: any) => r.triggerId === "debt-maturity");
  const url: string = dm.debtScheduleSourceFiling.url;
  const text: string = (snap.docs[url]?.text ?? "").replace(/\s+/g, " ");
  for (const h of text.matchAll(/\b((?:20\d\d\s+){2,}20\d\d)\b(\s+Thereafter)?(\s+Total)?/g)) {
    const years = h[1].trim().split(/\s+/).map(Number);
    if (!years.every((y, k) => k === 0 || y === years[k - 1] + 1)) continue;
    const thereafter = !!h[2], total = !!h[3];
    if (!total) continue;
    const after = (h.index ?? 0) + h[0].length;
    const window = text.slice(after, after + 600);
    const row = ROW.exec(window);
    if (!row) continue;
    // The amounts directly after the row label: one per column.
    let at = after + (row.index ?? 0) + row[0].length;
    const lead = /^[^$\d(]{0,60}/.exec(text.slice(at))![0];
    at += lead.length;
    const cols = years.length + (thereafter ? 1 : 0) + 1;
    const nums: { raw: string; end: number }[] = [];
    for (let k = 0; k < cols; k++) {
      while (text[at] === " ") at++;
      NUM.lastIndex = at;
      const m = NUM.exec(text);
      if (!m) break;
      nums.push({ raw: m[1], end: at + m[0].length });
      at += m[0].length;
    }
    if (nums.length !== cols) continue;
    const val = (s: string) => Number(s.replace(/,/g, ""));
    const entries = nums.slice(0, -1), tot = nums[nums.length - 1];
    const sum = entries.reduce((a, n) => a + val(n.raw), 0);
    const dp = Math.max(...nums.map((n) => (n.raw.split(".")[1] ?? "").length));
    if (Math.abs(sum - val(tot.raw)) > 0.5 * 10 ** -dp + 1e-9 * Math.abs(sum)) continue; // ties exactly, at its printed precision
    const periods = [...years.map(String), ...(thereafter ? ["Thereafter"] : [])];
    const start = h.index ?? 0;
    return entries.map((n, k) => ({ period: periods[k], amount: { value: `$ ${n.raw}`, src: { sentence: text.slice(start, n.end).trim(), url } } }));
  }
  return null;
}
