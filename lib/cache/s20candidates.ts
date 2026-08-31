/** THROWAWAY — Session 20 Stage 2: every candidate span, chosen and rejected. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
import { locateDebtNoteSection, classifySpanByContent, issueSizeRatios } from "../fetch/noteLocation";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

/** Re-derives the raw coupon clusters the locator considers, so rejections are visible. */
function clustersOf(text: string): { start: number; end: number }[] {
  const COUPON = /(?:\d{1,2}\.\d{2,4}|\d{1,2}\s?[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s?%[\s\S]{0,90}?\b(?:19|20)\d{2}\b/g;
  const pos: number[] = [];
  for (const m of text.matchAll(COUPON)) pos.push(m.index ?? 0);
  const out: { start: number; end: number }[] = [];
  let cur: number[] = [];
  for (const p of pos) {
    if (cur.length && p - cur[cur.length - 1] > 1500) { if (cur.length >= 3) out.push({ start: cur[0], end: cur[cur.length - 1] + 400 }); cur = []; }
    cur.push(p);
  }
  if (cur.length >= 3) out.push({ start: cur[0], end: cur[cur.length - 1] + 400 });
  return out;
}

(async () => {
  for (const c of ALL) {
    const f = await getRecentFilings(c, ["8-K", "10-Q", "10-K"]);
    const fl = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K")
      .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
    const raw = await getFilingText(fl.primaryDocUrl);
    const text = typeof raw === "string" ? raw : (raw as { text: string }).text;
    const loc = locateDebtNoteSection(text);
    const chosen = loc.status === "found" ? { s: (loc as { start: number }).start, e: (loc as { end: number }).end } : null;

    console.error(`\n${"=".repeat(78)}\n${c}  —  ${fl.form} ${fl.filingDate}, ${text.length} chars`);
    console.error(`  SELECTED: ${loc.status === "found" ? `${chosen!.s}–${chosen!.e} via=${(loc as { via: string }).via}` : loc.status}`);

    for (const cl of clustersOf(text)) {
      const region = text.slice(cl.start, cl.end);
      const v = classifySpanByContent(region);
      const isChosen = chosen && cl.start >= chosen.s - 500 && cl.start <= chosen.e;
      const head = region.replace(/\s+/g, " ").slice(0, 62);
      const ratios = issueSizeRatios(region);
      const shown = ratios.slice(0, 4).map((r) => `${(r * 100).toFixed(2)}%`).join(" ");
      console.error(`   ${isChosen ? "→ CHOSEN " : "  reject  "} ${String(cl.start).padStart(7)}  ${v.kind.padEnd(15)} ${shown ? `[${shown}]` : ""}`);
      console.error(`              ${head}`);
      console.error(`              ${v.reason}`);
    }
  }
})();
