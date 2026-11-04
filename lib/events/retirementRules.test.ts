/**
 * SESSION 27 — THREE RULES FOR A RETIREMENT, over all six signed names (Akshay, Oct 22, 2026).
 *
 *   (a) A retirement dated on or before the position date is already in that
 *       balance. It is an event (Rule 64), never subtracted again: the row
 *       keeps its balance and status, Tier 2 carries no repayment for it.
 *       Its date is the filing date of the document that states it as done.
 *   (b) A partial retirement reduces only its stated amount, never the whole
 *       issue: the row stays live, the remainder is stated, Tier 2 subtracts
 *       the stated amount alone.
 *   (c) An announced redemption stays pending ("redemption set for [date],
 *       awaiting confirmation") until a filing after that date confirms it.
 *       The model's "completed" never confirms it.
 *
 * Each rule is asserted on synthetic claims injected into each name's
 * committed card snapshot result, against a real live row of that name, with
 * a control that must fail it. Offline, $0.
 *
 * Run: npx tsx lib/events/retirementRules.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePosition, parseMoneyAmount, redemptionRetiresRow } from "./position";
import { nonEmpty } from "../testing/nonEmpty";

let passed = 0, failed = 0;
const assert = (ok: boolean, msg: string) => { if (ok) { passed++; console.log(`  ✓ PASS — ${msg}`); } else { failed++; console.log(`  ✗ FAIL — ${msg}`); } };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const IN = join(process.cwd(), "lib", "cards", "inputs");
const snaps = nonEmpty("the card input snapshots", readdirSync(IN).filter((f) => /^\d{10}\.json$/.test(f))).map((f) => JSON.parse(readFileSync(join(IN, f), "utf-8")));

interface Claim { instrument: string; amount: string; status: "completed" | "intended"; sourceLine: string; verified: boolean; foundIn?: { url: string; filingDate: string } }
function withClaims(result: any, claims: Claim[], citedDate: string): any {
  const r = JSON.parse(JSON.stringify(result));
  let nd = r.results.find((t: any) => t.triggerId === "new-debt-issuance");
  const cite = { form: "8-K", date: citedDate, reportDate: citedDate, url: `https://www.sec.gov/Archives/edgar/data/0/synthetic-${citedDate}.htm` };
  nd.fired = true;
  nd.citations = [cite, ...(nd.citations ?? [])];
  nd.redeems = [...claims];
  return r;
}
const rowOf = (p: any, inst: string) => p.rows.find((x: any) => x.instrument === inst);
const repaymentFor = (p: any, inst: string) => p.tier2.events.filter((e: any) => e.kind === "repayment" && e.instrument === inst);
const pendingFor = (p: any, inst: string) => p.tier2.events.filter((e: any) => e.kind === "pending" && e.instrument === inst);

for (const s of snaps) {
  const name = s.company as string;
  const dm = s.result.results.find((t: any) => t.triggerId === "debt-maturity");
  const posDate = dm?.debtScheduleSourceFiling?.reportDate as string | undefined;
  if (!posDate) { console.log(`\n${name}: no anchor period — not constructible`); continue; }
  const asOf = new Date("2026-10-15T00:00:00Z");
  const base = assemblePosition(s.result, asOf);
  // Precondition, stated: a row the redemption identity rule (rate and maturity) can match at all. A row whose rate it cannot read is not a test of these rules.
  const dueOf = (r: any) => (/^\d{4}-\d{2}-\d{2}$/.test(r.maturityDate) ? longDate(r.maturityDate) : r.maturityDate.slice(0, 4));
  const target = base.rows.find((r: any) => r.status === "live" && !r.isCapacity && r.maturityDate && /^\d{4}(-\d{2}-\d{2})?$/.test(r.maturityDate) && (parseMoneyAmount(r.amount) ?? 0) > 1e8 && /%/.test(r.instrument)
    && redemptionRetiresRow(r, `${r.instrument} the Company redeemed all of its ${r.instrument}, due ${dueOf(r)}.`));
  console.log(`\n=== ${name}: position date ${posDate}; target row "${target?.instrument ?? "none"}" ${target?.amount ?? ""} ===`);
  if (!target) { console.log("  · no live dated coupon row to retire — not constructible"); continue; }
  const balance = parseMoneyAmount(target.amount)!;
  // The maturity as the row states it: a day where it states one, the bare year where it does not.
  const due = /^\d{4}-\d{2}-\d{2}$/.test(target.maturityDate!) ? longDate(target.maturityDate!) : target.maturityDate!.slice(0, 4);
  const line = (verb: string, amt: string) => `On ${longDate(addDays(posDate, -40))}, the Company ${verb} ${amt} aggregate principal amount of its ${target.instrument}, due ${due}.`;
  const after = addDays(posDate, 30), before = addDays(posDate, -20);
  const full = `$${(balance / 1e6).toLocaleString("en-US")} million`;

  // ── (a) ──
  const preClaim: Claim = { instrument: target.instrument, amount: full, status: "completed", verified: true, sourceLine: line("redeemed all", full), foundIn: { url: "https://www.sec.gov/Archives/edgar/data/0/prior-annual.htm", filingDate: before } };
  const pa = assemblePosition(withClaims(s.result, [preClaim], after), asOf);
  assert(rowOf(pa, target.instrument)?.status === "live" && rowOf(pa, target.instrument)?.amount === target.amount, `[a:${name}] a retirement stated by a filing dated ${before} (on or before the position date) leaves the row live at ${target.amount}`);
  assert(repaymentFor(pa, target.instrument).length === 0, `[a:${name}] and Tier 2 subtracts nothing for it`);
  assert(((pa as any).priorRetirements ?? []).some((e: any) => e.instrument === target.instrument), `[a:${name}] it is recorded as an event already in the balance`);
  const postFull: Claim = { ...preClaim, foundIn: { url: `https://www.sec.gov/Archives/edgar/data/0/synthetic-${after}.htm`, filingDate: after } };
  const pc = assemblePosition(withClaims(s.result, [postFull], after), asOf);
  assert(rowOf(pc, target.instrument)?.status === "retired" || repaymentFor(pc, target.instrument).length > 0, `[a control:${name}] the same claim stated after the position date does retire it, so the date is what decides`);

  // ── (b) ──
  const half = `$${(balance / 2e6).toLocaleString("en-US")} million`;
  const partial: Claim = { instrument: target.instrument, amount: half, status: "completed", verified: true, sourceLine: line("redeemed", half), foundIn: { url: `https://www.sec.gov/Archives/edgar/data/0/synthetic-${after}.htm`, filingDate: after } };
  const pb = assemblePosition(withClaims(s.result, [partial], after), asOf);
  const rb = rowOf(pb, target.instrument);
  assert(rb?.status === "live", `[b:${name}] redeeming ${half} of ${target.amount} leaves the row live (was ${rb?.status})`);
  assert(Math.abs((rb?.partialRetirement?.remainderUsd ?? -1) - balance / 2) < 1, `[b:${name}] and states the ${half} remainder`);
  assert(repaymentFor(pb, target.instrument).length === 1 && Math.abs(repaymentFor(pb, target.instrument)[0].effect + balance / 2) < 1, `[b:${name}] Tier 2 subtracts the stated ${half} alone`);
  const wholeGone = rowOf(pc, target.instrument)?.status === "retired" || repaymentFor(pc, target.instrument).some((e: any) => Math.abs(e.effect + balance) < 1);
  assert(wholeGone && !rowOf(pc, target.instrument)?.partialRetirement, `[b control:${name}] redeeming the whole ${full} removes the whole issue and states no remainder, so the amount is what decides`);

  // ── (c) ──
  const setFor = addDays(after, 25);
  const announced: Claim = { instrument: target.instrument, amount: full, status: "completed", verified: true, sourceLine: `The Company issued a notice of redemption for all ${full} of its ${target.instrument}, due ${due}, which will be redeemed on ${longDate(setFor)}.`, foundIn: { url: `https://www.sec.gov/Archives/edgar/data/0/synthetic-${after}.htm`, filingDate: after } };
  const pcc = assemblePosition(withClaims(s.result, [announced], after), asOf);
  assert(rowOf(pcc, target.instrument)?.status === "live" && repaymentFor(pcc, target.instrument).length === 0, `[c:${name}] a redemption set for ${setFor}, stated by a filing of ${after} and called "completed" by the model, subtracts nothing`);
  assert(pendingFor(pcc, target.instrument).some((e: any) => e.nets === "unconfirmed" && new RegExp(`redemption set for ${setFor}, awaiting confirmation`).test(e.note)), `[c:${name}] it is pending: "redemption set for ${setFor}, awaiting confirmation"`);
  const confirmed: Claim = { ...announced, sourceLine: `On ${longDate(setFor)}, the Company redeemed all ${full} of its ${target.instrument}, due ${due}.`, foundIn: { url: `https://www.sec.gov/Archives/edgar/data/0/synthetic-${addDays(setFor, 2)}.htm`, filingDate: addDays(setFor, 2) } };
  const pd = assemblePosition(withClaims(s.result, [confirmed], addDays(setFor, 2)), asOf);
  assert(repaymentFor(pd, target.instrument).length === 1, `[c control:${name}] a filing after ${setFor} stating it done confirms it, so the confirming filing is what decides`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
