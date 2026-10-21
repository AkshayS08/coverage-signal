/**
 * SESSION 27, STAGE 1, STEP 1 — MEASURE BEFORE RE-KEYING. $0, read-only.
 *
 * For each signed name:
 *   1. its current read set (selectBaselineFilings over today's filing list);
 *   2. every base-answer key the store holds for it, with its upload time —
 *      each is a fingerprint the old key actually produced;
 *   3. a replay of the last 90 days. The company's full EDGAR history (the
 *      submissions feed's "recent" block plus its older pages) is rebuilt,
 *      and for every day D the catalog EDGAR would have served is emulated:
 *      the newest filings of ANY form filed on or before D, as many as the
 *      "recent" block holds (calibrated to today's block size, never less
 *      than a year). The old key is corpusFingerprint over that block's
 *      8-K/10-Q/10-K; the new key is the read set, by accession number.
 *      Each day either key moves is reported with the filings that moved it.
 *
 * The emulation is checked against every fingerprint actually observed
 * (committed snapshots, stored answer keys) before any count is believed.
 *
 * Model calls: none. Cache writes: only what getRecentFilings itself does when
 * a filing-list entry has passed its 24h TTL (exactly as preflight does). The
 * older pages are read straight from EDGAR (free) and never cached.
 *
 * Run: ANTHROPIC_API_KEY="" npx tsx lib/cache/s27measure.ts > sessions/27/stage1_measurement.txt
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { get, list } from "@vercel/blob";
import { getRecentFilings, type FilingEntry } from "../fetch";
import { secFetchJson } from "../fetch/http";
import { corpusFingerprint } from "./answerCache";
import { selectBaselineFilings } from "../agent/selectFilings";

const FORMS = ["8-K", "10-Q", "10-K"];
const TODAY = "2026-10-21";
const DAYS = 90;
interface Raw { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[]; primaryDocument: string[]; items?: string[] }
const rows = (r: Raw, cikNumber: number): FilingEntry[] =>
  r.form.map((form, i) => ({
    form, filingDate: r.filingDate[i], reportDate: r.reportDate[i], accessionNumber: r.accessionNumber[i], primaryDocument: r.primaryDocument[i],
    primaryDocUrl: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`,
    items: r.items?.[i] ?? "",
  }));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const desc = (a: FilingEntry, b: FilingEntry) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0);
const tag = (f: FilingEntry) => `${f.form} ${f.filingDate}${f.items ? ` (Items ${f.items})` : ""}`;

/** The old key's input on day D: EDGAR's "recent" block as of D, of the three forms. */
function catalogOn(all: FilingEntry[], day: string, blockSize: number): FilingEntry[] {
  const filed = all.filter((f) => f.filingDate <= day).sort(desc);
  const yearAgo = addDays(day, -365);
  const n = Math.max(blockSize, filed.filter((f) => f.filingDate > yearAgo).length);
  return filed.slice(0, n).filter((f) => FORMS.includes(f.form));
}
const readSetOf = (catalog: FilingEntry[]) => selectBaselineFilings([...catalog].sort(desc));
const readKey = (rs: FilingEntry[]) => rs.map((f) => f.accessionNumber).sort().join(",");

(async () => {
  if (process.env.ANTHROPIC_API_KEY !== "") { console.error('REFUSING: run with ANTHROPIC_API_KEY="" (nothing here calls a model, and nothing may)'); process.exit(1); }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const goldens = readdirSync("baselines/golden").map((f) => JSON.parse(readFileSync(`baselines/golden/${f}`, "utf-8"))).filter((g) => g.extractionVersion === 31);
  const totals: string[] = [];

  for (const g of goldens) {
    const name = g.state.company as string;
    const cur = await getRecentFilings(name, FORMS);
    const cikNumber = Number(cur.cik);
    const env = await get(`edgar/submissions/CIK${cur.cik}.json`, { access: "public", token });
    if (!env) throw new Error(`no cached submissions feed for ${name}`);
    const sub = JSON.parse(await new Response(env.stream).text());
    const recent: FilingEntry[] = rows(sub.data.filings.recent, cikNumber);
    const older: FilingEntry[] = [];
    for (const p of sub.data.filings.files ?? []) older.push(...rows(await secFetchJson<Raw>(`https://data.sec.gov/submissions/${p.name}`), cikNumber));
    const all = [...recent, ...older];
    const blockSize = recent.length;

    console.log(`\n================ ${name} (CIK ${cur.cik}) ================`);
    console.log(`feed cached ${sub.cachedAt}; recent block ${blockSize} filings of all forms, ${recent[recent.length - 1].filingDate} to ${recent[0].filingDate}; ${older.length} older on ${(sub.data.filings.files ?? []).length} page(s)`);

    // 1. today's read set
    const rs = readSetOf(cur.filings);
    console.log(`READ SET today (${rs.length} documents; ${cur.filings.length} filings in the catalog the prompt lists):`);
    for (const f of rs) console.log(`  ${tag(f).padEnd(44)} ${f.accessionNumber}`);
    console.log(`  + XBRL company facts (debt total at the anchor's period end: bounds the debt-note excerpt), the catalog listing itself (${cur.filings.length} lines in the prompt), the registered name "${cur.company}"`);

    // 2. validate the emulation against every fingerprint actually observed
    const observed: { when: string; fp: string; where: string }[] = [];
    for (const h of execSync(`git log --format=%h -- lib/cards/inputs/${cur.cik}.json`, { encoding: "utf-8" }).trim().split("\n").filter(Boolean)) {
      const s = JSON.parse(execSync(`git show ${h}:lib/cards/inputs/${cur.cik}.json`, { encoding: "utf-8", maxBuffer: 1 << 30 }));
      observed.push({ when: s.capturedOn, fp: s.corpusFingerprint, where: `snapshot ${h}` });
    }
    const keys = (await list({ prefix: `answer/${cur.cik}/base/`, token, limit: 1000 })).blobs;
    for (const b of keys) {
      const m = /base\/([0-9a-f]{24})\/v(\d+)\.json$/.exec(b.pathname);
      if (m) observed.push({ when: b.uploadedAt.toISOString().slice(0, 10), fp: m[1], where: `stored answer v${m[2]}` });
    }
    let ok = 0, bad = 0;
    const lines: string[] = [];
    for (const o of observed.sort((a, b) => a.when.localeCompare(b.when))) {
      // The filing list is cached up to 24h, so an observed key may reflect the previous day's catalog.
      const fpOn = (d: string) => corpusFingerprint(catalogOn(all, d, blockSize));
      const hit = [o.when, addDays(o.when, -1)].some((d) => fpOn(d) === o.fp);
      if (o.when < addDays(TODAY, -DAYS - 400)) continue;
      if (hit) ok++; else bad++;
      // Not on its own day: name the days whose catalog DOES produce it, so a stale list is told apart from a wrong emulation.
      let near = "";
      if (!hit) {
        const days = Array.from({ length: 121 }, (_, n) => addDays(o.when, n - 90)).filter((d) => fpOn(d) === o.fp);
        near = days.length ? ` (the catalog of ${days[0]}${days.length > 1 ? ` to ${days[days.length - 1]}` : ""} produces it)` : " (no day within 90 before to 30 after produces it)";
      }
      lines.push(`  ${o.when} ${o.fp.slice(0, 8)} ${o.where.padEnd(22)} ${hit ? "reproduced" : "NOT reproduced" + near}`);
    }
    console.log(`EMULATION CHECK: ${ok} of ${ok + bad} observed fingerprints reproduced by the replay`);
    for (const l of lines) console.log(l);

    // 3. the 90-day replay
    let prevCat = catalogOn(all, addDays(TODAY, -DAYS - 1), blockSize);
    let prevFp = corpusFingerprint(prevCat), prevRs = readSetOf(prevCat), prevRk = readKey(prevRs);
    let oldMoves = 0, newMoves = 0;
    console.log(`REPLAY ${addDays(TODAY, -DAYS)} to ${TODAY}:`);
    for (let k = DAYS - 1; k >= 0; k--) {
      const day = addDays(TODAY, -k);
      const cat = catalogOn(all, day, blockSize);
      const fp = corpusFingerprint(cat), rsD = readSetOf(cat), rk = readKey(rsD);
      if (fp === prevFp && rk === prevRk) continue;
      const urls = new Set(cat.map((f) => f.primaryDocUrl)), pUrls = new Set(prevCat.map((f) => f.primaryDocUrl));
      const entered = cat.filter((f) => !pUrls.has(f.primaryDocUrl)), left = prevCat.filter((f) => !urls.has(f.primaryDocUrl));
      const allNew = all.filter((f) => f.filingDate === day);
      const nonForm = allNew.filter((f) => !FORMS.includes(f.form));
      const oldMoved = fp !== prevFp, newMoved = rk !== prevRk;
      if (oldMoved) oldMoves++;
      if (newMoved) newMoves++;
      const rsIn = rsD.filter((f) => !prevRs.some((p) => p.accessionNumber === f.accessionNumber)), rsOut = prevRs.filter((p) => !rsD.some((f) => f.accessionNumber === p.accessionNumber));
      console.log(`  ${day}  old key ${oldMoved ? "MOVES" : "stays"} | read-set key ${newMoved ? "MOVES" : "stays"}`);
      if (entered.length) console.log(`      entered the catalog: ${entered.map(tag).join("; ")}`);
      if (left.length) console.log(`      left the catalog (pushed out of EDGAR's recent block${nonForm.length ? ` by ${nonForm.length} other filing(s) that day: ${[...new Set(nonForm.map((f) => f.form))].join(", ")}` : ""}): ${left.map(tag).join("; ")}`);
      if (newMoved) console.log(`      read set: + ${rsIn.map(tag).join("; ") || "—"}  − ${rsOut.map(tag).join("; ") || "—"}`);
      prevCat = cat; prevFp = fp; prevRs = rsD; prevRk = rk;
    }
    console.log(`SUMMARY ${name}: old key moved ${oldMoves} time(s) in ${DAYS} days; read-set key moved ${newMoves} time(s).`);
    totals.push(`${name.padEnd(30)} old ${String(oldMoves).padStart(2)}   read-set ${String(newMoves).padStart(2)}`);
  }
  console.log(`\n================ TOTALS over ${DAYS} days ================`);
  for (const t of totals) console.log(t);
})().catch((e) => { console.error(e); process.exit(1); });
