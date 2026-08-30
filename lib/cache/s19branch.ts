/** THROWAWAY — Session 19: which companies' inputs does the marker fix change? */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection } from "../fetch/debtNoteLocator";

const LEAD = 40000;
const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

async function main() {
  console.log("company                       form  chars    noteStart  branch        input changes?");
  for (const c of ALL) {
    const f = await getRecentFilings(c, ["8-K","10-Q","10-K"]);
    const tenq = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
    if (!tenq) { console.log(`${c.padEnd(28)}  (no 10-Q/10-K)`); continue; }
    const raw = await getFilingText(tenq.primaryDocUrl);
    const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
    if (text.length <= LEAD) { console.log(`${c.padEnd(28)}  ${tenq.form.padEnd(4)}  ${String(text.length).padStart(6)}  under cap    unchanged`); continue; }
    const loc = locateDebtNoteSection(text);
    if (loc.status !== "found") { console.log(`${c.padEnd(28)}  ${tenq.form.padEnd(4)}  ${String(text.length).padStart(6)}  not found    unchanged`); continue; }
    const early = loc.start < LEAD;   // the CORRECTED condition
    const straddle = early && loc.end > LEAD;
    console.log(`${c.padEnd(28)}  ${tenq.form.padEnd(4)}  ${String(text.length).padStart(6)}  ${String(loc.start).padStart(7)}   ${(straddle ? "STRADDLE (was cut)" : early ? "EARLY (was silent)" : "late (was marked)").padEnd(20)} ${early ? "YES" : "no"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
