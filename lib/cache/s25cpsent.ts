import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { getRecentFilings, getFilingText } from "../fetch";
(async () => {
  const f = await getRecentFilings("Cigna Group", ["8-K", "10-Q", "10-K"]);
  const q = f.filings.find((x) => /^10-Q$/i.test(x.form) && x.reportDate === "2026-06-30")!;
  const { text } = await getFilingText(q.primaryDocUrl);
  console.log(`anchor: ${q.primaryDocUrl.split("/").pop()}  ${text.length.toLocaleString()} chars\n`);
  const sentences = text.split(/(?<=[.;])\s+/).map((s) => s.replace(/\s+/g, " ").trim());
  console.log("--- every sentence naming commercial paper ---");
  for (const s of sentences) if (/commercial paper/i.test(s) && s.length < 420) console.log(`   "${s}"`);
})();
