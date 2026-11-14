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
 *   control: Encompass's header as committed before this rule fails H1
 *
 * Offline, $0. Run: npx tsx lib/cards/headerFilings.test.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { shownCards } from "./shownCards";
import { ITEM_WORDS, plainFilingName, READ_WHEN } from "./filingWords";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
const CHARACTERISES = /none with a debt item|affecting debt|may affect debt|Why it matters|none affecting|not affecting/i;
export const headerText = (card: any): string => [txt(card.v3.header.status), ...(card.v3.header.actionable ?? []).map(txt)].join(" | ");

for (const s of shownCards()) {
  const h = headerText(s.card);
  const filings = [...(s.card.v3.header.status ?? []), ...(s.card.v3.header.actionable ?? []).flat()].filter((x: any) => x.k === "filing" && x.url !== s.card.v3.header.filing?.url);
  const unnamed = filings.filter((f: any) => !Object.values(ITEM_WORDS).some((w) => f.t.includes(w)) && !/\((?:quarterly|annual) report|insider|ownership|proxy|share plans|registration|other filing\)/.test(f.t));
  assert(!CHARACTERISES.test(h) && unnamed.length === 0 && (filings.length === 0 || h.includes(READ_WHEN)), `[H1/H2:${s.card.company} ${s.label}] "${h.slice(0, 150)}"${unnamed.length ? `; not named in plain words: ${unnamed.map((f: any) => f.t).join(", ")}` : ""}`);
}
assert(plainFilingName({ form: "8-K", items: "7.01,9.01" }) === "8-K (public disclosure)" && plainFilingName({ form: "8-K", items: "2.02,7.01,9.01" }) === "8-K (earnings results, public disclosure)" && plainFilingName({ form: "8-K", items: "5.02" }) === "8-K (officer change)" && plainFilingName({ form: "10-Q", items: "" }) === "10-Q (quarterly report)", `[H2] the shared names: "${plainFilingName({ form: "8-K", items: "7.01,9.01" })}", "${plainFilingName({ form: "8-K", items: "2.02,7.01,9.01" })}"`);
const build = readFileSync("lib/cards/build.ts", "utf-8");
assert(/from "\.\/filingWords"/.test(build) && !/const (?:ACTIONABLE_ITEMS|ITEM_WHAT|FORM_WHAT|WHY)\b/.test(build), `[H3] build.ts names filings only through filingWords.ts`);
const before = JSON.parse(execSync("git show HEAD:lib/cards/generated/0000785161.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(CHARACTERISES.test(headerText(before)), `[control] Encompass's header before this rule: "${headerText(before).slice(0, 120)}"`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
