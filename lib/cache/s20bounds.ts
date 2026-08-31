/** THROWAWAY — Session 20 Stage 4: would a note-boundary span rule reach the whole note? Free. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection } from "../fetch/noteLocation";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

const WIDE = /(?:\bnotes?\s+)?(\d{1,2})\s*([.)–—:-])\s+((?:[A-Za-z][A-Za-z-]*\s+){0,5}?debt)\b/gi;

function headingsWide(text: string) {
  const out: { at: number; n: number; sep: string; s: string }[] = [];
  const r = new RegExp(WIDE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 30 && !/^0/.test(m[1])) out.push({ at: m.index, n, sep: m[2], s: m[0].replace(/\s+/g, " ").trim() });
    if (r.lastIndex === m.index) r.lastIndex++;
  }
  return out;
}

/** The next sibling note heading: same number+1, same separator, followed by a capitalised word. */
function nextSibling(text: string, from: number, n: number, sep: string): number | null {
  const esc = "\\" + sep;
  const re = new RegExp(String.raw`(?:\bNotes?\s+)?\b` + (n + 1) + String.raw`\s*` + esc + String.raw`\s+[A-Z]`, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : null;
}

(async () => {
  for (const c of ALL) {
    const f = await getRecentFilings(c, ["8-K", "10-Q", "10-K"]);
    const fl = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
    const raw = await getFilingText(fl.primaryDocUrl);
    const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
    const loc = locateDebtNoteSection(text);
    const cur = loc.status === "found" ? `${loc.start}-${loc.end} (${loc.end - loc.start}ch, via=${loc.via})` : "NOT FOUND";
    const hs = headingsWide(text);
    const anchor = loc.status === "found"
      ? hs.filter((h) => h.at <= loc.end).sort((a, b) => Math.abs(a.at - loc.start) - Math.abs(b.at - loc.start))[0]
      : hs[0];
    let proposed = "—";
    if (anchor) {
      const sib = nextSibling(text, anchor.at + 50, anchor.n, anchor.sep);
      proposed = `"${anchor.s}" @${anchor.at} → sibling ${anchor.n + 1}${anchor.sep} @${sib ?? "none"}  span ${anchor.at - 200}-${sib ?? "n/a"} (${sib ? sib - anchor.at + 200 : "n/a"}ch)`;
    }
    console.log(`\n${c} — ${fl.form} ${fl.filingDate}\n  current : ${cur}\n  proposed: ${proposed}`);
  }
})();
