/** THROWAWAY — Session 20 Stage 3: baseline every proceedsUse value before 3f moves the key. */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync } from "node:fs";
import { runAgentLoop } from "../agent";

const ALL = ["DaVita","HCA Healthcare","Tenet Healthcare","Universal Health Services","Encompass Health",
  "Community Health Systems","Quest Diagnostics","Centene Corporation","Cigna Group","Molina Healthcare"];

(async () => {
  const out: Record<string, unknown> = {};
  for (const c of ALL) {
    const r = await runAgentLoop(c);
    const t = r.results.find((x) => x.triggerId === "new-debt-issuance");
    out[c] = t?.proceedsUse ?? null;
    console.error(`${c.padEnd(28)} ${t?.proceedsUse ? JSON.stringify(t.proceedsUse).slice(0, 120) : "(none)"}`);
  }
  writeFileSync("baselines/s20-proceedsUse-before.json", JSON.stringify(out, null, 2), "utf8");
  console.error("\nwrote baselines/s20-proceedsUse-before.json");
})();
