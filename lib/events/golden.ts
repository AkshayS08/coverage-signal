/**
 * SESSION 21, STAGE 6 — GOLDEN FILES.
 *
 * A golden file pins a state that a person checked against the filings and
 * signed. It is not a snapshot of whatever the last run produced: it is
 * written only when a signature says so, and nothing writes one on its own.
 *
 * WHAT IT IS PINNED TO IS THE FILING SET. A company's answer is a function of
 * the documents it was built from, and those change on their own — a new 8-K
 * appears, a 10-Q supersedes the anchor. Comparing a run against a golden
 * file whose filing set has moved would report a divergence that is not one,
 * and after a few of those nobody reads the failures. So the identity is the
 * sorted set of cited URLs plus the anchor: same documents in, same answer
 * out, and a different set is NOT A FAILURE — it is a golden file that no
 * longer applies and says so.
 *
 * DIVERGENCE FAILS BY NAME. "The ladder changed" is not actionable. Every
 * comparison names the field, the expected value and the actual one, so a
 * failure reads as a diff rather than as an alarm.
 */
import type { CompanyResult } from "../agent";
import { assemblePosition, parseMoneyAmount, rowIdentityKey, rowIdentityKeyWithoutSize } from "./position";
import { computeCoverage } from "./coverage";
import { buildDerivedLines } from "./derived";
import { buildEvents } from "./buildEvents";

/** One ladder entry, reduced to what a signature actually pins. */
export interface GoldenRow {
  instrument: string;
  amount: string;
  maturityDate: string | null;
  dateGranularity: string | null;
  status: string;
  provenance: string;
  isCapacity: boolean;
  sourceLine: string;
}

export interface GoldenDerivedLine {
  kind: string;
  text: string;
  computed: string | null;
  inputs: string[];
  fieldInputs: { value: string; verifiedBy: string }[];
}

export interface GoldenCard {
  triggerId: string;
  bucket: string;
  headlineRowId: string | null;
  derived: GoldenDerivedLine[];
  withheld: { kind: string; unverified: string[] }[];
}

/** The pinned state. Every field here is one a divergence can be named against. */
export interface GoldenState {
  company: string;
  cik: string;
  anchor: { form: string; date: string; reportDate: string | null; url: string } | null;
  filingSet: string[];
  asOf: string;
  rows: GoldenRow[];
  coverage: {
    denominatorSource: string;
    statedTotalDebt: number | null;
    capturedFace: number;
    statedBridge: number;
    /**
     * PERCENT, and the name now says so. This was `residualFraction` while
     * holding `cov.residualFraction * 100` — the same name as
     * CoverageResult's field, carrying different units. Rule 21 exactly: one
     * fact in two fields, and the two will eventually disagree. They did,
     * within minutes of the re-signature packet being written, which applied
     * the fraction convention and printed UHS's 2.28% residual as 228.00%.
     */
    residualPercent: number | null;
    residualPasses: boolean | null;
  };
  tier2: { kind: string; date: string | null; effect: number | null; nets: string | null; instrument: string }[];
  rowsOutsideSubtotal: number;
  cards: GoldenCard[];
}

export interface GoldenFile {
  /**
   * SESSION 22, STAGE 3 — THE EXTRACTION VERSION THE CAPTURED INPUT CAME FROM.
   *
   * A golden file's claim is "the same documents in, the same answer out".
   * That claim is about the DERIVATION, and it silently assumes the captured
   * input still has the shape the derivation reads. When the schema moves,
   * it does not: v28 results carry a single `revolver` object and v29 code
   * looks for a `facilities` array, so UHS's revolver read as capacity, its
   * captured face fell $225M and its residual went 2.28% -> 6.92%. Nothing
   * regressed. The pin was being compared against code that asks a different
   * question of the same bytes.
   *
   * Rule 30 already settled the shape of this answer for a moved FILING SET
   * — not-applicable, name what moved, re-sign against the new corpus. A
   * moved SCHEMA is the same kind of event and gets the same treatment,
   * rather than being reported as a divergence nobody can act on.
   *
   * Absent on files signed before this was recorded; those are treated as
   * un-comparable against a newer version rather than assumed to match it.
   */
  extractionVersion?: number;
  /** Who signed, when, and on what evidence. A golden file with no signature is not one. */
  signature: { signedBy: string; signedOn: string; basis: string };
  /**
   * What the signer confirmed BY HAND — the three criteria no tool can check
   * about itself. Stored so a reader of the file knows which parts of the
   * claim rest on a person and which on a measurement.
   */
  attestation: { rowsCorrect: boolean; instrumentTypeFaithful: boolean; reproducedThreeTimes: boolean; by: string; on: string };
  /**
   * All nine criteria as evaluated at signing, verbatim. The file carries its
   * own justification: a later reader does not have to re-derive why this
   * state was considered pinnable, and a criterion that was amended is
   * visible in the wording recorded here.
   */
  criteria: { id: string; name: string; kind: string; pass: boolean | null; detail: string; defends: string }[];
  state: GoldenState;
  /**
   * The captured CompanyResult the state was derived from. Committed WITH the
   * golden file so the offline suite can re-derive and compare without a
   * network call or a model call — which is what makes this a regression test
   * rather than a note about a run nobody can repeat.
   */
  sourceResult: CompanyResult;
}

/** Every distinct filing this answer was built from — the golden file's identity. */
export function filingSetOf(result: CompanyResult): string[] {
  const urls = new Set<string>();
  for (const t of result.results) for (const c of t.citations) if (c.url) urls.add(c.url);
  return [...urls].sort();
}

/**
 * Derives the pinnable state from a CompanyResult. The SAME function runs
 * when a golden file is written and when one is checked, so a divergence is
 * always a change in the pipeline and never a difference between two
 * descriptions of it.
 */
/** The residual, as a percent. Every signed file now carries residualPercent; the migration shim that also read the old residualFraction spelling was deleted the moment the three files were re-signed, because a compatibility shim that outlives its migration becomes the second field all over again. */
export function residualPercentOf(state: { coverage: { residualPercent: number | null } }): number | null {
  return state.coverage.residualPercent;
}

export function deriveGoldenState(result: CompanyResult, asOf: Date): GoldenState {
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  const nd = result.results.find((t) => t.triggerId === "new-debt-issuance");
  const pos = assemblePosition(result, asOf);
  const cov = computeCoverage(dm);
  const anchor = dm?.debtScheduleSourceFiling ?? null;
  const cards = buildEvents([result], asOf).flashCardCandidates;

  return {
    company: result.company,
    cik: result.cik,
    anchor: anchor ? { form: anchor.form, date: anchor.date, reportDate: anchor.reportDate ?? null, url: anchor.url } : null,
    filingSet: filingSetOf(result),
    asOf: asOf.toISOString().slice(0, 10),
    rows: pos.rows.map((r) => ({
      instrument: r.instrument, amount: r.amount, maturityDate: r.maturityDate,
      dateGranularity: r.dateGranularity ?? null, status: r.status, provenance: r.provenance,
      isCapacity: !!r.isCapacity, sourceLine: r.sourceLine,
    })),
    coverage: {
      denominatorSource: cov.denominatorSource,
      statedTotalDebt: cov.statedTotalDebt,
      capturedFace: cov.capturedFace,
      statedBridge: cov.statedBridge,
      residualPercent: cov.residualFraction === null ? null : Number((cov.residualFraction * 100).toFixed(2)),
      residualPasses: cov.residualPasses,
    },
    tier2: pos.tier2.events.map((e) => ({ kind: e.kind, date: e.date, effect: e.effect, nets: e.nets, instrument: e.instrument })),
    rowsOutsideSubtotal: pos.rowsOutsideSubtotal.length,
    cards: cards.map((card) => {
      const block = buildDerivedLines({ card, position: pos, debtMaturity: dm, newDebtIssuance: nd, asOf });
      return {
        triggerId: card.headlineTrigger.triggerId,
        bucket: card.bucket,
        headlineRowId: card.headlineRowId,
        derived: block.lines.map((l) => ({ kind: l.kind, text: l.text, computed: l.computed, inputs: l.inputs, fieldInputs: l.fieldInputs })),
        withheld: block.withheld.map((w) => ({ kind: w.kind, unverified: w.unverified })),
      };
    }),
  };
}

export type GoldenVerdict =
  | { kind: "matches" }
  /** The documents moved. Not a failure — the pin no longer describes this input. */
  | { kind: "not-applicable"; reason: string; added: string[]; removed: string[] }
  | { kind: "diverged"; divergences: string[] };

const fmt = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "string" ? `"${v}"` : String(v));

/**
 * Compares a fresh state against a signed one.
 *
 * FILING SET FIRST. Same documents in, same answer out — that is the whole
 * claim a golden file makes, and it makes no claim at all about a different
 * corpus. A moved filing set returns "not-applicable" and names what moved,
 * so a stale pin is visibly stale rather than silently red.
 */
export function compareToGolden(expected: GoldenState, actual: GoldenState): GoldenVerdict {
  const exp = new Set(expected.filingSet);
  const act = new Set(actual.filingSet);
  const added = actual.filingSet.filter((u) => !exp.has(u));
  const removed = expected.filingSet.filter((u) => !act.has(u));
  if (added.length > 0 || removed.length > 0) {
    return {
      kind: "not-applicable",
      reason: `the filing set moved: ${added.length} document(s) added, ${removed.length} removed. This golden file pins an answer to a corpus that is no longer the one on EDGAR; it must be re-signed against the new one, not compared against it.`,
      added, removed,
    };
  }

  const d: string[] = [];
  const cmp = (field: string, e: unknown, a: unknown) => {
    if (JSON.stringify(e) !== JSON.stringify(a)) d.push(`${field}: expected ${fmt(e)}, got ${fmt(a)}`);
  };

  /**
   * SESSION 22, STAGE 7 — AN AMOUNT IS COMPARED BY VALUE AND UNIT, NOT BY
   * ITS WHITESPACE.
   *
   * A golden pins a transcription, and `"$ 1,500 million"` against
   * `"$1,500 million"` is the same transcription with a space moved. String
   * equality called that a divergence and blocked a signature over it, which
   * trains a reader to wave divergences through — the one thing a signature
   * surface must never do.
   *
   * BOTH HALVES MUST MATCH, and the unit is the half that keeps this honest.
   * Comparing value alone would make `"$1.5 billion"` equal `"$1,500
   * million"`: the same money, and NOT the same transcription. The filing
   * printed one of them, and a run that starts printing the other has
   * changed what it read even though the arithmetic is unmoved.
   *
   * Falls back to exact string comparison whenever either side does not parse
   * — `"(no amount stated)"`, an em-dash zero, a capacity row's composed
   * `"$X drawn under $Y"` — because a comparison that cannot read its inputs
   * must not report them as equal.
   */
  const amountKey = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const value = parseMoneyAmount(raw);
    if (value === null) return null;
    const unit = /\b(thousand|million|billion|trillion)s?\b/i.exec(raw);
    return `${value}|${unit ? unit[1].toLowerCase() : "asPrinted"}`;
  };
  const cmpAmount = (field: string, e: unknown, a: unknown) => {
    const ek = amountKey(e), ak = amountKey(a);
    if (ek !== null && ak !== null) {
      if (ek !== ak) d.push(`${field}: expected ${fmt(e)}, got ${fmt(a)}`);
      return;
    }
    cmp(field, e, a);
  };

  cmp("anchor.url", expected.anchor?.url ?? null, actual.anchor?.url ?? null);
  cmp("anchor.reportDate", expected.anchor?.reportDate ?? null, actual.anchor?.reportDate ?? null);
  cmp("asOf", expected.asOf, actual.asOf);

  // The ladder, row by row — never "the ladder changed".
  //
  // SESSION 22 — ROWS ARE MATCHED ON WHAT THE FILING STATES, NOT ON THE LABEL.
  //
  // This keyed on `instrument`, so a filer whose synonyms the model alternates
  // between produced a MISSING and an UNEXPECTED for one unmoved row. Molina's
  // revolver is "revolving credit facility" in one re-ask and "Credit
  // Facility" in two, with the same $1.25 billion, the same 2030-11-20
  // maturity and the same class in all three. A golden must not fail over
  // which of the filing's own two names a run happened to print.
  //
  // The label is still COMPARED — it is a transcription and a change in it is
  // worth seeing — but as a field of a matched row, reported as a rename,
  // rather than as the thing that decides whether the row is the same row.
  const keyOf = (r: GoldenRow) => rowIdentityKey({ rate: null, maturityDate: r.maturityDate, amount: r.amount });
  const loose = (r: GoldenRow) => rowIdentityKeyWithoutSize({ rate: null, maturityDate: r.maturityDate });
  cmp("rows.count", expected.rows.length, actual.rows.length);
  const byKey = new Map(actual.rows.map((r) => [keyOf(r), r]));
  const matched = new Set<GoldenRow>();
  for (const e of expected.rows) {
    let a = byKey.get(keyOf(e));
    // SECOND PASS — THE SAME TRANCHE WITH A MOVED BALANCE.
    //
    // Size is in the key so that two facilities sharing a maturity stay
    // separate. The cost is that a repurchase changes the key, and a golden
    // must report that as "this row's amount changed" rather than as one row
    // leaving and another arriving. So an unmatched expected row is matched on
    // rate and maturity alone — and ONLY when exactly one unclaimed row on
    // each side holds that looser key, because an ambiguous match is not a
    // match (Rule 19) and merging two real instruments is the failure this
    // whole key was rewritten to avoid.
    if (!a) {
      const eLoose = loose(e);
      const candidates = actual.rows.filter((r) => loose(r) === eLoose && !matched.has(r));
      const rivals = expected.rows.filter((x) => loose(x) === eLoose);
      if (candidates.length === 1 && rivals.length === 1) a = candidates[0];
    }
    if (!a) { d.push(`rows["${e.instrument}"]: MISSING — the signed ladder carries it, this run does not`); continue; }
    matched.add(a);
    if (a.instrument !== e.instrument) {
      d.push(`rows["${e.instrument}"].instrument: RENAMED to ${fmt(a.instrument)} — same amount, maturity and status, so the same instrument under another of the filing's own names`);
    }
    cmpAmount(`rows["${e.instrument}"].amount`, e.amount, a.amount);
    for (const k of ["maturityDate", "dateGranularity", "status", "provenance", "isCapacity", "sourceLine"] as const) {
      cmp(`rows["${e.instrument}"].${k}`, e[k], a[k]);
    }
  }
  for (const a of actual.rows) if (!matched.has(a)) d.push(`rows["${a.instrument}"]: UNEXPECTED — this run carries it, the signed ladder does not`);

  for (const k of ["denominatorSource", "statedTotalDebt", "capturedFace", "statedBridge", "residualPercent", "residualPasses"] as const) {
    // These are already numbers or booleans, not printed strings — cmp is
    // the right comparison and cmpAmount would fall straight back to it.
    cmp(`coverage.${k}`, expected.coverage[k], actual.coverage[k]);
  }
  cmp("rowsOutsideSubtotal", expected.rowsOutsideSubtotal, actual.rowsOutsideSubtotal);

  cmp("tier2.count", expected.tier2.length, actual.tier2.length);
  for (let i = 0; i < Math.min(expected.tier2.length, actual.tier2.length); i++) {
    for (const k of ["kind", "date", "effect", "nets", "instrument"] as const) {
      cmp(`tier2[${i}].${k}`, expected.tier2[i][k], actual.tier2[i][k]);
    }
  }

  cmp("cards.count", expected.cards.length, actual.cards.length);
  for (let i = 0; i < Math.min(expected.cards.length, actual.cards.length); i++) {
    const e = expected.cards[i], a = actual.cards[i];
    cmp(`cards[${i}].triggerId`, e.triggerId, a.triggerId);
    cmp(`cards[${i}].headlineRowId`, e.headlineRowId, a.headlineRowId);
    cmp(`cards[${i}].derived.count`, e.derived.length, a.derived.length);
    for (const el of e.derived) {
      const al = a.derived.find((x) => x.kind === el.kind);
      if (!al) { d.push(`cards[${i}].derived["${el.kind}"]: MISSING — signed, and not produced by this run`); continue; }
      cmp(`cards[${i}].derived["${el.kind}"].text`, el.text, al.text);
      cmp(`cards[${i}].derived["${el.kind}"].computed`, el.computed, al.computed);
      cmp(`cards[${i}].derived["${el.kind}"].inputs`, el.inputs, al.inputs);
      cmp(`cards[${i}].derived["${el.kind}"].fieldInputs`, el.fieldInputs, al.fieldInputs);
    }
    cmp(`cards[${i}].withheld`, e.withheld, a.withheld);
  }

  return d.length === 0 ? { kind: "matches" } : { kind: "diverged", divergences: d };
}
