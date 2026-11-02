/**
 * SESSION 27 (Akshay, Oct 31, 2026) — DEBT-MOVE SENTENCES, LOCATED IN CODE.
 *
 * Molina's Q3 facts asks all omitted "We executed an amendment to the Credit
 * Agreement on February 4, 2026 …" though it was in their input and the
 * instruction is year-scoped (the Q2 asks all returned it). A move the filing
 * states must not depend on the model noticing it, so the same locator feeds
 * two places: the facts stage's input (a list to account for — the cause) and
 * the card's check (an unkept sentence shows as "possible move, not
 * confirmed" — the safety net).
 *
 * A move sentence states a completed or announced debt transaction in the past
 * tense (an amendment executed, notes issued or priced, notes redeemed,
 * repurchased or repaid, a redemption notice issued, a facility entered into,
 * refinanced or terminated), with a date inside the window printed within
 * 140 characters of that verb. A conditional ("may redeem", "will be repaid")
 * is not a move, and neither is an exhibit or press-release description.
 */
export interface LocatedMove { sentence: string; url: string; label: string; date: string; kind: "amendment" | "issuance" | "retirement" | "facility" }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** A gap that may cross a decimal point ("1.250 %") but not a sentence end. */
const GAP = (n: number) => String.raw`(?:[^.]|\.(?=\d)){0,${n}}`;
const KINDS: { kind: LocatedMove["kind"]; re: RegExp }[] = [
  { kind: "amendment", re: new RegExp(String.raw`\b(?:executed|entered into|completed)\s+(?:an?|the)\s+(?:[\w-]+\s+){0,3}amendment\b|\bamended\s+(?:and\s+restated\s+)?(?:the|our|its)\s+[\w\s-]{0,40}?(?:credit agreement|credit facility|indenture|facility)\b`, "i") },
  { kind: "retirement", re: new RegExp(String.raw`\bissued\s+(?:a\s+)?notices?\s+of\s+(?:conditional\s+)?(?:full\s+|partial\s+)?(?:and\s+(?:conditional\s+)?(?:full\s+|partial\s+)?)?redemption\b|\b(?:redeemed|repurchased|repaid|retired|prepaid)\b${GAP(160)}\b(?:notes|debentures|bonds|term loans?|loans)\b`, "i") },
  { kind: "issuance", re: new RegExp(String.raw`\b(?:issued\s+(?:\$|an\s+aggregate|aggregate|additional)|completed\s+(?:an?|the|its)\s+(?:private\s+|registered\s+)?offering\s+of|priced\s+(?:an?|its|the)\s+(?:private\s+)?offering\s+of)${GAP(160)}\b(?:notes|debentures|bonds)\b`, "i") },
  { kind: "facility", re: new RegExp(String.raw`\b(?:entered into|terminated|refinanced)\b${GAP(80)}\b(?:credit agreement|credit facility|revolving credit|term loan)\b`, "i") },
];
const CONDITIONAL = /\b(?:may|will|would|could|can|shall|might|intends? to|expects? to)\s+(?:be\s+)?(?:\w+\s+){0,2}(?:redeem|repurchase|repay|retire|prepay|issue|amend|refinance|terminate)|\bto be (?:redeemed|repaid|repurchased|retired|issued)\b/i;
const NOT_A_STATEMENT = /\bpress release\b|\bexhibit\b|^description\b/i;

/** Every date the sentence prints, with its position and [first day, last day] at its precision. */
function datesIn(sentence: string): { iso: string; from: string; to: string; at: number }[] {
  const out: { iso: string; from: string; to: string; at: number }[] = [];
  const re = new RegExp(String.raw`\b(${MONTHS.join("|")})\s+(?:(\d{1,2}),\s*)?(\d{4})\b`, "gi");
  for (const m of sentence.matchAll(re)) {
    const mm = String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0");
    if (m[2]) { const iso = `${m[3]}-${mm}-${m[2].padStart(2, "0")}`; out.push({ iso, from: iso, to: iso, at: m.index ?? 0 }); }
    else { const last = new Date(Date.UTC(Number(m[3]), Number(mm), 0)).getUTCDate(); out.push({ iso: `${m[3]}-${mm}`, from: `${m[3]}-${mm}-01`, to: `${m[3]}-${mm}-${String(last).padStart(2, "0")}`, at: m.index ?? 0 }); }
  }
  return out;
}

const sentencesOf = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[A-Z(“"]|20\d\d\b)|\s*[•●▪]\s*/).filter((x) => x.length > 30 && x.length < 900);

/** Debt-move sentences in these documents dated inside [from, to] (ISO dates), once each. */
export function locateMoveSentences(docs: { url: string; label: string; text: string }[], from: string, to: string): LocatedMove[] {
  const out: LocatedMove[] = [];
  const seen = new Set<string>();
  for (const d of docs) for (const raw of sentencesOf(d.text)) {
    if (NOT_A_STATEMENT.test(raw) || CONDITIONAL.test(raw)) continue;
    let hit: { kind: LocatedMove["kind"]; at: number } | null = null;
    for (const k of KINDS) { const m = k.re.exec(raw); if (m) { hit = { kind: k.kind, at: m.index }; break; } }
    if (!hit) continue;
    // A table without a closing period runs into the next sentence (DaVita's schedule, then "On June 8, 2026 … entered
    // into the Ninth Amendment"); the move's sentence starts at its own "On"/"In" when figures run before it.
    let s = raw;
    const opener = Math.max(raw.lastIndexOf(" On ", hit.at), raw.lastIndexOf(" In ", hit.at));
    if (opener > 0 && (raw.slice(0, opener).match(/\d[\d,.]*/g) ?? []).length >= 4) { s = raw.slice(opener + 1); hit = { ...hit, at: hit.at - opener - 1 }; }
    // A period marker ("six months ended June 30", "as of", "at") is not the move's date.
    const near = datesIn(s).filter((x) => x.to >= from && x.from <= to && Math.abs(x.at - hit!.at) <= 140 && !/\b(?:ended|as of|at)\s*$/i.test(s.slice(Math.max(0, x.at - 12), x.at)));
    if (!near.length) continue;
    const key = s.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    // The move's own date: the in-window date printed nearest its verb.
    const date = near.sort((a, b) => Math.abs(a.at - hit!.at) - Math.abs(b.at - hit!.at))[0].iso;
    out.push({ sentence: s, url: d.url, label: d.label, date, kind: hit.kind });
  }
  // A run of flattened text that swallows a located sentence is not a second move: keep the shorter.
  return out.filter((m) => !out.some((o) => o !== m && o.url === m.url && o.sentence.length < m.sentence.length && m.sentence.includes(o.sentence.slice(0, 60))));
}

/**
 * Which located move sentences no confirmed move covers — ONE rule, used by the card and its check. A confirmed move
 * (a move card) covers a located sentence when it cites the same sentence (spacing aside) or states the same date
 * (a day, or a month containing it): one transaction printed in two documents is one move.
 */
export function uncoveredMoves(located: LocatedMove[], moveCards: unknown): LocatedMove[] {
  const squash = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  const sentences: string[] = [];
  const dates: { from: string; to: string }[] = [];
  (function walk(o: any) {
    if (!o || typeof o !== "object") return;
    if (typeof o.src?.sentence === "string") sentences.push(squash(o.src.sentence));
    for (const t of [o.k === "date" ? o.date : null, o.k === "label" ? o.stated : null]) if (typeof t === "string") {
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(t)) dates.push({ from: t.length === 7 ? `${t}-01` : t, to: t.length === 7 ? `${t}-31` : t });
      else for (const d of datesIn(t)) dates.push({ from: d.from, to: d.to });
    }
    for (const v of Object.values(o)) walk(v);
  })(moveCards);
  // One transaction printed in several documents is one possible move, as it is one confirmed move: the first located
  // sentence (the anchor's, which the caller lists first) stands for each date and kind.
  const firstOf = new Map<string, LocatedMove>();
  for (const m of located) if (!firstOf.has(`${m.date}|${m.kind}`)) firstOf.set(`${m.date}|${m.kind}`, m);
  // Session 27 (Nov 1): a redemption notice and the redemption it announces are one transaction. The notice is covered
  // by a confirmed retirement of the same notes (each maturity year the notice names, on the card's retirement lines)
  // dated on or after the notice and within 60 days (the indenture notice window).
  const retireLines: { text: string; dates: string[] }[] = (Array.isArray(moveCards) ? moveCards : []).flatMap((mv: any) => {
    const txt = (l: any[] | null | undefined) => (l ?? []).map((s: any) => s.t ?? "").join("");
    const lineDates = (l: any[] | null | undefined) => (l ?? []).flatMap((s: any) => [s.k === "date" ? s.date : null, s.k === "label" ? s.stated : null]).filter((x: any) => typeof x === "string").flatMap((x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? [x] : datesIn(x).filter((d) => d.from === d.to).map((d) => d.from)));
    return [
      ...(/\b(?:Redeemed|Repurchased|Retired|Repaid|Refinanced)\b/.test(txt(mv.meta)) ? [{ text: mv.title.map(txt).join(" "), dates: lineDates(mv.meta) }] : []),
      ...(mv.retires ? [{ text: mv.retires.items.map(txt).join(" "), dates: lineDates(mv.retires.meta) }] : []),
    ];
  });
  const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const noticeCovered = (m: LocatedMove): boolean => {
    if (!/\bnotices?\s+of\s+(?:conditional\s+)?(?:full\s+|partial\s+)?redemption\b/i.test(m.sentence) || m.date.length !== 10) return false;
    const years = [...new Set([...m.sentence.matchAll(/\b(20\d\d)\s+(?:Senior\s+)?(?:Secured\s+)?(?:First\s+Lien\s+)?Notes\b/gi)].map((x) => x[1]))];
    if (!years.length) return false;
    return years.every((y) => retireLines.some((r) => new RegExp(`\\b${y}\\b`).test(r.text) && r.dates.some((d) => d >= m.date && d <= plusDays(m.date, 60))));
  };
  return [...firstOf.values()].filter((m) => {
    const head = squash(m.sentence).slice(0, 60);
    if (sentences.some((s) => s.includes(head))) return false;
    if (noticeCovered(m)) return false;
    const [from, to] = m.date.length === 7 ? [`${m.date}-01`, `${m.date}-31`] : [m.date, m.date];
    return !dates.some((d) => d.from <= to && d.to >= from && (d.from === d.to || from === to || d.from === from));
  });
}
