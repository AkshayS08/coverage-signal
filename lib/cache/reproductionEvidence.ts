/**
 * CRITERION 9b's EVIDENCE — KEYED BY COMPANY **AND** VERSION.
 *
 * 9b says a position reproduced three times at the version being signed. It
 * is the one criterion no code can attest on its own behalf, so it is carried
 * as recorded text. The text was keyed by COMPANY ALONE, and that made the
 * gate unable to fail for the case it exists to catch:
 *
 *   Molina's evidence reads "CACHE_BUST x3 at v29". At v30 the signer looked
 *   it up by name, found it, and would have written a v30 signature attesting
 *   reproduction — citing runs made against a different prompt, with no
 *   warning. The gate was present, and structurally could not refuse.
 *
 * An extraction version bump changes what the model is asked. Evidence from
 * before it is evidence about a different question, and the older it is the
 * more confidently it reads as fresh. So the version is part of the KEY, not
 * a note inside the text, and a lookup at the wrong version returns a refusal
 * that names what it found rather than nothing at all — because "no evidence"
 * and "evidence about another version" need different actions from the person
 * reading the refusal.
 */

export interface ReproductionEvidence {
  company: string;
  /** The EXTRACTION_PROMPT_VERSION the re-asks were made at. */
  version: number;
  /** How many CACHE_BUST re-asks. 9b requires three. */
  runs: number;
  recordedOn: string;
  evidence: string;
  /**
   * DIFFERENCES THE GATE TOLERATED, recorded so the SIGNATURE can carry them.
   *
   * A golden signed over a name the filing prints two ways must say which the
   * reader will see. Tolerating a difference and then not mentioning it is
   * the failure golden.test.ts [7a] names — it trains a reader to wave
   * differences through. This is a required field rather than a sentence
   * inside `evidence`, because a convention is forgettable and a field is
   * not: an empty array is an assertion that nothing was tolerated.
   */
  toleratedDifferences: string[];
}

/** 9b requires three. Named rather than inlined, because the number is the criterion. */
export const RUNS_REQUIRED = 3;

export const REPRODUCTION_EVIDENCE: ReproductionEvidence[] = [
  {
    company: "Molina Healthcare", version: 30, runs: 3, recordedOn: "2026-09-21",
    evidence:
      "CACHE_BUST x3 at v30 on 2026-09-21 (lib/cache/s23repro9b.ts, $0.6257): 6 rows in every run; every row " +
      "identical across all three on identity, amount, maturity date, granularity, provenance and capacity flag; " +
      "coverage identical (statedTotalDebt, capturedFace, statedBridge, denominator). " +
      "TESTED RATHER THAN ASSUMED because v30 had already given two different answers for `drawn` earlier in the " +
      "session — null on the cold pass, $0 on the refresh. Across these three it held at $0 every time, with every " +
      "other facility figure identical too, so the value the re-baseline pins is one that reproduces. " +
      "Facility figures are NOT covered by 9b and were measured separately for exactly that reason.",
    toleratedDifferences: [],
  },
  {
    company: "DaVita", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29 on 2026-09-17: 9 of 9 rows carried a heading in every run, 9 classed in every run, row set / amounts / classes byte-identical across all three.",
    toleratedDifferences: [],
  },
  {
    company: "Community Health Systems", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29 on 2026-09-17: 12 rows and 9 classed in every run, row set / amounts / classes byte-identical across all three.",
    toleratedDifferences: [],
  },
  {
    company: "Universal Health Services", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29: prose-only note (0 table rows), 5 classed in every run, row set / amounts / classes byte-identical across all three.",
    toleratedDifferences: [],
  },
  {
    company: "Encompass Health", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29: 7 of 7 rows carried a heading in every run, 4 classed in every run, row set / amounts / classes byte-identical across all three.",
    toleratedDifferences: [],
  },
  {
    company: "Tenet Healthcare", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29 after the letter-of-credit rule: 12 rows in every run, 11 classed in every run, row set / amounts / classes identical across all three. Before that rule a $200 million letter-of-credit facility appeared as a 13th row in one run of three; an LC is not borrowed money and now has no ladder destination, so it cannot be routed onto one.",
    toleratedDifferences: [],
  },
  {
    company: "Molina Healthcare", version: 29, runs: 3, recordedOn: "2026-09-17",
    evidence: "CACHE_BUST x3 at v29 after row identity moved off the label: 6 rows in every run, 5 classed in every run, row set / amounts / classes identical across all three.",
    toleratedDifferences: [
      "the revolver is named \"revolving credit facility\" in one run and \"Credit Facility\" in two — the filing uses both. Same $1.25 billion, same 2030-11-20 maturity, same class in all three. A reader may see either name.",
    ],
  },
];

export type EvidenceLookup =
  | { kind: "usable"; evidence: ReproductionEvidence }
  /** Nothing recorded for this company at any version. */
  | { kind: "none"; reason: string }
  /** Recorded — but for a different version than the one being signed. */
  | { kind: "wrong-version"; reason: string; found: ReproductionEvidence[] }
  /** Right version, too few runs to attest 9b. */
  | { kind: "too-few-runs"; reason: string; found: ReproductionEvidence };

/**
 * A company name may arrive as the filer's own ("MOLINA HEALTHCARE, INC.") or
 * as the name a run was requested under ("Molina Healthcare"). Matching is
 * deliberately containment-based in one direction only, and case-folded —
 * the same behaviour the signer already had, made explicit so it can be
 * tested rather than inferred from an inline `??` chain.
 */
function namesMatch(recorded: string, asked: string): boolean {
  const a = recorded.toLowerCase(), b = asked.toLowerCase();
  return a === b || b.includes(a) || a.includes(b);
}

/**
 * The lookup 9b is allowed to rest on. Version is part of the key: evidence
 * recorded at another version is NOT returned as usable, however well it
 * matches the name.
 */
export function evidenceFor(
  company: string,
  version: number,
  /**
   * The table to look in. Defaults to the real one; a caller passes its own
   * so the MECHANISM can be tested independently of what happens to be
   * recorded. The first version of the test suite asserted "Molina has no v30
   * evidence" — a fact about the data — and every one of those assertions
   * broke the moment the v30 evidence was recorded, which is what the suite
   * was there to enable.
   */
  table: ReproductionEvidence[] = REPRODUCTION_EVIDENCE
): EvidenceLookup {
  const forCompany = table.filter((e) => namesMatch(e.company, company));
  if (forCompany.length === 0) {
    return { kind: "none", reason: `no reproduction evidence recorded for "${company}" at any version — criterion 9b cannot be attested` };
  }
  const atVersion = forCompany.filter((e) => e.version === version);
  if (atVersion.length === 0) {
    const versions = [...new Set(forCompany.map((e) => e.version))].sort((a, b) => a - b);
    return {
      kind: "wrong-version",
      reason:
        `reproduction evidence for "${company}" exists at v${versions.join(", v")} but NOT at v${version}, which is the version being signed. ` +
        `A version bump changes what the model is asked, so runs made before it are evidence about a different question. ` +
        `Re-run CACHE_BUST x${RUNS_REQUIRED} at v${version} and record it.`,
      found: forCompany,
    };
  }
  const best = atVersion[0];
  if (best.runs < RUNS_REQUIRED) {
    return {
      kind: "too-few-runs",
      reason: `reproduction evidence for "${company}" at v${version} records ${best.runs} run(s); criterion 9b requires ${RUNS_REQUIRED}`,
      found: best,
    };
  }
  return { kind: "usable", evidence: best };
}
