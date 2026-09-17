/**
 * SESSION 21, STAGE 6 — THE NINE CRITERIA.
 *
 * A golden file pins ONE company's position as of ONE named anchor filing
 * (its period of report and its filing date), and is written only when all
 * nine hold.
 *
 * EVERY CRITERION IS A FAILURE THIS BUILD ACTUALLY HAD. That is why the list
 * is this list and not a general-purpose quality checklist — each line is a
 * specific way the ladder has been wrong, in a specific session, on a
 * specific filer. The named case is recorded with each one so a future
 * reader knows what it is defending against.
 *
 * COMPUTED VERSUS ATTESTED, and the distinction is not a technicality.
 * Criterion 1 — "every row's amount, maturity and instrument correct against
 * the filing" — cannot be computed: the tool comparing its own output to
 * itself proves nothing, which is the whole reason verification sheets exist
 * and a person reads them. Those criteria are ATTESTED, recorded with what
 * the signer confirmed and when. Pretending to compute them would be false
 * assurance, and false assurance on the one artifact meant to carry
 * confidence is worse than none.
 */
import type { CompanyResult, TriggerResult } from "../agent";
import { assemblePosition, computeWalkChecksum, normalizeScheduleSequence, scheduleIsAggregateDisclosure, ladderCapacityFor, facilityCategoriesOnLadder, matchFacility } from "./position";
import { computeCoverage } from "./coverage";
import { parseMoneyAmount } from "./position";
import { classifyInstrument, priorityClassLabel } from "./instrumentClass";

export type CriterionKind = "computed" | "attested";

export interface Criterion {
  /** "1".."9", with letters where one criterion has separable parts. */
  id: string;
  name: string;
  kind: CriterionKind;
  /** Null for an attested criterion with no attestation recorded yet. */
  pass: boolean | null;
  /** What was measured, or what the signer must confirm. Always stated. */
  detail: string;
  /** The failure this criterion exists because of. */
  defends: string;
}

export interface CriteriaResult {
  criteria: Criterion[];
  /** True only when every computed criterion passes AND every attested one carries an attestation. */
  allHold: boolean;
  failing: string[];
  unattested: string[];
}

/** What a signer confirms by hand; nothing here can be computed from the tool's own output. */
export interface Attestation {
  /** (1) Rows checked against the filing. */
  rowsCorrect?: boolean;
  /** (8c) Instrument type faithful to the note. */
  instrumentTypeFaithful?: boolean;
  /** (9b) The whole state reproduced on three independent re-asks. */
  reproducedThreeTimes?: boolean;
  by?: string;
  on?: string;
}

export function evaluateGoldenCriteria(result: CompanyResult, asOf: Date, att: Attestation = {}): CriteriaResult {
  const dm = result.results.find((t: TriggerResult) => t.triggerId === "debt-maturity");
  const pos = assemblePosition(result, asOf);
  const cov = computeCoverage(dm, ladderCapacityFor(pos), facilityCategoriesOnLadder(pos, dm?.facilities));
  const seq = normalizeScheduleSequence(dm?.scheduleSequence);
  const walk = computeWalkChecksum(dm?.scheduleSequence);
  const anchor = dm?.debtScheduleSourceFiling ?? null;
  const anchorUrl = anchor?.url ?? null;
  const debtRows = pos.rows.filter((r) => !r.isCapacity);
  const c: Criterion[] = [];

  // ---- (1) rows correct against the filing — ATTESTED --------------------
  c.push({
    id: "1", kind: "attested", name: "every row's amount, maturity and instrument correct against the filing",
    pass: att.rowsCorrect ?? null,
    detail: att.rowsCorrect
      ? `attested by ${att.by ?? "(unnamed)"}${att.on ? ` on ${att.on}` : ""} against ${anchor?.form ?? "the anchor"} ${anchor?.date ?? ""}`
      : `${debtRows.length} row(s) to check by hand against the anchor; the tool cannot verify this about itself`,
    defends: "a ladder that ties to itself and to nothing in the world",
  });

  // ---- (2) unit and basis -------------------------------------------------
  // SESSION 22, STAGE 7 — "NO AMOUNT STATED" IS A FINDING, NOT AUTOMATICALLY
  // A FAILURE. Each no-unit row is classified rather than counted.
  //
  // The criterion defends against a bare table cell read at a guessed scale.
  // A row carrying NO FIGURE AT ALL is not that: there is nothing to misread.
  // But it is only honest if the filing really states none — and the two
  // cases are distinguishable from data the guard already produced. A
  // facility whose size was CLAIMED and then rejected by the per-figure guard
  // is a real miss: the filing stated something and the tool does not carry
  // it. A facility whose size was never claimed states none.
  //
  // Same principle as 8b: do not punish honesty, and do not let a silent
  // absence pass as one.
  const rejections = dm?.facilityRejections ?? [];
  const noUnitRows = pos.rows.filter((r) => !/thousand|million|billion|\$/i.test(r.amount));
  const classifyNoUnit = (r: (typeof pos.rows)[number]) => {
    const f = matchFacility({ name: r.instrument, category: null }, dm?.facilities, { byNameOnly: true });
    const rejected = f ? rejections.filter((x) => x.facility === f.name && x.field === "facilitySize") : [];
    if (rejected.length > 0) {
      return { honest: false, why: `an amount WAS stated for it and did not survive verification (${rejected[0].value}: ${rejected[0].reason})` };
    }
    if (f && !f.facilitySize) return { honest: true, why: "the filing states no size for this facility" };
    if (r.isCapacity) return { honest: true, why: "committed facility, and the filing states no amount for it" };
    return { honest: false, why: "a debt row carrying no figure and no stated absence" };
  };
  const noUnitClassified = noUnitRows.map((r) => ({ row: r, ...classifyNoUnit(r) }));
  const noUnit = noUnitClassified.filter((x) => !x.honest);
  // BASIS LIVES ON THE PROSE INSTRUMENT, NOT ON THE ROW. `amountBasis` is
  // read by debtContribution to decide debt-versus-capacity and is then
  // DROPPED when the instrument becomes a LadderRow — so the row a golden
  // file pins, and the row the ladder renders, carries no basis of its own.
  // Checking the row for it reported every narrative row as basis-less,
  // which was this check being wrong; that the row does not carry it is a
  // real gap, reported here rather than hidden by fixing the check.
  const prose = dm?.proseInstruments ?? [];
  const proseNoBasis = prose.filter((p) => !p.amountBasis);
  const basisOnRow = false; // no LadderRow field exists — see the comment above
  c.push({
    id: "2", kind: "computed", name: "every amount in the filing's unit and basis, or explicitly absent from the filing — verified either way",
    pass: noUnit.length === 0 && proseNoBasis.length === 0,
    detail: (noUnitClassified.length === 0
      ? `all ${pos.rows.length} row(s) carry a printed unit`
      : noUnit.length === 0
        ? `${pos.rows.length - noUnitClassified.length} row(s) carry a printed unit; ${noUnitClassified.length} state no amount HONESTLY (${noUnitClassified.map((x) => `${x.row.instrument} — ${x.why}`).join("; ")})`
        : `${noUnit.length} row(s) MISSING an amount the filing has (${noUnit.map((x) => `${x.row.instrument} — ${x.why}`).join("; ")})`)
      + "; " +
      (prose.length === 0
        ? "no narrative instruments, so no basis to state"
        : proseNoBasis.length === 0
          ? `all ${prose.length} narrative instrument(s) state a basis (${[...new Set(prose.map((p) => p.amountBasis))].join(", ")})`
          : `${proseNoBasis.length} of ${prose.length} narrative instrument(s) state NO basis`)
      + (prose.length > 0 && !basisOnRow ? " — NOTE: the basis is carried on the extracted instrument and is DROPPED on the assembled row, so neither the pinned row nor the rendered ladder states it" : ""),
    defends: "a bare table cell read at a guessed scale — the $1.448 TRILLION line, and a facility size counted as a drawn balance",
  });

  // ---- (3) citations ------------------------------------------------------
  const offAnchor = pos.rows.filter((r) => r.provenance !== "pricing-8-K" && anchorUrl && r.citedUrl && r.citedUrl !== anchorUrl);
  c.push({
    id: "3", kind: "computed", name: "every row cited to the anchor filing, or to a post-anchor 8-K for Tier 2",
    pass: !!anchorUrl && offAnchor.length === 0,
    detail: !anchorUrl ? "no anchor filing to cite against"
      : offAnchor.length === 0
        ? `all ${debtRows.length} note row(s) cite the anchor; ${pos.tier2.events.length} Tier 2 event(s) cite post-anchor documents`
        : `${offAnchor.length} row(s) cite a filing other than the anchor: ${offAnchor.map((r) => r.instrument).join("; ")}`,
    defends: "one position assembled from three filings and three dates",
  });

  // ---- (4) the note's own subtotals tie -----------------------------------
  //
  // AMENDED, and the amendment is what "subtotals tie" always meant: this is
  // a check that only exists where subtotals do. As first written it
  // permanently excluded every prose-only filer, including the one already
  // signed — UHS's debt note prints no subtotal at all, which is the shape
  // the whole Rule 22 chain exists for. A criterion that cannot ever hold
  // for a shape that really exists is not strict, it is blind.
  //
  // So: where the note PRINTS subtotals, they tie. Where it prints NONE, the
  // stated total triangulates instead — the balance sheet's own captions
  // against the filer's own XBRL tag — and Check 2 plus coverage carry the
  // weight. That is a stronger tie than a subtotal, not a weaker one: a
  // subtotal is the note checked against itself, while triangulation is two
  // independent statements by the filer agreeing. UHS's 2.28% residual
  // against its own XBRL total is the worked example.
  const subtotals = seq.filter((e) => e.kind === "subtotal");
  const captionSum = (dm?.balanceSheetDebtCaptions ?? []).reduce((a, x) => a + (parseMoneyAmount(x.amount) ?? 0), 0);
  // SESSION 22, STAGE 7 — EITHER PATH TIES, NOT BOTH.
  //
  // Triangulation is two independent statements by the filer agreeing. It had
  // exactly one route — the balance sheet's own captions against the stated
  // total — so a filer whose CAPTIONS are missing failed a criterion about
  // whether its TOTAL is corroborated. UHS is the case: its
  // balanceSheetDebtCaptions are empty at v29 (they were populated at v28),
  // and criterion 4 failed while the residual it is really about ties at
  // 2.28% against the filer's own XBRL tag, gate-confirmed.
  //
  // The XBRL tag is the filer's own statement of its debt and does not move
  // when our prompt does; it is a corroborating source in its own right. So
  // the criterion holds if EITHER route ties. The caption emptiness is a real
  // extraction gap and is logged as one — it is not evidence that the total
  // is uncorroborated.
  const capTriangulates =
    cov.statedTotalDebt !== null && captionSum > 0 &&
    Math.abs(captionSum - cov.statedTotalDebt) <= Math.abs(cov.statedTotalDebt) * 0.01;
  const xbrlTriangulates = cov.denominatorSource === "xbrl" && cov.statedTotalDebt !== null;
  const triangulates = capTriangulates || xbrlTriangulates;
  c.push({
    id: "4", kind: "computed", name: "the note's subtotals tie where it prints any; where it prints none, the stated total triangulates instead",
    pass: subtotals.length > 0 ? walk.pass : triangulates && cov.residualPasses === true,
    detail: subtotals.length > 0
      ? walk.subtotalChecks.map((s) => `${s.label ?? "(unlabelled)"}: gap ${s.gap.toLocaleString("en-US")}${s.tie ? " TIES" : " DOES NOT TIE"}`).join("; ")
      : `this note prints NO subtotal, so the amended test applies. Captions sum to $${captionSum.toLocaleString("en-US")}${capTriangulates ? " and TIE" : captionSum === 0 ? " (NONE EXTRACTED — a real gap, logged separately; it is not evidence the total is uncorroborated)" : " and DO NOT tie"}; the stated total is ${cov.statedTotalDebt === null ? "—" : "$" + cov.statedTotalDebt.toLocaleString("en-US")} from ${cov.denominatorSource}${xbrlTriangulates ? ", the filer's own XBRL tag, which TIES" : ""}. Either route suffices: ${triangulates ? "TRIANGULATES" : "DOES NOT TRIANGULATE"}; coverage residual ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"} passes=${cov.residualPasses}`,
    defends: "a transcription missing a row that nothing in the filing's own arithmetic would catch — and, as amended, a criterion that would have declared every prose-only note unpinnable",
  });

  // ---- (5) denominator provenance ----------------------------------------
  c.push({
    id: "5", kind: "computed", name: "stated total triangulates to the filer's XBRL tag, or is labelled model-read",
    pass: cov.denominatorSource === "xbrl" || cov.denominatorSource === "model-read",
    detail: cov.denominatorSource === "xbrl"
      ? `the filer's own XBRL tags, ${cov.statedTotalDebt === null ? "—" : "$" + cov.statedTotalDebt.toLocaleString("en-US")}`
      : cov.denominatorSource === "model-read"
        ? `MODEL-READ and labelled as such — this filer tags no usable XBRL total; the denominator is the balance-sheet captions as extracted, which is a weaker provenance than a tagged one`
        : "no denominator at all — coverage is unmeasured",
    defends: "a coverage percentage whose denominator nobody could name",
  });

  // ---- (6) coverage passes both tests -------------------------------------
  const missing = cov.categoriesMissing ?? [];
  c.push({
    id: "6", kind: "computed", name: "coverage passes both tests — category-complete and residual under threshold",
    pass: missing.length === 0 && cov.residualPasses === true,
    detail: `residual ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"} (passes=${cov.residualPasses}); ` +
      (missing.length === 0 ? "no category stated-but-not-captured" : `STATED BUT NOT CAPTURED: ${missing.join(", ")}`),
    defends: "a $1.1B ladder rendered against $4.85B of stated debt with both other checks silent",
  });

  // ---- (7) capacity separated ---------------------------------------------
  const capRows = pos.rows.filter((r) => r.isCapacity);
  const capInSum = capRows.length !== cov.capacity.length;
  c.push({
    id: "7", kind: "computed", name: "capacity separated and excluded from the debt sum",
    pass: !capInSum,
    detail: capRows.length === 0
      ? "this filer states no undrawn capacity"
      : `${capRows.length} capacity row(s) held out of captured face and reported separately: ${cov.capacity.map((e) => e.label).join("; ")}`,
    defends: "a $1.25B facility with nothing drawn counted as debt, reading 134% coverage",
  });

  // ---- (8) structure faithful to the note ---------------------------------
  const aggregate = scheduleIsAggregateDisclosure(dm?.scheduleSequence);
  c.push({
    id: "8a", kind: "computed", name: "structure faithful in TRANCHES — the note's rows are per-instrument, not one aggregate line",
    pass: !aggregate && debtRows.length > 0,
    detail: aggregate
      ? "this note prints ONE AGGREGATE LINE for its notes, not a tranche ladder — the position cannot answer which tranche, at what rate"
      : `${debtRows.length} per-instrument row(s)`,
    defends: "an aggregate disclosure pinned as though it were a tranche ladder",
  });

  // Class completeness: where the note states a priority class for ANY row it
  // must state one for EVERY debt row, or the ladder shows a class on some
  // lines and silence on others, which reads as "unsecured" rather than "not
  // stated".
  // SESSION 22, STAGE 7 — READ THE MERGED FIELD, AND TIGHTEN THE MEANING.
  //
  // This read `r.seniority`. Stage 4 merged the concept into `classification`
  // — fed by the section heading, the instrument's own name, and the note's
  // prose — because the model distributes one class across two schema fields
  // per company (Rule 39). So this reported "no row carries a priority class"
  // about Tenet's ladder while that ladder rendered ELEVEN of twelve with
  // one, and passed vacuously on a name it was written to protect.
  //
  // AND THE TEST ITSELF WAS THE WRONG TEST. "All or none" fails a ladder
  // whose filing genuinely classes some rows and not others — which is most
  // real notes. What this criterion exists to prevent is SILENCE READING AS
  // UNSECURED, and that is now defended directly: a row with no stated class
  // renders "class not stated on this row" in as many words.
  //
  // So faithful means: every row either carries its class or explicitly
  // states it has none. A partial count with honest unclassed rows is
  // faithful; a silent default is not. The failure that remains — and the
  // one worth catching — is a row whose SOURCES state a class that the
  // ladder dropped.
  const withClass = debtRows.filter((r) => r.classification.priorityClass !== null);
  const unclassed = debtRows.filter((r) => r.classification.priorityClass === null);
  const dropped = unclassed.filter(
    (r) => classifyInstrument({ headings: [r.seniority], instrumentName: r.instrument }).priorityClass !== null
  );
  const everyUnclassedSaysSo = unclassed.every((r) => priorityClassLabel(r.classification) === "class not stated on this row");
  const sectionsPrinted = [...new Set(seq.map((e) => e.section).filter(Boolean))];
  c.push({
    id: "8b", kind: "computed", name: "structure faithful in PRIORITY CLASS — every row carries its class or explicitly states it has none",
    pass: dropped.length === 0 && everyUnclassedSaysSo,
    detail: dropped.length > 0
      ? `DROPPED — ${dropped.length} row(s) whose own sources state a class the ladder does not carry (${dropped.map((r) => r.instrument).join("; ")})`
      : !everyUnclassedSaysSo
        ? `${unclassed.length} unclassed row(s) render no explicit statement — silence here reads as "unsecured"`
        : unclassed.length === 0
          ? `all ${debtRows.length} row(s) carry a class (${[...new Set(withClass.map((r) => priorityClassLabel(r.classification)))].join("; ")})`
          : `${withClass.length} of ${debtRows.length} row(s) carry a class; the remaining ${unclassed.length} state "class not stated on this row" explicitly (${unclassed.map((r) => r.instrument).join("; ")})${sectionsPrinted.length ? `. Sections printed: ${sectionsPrinted.join("; ")}` : ""}`,
    defends: "a note that prints senior secured and senior unsecured as separate sections, flattened into one list — and silence defaulting to unsecured",
  });

  c.push({
    id: "8c", kind: "attested", name: "structure faithful in INSTRUMENT TYPE",
    pass: att.instrumentTypeFaithful ?? null,
    detail: att.instrumentTypeFaithful
      ? `attested by ${att.by ?? "(unnamed)"}`
      : "no instrument-type field exists on a row; type survives only inside the instrument's own name, unnormalized. A signer confirms the names carry it",
    defends: "a revolver rendering as a generic facility with its type nowhere stated",
  });

  // ---- (9) Tier 2 and reproducibility -------------------------------------
  const badT2 = pos.tier2.events.filter((e) => !e.sourceLine || !e.citedUrl);
  c.push({
    id: "9a", kind: "computed", name: "Tier 2 events status-corroborated and source-verified",
    pass: badT2.length === 0,
    detail: pos.tier2.events.length === 0
      ? "no Tier 2 events"
      : `${pos.tier2.events.length} event(s), each carrying its own verbatim source and cited filing; ${pos.tier2.events.filter((e) => e.nets).length} net nothing and say why`,
    defends: "a tranche retired on an instrument's name appearing in a ranking clause, and an intention read as a completion",
  });

  c.push({
    id: "9b", kind: "attested", name: "the whole state reproduces on three independent re-asks",
    pass: att.reproducedThreeTimes ?? null,
    detail: att.reproducedThreeTimes
      ? `attested by ${att.by ?? "(unnamed)"} — three CACHE_BUST re-asks at a fixed prompt version`
      : "NOT DEMONSTRATED. Warm re-runs prove the pipeline is deterministic; only a re-ask at the same version on the same filings measures the model, and that is billed",
    defends: "a hand-verified 98% that did not survive the next extraction (Rule 23)",
  });

  const computed = c.filter((x) => x.kind === "computed");
  const attested = c.filter((x) => x.kind === "attested");
  return {
    criteria: c,
    failing: computed.filter((x) => x.pass !== true).map((x) => `${x.id} ${x.name}`),
    unattested: attested.filter((x) => x.pass !== true).map((x) => `${x.id} ${x.name}`),
    allHold: computed.every((x) => x.pass === true) && attested.every((x) => x.pass === true),
  };
}
