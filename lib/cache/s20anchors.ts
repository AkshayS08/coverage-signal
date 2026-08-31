/** THROWAWAY — Session 20 Stage 4: which filing is each company's rendered anchor, and is it the newest 10-Q/10-K? Free. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readFileSync } from "node:fs";
import { getRecentFilings } from "../fetch";
import type { CompanyResult } from "../agent";

const book = JSON.parse(readFileSync(process.argv[2] ?? "baselines/s20-stage3.json", "utf8")) as { company: string; result: CompanyResult }[];

(async () => {
  for (const { company, result } of book) {
    const dm = result.results.find((r) => r.triggerId === "debt-maturity");
    const f = await getRecentFilings(company, ["8-K", "10-Q", "10-K"]);
    const periodic = f.filings.filter((x) => x.form === "10-Q" || x.form === "10-K").sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const newest = periodic[0];
    const rowUrls = [...new Set((dm?.scheduleSequence ?? []).map((e) => e.citedUrl))];
    const capUrls = [...new Set((dm?.balanceSheetDebtCaptions ?? []).map((e) => (e as { citedUrl?: string }).citedUrl))];
    const urls = [...new Set([...rowUrls, ...capUrls])].filter(Boolean) as string[];
    const which = urls.map((u) => {
      const hit = periodic.find((p) => p.primaryDocUrl === u);
      return hit ? `${hit.form} ${hit.filingDate} (period ${hit.reportDate})` : `?? ${u.slice(-40)}`;
    });
    const stale = urls.length > 0 && !urls.includes(newest.primaryDocUrl);
    console.log(
      `${company.padEnd(26)} newest=${newest.form} ${newest.filingDate} (period ${newest.reportDate})  rows=${(dm?.scheduleSequence ?? []).length} caps=${(dm?.balanceSheetDebtCaptions ?? []).length}  anchor=${which.join(" | ") || "none"}${stale ? "   <<< STALE" : ""}`
    );
  }
})();
