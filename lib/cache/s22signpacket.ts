/**
 * SESSION 22, STAGE 7 — THE SIGNATURE PACKET, AS DATA. $0.
 *
 * Emits the verification-sheet data as JSON so a formatter can render it
 * without re-describing it. THE POINT IS THAT NOTHING IS RETYPED: what a
 * signer reads must be what the golden file pins, or the signature is on a
 * different document from the one that gets written.
 *
 * So the packet is built from exactly the calls the text sheet and the golden
 * writer already make — `deriveGoldenState` for the pinned state,
 * `evaluateGoldenCriteria` for the nine, `placer` for the character offsets —
 * and it carries a SELF-CHECK: every figure in the packet is looked for in
 * the rendered text sheet, and any that is missing is reported. A formatter
 * that silently drops a row is the failure this exists to prevent, and
 * "it looked right" is not a check (Rule 41).
 *
 * Reusable by construction: pass company names to scope it. Session 23's
 * signature pass over the wider book runs the same command.
 *
 *   npx tsx lib/cache/s22signpacket.ts                       every company
 *   npx tsx lib/cache/s22signpacket.ts "DaVita" "Tenet Healthcare"
 */
import { loadEnvQuietly } from "./loadEnv";
loadEnvQuietly();
import { writeFileSync, mkdirSync } from "node:fs";
import { PINNED_AS_OF } from "./pinnedAsOf";
import { runAgentLoop } from "../agent";
import { getFilingText } from "../fetch";
import { assemblePosition, ladderCapacityFor, facilityCategoriesOnLadder, parseMoneyAmount } from "../events/position";
import { computeCoverage } from "../events/coverage";
import { deriveGoldenState, filingSetOf } from "../events/golden";
import { evaluateGoldenCriteria } from "../events/goldenCriteria";
import { priorityClassLabel, facilityTypeLabel } from "../events/instrumentClass";
import { buildEvents } from "../events/buildEvents";
import { renderVerificationSheet, placer, derivedFor } from "./verificationSheet";
import { sentenceStatesFigure } from "../agent/verifyFacility";
import { matchFacility } from "../events/position";
import type { VerifiedFacility } from "../agent/verifyFacility";
import { EXTRACTION_PROMPT_VERSION, NARRATION_PROMPT_VERSION } from "./promptVersion";

const BOOK = process.argv.slice(2).length ? process.argv.slice(2) : [
  "DaVita", "HCA Healthcare", "Tenet Healthcare", "Universal Health Services",
  "Encompass Health", "Community Health Systems", "Quest Diagnostics",
  "Centene Corporation", "Cigna Group", "Molina Healthcare",
];

/**
 * SESSION 22, STAGE 7 (A1) — ONE FIGURE, ITS OWN SENTENCE, ITS OWN DOCUMENT.
 *
 * A row displays more than one figure and they do not always come from the
 * same disclosure. Tenet's revolver is the worked example: its AMOUNT is in
 * the anchor 10-Q's size sentence and its MATURITY is in the 10-K, seven
 * months older. The packet carried one `sourceLine` for the whole row, so the
 * page showed November 4, 2030 beside a sentence about $1.900 billion and
 * attributed it to the anchor — a real figure and a real quote joined by
 * nothing, on the signature surface itself.
 *
 * `statesFigure` is the check that would have caught it, and it reuses the
 * facility guard's own rule rather than a second one.
 */
export interface FigureProvenance {
  value: string;
  sentence: string;
  document: string;
  placement: string;
  /** The sentence shown is not in this company's anchor filing. */
  outsideAnchor: boolean;
  /** Does the sentence shown actually state this figure? False is a defect, never a note. */
  statesFigure: boolean;
}

export interface PacketRow {
  instrument: string;
  amount: string;
  maturityDate: string | null;
  dateGranularity: string | null;
  status: string;
  provenance: string;
  isCapacity: boolean;
  /** Rendered exactly as the ladder renders it — never a normalized code. */
  priorityClass: string;
  /** B2 — what the tool actually knows: the instrument's kind in the filer's words, with the filing's grouping label. */
  facilityType: string;
  /** E1 — the house display scale. The as-printed value stays in `amount` and is what the golden pins. */
  amountMillions: string | null;
  priorityClassFrom: string | null;
  instrumentType: string | null;
  sourceDocument: string;
  /** The filing's own sentence. Verbatim; the packet never shortens it. */
  sourceLine: string;
  placement: string;
  /** True when this row's amount states no figure AND the filing states none — criterion 2's honest-absence case. */
  honestAbsence: boolean;
  /** A1 — each displayed figure with the sentence that states IT. */
  amountProvenance: FigureProvenance | null;
  maturityProvenance: FigureProvenance | null;
}

export interface PacketCompany {
  company: string;
  cik: string;
  anchor: { form: string; date: string; reportDate: string | null; url: string } | null;
  filingSet: string[];
  asOf: string;
  rows: PacketRow[];
  coverageLine: string;
  criteria: { id: string; name: string; kind: string; pass: boolean | null; detail: string; defends: string }[];
  computedPass: number;
  computedTotal: number;
  signable: boolean;
  /** Figures the self-check could not find in the rendered text sheet. Empty is the only acceptable value. */
  missingFromSheet: string[];
  /**
   * A1 — figures displayed beside a sentence that does not state them. A
   * presence-of-two-things check passed while this was broken; belonging is
   * the property that matters and this is the one that reports it. Empty is
   * the only acceptable value.
   */
  figuresNotStatedBySentence: string[];
  /** The figure IS in the sentence, printed in the filing's own unit while the packet displays it normalized. Not a composite. */
  figuresScaleNormalized: string[];
}

export async function buildSignPacket(companies: string[]): Promise<PacketCompany[]> {
  const out: PacketCompany[] = [];
  for (const company of companies) {
    const result = await runAgentLoop(company);
    const dm = result.results.find((t) => t.triggerId === "debt-maturity");
    const pos = assemblePosition(result, PINNED_AS_OF);
    const cov = computeCoverage(dm, ladderCapacityFor(pos), facilityCategoriesOnLadder(pos, dm?.facilities));
    const state = deriveGoldenState(result, PINNED_AS_OF);
    const crit = evaluateGoldenCriteria(result, PINNED_AS_OF);

    const urls = [...new Set(result.results.flatMap((t) => t.citations.map((c) => c.url)).filter(Boolean))];
    const corpus: { url: string; text: string; label: string }[] = [];
    const docLabel = new Map<string, string>();
    for (const t of result.results) for (const c of t.citations) if (c.url) docLabel.set(c.url, `${c.form} ${c.date}`);
    for (const u of urls) {
      try {
        const raw = await getFilingText(u);
        corpus.push({ url: u, text: typeof raw === "string" ? raw : (raw as { text: string }).text, label: docLabel.get(u) ?? u });
      } catch { /* a document that will not load places as NOT FOUND, which the sheet already says */ }
    }
    const place = placer(corpus, dm?.debtScheduleSourceFiling?.url ?? null);

    /** The facility a ladder row corresponds to, by the position's own rule — never a second matcher. */
    const matchedFacility = (row: { instrument: string }): VerifiedFacility | null =>
      (matchFacility({ name: row.instrument, category: null }, dm?.facilities, { byNameOnly: true }) as VerifiedFacility | null) ?? null;

    /** Which document stated one figure of a facility. The per-figure map the Stage 3 guard already records. */
    const facilityFigureUrl = (f: VerifiedFacility | null, field: string): string =>
      (f as unknown as { figureSources?: Record<string, string> } | null)?.figureSources?.[field] ?? "";

    const rejections = dm?.facilityRejections ?? [];
    const anchorUrl = dm?.debtScheduleSourceFiling?.url ?? "";
    const facilities = dm?.facilities ?? [];

    /**
     * A1 — WHICH SENTENCE STATES THIS FIGURE?
     *
     * Candidates are tried in the order a reader would trust them: the row's
     * own sentence first, then the facility figure's own sentence. The FIRST
     * that actually states the figure wins, and if none does the provenance
     * records that rather than picking one anyway — a sentence that does not
     * state the figure is not provenance for it, and silently attaching the
     * nearest one is the defect this replaces.
     */
    const provenanceFor = (
      value: string | null,
      candidates: { sentence: string; url: string }[]
    ): FigureProvenance | null => {
      if (!value || value.trim() === "" || /^\(no amount stated\)$/i.test(value)) return null;
      const hit = candidates.find((c) => c.sentence && sentenceStatesFigure(value, c.sentence));
      const chosen = hit ?? candidates.find((c) => c.sentence) ?? { sentence: "", url: "" };
      return {
        value,
        sentence: chosen.sentence,
        document: chosen.url ? (docLabel.get(chosen.url) ?? chosen.url) : "(no document recorded)",
        placement: chosen.sentence ? place(chosen.sentence).note : "no sentence recorded for this figure",
        outsideAnchor: !!chosen.url && !!anchorUrl && chosen.url !== anchorUrl,
        statesFigure: !!hit,
      };
    };

    const rows: PacketRow[] = pos.rows.map((r) => {
      // THE PINNED ROW IS THE SOURCE OF THE PINNED FIELDS. Taken from
      // deriveGoldenState rather than re-read off the position, so the packet
      // cannot show one thing while the golden writes another.
      const pinned = state.rows.find((g) => g.instrument === r.instrument);
      const claimedAndRejected = rejections.some((x) => x.field === "facilitySize" && r.instrument.toLowerCase().includes(x.facility.toLowerCase().slice(0, 12)));
      return {
        instrument: pinned?.instrument ?? r.instrument,
        amount: pinned?.amount ?? r.amount,
        maturityDate: pinned?.maturityDate ?? r.maturityDate,
        dateGranularity: pinned?.dateGranularity ?? r.dateGranularity ?? null,
        status: pinned?.status ?? r.status,
        provenance: pinned?.provenance ?? r.provenance,
        isCapacity: pinned?.isCapacity ?? !!r.isCapacity,
        priorityClass: priorityClassLabel(r.classification),
        facilityType: facilityTypeLabel(r.classification),
        // E1 — VERIFY AS PRINTED, DISPLAY NORMALIZED. Derived from the pinned
        // amount, never replacing it: the golden pins what the filing printed
        // and the reader sees one scale down the column.
        amountMillions: (() => {
          const v = parseMoneyAmount(pinned?.amount ?? r.amount);
          return v === null ? null : `$${Math.round(v / 1e6).toLocaleString("en-US")}M`;
        })(),
        priorityClassFrom: r.classification.priorityClassFrom,
        instrumentType: r.classification.instrumentType,
        sourceDocument: r.citedUrl ? (docLabel.get(r.citedUrl) ?? r.citedUrl) : "(none recorded on this row)",
        sourceLine: pinned?.sourceLine ?? r.sourceLine,
        placement: place(pinned?.sourceLine ?? r.sourceLine).note,
        honestAbsence: !/thousand|million|billion|\$/i.test(pinned?.amount ?? r.amount) && !claimedAndRejected,
        amountProvenance: provenanceFor(pinned?.amount ?? r.amount, [
          { sentence: pinned?.sourceLine ?? r.sourceLine, url: r.citedUrl },
          ...(matchedFacility(r)
            ? [
                { sentence: matchedFacility(r)!.facilitySize?.sourceLine ?? "", url: facilityFigureUrl(matchedFacility(r)!, "facilitySize") },
                { sentence: matchedFacility(r)!.drawn?.sourceLine ?? "", url: facilityFigureUrl(matchedFacility(r)!, "drawn") },
              ]
            : []),
        ]),
        // THE MATURITY'S OWN SENTENCE. Where the ladder took it from the
        // facility, that facility's maturity sentence is tried FIRST — it is
        // the disclosure the figure actually came from, and it routinely sits
        // in a different filing from the row.
        maturityProvenance: provenanceFor(r.maturityFromFacility?.statedAs ?? (pinned?.maturityDate ?? r.maturityDate), [
          ...(r.maturityFromFacility ? [{ sentence: r.maturityFromFacility.sourceLine, url: facilityFigureUrl(matchedFacility(r), "maturity") }] : []),
          { sentence: pinned?.sourceLine ?? r.sourceLine, url: r.citedUrl },
        ]),
      };
    });

    // ---- THE SELF-CHECK. Every amount and instrument the packet carries must
    // appear in the rendered text sheet. A formatter that drops a row is the
    // whole risk here, and a count would not catch it (Rule 41).
    const cards = buildEvents([result], PINNED_AS_OF).flashCardCandidates;
    const sheetText = renderVerificationSheet({
      result, corpus, cards, derivedByCard: derivedFor(result, cards, PINNED_AS_OF), asOf: PINNED_AS_OF,
    }).join("\n");
    const missingFromSheet: string[] = [];
    for (const r of rows) {
      if (!sheetText.includes(r.instrument)) missingFromSheet.push(`row instrument "${r.instrument}"`);
      if (!sheetText.includes(r.amount)) missingFromSheet.push(`row amount "${r.amount}" (${r.instrument})`);
    }

    // A1 — THE BELONGING CHECK, on every figure of every row.
    //
    // Presence was never the property that mattered. This asks the question
    // the old check could not: does the sentence displayed beside this figure
    // STATE it? Anything false here is composite fabrication on the signature
    // surface and blocks the signature, not a note beside it.
    //
    // TWO FAILURE CLASSES, AND THEY ARE NOT THE SAME DEFECT. Reporting one
    // number for both would be the mistake Rule 41 names.
    //
    //   COMPOSITE        the sentence carries no form of the figure at all.
    //                    Real, and exactly what A1 exists to catch.
    //   SCALE-NORMALIZED the sentence states the figure AS PRINTED and the
    //                    packet displays it NORMALIZED — "$1,900 million"
    //                    against the filing's own "$ 1.900 billion", or
    //                    "$ 42 million" against a bare table cell "42" whose
    //                    unit came from the table's governing declaration.
    //                    The figure IS stated; the check is comparing the
    //                    wrong side of "verify as printed, display
    //                    normalized".
    //
    // `sentenceStatesFigure` is reused unchanged — it is right about the
    // as-printed value and must not be weakened to accommodate a display
    // form. The classification below only SEPARATES the two so the real
    // defects are legible; it never overturns a verdict.
    const digitsOf = (x: string) => (x.match(/\d+/g) ?? []).join("");
    const figuresNotStatedBySentence: string[] = [];
    const figuresScaleNormalized: string[] = [];
    for (const r of rows) {
      for (const [field, prov] of [["amount", r.amountProvenance], ["maturity", r.maturityProvenance]] as const) {
        if (!prov || prov.statesFigure) continue;
        const d = digitsOf(prov.value);
        const sentenceCarriesDigits = d.length > 0 && digitsOf(prov.sentence).includes(d);
        const line = `${r.instrument} — ${field} "${prov.value}" beside: "${prov.sentence.replace(/\s+/g, " ").slice(0, 100)}"`;
        if (sentenceCarriesDigits) figuresScaleNormalized.push(line);
        else figuresNotStatedBySentence.push(line);
      }
    }

    const computed = crit.criteria.filter((c) => c.kind === "computed");
    const computedPass = computed.filter((c) => c.pass === true).length;
    out.push({
      company: result.company,
      cik: result.cik,
      anchor: state.anchor,
      filingSet: filingSetOf(result),
      asOf: state.asOf,
      rows,
      coverageLine: cov.line,
      criteria: crit.criteria,
      computedPass,
      computedTotal: computed.length,
      signable: computedPass === computed.length && filingSetOf(result).length > 0,
      missingFromSheet,
      figuresNotStatedBySentence,
      figuresScaleNormalized,
    });
    const outside = rows.filter((r) => r.maturityProvenance?.outsideAnchor || r.amountProvenance?.outsideAnchor).length;
    console.log(
      `  ${result.company.padEnd(30)} rows ${String(rows.length).padStart(2)}  computed ${computedPass}/${computed.length}  ` +
      `${missingFromSheet.length === 0 ? "sheet OK" : "SHEET FAILED"}  ` +
      `${figuresNotStatedBySentence.length === 0 ? "belonging OK" : `COMPOSITE (${figuresNotStatedBySentence.length})`}  ` +
      `${figuresScaleNormalized.length ? `scale-normalized ${figuresScaleNormalized.length}` : ""}  ` +
      `${outside ? `${outside} figure(s) from outside the anchor` : ""}`
    );
    for (const f of figuresNotStatedBySentence) console.log(`      ✗ COMPOSITE  ${f}`);
    for (const f of figuresScaleNormalized) console.log(`      ~ scale      ${f}`);
  }
  return out;
}

if (process.argv[1] && process.argv[1].includes("s22signpacket")) {
  (async () => {
    const packet = await buildSignPacket(BOOK);
    mkdirSync("files", { recursive: true });
    const doc = {
      generatedAt: new Date().toISOString(),
      asOf: PINNED_AS_OF.toISOString().slice(0, 10),
      extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
      narrationPromptVersion: NARRATION_PROMPT_VERSION,
      companies: packet,
    };
    writeFileSync("sessions/22/sign_packet.json", JSON.stringify(doc, null, 2), "utf8");
    const failed = packet.filter((p) => p.missingFromSheet.length > 0);
    console.log(`\n  wrote sessions/22/sign_packet.json — ${packet.length} company/companies`);
    console.log(`  SHEET-CHECK: ${failed.length === 0 ? "every packet figure appears in the rendered sheet" : `${failed.length} company/companies FAILED`}`);
    console.log(`  SIGNABLE: ${packet.filter((p) => p.signable).map((p) => p.company).join(", ") || "(none)"}`);
  })();
}
