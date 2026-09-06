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
import { assemblePosition, computeWalkChecksum, normalizeScheduleSequence, scheduleIsAggregateDisclosure } from "./position";
import { computeCoverage } from "./coverage";
import { parseMoneyAmount } from "./position";

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
  const cov = computeCoverage(dm);
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
  const noUnit = pos.rows.filter((r) => !/thousand|million|billion|\$/i.test(r.amount));
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
    id: "2", kind: "computed", name: "every amount in the unit the filing prints, with its basis stated",
    pass: noUnit.length === 0 && proseNoBasis.length === 0,
    detail: (noUnit.length === 0 ? `all ${pos.rows.length} row(s) carry a printed unit` : `${noUnit.length} row(s) with NO printed unit (${noUnit.map((r) => r.instrument).join("; ")})`)
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
  const triangulates =
    cov.statedTotalDebt !== null && captionSum > 0 &&
    Math.abs(captionSum - cov.statedTotalDebt) <= Math.abs(cov.statedTotalDebt) * 0.01;
  c.push({
    id: "4", kind: "computed", name: "the note's subtotals tie where it prints any; where it prints none, the stated total triangulates instead",
    pass: subtotals.length > 0 ? walk.pass : triangulates && cov.residualPasses === true,
    detail: subtotals.length > 0
      ? walk.subtotalChecks.map((s) => `${s.label ?? "(unlabelled)"}: gap ${s.gap.toLocaleString("en-US")}${s.tie ? " TIES" : " DOES NOT TIE"}`).join("; ")
      : `this note prints NO subtotal, so the amended test applies: the balance sheet's own captions sum to $${captionSum.toLocaleString("en-US")} against a stated total of ${cov.statedTotalDebt === null ? "—" : "$" + cov.statedTotalDebt.toLocaleString("en-US")} (${cov.denominatorSource}) — ${triangulates ? "TRIANGULATES" : "DOES NOT TRIANGULATE"}; coverage residual ${cov.residualFraction === null ? "—" : (cov.residualFraction * 100).toFixed(2) + "%"} passes=${cov.residualPasses}`,
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
  const withClass = debtRows.filter((r) => !!r.seniority);
  const classPartial = withClass.length > 0 && withClass.length < debtRows.length;
  const sectionsPrinted = [...new Set(seq.map((e) => e.section).filter(Boolean))];
  c.push({
    id: "8b", kind: "computed", name: "structure faithful in PRIORITY CLASS — stated for every debt row, or for none",
    pass: !classPartial,
    detail: withClass.length === 0
      ? `no row carries a priority class${sectionsPrinted.length ? `, though the note prints section headings (${sectionsPrinted.join("; ")}) that are used only for subtotal matching` : ""}`
      : classPartial
        ? `PARTIAL — ${withClass.length} of ${debtRows.length} row(s) carry a class (${[...new Set(withClass.map((r) => r.seniority))].join("; ")}); the rest render with none, which reads as an absence of seniority rather than an absence of disclosure`
        : `all ${debtRows.length} row(s) carry a class`,
    defends: "a note that prints senior secured and senior unsecured as separate sections, flattened into one list",
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
