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

const REF = process.argv[2] ?? "origin/main";
const OUT = process.argv[3] ?? null;
const ORDER = JSON.parse(readFileSync("lib/cards/generated/index.json", "utf-8")).ciks as string[];
const textOf = (line: any[]) => line.map((s) => s?.t ?? s?.printed ?? "").join("").replace(/\s+/g, " ").trim();
const isLine = (o: any) => Array.isArray(o) && o.length > 0 && o.every((s) => s && typeof s === "object" && ("k" in s || "t" in s));

/** Every rendered line of a v3 card, by section, plus every cited sentence. */
function visible(card: any) {
  const lines = new Map<string, string[]>(), cites: string[] = [];
  const push = (section: string, t: string) => { (lines.get(section) ?? lines.set(section, []).get(section)!).push(t); };
  const walk = (o: any, section: string) => {
    if (!o || typeof o !== "object") return;
    if (o.src?.sentence) cites.push(`${o.src.doc ?? ""} | ${String(o.src.sentence).slice(0, 140)}`);
    if (isLine(o)) { const t = textOf(o); if (t) push(section, t); }
    // Labels rendered as-is: bar segment titles (tooltips) and table row names.
    for (const k of ["title", "name"]) if (typeof o[k] === "string") push(`${section} (${k === "title" ? "tooltip" : "row name"})`, o[k]);
    for (const [k, v] of Object.entries(o)) if (k !== "src") walk(v, section);
  };
  for (const [k, v] of Object.entries(card.v3 ?? {})) walk(v, k);
  lines.set("header", [card.company, card.subtitle, card.briefDate].filter((x) => typeof x === "string"));
  return { lines, cites };
}
const multisetDiff = (a: string[], b: string[]) => {
  const left = [...a], added: string[] = [];
  for (const x of b) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else added.push(x); }
  return { removed: left, added };
};

const out: string[] = [];
const say = (s: string) => { console.log(s); out.push(s); };
for (const cik of ORDER) {
  const now = JSON.parse(readFileSync(`lib/cards/generated/${cik}.json`, "utf-8"));
  let then: any = null;
  try { then = JSON.parse(execSync(`git show ${REF}:lib/cards/generated/${cik}.json`, { encoding: "utf-8", maxBuffer: 64 << 20 })); } catch { /* new card */ }
  say(`\n## ${now.company}`);
  if (!then) { say("- new card (not at the ref)"); continue; }
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
  if (!any) say("- no visible change");
}
if (OUT) writeFileSync(OUT, `# Visible changes against ${REF}\n` + out.join("\n") + "\n");
