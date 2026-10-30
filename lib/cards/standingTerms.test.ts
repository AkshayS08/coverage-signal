/**
 * SESSION 27 (Akshay, Oct 30, 2026) — STANDING TERMS FROM THE LATEST 10-K,
 * TAGGED, BOUNDED. Rule 66 governs balances (amounts stated as of a date:
 * drawn, outstanding, letters of credit outstanding, available). A standing
 * term (a facility's maturity or size, a sub-limit, a note's coupon and
 * maturity) holds until amended: stated only in the latest 10-K, it renders
 * with the "10-K" tag, provided no filing in the read set after that 10-K
 * amends or replaces that facility (an 8-K Item 1.01, 1.02 or 2.03 naming it,
 * or a 10-Q stating an amendment of it). If one does, the term comes from
 * that filing, or shows "not stated".
 *
 *   T1  a maturity and a size stated only in the 10-K are kept, marked as
 *       10-K standing terms; a drawn balance from the 10-K is removed
 *   T2  control: an 8-K (Item 1.01) after the 10-K that amends the facility
 *       stops the 10-K term: taken from the 8-K where it states it, else not
 *       stated
 *   T3  control: an 8-K (Item 2.03) about notes, not naming the facility, and
 *       a 10-Q's "as amended to date" formula do not stop the term
 *   T4  control: where Rule 66 permits the 10-K (mayRead), nothing is tagged
 *       and nothing removed
 *   T5  Tenet's card: the revolver and the L/C facility show "November 4,
 *       2030", each with the 10-K tag
 *
 * Offline, $0. Run: npx tsx lib/cards/standingTerms.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retargetAnnualReportFigures } from "../agent/verifyFacility";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };

const K = "https://sec.gov/10k.htm", Q = "https://sec.gov/10q.htm", E = "https://sec.gov/8k.htm";
const kText = "Our 2025 Credit Agreement provides for revolving loans of up to $1.9 billion. The 2025 Credit Agreement will terminate on November 4, 2030. At December 31, 2025, we had $ 50 million of borrowings outstanding under the 2025 Credit Agreement.";
const qText = "We have a senior secured revolving credit facility (as amended to date, the \"Credit Agreement\"). At June 30, 2026, we had no borrowings outstanding under the Credit Agreement.";
const fac = () => ({
  name: "senior secured revolving credit facility", category: "revolver",
  facilitySize: { value: "$1.9 billion", sourceLine: "Our 2025 Credit Agreement provides for revolving loans of up to $1.9 billion." },
  maturity: { value: "November 4, 2030", sourceLine: "The 2025 Credit Agreement will terminate on November 4, 2030." },
  drawn: { value: "$ 50 million", sourceLine: "At December 31, 2025, we had $ 50 million of borrowings outstanding under the 2025 Credit Agreement." },
  lettersOfCredit: null, available: null, citedUrl: K, figureSources: {},
});
const run = (later: any[], extra: Record<string, string> = {}, mayRead = false) => retargetAnnualReportFigures({
  facilities: [fac()] as any, textByUrl: new Map(Object.entries({ [K]: kText, [Q]: qText, ...extra })), isAnnualReport: (u) => u === K,
  anchorUrl: Q, anchorReportDate: "2026-06-30", enforced: true, mayRead, gateReason: "test",
  annualReportDate: "2026-02-17", laterFilings: later,
} as any);

const t1 = run([{ url: Q, form: "10-Q", filingDate: "2026-07-29", items: "" }]);
const f1: any = t1.facilities[0];
assert(f1.maturity?.value === "November 4, 2030" && f1.facilitySize?.value === "$1.9 billion" && JSON.stringify(f1.standingFrom10K ?? []) === JSON.stringify(["facilitySize", "maturity"]), `[T1] maturity and size kept as 10-K standing terms (${JSON.stringify(f1.standingFrom10K)})`);
assert(f1.drawn === null, `[T1] the 10-K's drawn balance is removed (a balance, Rule 66)`);

const amend = "On March 3, 2026, we entered into an amendment to the Credit Agreement that extends the scheduled maturity of the senior secured revolving credit facility to March 3, 2031.";
const t2 = run([{ url: E, form: "8-K", filingDate: "2026-03-05", items: "1.01,9.01" }], { [E]: amend });
const f2: any = t2.facilities[0];
assert(f2.maturity === null && !(f2.standingFrom10K ?? []).includes("maturity"), `[T2 control] an 8-K (1.01) amending the facility after the 10-K stops the 10-K maturity; the 8-K states a different date, so the maturity is not stated (got ${JSON.stringify(f2.maturity)})`);
const restate = "On March 3, 2026, we entered into an amendment to the Credit Agreement; the senior secured revolving credit facility will terminate on November 4, 2030.";
const f2b: any = run([{ url: E, form: "8-K", filingDate: "2026-03-05", items: "1.01" }], { [E]: restate }).facilities[0];
assert(f2b.maturity?.value === "November 4, 2030" && f2b.maturity?.sourceLine === restate && !(f2b.standingFrom10K ?? []).includes("maturity"), `[T2 control] where the amending 8-K states the term, it comes from the 8-K, untagged`);

const notes = "On September 22, 2026, we issued $2,000 million aggregate principal amount of 6.250% senior secured first lien notes due 2034.";
const f3: any = run([{ url: E, form: "8-K", filingDate: "2026-09-22", items: "2.03,9.01" }, { url: Q, form: "10-Q", filingDate: "2026-07-29", items: "" }], { [E]: notes }).facilities[0];
assert(f3.maturity?.value === "November 4, 2030" && (f3.standingFrom10K ?? []).includes("maturity"), `[T3 control] an 8-K (2.03) about notes, and the 10-Q's "as amended to date", do not stop the 10-K term`);

const f4: any = run([], {}, true).facilities[0];
assert(!f4.standingFrom10K && f4.drawn !== null && f4.maturity !== null, `[T4 control] where Rule 66 permits the 10-K, nothing is tagged or removed`);

console.log("\n=== T5: Tenet's card ===");
const card = JSON.parse(readFileSync(join("lib", "cards", "generated", "0000070318.json"), "utf-8"));
const dates: any[] = [];
const walk = (o: any) => { if (!o || typeof o !== "object") return; if (o.k === "date" && o.t === "November 4, 2030") dates.push(o); for (const v of Object.values(o)) walk(v); };
walk(card.v3.facilities);
assert(dates.length === 2 && dates.every((d) => d.tenK === true), `[T5] the revolver and the L/C facility each show "November 4, 2030" with the 10-K tag (${dates.length} found, tagged: ${dates.map((d) => !!d.tenK).join(", ")})`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
