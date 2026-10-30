/**
 * SESSION 27 — VISIBLE CHANGES PER CARD AGAINST A GIT REF. $0, offline.
 *
 * The page renders `card.v3` (app/cards/CardV3View.tsx). This lists, per
 * card and per v3 section, every rendered text line removed and added
 * against the cards committed at <ref> (production is origin/main), and
 * counts the cited sentences behind each figure's source link that changed.
 *
 * Run: npx tsx lib/cache/s27cardDiff.ts [ref=origin/main] [out.md]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { partText } from "../cards/format";

const REF = process.argv[2] ?? "origin/main";
const OUT = process.argv[3] ?? null;
const ORDER = JSON.parse(readFileSync("lib/cards/generated/index.json", "utf-8")).ciks as string[];
const textOf = (line: any[]) => line.map((s) => s?.t ?? s?.printed ?? "").join("").replace(/\s+/g, " ").trim();
const isLine = (o: any) => Array.isArray(o) && o.length > 0 && o.every((s) => s && typeof s === "object" && ("k" in s || "t" in s));

/** String fields the view uses as data, never as text. */
const NOT_RENDERED = new Set(["k", "kind", "url", "doc", "date", "iso", "granularity", "color", "pattern", "tone", "source", "cik", "id", "sort", "stated", "sentence", "printed", "usd"]);

/** Every rendered line of a v3 card, by section, plus every cited sentence. */
function visible(card: any) {
  const lines = new Map<string, string[]>(), cites: string[] = [];
  const push = (section: string, t: string) => { (lines.get(section) ?? lines.set(section, []).get(section)!).push(t); };
  const walk = (o: any, section: string, inLine = false) => {
    if (!o || typeof o !== "object") return;
    if (o.src?.sentence) cites.push(`${o.src.doc ?? ""} | ${String(o.src.sentence).slice(0, 140)}`);
    const line = isLine(o);
    if (line) { const t = textOf(o); if (t) push(section, t); }
    // A segment rendered on its own (a headline figure, a filing link), not inside a line.
    else if (!inLine && !Array.isArray(o) && typeof o.k === "string" && typeof (o.t ?? o.printed) === "string") push(section, String(o.t ?? o.printed));
    // Every other string field of a non-segment object renders as-is ("label", a bar's "title" tooltip, a row's
    // "name", a tile's "away"), except the fields the view never prints.
    if (!line && typeof o.k !== "string") for (const [k, v] of Object.entries(o)) if (typeof v === "string" && !NOT_RENDERED.has(k)) push(`${section} (${k === "title" ? "tooltip" : k})`, v);
    for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v, section, inLine || line);
  };
  for (const [k, v] of Object.entries(card.v3 ?? {})) walk(v, k);
  return { lines, cites };
}
const multisetDiff = (a: string[], b: string[]) => {
  const left = [...a], added: string[] = [];
  for (const x of b) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else added.push(x); }
  return { removed: left, added };
};

/** Every visible difference between two cards, as markdown list lines. */
export function visibleDiff(then: any, now: any): string[] {
  const out: string[] = [];
  const say = (x: string) => { out.push(x); };
  const a = visible(then), b = visible(now);
  let any = false;
  for (const sec of new Set([...a.lines.keys(), ...b.lines.keys()])) {
    const d = multisetDiff(a.lines.get(sec) ?? [], b.lines.get(sec) ?? []);
    if (!d.removed.length && !d.added.length) continue;
    any = true;
    say(`- **${sec}**`);
    for (const x of d.removed) say(`  - was: ${x}`);
    for (const x of d.added) say(`  - now: ${x}`);
  }
  const c = multisetDiff(a.cites, b.cites);
  if (c.removed.length || c.added.length) {
    any = true;
    say(`- **cited sentences behind source links**: ${c.removed.length} out, ${c.added.length} in`);
    for (const x of [...new Set(c.removed)]) say(`  - was cited: ${x}`);
    for (const x of [...new Set(c.added)]) say(`  - now cited: ${x}`);
  }
  // The view changed too (Oct 30): a computed figure's opened parts were shown as raw `printed`, now through partText.
  const partsShown = (card: any, show: (p: any) => string) => {
    const out: string[] = [];
    const walk = (o: any) => { if (!o || typeof o !== "object") return; if (o.k === "computed") for (const p of o.parts ?? []) out.push(show(p)); for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v); };
    walk(card.v3);
    return out;
  };
  const pd = multisetDiff(partsShown(then, (p) => p.printed), partsShown(now, partText));
  if (pd.removed.length || pd.added.length) {
    any = true;
    say(`- **parts of computed figures (shown when a figure is opened)**: ${pd.removed.length} shown differently`);
    for (const x of [...new Set(pd.removed)].slice(0, 12)) say(`  - was: ${x}`);
    for (const x of [...new Set(pd.added)].slice(0, 12)) say(`  - now: ${x}`);
  }
  if (!any) say("- no visible change");
  return out;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("s27cardDiff.ts")) {
  const out: string[] = [];
  for (const cik of ORDER) {
    const now = JSON.parse(readFileSync(`lib/cards/generated/${cik}.json`, "utf-8"));
    let then: any = null;
    try { then = JSON.parse(execSync(`git show ${REF}:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64 << 20 })); } catch { /* new card */ }
    out.push(`\n## ${now.company}`, ...(then ? visibleDiff(then, now) : ["- new card (not at the ref)"]));
  }
  console.log(out.join("\n"));
  if (OUT) writeFileSync(OUT, `# Visible changes against ${REF}\n` + out.join("\n") + "\n");
}
