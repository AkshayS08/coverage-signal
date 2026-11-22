/**
 * SESSION 27 (Akshay, Nov 14, 2026) — THE HEADER NEVER CHARACTERISES AN UNREAD FILING.
 *
 * Each new filing is named in plain words by form and item ("8-K (public disclosure)", "8-K (earnings results)",
 * "8-K (officer change)", "10-Q (quarterly report)"), from ONE shared mapping (filingWords.ts), and the header says when
 * it will be read ("read at the next refresh"). Nothing says what an unread filing does or does not do to debt: no
 * "none with a debt item", "none affecting debt", "may affect debt", "Why it matters".
 *   H1  over every shown card: the header (status and new-filing lines) characterises no unread filing
 *   H2  every new filing the header names is named by plainFilingName and followed by "read at the next refresh"
 *   H3  build.ts names filings only through filingWords.ts (no item map of its own)
 *   control: Encompass's header as committed before this rule (fa99441~1, pinned: HEAD now holds the rule) fails H1
 *
 * Nov 16: a named filing in the build's read set says it was read for this card (headerReadSet.test checks which).
 *
 * Offline, $0. Run: npx tsx lib/cards/headerFilings.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { shownCards } from "./shownCards";
import { ITEM_WORDS, plainFilingName, READ_WHEN, READ_FOR_CARD } from "./filingWords";
import { loadFailedReads } from "./failedReads";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const CHARACTERISES = /none with a debt item|affecting debt|may affect debt|Why it matters|none affecting|not affecting/i;
export const headerText = (card: any): string => [txt(card.v3.header.status), ...(card.v3.header.actionable ?? []).map(txt)].join(" | ");

/**
 * Nov 21, following Akshay's ruling of Nov 20 (item 2) — and no further: a filing READ by a build that failed its checks
 * is not a new filing. Its banner names it as he worded it ("Nov 5 10-Q read: its Sept 30 debt doesn't reconcile …"),
 * so H2's plain-words rule for new filings does not apply to that one segment: a filing recorded in
 * baselines/failed_reads.json, opening a line that continues " read: its ". Any other filing is still held to H2
 * (control below).
 */
const failedReadBanners = (card: any): Set<any> => {
  const recorded = new Set(loadFailedReads(card.cik).map((r) => r.url));
  return new Set((card.v3.header.actionable ?? []).filter((l: any[]) => l[0]?.k === "filing" && recorded.has(l[0].url) && /^ read: its /.test(l[1]?.t ?? "")).map((l: any[]) => l[0]));
};
for (const s of shownCards()) {
  const h = headerText(s.card);
  const banners = failedReadBanners(s.card);
  const filings = [...(s.card.v3.header.status ?? []), ...(s.card.v3.header.actionable ?? []).flat()].filter((x: any) => x.k === "filing" && x.url !== s.card.v3.header.filing?.url && !banners.has(x));
  const unnamed = filings.filter((f: any) => !Object.values(ITEM_WORDS).some((w) => f.t.includes(w)) && !/\((?:quarterly|annual) report|insider|ownership|proxy|share plans|registration|other filing\)/.test(f.t));
  assert(!CHARACTERISES.test(h) && unnamed.length === 0 && (filings.length === 0 || h.includes(READ_WHEN) || h.includes(READ_FOR_CARD)), `[H1/H2:${s.card.company} ${s.label}] "${h.slice(0, 150)}"${unnamed.length ? `; not named in plain words: ${unnamed.map((f: any) => f.t).join(", ")}` : ""}`);
}
assert(plainFilingName({ form: "8-K", items: "7.01,9.01" }) === "8-K (public disclosure)" && plainFilingName({ form: "8-K", items: "2.02,7.01,9.01" }) === "8-K (earnings results, public disclosure)" && plainFilingName({ form: "8-K", items: "5.02" }) === "8-K (officer change)" && plainFilingName({ form: "10-Q", items: "" }) === "10-Q (quarterly report)", `[H2] the shared names: "${plainFilingName({ form: "8-K", items: "7.01,9.01" })}", "${plainFilingName({ form: "8-K", items: "2.02,7.01,9.01" })}"`);
const build = readFileSync("lib/cards/build.ts", "utf-8");
assert(/from "\.\/filingWords"/.test(build) && !/const (?:ACTIONABLE_ITEMS|ITEM_WHAT|FORM_WHAT|WHY)\b/.test(build), `[H3] build.ts names filings only through filingWords.ts`);
const before = JSON.parse(execSync("git show fa99441~1:lib/cards/generated/0000785161.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(CHARACTERISES.test(headerText(before)), `[control] Encompass's header before this rule: "${headerText(before).slice(0, 120)}"`);

// Control for the Nov 20 (item 2) exemption: the same banner on a filing NOT recorded as a failed read is not exempt.
{
  const cig = JSON.parse(require("node:fs").readFileSync("lib/cards/generated/0001739940.json", "utf-8"));
  const forged = JSON.parse(JSON.stringify(cig));
  for (const l of forged.v3.header.actionable) if (l[0]?.k === "filing" && /^ read: its /.test(l[1]?.t ?? "")) l[0].url = "https://www.sec.gov/Archives/edgar/data/1739940/not-a-recorded-read.htm";
  assert(failedReadBanners(cig).size === 1 && failedReadBanners(forged).size === 0, `[H3 control, Nov 20 item 2] Cigna's recorded failed read is exempt (${failedReadBanners(cig).size}); the same wording on an unrecorded filing is not (${failedReadBanners(forged).size})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
