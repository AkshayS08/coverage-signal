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
import { amountKey, amountSupportOf, assemblePosition, rowIdentityKey, rowIdentityKeyWithoutSize, sameAmount } from "./position";

// Re-exported from their home beside `parseMoneyAmount`. They moved there
// when the ladder's own duplicate collapse needed the same notion of "same
// amount" the golden comparator uses, and importing golden.ts from
// position.ts would have been a cycle. Callers are unchanged.
export { amountKey, sameAmount };
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
  /**
   * THE DOCUMENTS THE POSITION RESTS ON — ladder rows' own citations, the
   * anchor, and the debt-maturity trigger's citations (which is where a
   * facility figure's document is recorded, since the figure itself carries
   * only a sentence). This is the golden's IDENTITY: a change here means the
   * answer is not comparable.
   */
  filingSet: string[];
  /**
   * Everything else the run cited, across the other fourteen triggers.
   * Recorded so the narrowing is visible in the signed file, and explicitly
   * NOT identity-bearing — a difference here is reported and tolerated.
   * Optional so files signed before Session 24 still parse.
   */
  otherCitations?: string[];
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

/**
 * Every distinct filing this answer was built from, across all fifteen
 * triggers. Still the honest answer to "what did this run read" — the
 * verification sheet says exactly that — but NO LONGER the golden's identity.
 * See `positionFilingSetOf`.
 */
export function filingSetOf(result: CompanyResult): string[] {
  const urls = new Set<string>();
  for (const t of result.results) for (const c of t.citations) if (c.url) urls.add(c.url);
  return [...urls].sort();
}

/**
 * SESSION 24 — THE GOLDEN'S IDENTITY IS THE DOCUMENTS THE POSITION RESTS ON.
 *
 * `filingSetOf` unions citations across all fifteen triggers, and that union
 * was a golden file's identity. So an unrelated trigger citing one more
 * document changed what a signed POSITION was pinned to, and every future
 * comparison answered "not applicable, the corpus moved" — about a corpus
 * that had not moved and a document the ladder never read.
 *
 * MEASURED, NOT ASSUMED. Both drifting documents were traced to a single
 * trigger each, and neither backs anything rendered:
 *
 *   DaVita  dva-20251231.htm  cited ONLY by `international-expansion`, in 1
 *           run of 3. Zero of nine ladder rows cite it; none of six facility
 *           figure sentences appear in its text. That trigger's quote failed
 *           verification and its evidence was discarded — so a golden's
 *           identity moved on a citation from a fact the pipeline threw away.
 *   CHS     cyh-20260401.htm  cited ONLY by `asset-sale`, in 1 run of 3. Zero
 *           of twelve ladder rows; none of five facility sentences.
 *
 * And the replacement was measured BEFORE it was built: across three runs of
 * five companies, the all-trigger union moves for two names and the
 * position-only set is STABLE for all five.
 *
 * A POSITION DOCUMENT IS ONE OF THREE THINGS, and the third is the precise
 * one: a facility's `figureSources` records WHICH FILING STATED EACH FIELD,
 * because a facility's figures routinely come from different documents —
 * Encompass's size from an 8-K about the credit agreement, its availability
 * from the 10-Q's liquidity discussion. An earlier draft of this function
 * used the debt-maturity trigger's whole citation list instead, on the belief
 * that a facility figure carries no url at all. It does; I had not looked.
 * Using the trigger's list would have swept in documents that trigger merely
 * read, which is the same over-broad mistake one level down.
 *
 * WHAT IS NOT HERE IS STILL COMPARED. Tier 2 events, derived lines and cards
 * are fields of GoldenState and diverge on their own contents; dropping their
 * source documents from the IDENTITY does not stop a change in them from
 * failing. Only the "is this even comparable" question narrows.
 */
export function positionFilingSetOf(result: CompanyResult, asOf: Date): string[] {
  const urls = new Set<string>();
  for (const row of assemblePosition(result, asOf).rows) if (row.citedUrl) urls.add(row.citedUrl);
  const dm = result.results.find((t) => t.triggerId === "debt-maturity");
  if (dm?.debtScheduleSourceFiling?.url) urls.add(dm.debtScheduleSourceFiling.url);
  for (const f of dm?.facilities ?? []) {
    if (f.citedUrl) urls.add(f.citedUrl);
    for (const u of Object.values(f.figureSources ?? {})) if (u) urls.add(u);
  }
  return [...urls].sort();
}

/**
 * Cited, recorded, and NOT identity-bearing. Kept in the signed file because
 * "the run also read these" is worth knowing and because dropping them
 * silently would make the narrowing invisible to a reader of the golden.
 */
export function otherCitationsOf(result: CompanyResult, asOf: Date): string[] {
  const position = new Set(positionFilingSetOf(result, asOf));
  return filingSetOf(result).filter((u) => !position.has(u));
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
    filingSet: positionFilingSetOf(result, asOf),
    otherCitations: otherCitationsOf(result, asOf),
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

/**
 * STAGE 0 — WHAT 9b ACTUALLY REQUIRES.
 *
 * The comparator already knew the difference between kinds of difference — it
 * emitted `RENAMED to "X" — same amount, maturity and status` — and then filed
 * that under `divergences` anyway. The knowledge existed and was discarded at
 * the reporting line, so a golden could be blocked by a filer printing two of
 * its own names for one instrument. That blocks most of the book over
 * something that was never a defect.
 *
 * So differences are now SORTED, not counted:
 *
 *   blocking   amount by value AND unit, maturity, granularity, status,
 *              provenance, isCapacity, coverage, tier2, cards, row identity,
 *              and every amount being supported by its own sentence
 *   tolerated  the instrument LABEL where amount, maturity and status match;
 *              and which of two sentences provides provenance where BOTH
 *              state the row's amount
 *
 * `tolerated` is returned, never dropped, and a signature writes it into its
 * basis — a golden signed over a name that renders two ways must say which
 * the reader will see. Silently swallowing them is the failure [7a] already
 * names: it trains a reader to wave differences through.
 */
export type GoldenVerdict =
  | { kind: "matches"; tolerated: string[] }
  /** The documents moved. Not a failure — the pin no longer describes this input. */
  | { kind: "not-applicable"; reason: string; added: string[]; removed: string[] }
  | { kind: "diverged"; divergences: string[]; tolerated: string[] };

const fmt = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "string" ? `"${v}"` : String(v));

/**
 * Compares a fresh state against a signed one.
 *
 * FILING SET FIRST. Same documents in, same answer out — that is the whole
 * claim a golden file makes, and it makes no claim at all about a different
 * corpus. A moved filing set returns "not-applicable" and names what moved,
 * so a stale pin is visibly stale rather than silently red.
 */
/**
 * Rows whose amount no shown sentence supports (Rule 58). A property of one
 * state, used by the signer to refuse rather than by the comparator to
 * diverge.
 */
/**
 * DOES THIS GOLDEN FILE STILL APPLY AT THIS EXTRACTION VERSION?
 *
 * `GoldenFile.extractionVersion` was documented as making an older file "un-
 * comparable against a newer version rather than assumed to match it" — and
 * NOTHING read it. `compareToGolden` never saw it; the diff harness printed
 * it in a header and compared anyway. A guard written in a doc comment and
 * nowhere else is the session's own dominant defect class, sitting in the
 * file that defines what a signature means.
 *
 * It matters at exactly one moment, which is now: a version bump changes what
 * the model is ASKED, so every difference it produces is a prompt change and
 * not a regression. Comparing across it reports prompt changes as failures,
 * and after a few of those nobody reads the failures — the precise reasoning
 * Rule 30 already applied to a moved filing set.
 *
 * Returns the verdict when the file does not apply, and null when it does, so
 * a caller cannot accidentally treat "no answer" as "matches".
 */
export function goldenVersionVerdict(file: GoldenFile, currentVersion: number): GoldenVerdict | null {
  if (file.extractionVersion === undefined) {
    return {
      kind: "not-applicable",
      reason:
        `this golden file records no extractionVersion, so it was signed before the version was captured and ` +
        `cannot be shown to describe v${currentVersion}'s question. Re-sign it rather than compare against it.`,
      added: [], removed: [],
    };
  }
  if (file.extractionVersion !== currentVersion) {
    return {
      kind: "not-applicable",
      reason:
        `signed at extraction v${file.extractionVersion}, running at v${currentVersion}. A version bump changes what the ` +
        `model is asked, so every difference it produces is a prompt change and not a regression — the same disposition ` +
        `Rule 30 gives a moved filing set. Re-sign against the new version, do not compare across it.`,
      added: [], removed: [],
    };
  }
  return null;
}

/**
 * The comparison a GOLDEN FILE gets: version first, then the state.
 *
 * Call sites that hold a file should use this rather than reaching past it to
 * `compareToGolden`, because the version check is exactly the kind of step
 * that gets skipped when it is optional. `compareToGolden` stays exported for
 * comparing two states that share a version by construction — three re-asks
 * of the same run, which is what 9b does.
 */
export function compareGoldenFile(file: GoldenFile, actual: GoldenState, currentVersion: number): GoldenVerdict {
  return goldenVersionVerdict(file, currentVersion) ?? compareToGolden(file.state, actual);
}

export function unsupportedAmountRows(state: GoldenState): string[] {
  return state.rows
    .filter((r) => amountSupportOf(r.amount, r.sourceLine).kind === "unsupported")
    .map((r) => `${r.instrument}: ${r.amount} is not stated by the sentence shown for this row`);
}

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

  // NON-POSITION CITATIONS: reported, tolerated, never a reason to stop
  // comparing. This is the whole point of the Session 24 narrowing — an
  // `international-expansion` trigger citing one more document is a fact about
  // that trigger, not about whether the signed position is comparable.
  const otherAdded = (actual.otherCitations ?? []).filter((u) => !(expected.otherCitations ?? []).includes(u));
  const otherRemoved = (expected.otherCitations ?? []).filter((u) => !(actual.otherCitations ?? []).includes(u));

  const d: string[] = [];
  /** Differences that are real, reported, and do NOT block a signature. */
  const tolerated: string[] = [];
  if (otherAdded.length > 0 || otherRemoved.length > 0) {
    tolerated.push(
      `non-position citations moved: ${otherAdded.length} added, ${otherRemoved.length} removed. These are documents cited by triggers OTHER than the position — no ladder row cites them and no facility figure's sentence is in them — so they are recorded and do not make this answer incomparable.` +
        otherAdded.map((u) => ` (+ ${u})`).join("") +
        otherRemoved.map((u) => ` (− ${u})`).join("")
    );
  }
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
      // TOLERATED. The row matched on what the filing STATES — amount,
      // maturity, status — so this is one instrument under another of the
      // filer's own names, which Session 22 already moved identity off.
      tolerated.push(`rows["${e.instrument}"].instrument: RENAMED to ${fmt(a.instrument)} — same amount, maturity and status, so the same instrument under another of the filing's own names`);
    }
    cmpAmount(`rows["${e.instrument}"].amount`, e.amount, a.amount);
    for (const k of ["maturityDate", "dateGranularity", "status", "provenance", "isCapacity"] as const) {
      cmp(`rows["${e.instrument}"].${k}`, e[k], a[k]);
    }
    // PROVENANCE: WHICH valid sentence is a document choice; whether the
    // sentence supports the amount is not.
    //
    // A filing states a facility's size in its 10-Q and again in the 8-K that
    // created it. A run citing one and a run citing the other have not
    // disagreed about anything — BOTH state the amount, and a reader checking
    // either sees the number. That is tolerated. A run whose sentence does
    // NOT state the amount has changed what backs the figure, and that blocks
    // (Rule 58).
    if (e.sourceLine !== a.sourceLine) {
      const eOk = amountSupportOf(e.amount, e.sourceLine).kind !== "unsupported";
      const aOk = amountSupportOf(a.amount, a.sourceLine).kind !== "unsupported";
      const line = `rows["${e.instrument}"].sourceLine: expected ${fmt(e.sourceLine)}, got ${fmt(a.sourceLine)}`;
      if (eOk && aOk) tolerated.push(`${line} — both sentences state the row's amount, so this is which document was cited, not a changed fact`);
      else d.push(`${line}${aOk ? "" : " — and the new sentence does NOT state this row's amount (Rule 58)"}`);
    }
  }
  for (const a of actual.rows) if (!matched.has(a)) d.push(`rows["${a.instrument}"]: UNEXPECTED — this run carries it, the signed ladder does not`);

  // "EVERY AMOUNT IS SUPPORTED" IS NOT A COMPARISON, SO IT DOES NOT LIVE
  // HERE. It was written into this function first, and [7b] caught it
  // immediately: a test mutating an amount without touching its sentence
  // started failing for a reason that had nothing to do with the two states
  // differing. `compareToGolden` answers "did this run move?"; whether a
  // single run's figures are checkable is a property of ONE state and gates
  // SIGNING. It is enforced in s22sign, where refusing is the right verb.
  // See `unsupportedAmountRows` below.

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

  return d.length === 0 ? { kind: "matches", tolerated } : { kind: "diverged", divergences: d, tolerated };
}
