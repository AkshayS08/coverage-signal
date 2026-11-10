/**
 * SESSION 27 (Akshay, Nov 4, 2026) — THE SIX ACCEPTANCE FINDINGS, RULED (sessions/27/prompt_rulings_nov4.md, Part A).
 * Over all ten cards (the six published, the four refreshed), each rule with a control that must fail.
 *
 *   R1  a ladder-table maturity keeps the precision its sentence states ("due in September 2034" is Sept 2034)
 *   R2  a scheduled or expected date never dates a completed move; a completed move takes the precision of the
 *       sentence stating it done, and a scheduled day for the same move shows labelled: "Redeemed Sept 2026
 *       (scheduled for Sept 23)"; every move type
 *   R3  every outstanding commercial paper the signed answer states is a table row ("Short-term"), the first row
 *   R4  a move's effect on profit and loss (a loss or gain on extinguishment) is not a move-card fact: no acceptance
 *       fixture requires one
 *   R5  a ruled residual binds to the anchor it was ruled on (form and filing date); on another anchor the plain
 *       check governs
 *
 * Offline, $0. Run: npx tsx lib/cards/rulingsNov4.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { couponsIn } from "./labels";
import { nonEmpty } from "../testing/nonEmpty";
import { RULED, applyRuled } from "./ruledResiduals";
import { shownCards, everyShownCard, inScope } from "./shownCards";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const read = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const norm = (s: string) => s.replace(/[\s ]+/g, " ").replace(/ %/g, "%");
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

const CIKS = nonEmpty("the published cards", read(join("lib", "cards", "generated", "index.json")).ciks as string[]);
// Nov 7: over every card that can be shown or signed (lib/cards/shownCards.ts), never only the published ones.
const cards: { label: string; card: any; input: any }[] = shownCards().map((s) => ({ label: s.label === "published" ? "published" : "refresh", card: s.card, input: s.input }));
const docsFor = (input: any, card: any) => {
  const dm = input.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const urls = [dm.debtScheduleSourceFiling.url, ...(input.laterFilings ?? []).filter((x: any) => x.filingDate <= card.briefDate).map((x: any) => x.url)];
  return urls.map((u: string) => norm(input.docs[u]?.text ?? "")).filter(Boolean);
};

/** R1: the most precise maturity a held anchor-or-later sentence states for a coupon and year. */
function r1(card: any, input: any): string[] {
  const out: string[] = [];
  const texts = docsFor(input, card);
  for (const row of card.v3.table?.rows ?? []) {
    const shown = txt(row.matures);
    const year = (/\b(20\d\d)\b/.exec(shown) ?? [])[1];
    const c = couponsIn(row.name ?? txt(row.instrument))[0]?.rate;
    if (!year || c === undefined || /\b\d{1,2}, 20\d\d/.test(shown)) continue;
    let best = /^[A-Z][a-z]+\.? 20\d\d$/.test(shown) ? 1 : 0, want = "";
    for (const t of texts) for (const s of t.split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)|\s*[•●▪]\s*/)) {
      const cs = couponsIn(s);
      const at = cs.findIndex((x) => Math.abs(x.rate - c) < 1e-9);
      if (at < 0) continue;
      const stretch = s.slice(cs[at].at, cs.find((x, n) => n > at && Math.abs(x.rate - c) > 1e-9)?.at);
      for (const m of stretch.matchAll(new RegExp(`\\b(?:due|matur\\w*)(?:\\s+(?:on|in))?\\s+(${MONTHS})(?:\\s+(\\d{1,2}),)?\\s+(${year})\\b`, "g"))) {
        const p = m[2] ? 2 : 1;
        if (p > best) { best = p; want = m[0]; }
      }
    }
    if (want) out.push(`${row.name}: shows "${shown}", but a held sentence states "${want}"`);
  }
  return out;
}

/** R2: no day on a move comes from a scheduled or expected sentence, except labelled "(scheduled for …)". */
const SCHEDULED = /\bexpected to\b|\bscheduled\b|\bwill be\b|\bintends?\b|\bset for\b|\bnotice\b|\bconditional\b|\banticipat\w*/i;
function r2(card: any): string[] {
  const out: string[] = [];
  for (const m of card.v3.moves) for (const meta of [m.meta, m.retires?.meta].filter(Boolean)) {
    meta.forEach((s: any, n: number) => {
      if (s.k !== "label" || !/\b\d{1,2}, 20\d\d\b|\b[A-Z][a-z]+\.? \d{1,2}\b/.test(s.t) || !s.src?.sentence) return;
      const labelled = /\(scheduled for\s*$/.test(txt(meta.slice(0, n)));
      if (SCHEDULED.test(s.src.sentence) && !labelled) out.push(`"${txt(meta)}": the day "${s.t}" comes from "${s.src.sentence.slice(0, 90)}…", which schedules it`);
    });
  }
  return out;
}

/** R3: every outstanding commercial paper in the signed answer is the first table row, "Short-term". */
function r3(card: any, input: any): string[] {
  const dm = input.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const cp = (dm.proseInstruments ?? []).filter((p: any) => p.category === "commercial-paper" && p.amount && !/^\$?\s*[—–-]\s*$/.test(p.amount) && !/^\$?\s*0(\.0+)?\b/.test(p.amount));
  if (!cp.length) return [];
  const first = card.v3.table?.rows[0];
  return first && /commercial paper/i.test(txt(first.instrument)) && /^Short-term$/.test(txt(first.matures)) ? [] : [`the signed answer states ${cp.map((p: any) => `${p.name} (${p.amount})`).join(", ")} outstanding, but the table's first row is "${first ? `${txt(first.matures)} | ${txt(first.instrument)}` : "none"}"`];
}

/** R4: no fixture move sentence is required for a profit-and-loss effect alone. */
const PNL = /\b(?:loss|gain)\b[^.]{0,60}\b(?:on|from)\b[^.]{0,40}\b(?:extinguishment|early retirement|redemption|repurchase|refinancing)\b/i;
const r4 = (fixture: any) => (fixture.moveSentences ?? []).filter((m: any) => PNL.test(m.sentence ?? m.text ?? "")).map((m: any) => `fixture requires "${String(m.sentence ?? m.text).slice(0, 90)}…"`);

console.log("=== R1-R3 over the ten cards ===");
for (const x of cards) {
  const a = r1(x.card, x.input), b = r2(x.card), c = r3(x.card, x.input);
  assert(a.length === 0, `[R1:${x.card.company} ${x.label}] table maturities keep their stated precision${a.length ? ` — ${a.join("; ")}` : ""}`);
  assert(b.length === 0, `[R2:${x.card.company} ${x.label}] no move is dated by a scheduled sentence${b.length ? ` — ${b.join("; ")}` : ""}`);
  assert(c.length === 0, `[R3:${x.card.company} ${x.label}] outstanding commercial paper is the first row${c.length ? ` — ${c.join("; ")}` : ""}`);
}
// R1/R2 are about Tenet's review card: they count where it is in scope (releaseGate.test).
const ten = everyShownCard().find((x) => x.label === "review" && x.cik === "0000070318") as any;
const aboutTen = (ok: boolean, msg: string) => (inScope("0000070318", "review") ? assert(ok, msg) : console.log(`  — NOT IN SCOPE (SHOWN_SCOPE=${process.env.SHOWN_SCOPE}): ${msg.slice(0, 60)}`));
const pair = ten.card.v3.moves.find((m: any) => m.retires);
aboutTen(!!pair && /^Refinanced · redeemed Sept 2026 \(scheduled for Sept 23\)/.test(txt(pair.retires.meta)), `[R2] Tenet's redemption reads "Refinanced · redeemed Sept 2026 (scheduled for Sept 23)…" ("${pair ? txt(pair.retires.meta) : "no pair"}")`);
const tenRow = ten.card.v3.table.rows.find((r: any) => /6\.250\s?%/.test(r.name ?? ""));
aboutTen(!!tenRow && /^Sept(ember)? 2034$/.test(txt(tenRow.matures)), `[R1] Tenet's 6.250% notes mature "Sept 2034" in the table ("${tenRow ? txt(tenRow.matures) : "no row"}")`);

console.log("\n=== R4: the fixtures ===");
for (const c of CIKS) {
  const f = read(join("lib", "cards", "fixtures", `${c}.json`));
  const v = r4(f);
  assert(v.length === 0, `[R4:${f.company}] no fixture move sentence is a profit-and-loss effect alone${v.length ? ` — ${v.join("; ")}` : ""}`);
}

console.log("\n=== R5: ruled residuals bind to their anchor ===");
for (const r of nonEmpty("the ruled residuals", RULED)) assert(!!r.anchor?.form && /^\d{4}-\d{2}-\d{2}$/.test(r.anchor?.filingDate ?? ""), `[R5] the ${r.id} ruling for ${r.cik} records its anchor (${r.anchor?.form} ${r.anchor?.filingDate})`);
const dvRuling = RULED.find((r) => r.cik === "0000927066")!;
const fail = [`not on a move card: ${dvRuling.amount} in "Significant sources of cash during the period included the incurrence of …"`];
// Nov 6: DaVita's ruling is retired (replaced by the revolver period-total rule in 5.8); a retired ruling never applies.
assert(!!dvRuling.retired && applyRuled("5.8", "0000927066", dvRuling.anchor!, fail).counted.length === 1, `[R5] DaVita's Q2 ruling is retired and no longer suppresses, even on its own anchor (${dvRuling.retired?.slice(0, 60)}…)`);
// The binding, on a synthetic active ruling: reported, not counted, on its own anchor.
const synth = [{ ...dvRuling, retired: undefined }];
assert(applyRuled("5.8", "0000927066", dvRuling.anchor!, fail, synth).counted.length === 0, `[R5] an active ruling on its own anchor (${dvRuling.anchor?.form} ${dvRuling.anchor?.filingDate}) is reported, not counted`);
assert(applyRuled("5.8", "0000927066", { form: "10-Q", filingDate: "2026-10-29" }, []).counted.length === 0, `[R5] on DaVita's Q3 anchor the ruling drops and the plain check governs (it passes: nothing counted)`);

console.log("\n=== controls ===");
const c1 = clone(ten.card); for (const r of c1.v3.table.rows) if (/6\.250\s?%/.test(r.name ?? "")) r.matures = [{ k: "date", t: "2034", date: "2034", granularity: "year" }];
assert(r1(c1, ten.input).length > 0, `[R1 control] the 6.250% notes shown at "2034" are flagged`);
const c2 = clone(ten.card); const p2 = c2.v3.moves.find((m: any) => m.retires);
p2.retires.meta = [{ k: "text", t: "Refinanced · " }, { k: "label", t: "redeemed Sept 23, 2026", stated: "September 23, 2026", src: { sentence: "The 2027 Notes and 2028 Notes are expected to be redeemed on September 23, 2026.", url: "u", doc: "8-K" } }];
assert(r2(c2).length > 0, `[R2 control] "redeemed Sept 23" taken from an intention-only sentence is flagged`);
// Control material: read from every card, whatever the scope (releaseGate.test R4).
const cig = (() => { const s = everyShownCard().find((x) => x.label === "published" && x.cik === "0001739940") as any; return { card: s.card, input: s.input }; })();
const c3 = clone(cig.card); c3.v3.table.rows = c3.v3.table.rows.filter((r: any) => !/commercial paper/i.test(txt(r.instrument)));
assert(r3(c3, cig.input).length > 0, `[R3 control] Cigna's card with its commercial paper row removed is flagged`);
assert(r4({ moveSentences: [{ sentence: "As a result of the redemption of the 2028 Notes, we recorded a $3.2 million Loss on early extinguishment of debt." }] }).length > 0, `[R4 control] a fixture requiring Encompass's $3.2MM loss on extinguishment is flagged`);
assert(applyRuled("5.8", "0000927066", { form: "10-Q", filingDate: "2026-10-29" }, fail, synth).counted.length > 0, `[R5 control] the $65MM ruling applied on a different anchor than its own does not suppress the failure`);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
