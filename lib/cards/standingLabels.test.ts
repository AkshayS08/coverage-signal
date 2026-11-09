/**
 * SESSION 27 (Akshay, Nov 9, 2026) — SENIORITY AND SECURITY ARE STANDING TERMS (the Nov 1 rule).
 *
 * A note's seniority and security, stated only in the latest 10-K, label it with the "10-K" tag unless a later filing
 * in the read set amends the instrument. This replaces "stated only in an earlier annual report, which this card does
 * not use for labels". Over every card that can be shown or signed:
 *   L1  every label sourced from a 10-K sentence carries the 10-K tag
 *   L2  no card says "does not use for labels" where it holds the 10-K statement and no later filing amends the notes
 *   L3  Encompass: its four senior notes read "senior unsecured", tagged 10-K, linked to the 10-K's sentence; no
 *       "Seniority not stated" in its chart legend
 *   controls: a 10-K label without its tag fails L1; the old "Not shown" line fails L2
 *
 * Offline, $0. Run: npx tsx lib/cards/standingLabels.test.ts
 */
import { shownCards } from "./shownCards";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const txt = (l: any): string => (typeof l === "string" ? l : (Array.isArray(l) ? l : l ? [l] : []).map((s: any) => (typeof s === "string" ? s : s.t ?? s.printed ?? "")).join(""));
const clone = (o: any) => JSON.parse(JSON.stringify(o));

/** L1: every label segment linked to a 10-K sentence carries the tag. */
function l1(card: any): string[] {
  const out: string[] = [];
  (function walk(o: any) {
    if (!o || typeof o !== "object") return;
    if (o.k === "label" && /^10-K\b/.test(o.src?.doc ?? "") && /\b(?:senior|secured|unsecured|subordinated|junior|first[- ]lien)\b/i.test(o.t) && !o.tenK) out.push(`"${o.t}" is sourced from the 10-K but carries no 10-K tag`);
    for (const v of Object.values(o)) walk(v);
  })(card.v3);
  return [...new Set(out)];
}
/** L2: the old policy's line, where the statement is held and unamended. */
function l2(card: any, input: any): string[] {
  const dm = input.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const st = dm.seniorityStatement?.statement as string | undefined;
  const held = !!st && Object.values(input.docs as Record<string, { label: string; text: string }>).some((d) => /^10-K/.test(d.label) && d.text.replace(/\s+/g, " ").includes(st.slice(0, 60)));
  const line = (card.v3.notShown ?? []).map(txt).find((l: string) => /does not use for labels/.test(l));
  return held && line ? [`"${line.slice(0, 90)}…" although the card holds the 10-K statement`] : [];
}

const shown = nonEmpty("the cards that can be shown or signed", shownCards());
for (const s of shown) {
  const a = l1(s.card), b = l2(s.card, s.input);
  assert(a.length === 0, `[L1:${s.card.company} ${s.label}]${a.length ? ` — ${a.join("; ")}` : " holds"}`);
  assert(b.length === 0, `[L2:${s.card.company} ${s.label}]${b.length ? ` — ${b.join("; ")}` : " holds"}`);
}
for (const s of shown.filter((x) => x.cik === "0000785161")) {
  const notes = s.card.v3.table.rows.filter((r: any) => /Senior Notes due/i.test(r.name));
  const ok = notes.length === 4 && notes.every((r: any) => /senior unsecured/i.test(txt(r.instrument)) && r.instrument.some((x: any) => x.k === "label" && x.tenK && /^10-K/.test(x.src?.doc ?? "")));
  assert(ok, `[L3:Encompass ${s.label}] its four senior notes read "senior unsecured", tagged 10-K (${notes.map((r: any) => txt(r.instrument)).join(" | ")})`);
  const legend = s.card.v3.chart.legend.map((l: any) => txt(l.label ?? l.text ?? [])).join(" | ");
  assert(!/Seniority not stated/.test(legend), `[L3:Encompass ${s.label}] no "Seniority not stated" in the chart legend ("${legend}")`);
}

console.log("\n=== controls ===");
const enc = shown.find((s) => s.cik === "0000785161" && s.label === "published")!;
const c1 = clone(enc.card); (function strip(o: any) { if (!o || typeof o !== "object") return; if (o.k === "label") delete o.tenK; for (const v of Object.values(o)) strip(v); })(c1.v3);
c1.v3.table.rows[0].instrument.push({ k: "label", t: "senior unsecured", stated: "senior, unsecured", src: { sentence: "The Senior Notes are senior, unsecured obligations…", url: "u", doc: "10-K 2026-02-20" } });
assert(l1(c1).length > 0, `[L1 control] a 10-K-sourced label without its tag is flagged`);
const c2 = clone(enc.card); c2.v3.notShown = [[{ k: "text", t: "Seniority and security are stated only in an earlier annual report, which this card does not use for labels: “The Senior Notes are senior, unsecured obligations…”" }]];
const inputWith10K = clone(enc.input); inputWith10K.docs["k"] = { label: "10-K 2026-02-20", text: inputWith10K.result.results.find((t: any) => t.triggerId === "debt-maturity").seniorityStatement.statement };
assert(l2(c2, inputWith10K).length > 0, `[L2 control] the old "does not use for labels" line, with the 10-K statement held, is flagged`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
