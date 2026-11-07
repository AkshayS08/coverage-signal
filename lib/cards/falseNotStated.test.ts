/**
 * SESSION 27 (Akshay, Oct 31, 2026) — NO FIGURE FOUND IN A READ DOCUMENT
 * RENDERS AS "NOT STATED". Encompass's letters of credit ($46.3 million) are
 * stated — only in the 10-K, and as of December 31, 2025 — so the card said
 * "Letters of credit outstanding not stated", a false not-stated. A figure
 * stated only in the 10-K, as of an earlier date, renders "stated only as of
 * [date] in the 10-K; not shown".
 *
 *   N1  every committed card of the six: for every facility, a field whose
 *       figure the pipeline found in a read document (removed under Rule 66,
 *       or withheld) never renders "not stated"
 *   N2  Encompass: "Letters of credit outstanding: stated only as of December
 *       31, 2025 in the 10-K; not shown."
 *   N3  control: the same card with that line put back to "Letters of credit
 *       outstanding not stated." is flagged
 *
 * Offline, $0. Run: npx tsx lib/cards/falseNotStated.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nonEmpty } from "../testing/nonEmpty";
import { shownCards } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const CIKS = nonEmpty("the published cards", JSON.parse(readFileSync(join("lib", "cards", "generated", "index.json"), "utf-8")).ciks as string[]);
const txt = (l: any[] | null) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
/** How each facility field reads on the card when it claims the filing states nothing. */
const NOT_STATED: Record<string, RegExp> = {
  lettersOfCredit: /Letters of credit outstanding not stated/i,
  available: /Availability not stated/i,
  facilitySize: /facility size not stated/i,
  maturity: /Maturity not stated|no maturity stated/i,
  drawn: /drawn not stated/i,
};

/** Fields the pipeline found a figure for in some read document: removed under Rule 66, or withheld with a reason. */
function foundFields(result: any): Map<string, Set<string>> {
  const dm = result.results.find((t: any) => t.triggerId === "debt-maturity");
  const out = new Map<string, Set<string>>();
  const add = (fac: string, field: string) => (out.get(fac) ?? out.set(fac, new Set()).get(fac)!).add(field);
  for (const f of dm.facilities ?? []) for (const field of [...(f.removedUnderRule66 ?? []), ...(f.removedUnderRule66Detail ?? []).map((d: any) => d.field)]) add(f.name, field);
  for (const r of dm.facilityRejections ?? []) add(r.facility, r.field);
  return out;
}
function violations(card: any, result: any): string[] {
  const out: string[] = [];
  const found = foundFields(result);
  const facLines: { line: string }[] = card.v3.facilities.map((f: any) => ({ line: `${txt(f.bold)} ${txt(f.sub)}` }));
  for (const [fac, fields] of found) for (const field of fields) {
    const words = fac.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    for (const l of facLines) if (words.some((w) => l.line.toLowerCase().includes(w)) && NOT_STATED[field]?.test(l.line)) out.push(`${fac}.${field}: "${l.line.match(NOT_STATED[field])![0]}"`);
  }
  return out;
}

// Nov 7: over every card that can be shown or signed (lib/cards/shownCards.ts), never only the published ones.
for (const shown of shownCards()) {
  const card = shown.card;
  const result = shown.input.result;
  const v = violations(card, result);
  assert(v.length === 0, `[N1:${card.company}${shown.label === "review" ? " review" : ""}] no field with a figure found in a read document renders "not stated"${v.length ? ` — ${v.join("; ")}` : ""}`);
}
// Nov 3: the published brief moved to Nov 3; this fixture is the Oct 15 brief, read from its archive.
const ehc = JSON.parse(readFileSync(join("lib", "cards", "archive", "2026-10-15", "generated", "0000785161.json"), "utf-8"));
const ehcResult = JSON.parse(readFileSync(join("lib", "cards", "archive", "2026-10-15", "inputs", "0000785161.json"), "utf-8")).result;
const all = ehc.v3.facilities.map((f: any) => `${txt(f.bold)} ${txt(f.sub)}`).join(" | ");
assert(/Letters of credit outstanding: stated only as of December 31, 2025 in the 10-K; not shown\./.test(all), `[N2:Encompass] "Letters of credit outstanding: stated only as of December 31, 2025 in the 10-K; not shown." (facilities: ${all.slice(0, 220)})`);
const bad = JSON.parse(JSON.stringify(ehc));
for (const f of bad.v3.facilities) for (const s of f.sub ?? []) if (typeof s.t === "string") s.t = s.t.replace(/Letters of credit outstanding: stated only as of [^;]+; not shown\./, "Letters of credit outstanding not stated.");
assert(violations(bad, ehcResult).length > 0, `[N3 control] the false "Letters of credit outstanding not stated." is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
