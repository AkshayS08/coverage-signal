/**
 * SESSION 21, STAGE 6 — THE VERIFICATION SHEET.
 *
 * A golden file is a claim that a state is correct. Nobody can sign that
 * claim from a JSON blob, so this renders the state as something a person can
 * check against the filings: every figure the tool holds, the verbatim
 * sentence it came from, and the character offset in the anchor document
 * where that sentence sits.
 *
 * The offset is the point. "Verified" in this pipeline means a sentence was
 * found in a fetched filing; the sheet SHOWS where, so a reader checks the
 * pipeline's own claim rather than taking it. A sourceLine the locator cannot
 * place renders as NOT FOUND — loudly, never omitted, because a line that
 * cannot be placed is the one a signature most needs to see.
 *
 * Deterministic and free: no model call, one warm run per company.
 */
import type { CompanyResult, TriggerResult } from "../agent";
import { assemblePosition, computeWalkChecksum, computeBalanceSheetCheck, normalizeScheduleSequence, ladderCapacityFor, facilityCategoriesOnLadder } from "../events/position";
import { priorityClassLabel } from "../events/instrumentClass";
import { computeCoverage, checkRevolverArithmetic } from "../events/coverage";
import { buildDerivedLines, type DerivedBlock } from "../events/derived";
import type { FlashCard } from "../events/buildEvents";
import { createTextLocator } from "../agent/verifyQuote";

/**
 * Where a verbatim sourceLine sits, and IN WHICH DOCUMENT.
 *
 * The first version searched only the anchor, so every line legitimately
 * sourced from an 8-K — a pricing tranche, a redemption claim, the
 * refinancing line's own inputs — reported NOT FOUND. That is a sheet
 * defect reading as a data defect, and on a sheet meant for signature it is
 * the worst kind: it teaches the reader to skip the warnings.
 *
 * So placement searches the whole fetched corpus and names the document it
 * found the line in. NOT FOUND now means what it says.
 */
export interface Placement {
  offset: number | null;
  note: string;
}

export function placer(corpus: { url: string; text: string; label: string }[], anchorUrl: string | null) {
  const locators = corpus.map((d) => ({ ...d, loc: createTextLocator(d.text) }));
  return (sourceLine: string): Placement => {
    if (locators.length === 0) return { offset: null, note: "no filing text available — cannot place" };
    // The anchor first, so the common case reads as the common case.
    const ordered = [...locators].sort((a, b) => Number(b.url === anchorUrl) - Number(a.url === anchorUrl));
    for (const d of ordered) {
      const at = d.loc.find(sourceLine);
      if (at === null) continue;
      const where = d.url === anchorUrl ? "the anchor" : d.label;
      return { offset: at, note: `char ${at.toLocaleString("en-US")} of ${where}` };
    }
    return { offset: null, note: `NOT FOUND in any of the ${locators.length} fetched document(s) — check this line before signing` };
  };
}

const one = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

export interface SheetInputs {
  result: CompanyResult;
  /** Every fetched filing, so a line sourced from an 8-K places in that 8-K rather than reporting NOT FOUND against the anchor. */
  corpus: { url: string; text: string; label: string }[];
  cards: FlashCard[];
  derivedByCard: Record<string, DerivedBlock>;
  asOf: Date;
}

export function renderVerificationSheet(inp: SheetInputs): string[] {
  const { result, corpus, cards, derivedByCard, asOf } = inp;
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const nd = result.results.find((t) => t.triggerId === "new-debt-issuance");
  const pos = assemblePosition(result, asOf);
  const cov = computeCoverage(dm, ladderCapacityFor(pos), facilityCategoriesOnLadder(pos, dm?.facilities));
  const seq = normalizeScheduleSequence(dm?.scheduleSequence);
  const walk = computeWalkChecksum(dm?.scheduleSequence);
  const anchorCheck = dm ? computeBalanceSheetCheck(dm.balanceSheetDebtCaptions, dm.scheduleSequence) : null;
  const place = placer(corpus, dm?.debtScheduleSourceFiling?.url ?? null);
  const docLabel = new Map<string, string>();
  for (const t of result.results) for (const c of t.citations) if (c.url) docLabel.set(c.url, `${c.form} ${c.date}`);
  for (const d of corpus) if (!docLabel.has(d.url)) docLabel.set(d.url, d.label);
  const L: string[] = [];
  const anchor = dm?.debtScheduleSourceFiling ?? null;

  L.push("");
  L.push("=".repeat(100));
  L.push(`VERIFICATION SHEET — ${result.company}   (CIK ${result.cik})`);
  L.push("=".repeat(100));
  L.push(`ANCHOR      ${anchor ? `${anchor.form} filed ${anchor.date}, period of report ${anchor.reportDate}` : "none"}`);
  L.push(`            ${anchor?.url ?? "-"}`);
  L.push(`AS-OF       ${asOf.toISOString().slice(0, 10)} (pinned; every month count below is measured against this date)`);
  L.push(`FILING SET  ${filingSetOf(result).length} document(s) cited across all triggers:`);
  for (const u of filingSetOf(result)) L.push(`              ${u}`);

  // ---- 1. LADDER ROWS ------------------------------------------------------
  L.push("");
  L.push(`--- 1. LADDER, as the anchor's own debt note states it (${pos.rows.length} row(s)) ---`);
  if (pos.rows.length === 0) L.push("  (none — see the coverage line below for why)");
  for (const r of pos.rows) {
    const p = place(r.sourceLine);
    L.push(`  [${r.status}${r.isCapacity ? "/CAPACITY" : ""}] ${r.instrument}`);
    L.push(`      amount ${r.amount}   maturity ${r.maturityDate ?? "(none stated)"} (${r.dateGranularity ?? "-"})   from ${r.provenance}`);
    // SESSION 22, STAGE 7 — CLASS AND SOURCE DOCUMENT ON THE SHEET ITSELF.
    // Both are rendered on the ladder an RM reads and were absent from the
    // sheet a signer reads, so the two surfaces described the same row
    // differently. A signature surface must show what the product shows.
    L.push(`      class ${priorityClassLabel(r.classification)}${r.classification.priorityClassFrom ? ` (from ${r.classification.priorityClassFrom})` : ""}   type ${r.classification.instrumentType ?? "not stated"}`);
    L.push(`      source document ${r.citedUrl ? (docLabel.get(r.citedUrl) ?? r.citedUrl) : "(none recorded on this row)"}`);
    L.push(`      "${one(r.sourceLine)}"`);
    L.push(`      ${p.note}`);
  }

  // ---- 2. PROSE INSTRUMENTS ------------------------------------------------
  const prose = dm?.proseInstruments ?? [];
  L.push("");
  L.push(`--- 2. PROSE INSTRUMENTS, as the note's narrative states them (${prose.length}) ---`);
  if (prose.length === 0) L.push("  (none — this filer's note states its instruments in a table)");
  for (const pi of prose) {
    const p = place(pi.sourceLine);
    L.push(`  ${pi.name ?? pi.category} — ${pi.amount ?? "(no amount stated)"} [basis: ${pi.amountBasis ?? "-"}]`);
    L.push(`      "${one(pi.sourceLine)}"`);
    L.push(`      ${p.note}`);
  }

  // ---- 3. STATED TOTAL AND ITS PROVENANCE ----------------------------------
  L.push("");
  L.push("--- 3. STATED TOTAL DEBT — the denominator, and where it came from ---");
  L.push(`  DENOMINATOR SOURCE: ${cov.denominatorSource.toUpperCase()}`);
  L.push(`  stated total debt:  ${cov.statedTotalDebt === null ? "UNMEASURED" : "$" + cov.statedTotalDebt.toLocaleString("en-US")}`);
  if (cov.denominatorDisagreement) L.push(`  ⚠ DISAGREEMENT: ${cov.denominatorDisagreement}`);
  const captions = dm?.balanceSheetDebtCaptions ?? [];
  L.push(`  the anchor balance sheet's own debt captions (${captions.length}), which are the model-read alternative:`);
  for (const c of captions) {
    const p = place(c.sourceLine);
    L.push(`      ${c.label}: ${c.amount}   [period column: ${c.periodColumn ?? "-"}]`);
    L.push(`        "${one(c.sourceLine, 140)}"`);
    L.push(`        ${p.note}`);
  }

  // ---- 4. THE THREE CHECKS -------------------------------------------------
  L.push("");
  L.push("--- 4. CHECKS ---");
  L.push(`  CHECK 1 (internal walk): ${walk.pass ? "PASS" : walk.subtotalChecks.length === 0 ? "NOT RUN — no subtotal to walk" : "FAIL"} — ${walk.rowCount} row(s), ${walk.adjustmentCount} adjustment(s)`);
  for (const c of walk.subtotalChecks) {
    L.push(`      ${c.tie ? "tie " : "MISS"} ${c.label ?? "(unlabelled)"}${c.section ? ` [${c.section}]` : ""}: claims ${c.claimedAmount.toLocaleString("en-US")}, computed ${c.runningSum.toLocaleString("en-US")}, gap ${c.gap.toLocaleString("en-US")}`);
  }
  L.push(`  rows outside any subtotal: ${pos.rowsOutsideSubtotal.length}`);
  for (const r of pos.rowsOutsideSubtotal) L.push(`      ! ${r.label} ${r.amount} — ${r.why}`);
  if (anchorCheck) {
    L.push(`  CHECK 2 (balance-sheet anchor): ${anchorCheck.pass ? "PASS" : "FAIL"} — ${anchorCheck.captionCount} caption(s) summing ${anchorCheck.captionSum.toLocaleString("en-US")}${anchorCheck.matchedSubtotalLabel ? `, matched "${anchorCheck.matchedSubtotalLabel}" via ${anchorCheck.matchedVia}` : ""}${anchorCheck.nearestGap === null ? "" : `, nearest gap ${anchorCheck.nearestGap.toLocaleString("en-US")}`}`);
  }
  L.push(`  CHECK 3 (coverage): captured $${cov.capturedFace.toLocaleString("en-US")} + bridge ${cov.statedBridge.toLocaleString("en-US")} against stated $${(cov.statedTotalDebt ?? 0).toLocaleString("en-US")}`);
  L.push(`      residual ${cov.residual === null ? "—" : cov.residual.toLocaleString("en-US")} = ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"}, passes=${cov.residualPasses}`);
  for (const c of cov.capacity) L.push(`      capacity NOT counted as debt: ${c.label} ${c.amount === null ? "(no amount stated)" : "$" + c.amount.toLocaleString("en-US")} — ${c.basisNote}`);
  for (const m of cov.categoriesMissing ?? []) L.push(`      ⚠ STATED BUT NOT CAPTURED: ${m}`);
  const revCheck = checkRevolverArithmetic((dm?.facilities ?? []).find((f) => f.category === "revolver") ?? null);
  if (revCheck.note) L.push(`  REVOLVER: ${revCheck.note}`);
  L.push(`  COVERAGE LINE AS RENDERED: ${cov.line}`);

  // ---- 5. TIER 2 -----------------------------------------------------------
  L.push("");
  L.push(`--- 5. TIER 2 — events since the anchor (${pos.tier2.events.length}) ---`);
  if (pos.tier2.events.length === 0) L.push("  (none — no post-anchor 8-K in this corpus states an event against this position)");
  for (const e of pos.tier2.events) {
    L.push(`  [${e.kind}${e.nets ? `/${e.nets}` : ""}] ${e.date ?? "(no date)"} — ${e.instrument}`);
    L.push(`      effect ${e.effect === null ? "NOTHING" : "$" + e.effect.toLocaleString("en-US")}   ${e.note}`);
    L.push(`      "${one(e.sourceLine, 160)}"   ${e.citedUrl}`);
  }
  if (pos.tier2.rolledTotal !== null) L.push(`  ROLLED: $${pos.tier2.rolledTotal.toLocaleString("en-US")} — ${pos.tier2.rolledLabel}`);

  // ---- 6. CARDS AND THEIR DERIVED LINES ------------------------------------
  L.push("");
  L.push(`--- 6. CARDS AND DERIVED LINES (${cards.length}) ---`);
  if (cards.length === 0) L.push("  (no card-eligible event for this company at this as-of date)");
  for (const card of cards) {
    const block = derivedByCard[card.id];
    L.push(`  CARD: ${card.headlineTrigger.triggerName} [${card.bucket}]  row=${card.headlineRowId ?? "(none)"}`);
    L.push(`        qualified because: ${card.freshnessReason}`);
    for (const l of block?.lines ?? []) {
      L.push(`    ${l.label}: ${l.text}`);
      L.push(`        computed: ${l.computed ?? "nothing — this line states figures side by side and draws no conclusion"}`);
      for (const i of l.inputs) L.push(`        ran over (source text): "${one(i, 150)}"   ${place(i).note}`);
      // A normalized field is not text any document prints — see DerivedLine.fieldInputs.
      for (const f of l.fieldInputs) L.push(`        ran over (verified field): ${f.value}   — established by ${f.verifiedBy}`);
    }
    for (const w of block?.withheld ?? []) {
      L.push(`    ${w.kind}: WITHHELD — ${w.unverified.join(", ")} appears in no source sentence behind this line.`);
    }
  }

  // ---- 7. WHAT A SIGNATURE MEANS ------------------------------------------
  L.push("");
  L.push("--- 7. SIGNATURE ---");
  L.push("  Signing this sheet pins the state above as a golden file. A later run whose");
  L.push("  filing set matches this one must reproduce it; any divergence fails by name.");
  L.push("  Unsigned means unpinned — nothing is written until a signature says so.");
  return L;
}

/** Every distinct filing this company's answer was built from. The identity a golden file is pinned to. */
export function filingSetOf(result: CompanyResult): string[] {
  const urls = new Set<string>();
  for (const t of result.results) for (const c of t.citations) if (c.url) urls.add(c.url);
  return [...urls].sort();
}

/** Exported so the sheet generator and the golden writer agree on what "the card's derived lines" are. */
export function derivedFor(result: CompanyResult, cards: FlashCard[], asOf: Date): Record<string, DerivedBlock> {
  const pos = assemblePosition(result, asOf);
  const out: Record<string, DerivedBlock> = {};
  for (const card of cards) {
    out[card.id] = buildDerivedLines({
      card,
      position: pos,
      debtMaturity: result.results.find((t: TriggerResult) => t.triggerId === "debt-maturity"),
      newDebtIssuance: result.results.find((t: TriggerResult) => t.triggerId === "new-debt-issuance"),
      cashBalance: result.results.find((t: TriggerResult) => t.triggerId === "large-cash-balance"),
      asOf,
    });
  }
  return out;
}
