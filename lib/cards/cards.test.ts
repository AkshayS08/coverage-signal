/**
 * EVERY FIGURE, DATE AND LABEL ON EVERY CARD LINKS TO A SENTENCE THAT
 * CONTAINS IT — asserted over all six generated cards, not by inspection.
 *
 * Offline, $0: reads lib/cards/generated/*.json. Each segment's own claim is
 * re-checked with the guards the pipeline already trusts, never with the
 * builder's opinion of itself:
 *   figure   → amountSupportOf(printed, sentence)        Rule 58's test
 *   date     → sentenceSupportsMaturity(at precision)     Rule 77's test
 *   label    → the filer's word is in the sentence
 *   computed → equals the sum of its parts, and every part passes the figure test
 *
 * That each sentence is really IN its linked filing is checked separately,
 * against the filing text, by cardSources.test.ts.
 *
 * Run: npx tsx lib/cards/cards.test.ts
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { amountSupportOf, parseMoneyAmount as parseMoneyAmountForTest, sentenceSupportsMaturity } from "../events/position";
import { containsWord } from "./labels";
import { isZeroValue, zeroSupportFor } from "../agent/statedZero";
import { sentenceStatesFigure } from "../agent/verifyFacility";
import type { Card, Line, Segment } from "./types";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, label: string) {
  if (c) { console.log(`  ✓ PASS — ${label}`); passed++; }
  else { console.error(`  ✗ FAIL — ${label}`); failed++; failures.push(label); }
}

const DIR = join(process.cwd(), "lib", "cards", "generated");
const index = existsSync(join(DIR, "index.json")) ? JSON.parse(readFileSync(join(DIR, "index.json"), "utf-8")) : { ciks: [] };
const cards: Card[] = (index.ciks as string[]).map((c) => JSON.parse(readFileSync(join(DIR, `${c}.json`), "utf-8")));

function allLines(card: Card): { where: string; line: Line }[] {
  const out: { where: string; line: Line }[] = [];
  const sec = (name: string, s: { lines: Line[]; blocks?: { heading: Line; lines: Line[] }[] }) => {
    s.lines.forEach((l) => out.push({ where: name, line: l }));
    for (const b of s.blocks ?? []) { out.push({ where: name, line: b.heading }); b.lines.forEach((l) => out.push({ where: name, line: l })); }
  };
  card.header.forEach((l) => out.push({ where: "header", line: l }));
  sec("this week", card.thisWeek);
  sec("total debt", card.headlines.totalDebt);
  sec("liquidity", card.headlines.liquidity);
  sec("refinance window", (card.headlines.refi ?? card.headlines.due24)!);
  sec("ladder", card.ladder);
  sec("facilities", card.facilities);
  sec("withheld", card.withheld);
  sec("coverage", card.coverage);
  return out;
}
const text = (l: Line) => l.map((s) => s.t).join("");

function check(seg: Segment): string | null {
  switch (seg.k) {
    case "figure": {
      // The same function that admitted the figure decides it here: a stated
      // zero by zeroSupportFor (Rule 53), a facility figure by the facility
      // guard, any other amount by Rule 58's amountSupportOf.
      const ok = isZeroValue(seg.printed)
        ? zeroSupportFor(seg.src.sentence, seg.field ?? "drawn").kind === "asserts-absence"
        : amountSupportOf(seg.printed, seg.src.sentence).kind !== "unsupported" || (!!seg.field && sentenceStatesFigure(seg.printed, seg.src.sentence));
      return ok ? null : `figure ${seg.t} (${seg.printed}) is not stated by "${seg.src.sentence.slice(0, 90)}"`;
    }
    case "date":
      return sentenceSupportsMaturity(seg.date, seg.granularity, seg.src.sentence) ? null : `date ${seg.t} (${seg.granularity}) is not stated at that precision by "${seg.src.sentence.slice(0, 90)}"`;
    case "label":
      return containsWord(seg.src.sentence, seg.stated) ? null : `label "${seg.t}" — the filer's word "${seg.stated}" is not in "${seg.src.sentence.slice(0, 90)}"`;
    case "computed": {
      const total = seg.parts.reduce((a, p) => a + p.usd, 0);
      if (Math.abs(total - seg.usd) >= 1) return `computed ${seg.t} = ${seg.usd} but its parts sum to ${total}`;
      const bad = seg.parts.find((p) => amountSupportOf(p.printed, p.src.sentence).kind === "unsupported");
      return bad ? `computed ${seg.t}: part ${bad.printed} is not stated by "${bad.src.sentence.slice(0, 90)}"` : seg.parts.length === 0 ? `computed ${seg.t} has no parts` : null;
    }
    case "notStated":
      return seg.src.sentence.trim() ? null : `"${seg.t}" links to no sentence`;
    case "filing":
      return seg.url.startsWith("https://www.sec.gov/") ? null : `filing "${seg.t}" links nowhere`;
    default:
      return null;
  }
}

console.log(`=== [0] SIX CARDS EXIST ===`);
assert(cards.length === 6, `[0a] ${cards.length} cards generated (card_spec 1: Tenet, Encompass, Molina, DaVita, CHS, Cigna)`);

for (const card of cards) {
  const name = card.company;
  console.log(`\n=== ${name} ===`);
  const lines = allLines(card);
  const segs = lines.flatMap((l) => l.line.map((s) => ({ where: l.where, s })));
  const linked = segs.filter(({ s }) => s.k !== "text");
  const problems = linked.map(({ where, s }) => ({ where, p: check(s) })).filter((x) => x.p);
  assert(problems.length === 0, `[1:${name}] all ${linked.length} figures, dates, labels and links resolve to a sentence that contains them${problems.length ? ":\n        " + problems.slice(0, 8).map((x) => `${x.where}: ${x.p}`).join("\n        ") : ""}`);
  const srcless = linked.filter(({ s }) => "src" in s && (!(s as any).src.url || !(s as any).src.sentence));
  assert(srcless.length === 0, `[2:${name}] every source names both its sentence and its document`);

  // No bare amount: a line carrying an amount also says what it is.
  // v2.0 adds fields of its own: a CP program's size and outstanding (§2.6), a
  // sub-facility (§2.6), the schedule's other principal (§2.5), the coverage
  // footnote's face total and balance sheet (§2.8).
  const NAMED = /^(Total debt|Cash|Liquidity|Size|Drawn|Letters of credit|Available|Repaid|Ladder|Since |Repaid inside|next: |Next|Face total|Program size|Outstanding|Average rate|The filer's schedule shows|Lines marked carrying value)/;
  // v2.1 §2.4: the refinance box's summary and leftover line name what their amounts are.
  const NAMED_ANYWHERE = /other scheduled principal|sub-facility|across \d+ (?:notes?|instruments?) in the next 18 months|scheduled amortization and other principal/;
  const bare = lines.filter(({ line }) => line.some((s) => s.k === "figure" || s.k === "computed") && !line.some((s) => s.k === "label") && !NAMED.test(text(line)) && !NAMED_ANYWHERE.test(text(line)));
  assert(bare.length === 0, `[3:${name}] no bare amount — every amount line names its instrument type or the field it is${bare.length ? ": " + bare.slice(0, 3).map((b) => `"${text(b.line).slice(0, 80)}"`).join("; ") : ""}`);

  // Each instrument appears once on the ladder.
  const ladderTexts = card.ladder.blocks!.flatMap((b) => b.lines.map(text));
  const dup = ladderTexts.filter((x, n) => ladderTexts.indexOf(x) !== n);
  assert(dup.length === 0, `[4:${name}] each instrument appears once on the ladder${dup.length ? ": " + dup[0] : ""}`);

  // Every section renders, and the trust section is never empty.
  for (const [k, s] of Object.entries({ thisWeek: card.thisWeek, totalDebt: card.headlines.totalDebt, liquidity: card.headlines.liquidity, refi: (card.headlines.refi ?? card.headlines.due24)!, withheld: card.withheld, coverage: card.coverage })) {
    assert(s.lines.length > 0, `[5:${name}] section "${s.heading}" renders (${k})`);
  }
}

console.log(`\n=== [6] THE NAMED RENDER CASES (card_spec 4) ===`);
const cigna = cards.find((c) => /cigna/i.test(c.company));
if (cigna) {
  const ladder = cigna.ladder.blocks!.flatMap((b) => b.lines.map(text));
  // EXACTLY once — "at most once" passed with zero, because the lines once
  // carried no coupon at all. A check that cannot fail is not a check.
  for (const rate of ["4.500", "4.875", "5.250", "6.000"]) {
    // v2.0 §3.7 line shape: "$1,000MM 4.500% senior notes, due September 15, 2030" — the coupon leads, no name after a dash.
    const n = ladder.filter((l) => new RegExp(`${rate.replace(".", "\\.")}%[^·]*\\bnotes?, due [^·]*20(30|32|36|56)`, "i").test(l)).length;
    assert(n === 1, `[6a] Cigna's ${rate}% September 2025 note appears exactly once on the ladder, not also in the rolled base (found ${n})`);
  }
  const total = cigna.headlines.totalDebt.lines[0].find((s) => s.k === "computed") as Extract<Segment, { k: "computed" }>;
  // v2.0 §3.2: the total is at FACE, never mixed with carrying value. Each of the four notes is
  // on the ladder once (6a), so the total equals the sum of the ladder's face lines exactly once.
  const faceLines = cigna.ladder.blocks!.flatMap((b) => b.lines).filter((l) => !/carrying value|other scheduled principal|The filer's schedule shows/.test(text(l)));
  const faceSum = faceLines.reduce((a, l) => { const x = l.find((s) => s.k === "figure" || s.k === "computed") as any; return a + (x ? (x.k === "computed" ? x.usd : (parseMoneyAmountForTest(x.printed) ?? 0)) : 0); }, 0);
  assert(!!total && Math.abs(total.usd - faceSum) < 1, `[6b] Cigna's total debt is the face of its ladder lines, each counted once (total ${total?.usd}, ladder face ${faceSum})`);
  const liq = text(cigna.headlines.liquidity.lines.flat());
  assert(/commercial paper/i.test(liq) && /not counted/i.test(liq), "[6c] Cigna's commercial paper is named under liquidity as NOT counted");
}
const chs = cards.find((c) => /community health/i.test(c.company));
if (chs) {
  const bb = chs.facilities.blocks!.flatMap((b) => b.lines).flat().find((s) => s.k === "label" && s.t === "Borrowing-base limited") as Extract<Segment, { k: "label" }> | undefined;
  assert(!!bb && bb.src.sentence.length > "subject to borrowing base capacity".length + 20, `[6d] CHS's borrowing-base flag carries the full sentence, not the fragment (got "${bb?.src.sentence.slice(0, 80)}")`);
  const nine = chs.ladder.blocks!.flatMap((b) => b.lines.map(text)).find((l) => l.includes("2034"));
  assert(!!nine && !/2034-09-15|September 15, 2034/.test(nine), "[6e] CHS's 9¾% notes display 2034, as the anchor states");
}
const ehc = cards.find((c) => /encompass/i.test(c.company));
if (ehc) {
  const due = (ehc.headlines.refi ?? ehc.headlines.due24)!.lines.map(text);
  // v2.1 §2.4 rule 5: the flag is a marker on the date, with one legend line under the box.
  assert(due.some((l) => /4\.50% senior notes, due 2028†/.test(l)) && due.some((l) => /^† .*may fall within 18 months, see source/.test(l)), "[6f] Encompass's 4.50% notes due 2028 are in the 18-month refinance window, marked † for year only, with the legend (card_spec v2.1 §2.4)");
}
for (const c of cards) {
  const cap = c.ladder.lines.map(text).join(" ");
  const debtLines = c.ladder.blocks!.flatMap((b) => b.lines.map(text));
  assert(!debtLines.some((l) => /undrawn commitment, not debt/.test(l)), `[6g:${c.company}] no undrawn facility sits among the debt rows`);
  void cap;
}

// A CHECK THAT CANNOT FAIL IS NOT A CHECK (the audit spine). Real segments
// from the cards, each given a sentence that does NOT state it, must fail.
console.log(`\n=== [7] NEGATIVE CONTROLS — each check rejects a corrupted real segment ===`);
{
  const segs = cards.flatMap((c) => allLines(c).flatMap((l) => l.line));
  const wrong = "The Company's board of directors met four times during the quarter.";
  const of = <K extends Segment["k"]>(k: K) => segs.find((s) => s.k === k && (k !== "figure" || !isZeroValue((s as any).printed))) as Extract<Segment, { k: K }> | undefined;
  const fig = of("figure"), date = of("date"), label = of("label"), comp = of("computed");
  assert(!!fig && check({ ...fig, src: { ...fig.src, sentence: wrong } }) !== null, `[7a] a figure beside a sentence that does not state it fails (${fig?.t})`);
  assert(!!date && check({ ...date, src: { ...date.src, sentence: wrong } }) !== null, `[7b] a date beside a sentence that does not state it fails (${date?.t})`);
  const dayDate = segs.find((s) => s.k === "date" && s.granularity === "day") as Extract<Segment, { k: "date" }> | undefined;
  assert(!!dayDate && check({ ...dayDate, src: { ...dayDate.src, sentence: `due ${dayDate.date.slice(0, 4)}` } }) !== null, `[7c] a DAY shown beside a sentence stating only the year fails (Rule 77) (${dayDate?.t})`);
  assert(!!label && check({ ...label, src: { ...label.src, sentence: wrong } }) !== null, `[7d] a label whose word is not in its sentence fails (${label?.t})`);
  assert(!!comp && check({ ...comp, usd: comp.usd + 1e6 }) !== null, `[7e] a computed figure that is not the sum of its parts fails (${comp?.t})`);
  assert(!!comp && check({ ...comp, parts: comp.parts.map((p, n) => (n === 0 ? { ...p, src: { ...p.src, sentence: wrong } } : p)) }) !== null, "[7f] a computed figure with one unsupported part fails");
  const zero = segs.find((s) => s.k === "figure" && isZeroValue(s.printed)) as Extract<Segment, { k: "figure" }> | undefined;
  assert(!zero || check({ ...zero, src: { ...zero.src, sentence: "As of June 30, 2026, the facility had a balance." } }) !== null, `[7g] a stated zero beside a sentence asserting no absence fails — the "0" in "30, 2026" does not count`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) { console.error("\nFAILURES:"); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
