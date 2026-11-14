/**
 * SESSION 27 (Akshay, Nov 14, 2026) — ONE NOT-STATED CAPTION PER CAUSE UNDER A CHART.
 *
 * Found on June Cigna: three lines under the ladder for one cause (the filer states no labels for these instruments):
 * "The senior notes' security is not stated." / "For the notes, seniority and security are not stated." / "This
 * company's filings state labels for few of these instruments." They collapse to one line, by cause.
 *   K1  over every shown card: the chart's captions carry at most one not-stated line per cause
 *   K2  June Cigna's one line still names what is not stated for each type
 *   control: June Cigna's captions as committed before this rule fail K1
 *
 * Offline, $0. Run: npx tsx lib/cards/captionCauses.test.ts
 */
import { execSync } from "node:child_process";
import { shownCards, everyShownCard, inScope } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
/** The chart's not-stated lines (a caption carrying a not-stated segment): one cause, the filer's missing labels. */
export const notStatedLines = (card: any): string[] => (card.v3?.chart?.captions ?? []).filter((l: any[]) => l.some((s) => s.k === "notStated")).map(txt);

for (const s of shownCards()) { const v = notStatedLines(s.card); assert(v.length <= 1, `[K1:${s.card.company} ${s.label}] ${v.length} not-stated caption line(s)${v.length > 1 ? `: ${v.join(" | ")}` : ""}`); }
if (inScope("0001739940", "published")) {
  const june = everyShownCard().find((s) => s.cik === "0001739940" && s.label === "published")!;
  const line = notStatedLines(june.card)[0] ?? "";
  assert(/security/.test(line) && /seniority/.test(line) && /senior notes/.test(line) && /\bnotes\b/.test(line), `[K2] June Cigna: "${line}"`);
}
const before = JSON.parse(execSync("git show a81cb86:lib/cards/generated/0001739940.json", { encoding: "utf-8", maxBuffer: 64e6 }));
assert(notStatedLines(before).length > 1, `[control] June Cigna before this rule: ${notStatedLines(before).length} lines`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
