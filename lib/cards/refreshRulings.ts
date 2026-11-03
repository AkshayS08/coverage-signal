/**
 * SESSION 27 (Akshay, Nov 3, 2026) — FIVE RULINGS OVER THE RENDERED CARD.
 *
 *   Q  a meaning-bearing qualifier (committed/uncommitted, secured/unsecured,
 *      available/outstanding) printed just before a facility or capacity
 *      line's stated span in its own cited sentence is on the line
 *   R  a move card's "remains" is the amount outstanding immediately after
 *      that move: the position's face, plus the same note's later in-period
 *      retirements, less its post-period retirements up to the move
 *   H  where the anchor was filed in the brief week, the header states the
 *      filing date once: "[form] filed [date] · new this week · …"
 *   C  an issuance cites the first filing whose sentence states it completed
 *   P  a funding sentence that names an issuance on the card (its coupon and
 *      maturity year, or a "<year> … Notes" term) pairs that issuance with
 *      the retirement it funds
 */
import { couponsIn } from "./labels";
import { qualifiersBefore, lineStates } from "./qualifiers";

const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? s.printed ?? "").join("");
const norm = (x: string) => x.replace(/[\s ]+/g, " ").replace(/ %/g, "%").trim();
/** A sentence stating an issuance done ("issued $…", "completed the issuance and sale of …"), not a notice or plan. */
export const COMPLETED = /\b(?:issued|completed\s+(?:the|an|its|our)\s+(?:[\w-]+\s+){0,2}(?:sale|offering|issuance))\b/i;
export const NOT_DONE = /\bnotice\b|\bpress release\b|\bannounc\w*|\bintends?\s+to\b|\bexpects?\s+to\b/i;
/** Every dollar amount a sentence prints, in dollars ("$500 million", "$2,000,000,000", "$ 1.500 billion"). */
export const usdIn = (s: string): number[] => [...s.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?\b/gi)].map((m) => Number(m[1].replace(/,/g, "")) * ({ billion: 1e9, million: 1e6, thousand: 1e3 } as Record<string, number>)[(m[2] ?? "").toLowerCase()] || Number(m[1].replace(/,/g, "")));
const MONEY =/([~<]?)\$([\d,.]+)(MM|B)\b/;
const mm = (s: string) => { const m = MONEY.exec(s); return m ? Number(m[2].replace(/,/g, "")) * (m[3] === "B" ? 1000 : 1) : NaN; };
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "Sept 23, 2026" / "Feb 2, 2026" / "May 2026" → ISO (a month alone dates to its first day). */
const isoOf = (s: string): string | null => {
  const m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(?:(\d{1,2}),\s*)?(\d{4})/.exec(s);
  return m ? `${m[3]}-${String(MON[m[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}-${String(m[2] ?? 1).padStart(2, "0")}` : null;
};
const noteKey = (line: string) => { const c = couponsIn(line)[0]?.rate; const y = (/\bdue\s+(?:[A-Z][a-z]+\s+)?(?:\d{1,2},\s*)?(20\d\d)/.exec(line) ?? [])[1]; return c === undefined || !y ? null : `${c}|${y}`; };

export function rulingViolations(card: any, input: any): { Q: string[]; R: string[]; H: string[]; C: string[]; P: string[] } {
  const out = { Q: [] as string[], R: [] as string[], H: [] as string[], C: [] as string[], P: [] as string[] };
  const v = card.v3;
  // Q: facility and capacity lines (the liquidity legend and notes, the facilities list).
  const lines: any[][] = [...(v.liquidity?.notes ?? []), ...(v.liquidity?.legend ?? []).map((l: any) => l.label), ...(v.facilities ?? []).flatMap((f: any) => [f.bold, ...(Array.isArray(f.sub?.[0]) ? f.sub : [f.sub])])].filter(Array.isArray);
  for (const l of lines) {
    const shown = txt(l).toLowerCase();
    for (const s of l) if (s?.k === "label" && typeof s.stated === "string" && s.src?.sentence) {
      for (const q of qualifiersBefore(s.stated, s.src.sentence)) if (!lineStates(shown, q)) out.Q.push(`"${txt(l).slice(0, 90)}" drops "${q}", printed before "${s.stated}" in its sentence`);
    }
  }
  // R: remains immediately after each move.
  const periodEnd = isoOf(txt(v.header?.position)) ?? "9999-12-31";
  const face = new Map<string, number>();
  for (const r of v.table?.rows ?? []) { const k = noteKey(/\bdue\b/.test(r.name ?? "") ? r.name : `${r.name ?? txt(r.instrument)} due ${txt(r.matures)}`); const f = typeof r.face?.usd === "number" ? r.face.usd / 1e6 : NaN; if (k && Number.isFinite(f) && f > 0) face.set(k, f); }
  const retirements: { key: string; date: string; usd: number; line: string }[] = [];
  for (const m of v.moves ?? []) {
    const parts = [...(/\b(?:Redeemed|Repurchased|Retired|Repaid|Refinanced)\b/.test(txt(m.meta)) ? m.title.map((l: any) => ({ l, meta: m.meta })) : []), ...(m.retires ? m.retires.items.map((l: any) => ({ l, meta: m.retires.meta })) : [])];
    for (const p of parts) { const line = txt(p.l), d = isoOf(txt(p.meta)), k = noteKey(line); if (k && d && Number.isFinite(mm(line))) retirements.push({ key: k, date: d, usd: mm(line), line }); }
  }
  for (const r of retirements) {
    const rem = /·\s*([~<]?\$[\d,.]+(?:MM|B))\s+remains/.exec(r.line);
    const base = face.get(r.key);
    if (!rem || base === undefined) continue;
    const later = retirements.filter((x) => x.key === r.key && x.date > r.date && x.date <= periodEnd).reduce((a, x) => a + x.usd, 0);
    const postUpTo = retirements.filter((x) => x.key === r.key && x.date > periodEnd && x.date <= r.date).reduce((a, x) => a + x.usd, 0);
    const want = base + (r.date <= periodEnd ? later : -postUpTo);
    if (Math.abs(mm(rem[1]) - want) > 1.5) out.R.push(`"${r.line}" (${r.date}): ${rem[1]} remains, but immediately after it $${want.toLocaleString("en-US")}MM remained`);
  }
  // H
  const filing = txt([v.header?.filing]), status = txt(v.header?.status);
  const date = (/filed\s+([A-Z][a-z]+\.? \d{1,2}, \d{4})/.exec(filing) ?? [])[1];
  if (date && /new this week/i.test(status) && `${filing} ${status}`.split(date).length - 1 !== 1) out.H.push(`the header states ${date} ${`${filing} ${status}`.split(date).length - 1} times: "${filing} · ${status}"`);
  // C: the first filing whose sentence states the issuance completed.
  const docs = Object.entries((input?.docs ?? {}) as Record<string, { label: string; text: string }>).map(([url, d]) => ({ url, label: d.label, date: (/(\d{4}-\d{2}-\d{2})/.exec(d.label) ?? [])[1] ?? "9999", text: norm(d.text) }));
  for (const m of v.moves ?? []) {
    const cm = /Issued, confirmed by (\S+)/.exec(txt(m.meta));
    const k = cm ? noteKey(txt(m.title[0])) : null;
    if (!cm || !k) continue;
    const [rate, year] = k.split("|");
    // The same issue: its coupon, its maturity year and its face (an add-on of the same notes is another move).
    const faceMM = mm(txt(m.title[0]));
    const stating = docs.filter((d) => d.text.split(/(?<=[.;])\s+(?=[A-Z(“"])/).some((s) => s.length < 900 && COMPLETED.test(s) && !NOT_DONE.test(s) && !/\bmay\s+[a-z]/.test(s) && couponsIn(s).some((c) => Math.abs(c.rate - Number(rate)) < 1e-9) && s.includes(year) && (!Number.isFinite(faceMM) || usdIn(s).some((u) => Math.abs(u / 1e6 - faceMM) < 0.5)))).sort((a, b) => a.date.localeCompare(b.date));
    const first = stating[0];
    if (first && !first.label.startsWith(cm[1])) out.C.push(`"${txt(m.meta)}" cites ${cm[1]}, but the ${first.label} is the first filing stating it completed`);
  }
  // P: a funding sentence naming an issuance on the card pairs it with the retirement.
  const issuances = (v.moves ?? []).filter((m: any) => /Issued/.test(txt(m.meta))).map((m: any) => ({ m, k: noteKey(txt(m.title[0])) })).filter((x: any) => x.k);
  for (const mv of v.moves ?? []) {
    const parts = [...(/\b(?:Redeemed|Repurchased|Retired|Repaid)\b/.test(txt(mv.meta)) ? [{ segs: [...mv.title.flat(), ...(mv.detail ?? []), ...mv.meta], paired: null }] : []), ...(mv.retires ? [{ segs: [...mv.retires.items.flat(), ...mv.retires.meta], paired: mv }] : [])];
    for (const p of parts) for (const s of new Set(p.segs.map((x: any) => x?.src?.sentence).filter((x: any) => typeof x === "string" && /\b(?:used|use|finance[ds]?|fund(?:ed)?)\b/i.test(x))) as Set<string>) {
      for (const iss of issuances) {
        const [rate, year] = iss.k.split("|");
        const names = (couponsIn(s).some((c) => Math.abs(c.rate - Number(rate)) < 1e-9) && s.includes(year)) || new RegExp(`\\b${year}\\s+(?:[A-Z][a-z]+\\s+){0,4}Notes\\b`).test(s);
        if (names && p.paired !== iss.m) out.P.push(`"${s.slice(0, 90)}…" names the ${txt(iss.m.title[0])} as its funding, but the retirement is not paired with it`);
      }
    }
  }
  return out;
}
