import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { runAgentLoop } from "./loop";

async function main() {
  const company = process.argv[2] || "DaVita";
  const result = await runAgentLoop(company);

  console.log(`\n=== Assessed ${result.results.length}/15 triggers for ${result.company} ===`);
  const unavailable = result.results.filter((r) => !r.dataAvailable);
  console.log(`  dataAvailable=false (searched, no public signal): ${unavailable.length}`);
  for (const r of unavailable) {
    console.log(`    - ${r.triggerName}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
