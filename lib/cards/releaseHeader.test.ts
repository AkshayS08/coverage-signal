/**
 * SESSION 27 (Akshay, Nov 20): THE RELEASE HEADER.
 *
 *   B1  one brief date per release: every published card renders at the same brief date (the release date), with the
 *       same brief week and 18-month window
 *   B2  control: a release with mixed brief dates fails (mixedBriefDates)
 *   F1  each card serves its last build; the filings since that build are listed in its header — Cigna's Nov 5 10-Q
 *       (its card serves the Oct 15 build) though it falls before the brief week
 *   F2  a filing that was read and failed its checks is never "read at the next refresh": the header and banner say it
 *       was read and why the card stays on the prior position, with the gap — Cigna: "Nov 5 10-Q read: its Sept 30 debt
 *       doesn't reconcile to the balance sheet ($194MM, 0.62%), so this card stays at June 30."
 *   F3  control: without the failed read recorded, the same filing reads "read at the next refresh"; with the old
 *       window (since the previous brief), the Nov 5 10-Q is not in the header at all
 *   F4  the failed read is derived from the failing build's own breakage panel (failedReads.failedReadFromCard)
 *
 * Offline, $0. Run: ANTHROPIC_API_KEY="" npx tsx lib/cards/releaseHeader.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { buildCard } from "./build";
import { mixedBriefDates } from "./releaseBrief";
import { failedReadFromCard, failedReadLine } from "./failedReads";
import { READ_WHEN } from "./filingWords";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s?.t ?? "").join("");

// B1 / B2 over the generated cards
const index = read("lib/cards/generated/index.json");
const cards = nonEmpty("the published cards", (index.ciks as string[]).map((c) => read(`lib/cards/generated/${c}.json`)));
const mixed = mixedBriefDates(cards, index.briefDate);
assert(mixed.length === 0, `[B1] every published card at ${index.briefDate}: ${mixed.join("; ") || `${cards.length} cards, one brief week "${cards[0].v3.header.label}", one window "${cards[0].v3.call?.label}"`}`);
const clone = JSON.parse(JSON.stringify(cards));
clone[0].briefDate = "2026-11-16"; clone[0].v3.header.label = "Weekly coverage brief · Nov 10 to Nov 16, 2026";
assert(mixedBriefDates(clone, index.briefDate).length > 0, `[B2 control] a release with mixed brief dates fails: ${mixedBriefDates(clone, index.briefDate).join("; ")}`);

// F4: the failed read, from Cigna's failed Nov 5 refresh build
const failCard = read("sessions/27/refresh/0001739940_review_card.json"), failInput = read("sessions/27/refresh/0001739940_input.json");
const fr = failedReadFromCard(failCard, failInput)!;
assert(!!fr && fr.form === "10-Q" && fr.filingDate === "2026-11-05" && Math.round(fr.gapUsd / 1e6) === 194 && fr.gapPct === "0.62%", `[F4] from the failing build's breakage: ${fr ? `${fr.form} ${fr.filingDate}, period ${fr.periodEnd}, gap $${fr.gapUsd / 1e6}MM (${fr.gapPct})` : "none"}`);

// F1 / F2 / F3: Cigna's card at the release date
const RELEASE = "2026-11-20";
const cig = read("sessions/27/cigna_facts/input.json"), cigFacts = read("sessions/27/cigna_facts/0001739940.json");
const tenQ = { form: "10-Q", filingDate: "2026-11-05", items: "", primaryDocUrl: fr.url, accessionNumber: "", reportDate: "2026-09-30", primaryDocument: "" };
const eightK = { form: "8-K", filingDate: "2026-11-05", items: "2.02,9.01", primaryDocUrl: "https://www.sec.gov/Archives/edgar/data/1739940/x-8k-20261105.htm", accessionNumber: "", reportDate: "", primaryDocument: "" };
const render = (weekFilings: any[], failedReads: any[], sinceBuild: string | null) => buildCard({ result: cig.result, briefDate: RELEASE, previousBrief: "2026-11-09", weekFilings, cash: cig.cash, textByUrl: new Map(Object.entries(cig.docs as Record<string, { text: string }>).map(([u, d]) => [u, d.text])), periodSentence: cig.periodSentence, laterUrls: [], facts: cigFacts, failedReads, sinceBuild });
const want = "Nov 5 10-Q read: its Sept 30 debt doesn't reconcile to the balance sheet ($194MM, 0.62%), so this card stays at June 30.";
const c = render([tenQ, eightK], [fr], "2026-10-15");
const banner = c.v3!.header.actionable.map(txt), status = txt(c.v3!.header.status);
assert(banner.includes(want) && failedReadLine(fr, "2026-06-30") === want, `[F2] banner: ${banner.join(" | ")}`);
assert(/Nov 5, 2026, read/.test(status) && !new RegExp(`10-Q \\(quarterly report\\) Nov 5, 2026[^;]*${READ_WHEN}`).test(status) && /since this card's build of Oct 15/.test(status), `[F1/F2] status: ${status}`);
const noReg = render([tenQ, eightK], [], "2026-10-15");
assert(noReg.v3!.header.actionable.map(txt).some((l: string) => l.includes(READ_WHEN) && /Nov 5/.test(l)), `[F3 control] without the failed read recorded, it reads "${READ_WHEN}"`);
const oldWindow = render([], [fr], null);
assert(!txt(oldWindow.v3!.header.status).includes("Nov 5"), `[F3 control] with only the brief week (Nov 14 to Nov 20), the Nov 5 10-Q is not in the header: "${txt(oldWindow.v3!.header.status)}"`);
void existsSync;

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
