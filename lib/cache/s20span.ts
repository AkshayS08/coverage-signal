/** THROWAWAY — Session 20 Stage 4: does the located span cover the NOTE, or just the cluster? Free. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection, findDebtNoteHeading } from "../fetch/noteLocation";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

(async () => {
  for (const c of ALL) {
    const f = await getRecentFilings(c, ["8-K", "10-Q", "10-K"]);
    const fl = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
    const raw = await getFilingText(fl.primaryDocUrl);
    const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
    const loc = locateDebtNoteSection(text);
    if (loc.status !== "found") { console.log(`${c.padEnd(26)} ${fl.form} ${fl.filingDate}  NOT FOUND`); continue; }
    const h = findDebtNoteHeading(text, loc.start, loc.end);
    console.log(`${c.padEnd(26)} ${fl.form} ${fl.filingDate}  span ${loc.start}-${loc.end} (${loc.end - loc.start}ch) via=${loc.via}  heading=${h ? `"${h.text}" @${h.at} (${loc.start - h.at} before start)` : "none"}`);
  }
})();
