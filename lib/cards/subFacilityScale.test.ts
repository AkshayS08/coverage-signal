/**
 * SESSION 27 (Akshay, Nov 1, 2026) — DAVITA'S "LETTER-OF-CREDIT SUB-FACILITY
 * ~$0MM". Two defects, each ruled as a rule over the class:
 *
 *   (a) a sub-facility is one its own sentence places INSIDE the parent
 *       facility. DaVita's facts filed "letters of credit of approximately
 *       $ 184,758 outstanding under a separate bilateral secured letter of
 *       credit facility" — another facility's outstanding letters of credit —
 *       as a sub-facility of the revolver;
 *   (b) its amount keeps its stated scale. The card rendered verified-facts
 *       figures through displayAmount alone, so "$ 184,758" printed in
 *       thousands became $184,758 and rounded to "~$0MM". Every fact figure now
 *       goes through the single scale function (Rule 67).
 *
 * GUARD over all six and the four refreshes: no figure renders as $0MM, ~$0MM
 * or $0 unless a filing states zero (Rule 53); a non-zero source that rounds
 * to zero is a check failure.
 *
 *   F1  placement: "provides for a $15 million swingline sub-facility and a
 *       $100 million letter of credit sub-facility" is inside; control: a
 *       "separate bilateral … letter of credit facility" is not
 *   F2  DaVita's refresh card: no letter-of-credit sub-facility line; the
 *       bilateral facility still shows its ~$184.8MM outstanding
 *   F3  scale: the fact "$ 184,758" in DaVita's 10-Q renders ~$184.8MM
 *   F4  the guard, over every card; control: a "$ 184,758" rendered "~$0MM"
 *       is flagged
 *
 * Offline, $0. Run: npx tsx lib/cards/subFacilityScale.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { placedInsideParent } from "./subFacility";
import { scaledFactValue } from "./build";
import { isZeroValue } from "../agent/statedZero";
import { nonEmpty } from "../testing/nonEmpty";
import { shownCards } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any[]) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");

console.log("\n=== F1: placement ===");
assert(placedInsideParent("The Credit Agreement also provides for a $15 million swingline sub-facility and a $100 million letter of credit sub-facility, as well as incremental term loans."), `[F1] "provides for a … letter of credit sub-facility" is inside the parent`);
assert(!placedInsideParent("The Company also had letters of credit of approximately $ 184,758 outstanding under a separate bilateral secured letter of credit facility as of September 30, 2026."), `[F1 control] a separate bilateral letter of credit facility is not a sub-facility`);

console.log("\n=== F2-F3: DaVita's refresh ===");
const card = JSON.parse(readFileSync(join("sessions", "27", "refresh", "0000927066_review_card.json"), "utf-8"));
const facs = card.v3.facilities.map((f: any) => `${txt(f.bold)} | ${txt(f.sub)}`);
assert(!facs.some((l: string) => /Letter-of-credit sub-facility/i.test(l)) && facs.some((l: string) => /letter of credit facility .*~\$184\.8MM/i.test(l)), `[F2] no sub-facility line from the separate facility; its own line keeps ~$184.8MM (${facs.join(" || ").slice(0, 200)})`);
const input = JSON.parse(readFileSync(join("sessions", "27", "refresh", "0000927066_input.json"), "utf-8"));
const anchorUrl = input.result.results.find((t: any) => t.triggerId === "debt-maturity").debtScheduleSourceFiling.url;
const sentence = input.docs[anchorUrl].text.replace(/\s+/g, " ").match(/The Company also had letters of credit of approximately \$ 184,758[^.]*\./)?.[0] ?? "";
assert(!!sentence && /184[.,]8|184,758 thousand/.test(scaledFactValue("$ 184,758", sentence, input.docs[anchorUrl].text)), `[F3] "$ 184,758" takes its table's scale: "${scaledFactValue("$ 184,758", sentence, input.docs[anchorUrl].text)}"`);

console.log("\n=== F4: no figure rounds to zero ===");
/** Every rendered figure whose text is a zero; flagged unless its printed source is a stated zero. */
function zeroViolations(c: any): string[] {
  const out: string[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if ((o.k === "figure" || o.k === "computed") && typeof o.t === "string" && /^[~<]?\$0(?:\.0+)?(?:MM|B)?$/.test(o.t.trim()) && typeof o.printed === "string" && !isZeroValue(o.printed)) out.push(`"${o.printed}" renders "${o.t}"`);
    for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v);
  };
  walk(c.v3);
  return out;
}
// Nov 7: over every card that can be shown or signed (lib/cards/shownCards.ts), never only the published ones.
const all: [string, any][] = shownCards().map((x) => [x.label === "published" ? x.cik : `${x.cik} refresh`, x.card] as [string, any]);
for (const [label, c] of all) { const v = zeroViolations(c); assert(v.length === 0, `[F4:${c.company}${/refresh/.test(label) ? " refresh" : ""}] no non-zero source renders as zero${v.length ? ` — ${v.join("; ")}` : ""}`); }
const bad = JSON.parse(JSON.stringify(all[0][1])); bad.v3.facilities[0].bold.push({ k: "figure", t: "~$0MM", printed: "$ 184,758", src: { sentence: "x", url: "u", doc: "d" } });
assert(zeroViolations(bad).length > 0, `[F4 control] "$ 184,758" rendered "~$0MM" is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
