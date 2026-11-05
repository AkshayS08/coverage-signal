/**
 * SESSION 27 (Akshay, Nov 1, 2026) — A REFRESH NEVER LOSES A STATED FACT.
 * Five checks over a rendered card and its input (moveIntegrity.test.ts):
 *
 *   M1  debt-item 8-Ks (Items 1.01, 1.02, 2.03, 2.04, 8.01) filed since the
 *       latest 10-K stay among the card's documents, for move detail
 *   M2  the more precise statement of the same move wins: no move card shows
 *       a month where a held document states that move's day (Rules 76-78)
 *   M3  no template renders a placeholder with no content
 *   M4  a partial retirement's move card states what remains, as the table does
 *   M5  a funding line states every source its sentence names; a new-debt
 *       source makes the move "Refinanced", paired with its issuance
 */
import { couponsIn } from "./labels";

const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
const PLACEHOLDER = /^(?:use of the proceeds stated|a stated source)$/i;
/** New debt as a funding source: issuance proceeds, never divestiture or other proceeds. */
export const NEW_DEBT_SOURCE = /\b(?:net\s+issuance\s+proceeds|issuance\s+proceeds|(?:net\s+)?proceeds\s+(?:from|of)\s+(?:the\s+)?(?:sale|issuance|offering)\s+of\s+(?:the\s+|our\s+)?(?:\w+\s+){0,3}notes|net\s+proceeds\s+(?:from|of)\s+(?:the\s+|our\s+)?(?:\d{4}\s+)?(?:senior\s+)?notes)\b/i;
const OTHER_SOURCES: [string, RegExp][] = [["cash on hand", /\bcash on hand\b/i], ["borrowings", /\bborrowings under\b/i], ["divestiture proceeds", /\bdivestiture proceeds\b/i]];

export function moveIntegrityViolations(card: any, input: any): { M1: string[]; M2: string[]; M3: string[]; M4: string[]; M5: string[] } {
  const out = { M1: [] as string[], M2: [] as string[], M3: [] as string[], M4: [] as string[], M5: [] as string[] };
  const docs: Record<string, { label: string; text: string }> = input?.docs ?? {};
  // M1
  if (!Array.isArray(input?.debtEightKs)) out.M1.push("the card input does not record the debt-item 8-Ks filed since the latest 10-K");
  else for (const e of input.debtEightKs) if (!docs[e.url]) out.M1.push(`8-K ${e.filingDate} [${e.items}] is not among the card's documents`);
  // M2: sentences in held documents stating a move's day, with the coupons they name.
  const dayStatements: { coupons: number[]; y: number; m: number; d: number; sentence: string }[] = [];
  for (const d of Object.values(docs)) for (const s of d.text.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"])/)) {
    if (s.length > 700 || !/\b(?:issued|priced|redeem\w*|repurchas\w*|repaid|retired)\b/i.test(s)) continue;
    // Nov 4 (correcting ruling (b)): a scheduled or expected day states another fact; it never dates a completed move.
    if (/\bexpected to\b|\bscheduled\b|\bwill be\b|\bset for\b|\bconditional\b|\banticipat\w*/i.test(s)) continue;
    const cs = couponsIn(s).map((c) => c.rate);
    if (!cs.length) continue;
    for (const m of s.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/g)) dayStatements.push({ coupons: cs, y: +m[3], m: monthOf(m[1]), d: +m[2], sentence: s });
  }
  for (const mv of card.v3?.moves ?? []) {
    const meta = txt(mv.meta);
    const month = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/.exec(meta);
    if (!month) continue;
    const cs = couponsIn(mv.title.map(txt).join(" ") + " " + (mv.retires?.items ?? []).map(txt).join(" ")).map((c) => c.rate);
    const hit = dayStatements.find((s) => s.y === +month[2] && s.m === monthOf(month[1]) && s.coupons.some((c) => cs.includes(c)));
    if (hit) out.M2.push(`"${meta}" shows a month, but "${hit.sentence.slice(0, 100)}…" states the day`);
  }
  // M3
  (function walk(o: any) { if (!o || typeof o !== "object") return; if (typeof o.t === "string" && PLACEHOLDER.test(o.t.trim())) out.M3.push(`placeholder "${o.t}"`); for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v); })(card.v3);
  // M4: a row the table shows as partly retired ("… · $X remains") is stated as such on its move card.
  const partial = (card.v3?.table?.rows ?? []).map((r: any) => ({ r, s: txt(r.status?.text) })).filter((x: any) => /remains/.test(x.s) && /(?:retired|redeemed|repurchased|refinanced)/.test(x.s));
  for (const p of partial) {
    const c = couponsIn(p.r.name ?? txt(p.r.instrument))[0]?.rate;
    if (c === undefined) continue;
    const lines = (card.v3.moves ?? []).flatMap((m: any) => [...m.title, ...(m.retires?.items ?? [])]).map(txt).filter((l: string) => couponsIn(l).some((x) => Math.abs(x.rate - c) < 1e-9));
    if (lines.length && !lines.some((l: string) => /remains/.test(l))) out.M4.push(`${p.r.name}: the table says "${p.s}", its move card does not state what remains`);
  }
  // M5: every source a funding sentence names is stated; new debt makes it "Refinanced".
  // Retirements only: an issuance card's sentence is its USE of proceeds, not a funding line. A retirement is a card
  // whose meta reads Redeemed / Repurchased / Retired / Repaid / Refinanced, or the retires side of a pair.
  const RETIREMENT = /\b(?:Redeemed|Repurchased|Retired|Repaid|Refinanced|Redemption)\b/;
  const retirementParts = (card.v3?.moves ?? []).flatMap((mv: any) => [
    ...(RETIREMENT.test(txt(mv.meta)) ? [{ meta: txt(mv.meta), segs: [...mv.title.flat(), ...(mv.detail ?? [])] }] : []),
    ...(mv.retires ? [{ meta: txt(mv.retires.meta), segs: mv.retires.items.flat() }] : []),
  ]);
  for (const p of retirementParts) {
    // The retirement's own meta line is part of the move ("Refinanced · redeemed …, with the new notes' proceeds and cash on hand").
    const rendered = [p.meta, ...p.segs.map((s: any) => s.t ?? "")].join(" ");
    const sentences = [...new Set(p.segs.map((s: any) => s.src?.sentence).filter((x: any) => typeof x === "string" && /\b(?:used|use|finance|fund)\w*\b/i.test(x) && /proceeds|cash on hand|borrowings/i.test(x)))] as string[];
    for (const s of sentences) {
      if (NEW_DEBT_SOURCE.test(s) && !/Refinanced/.test(p.meta)) out.M5.push(`"${s.slice(0, 80)}…" names new debt as a source, but the retirement reads "${p.meta}"`);
      for (const [name, re] of OTHER_SOURCES) if (re.test(s) && !new RegExp(name, "i").test(rendered)) out.M5.push(`"${s.slice(0, 80)}…" names ${name}, which the card does not state`);
    }
  }
  return out;
}
