import { getRecentFilings } from "./filings";

const TEST_COMPANIES = ["HCA Healthcare", "DaVita", "Encompass Health"];
const FORMS = ["8-K", "10-Q"];

async function main() {
  for (const name of TEST_COMPANIES) {
    console.log(`\n=== ${name} ===`);
    try {
      const result = await getRecentFilings(name, FORMS);
      console.log(
        `Resolved: ${result.company} (CIK ${result.cik}, ticker ${result.ticker})`
      );
      console.log(
        `  submissions pull: ${result.fromCache.submissions ? "cache hit" : "fetched fresh + cached"}`
      );
      for (const form of FORMS) {
        console.log(
          `  ${form} list: ${result.fromCache[form] ? "cache hit" : "fetched fresh + cached"}`
        );
      }

      console.log(`Found ${result.filings.length} filings (${FORMS.join(", ")}):`);
      for (const f of result.filings.slice(0, 10)) {
        console.log(`  [${f.form}] ${f.filingDate}  ${f.accessionNumber}  ${f.primaryDocUrl}`);
      }
      if (result.filings.length > 10) {
        console.log(`  ... and ${result.filings.length - 10} more`);
      }
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
    }
  }
}

main();
