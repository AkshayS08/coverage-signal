# Session 23 — full-note transcription, Cigna, the facility bump, and the ten-name product read

Save as `sessions/23/prompt.md`.

Read `docs/rules.md` (all 50, generated, no gaps) and the Session 22 close-out in `docs/build_log.md` before any code. Everything below is a rule over the class; the named company is the worked example only. A change that satisfies the named company while the rule stays unimplemented has fixed nothing.

Work in stages, STOP at each, nothing after a STOP starts until the report is reviewed. Findings log forward to the audit unless a wrong number would render as a position. Budget: $10 authorized, stop-and-ask above it. Every paid run declares its Rule 13 cost shape and result shape first (a shape the mechanism can produce: span-identity plus attributable variance, never byte-identity across a bump), persists the per-company cost log (Rule 20), and notes that narration is metered but not persisted (Rule 43), so any estimate off the log understates a run that narrates. Goldens are written only against all nine criteria, each CACHE_BUST x3, on signature.

## The session's purpose and the one gate that matters

Six of ten are golden at v29 (Tenet, CHS, DaVita, UHS, Encompass, Molina). Four carry: Quest, Centene, HCA, Cigna. This session finishes the ten and then produces the whole product for an RM read.

The backbone is full-note transcription. The model transcribes 3 rows of Cigna's $31.878B note. Until a large note transcribes completely, Cigna cannot be built, and the facility/prose bump rides Cigna's cold pass. Its convergence is genuinely uncertain, so **Stage 2 is a hard gate: if transcription does not converge, Cigna stays honestly empty (it already renders its anchor with the reason stated), the session closes at 9 of 10, and nothing downstream is forced.** Nine golden plus one honest "cannot read this shape yet" is a defensible book. Nine plus a forced Cigna is not.

## Stage 1 — full-note transcription ($0 to design, one bump to prove)

**The problem, measured:** on a note of 30+ rows the model returns a handful and stops. Cigna's 10-K note (37 tabular locator matches, $31.878B stated) yields 3 rows. This is a reading capability, not a Cigna quirk; the 40-name book will have many large notes.

**Diagnose before designing, $0.** Read the raw v29 response for Cigna's 10-K note. Is the model (a) stopping early with a complete-looking but short list, (b) hitting an output limit (assertNotTruncated should say), or (c) summarizing rather than transcribing? Report which, with evidence. Do not design against a guess.

**Design constraints, whichever cause:**
- Transcription, not selection. The prompt already says "if the filings describe four, return four"; the instruction is not the fix (Rule 22, Rule 39: an instruction the model can decline is not a constraint). Look for the structural lever: if the note is a table, the row count is knowable from the located span before the model is asked, and the schema or a post-check can require that many rows or a stated reason for fewer. A count the tool derives from the document is a fact the model must match, not a suggestion.
- Chunking is allowed only if each chunk is verified independently and the chunks are reassembled by the note's own structure (its section headings and subtotals), never by proximity.
- Every transcribed row keeps the full verification contract: verbatim sourceLine, bounded to the note, amount corroborated.
- No distance constants (Rule 24).

Write the change, show the offline evidence on Cigna's 10-K note (expected: the full row count, each verified), and the effect on the six golden names' notes (expected: unchanged, since they already transcribe completely; any change is a finding). STOP with the design, the diagnosis, and the declared cost shape for the bump. Approval before spending.

**Then bump and run.** EXTRACTION_PROMPT_VERSION → v30. The B3/B4/B5 facility bump rides this same pass (Stage 3 below), so declare both together. Result shape: Cigna's 10-K note transcribes in full; the six goldens re-extract position-identical (span-identity, attributable variance); no company loses a row. Hold Cigna's transcribed 10-K note for Akshay's blend check before it counts, every row with its verbatim sourceLine, the same check UHS got. STOP.

## Stage 2 — Cigna's filer-directed roll-forward (the hard gate)

Per the design in the build log and BRD. Fires only because the anchor 10-Q's Note 6 has no ladder AND explicitly cross-references the 2025 10-K Note 7 for detail (verbatim, verified). Never on absence alone.

- Base: the most recent prior filing in the reference chain carrying tranche detail (the 10-K, now fully transcribed from Stage 1). Every row labelled "as of 2025-12-31, per 10-K Note 7."
- Deltas: every intervening period in order, each verified by instrument identity (Rule 49: stated facts, never the label). The 10-Q states them: repaid $550M 1.250% notes in March; $1.0B commercial paper outstanding; revolver undrawn.
- Tie: base ± deltas against the anchor's balance sheet ($31.878B, XBRL agrees). Akshay hand-verified the arithmetic: $31,352 − $550 + ~$1,000 ≈ $31,768 within ~$30M. If it ties within threshold, render as rolled-forward with the label. If not, render the base as prior-period-only with the gap stated; never force.
- The rolled ladder is the position; Tier 1/Tier 2 labelling as defined.

Confirm no other filer fires the roll-forward (Quest has cross-references and a full ladder, so it must not; HCA is aggregate-disclosure, not roll-forward). STOP with Cigna's rendered ladder, the tie arithmetic, and the negative tests. **This is the gate.** If Stage 1 did not converge or the tie fails, Cigna stays honest-empty, log why, and skip to Stage 4.

## Stage 3 — the facility/prose bump, riding Stage 1's cold pass

Deferred from Session 22 (B3/B4/B5), declared together with Stage 1's bump so one re-extraction covers both:
- **B3.** A stated zero is a captured amount. "No amount was outstanding" / "no outstanding borrowings" is drawn = $0, read like the em-dash zero, not "(no amount stated)". Molina's and CHS's revolvers are the examples.
- **B4.** Capacity renders. A facility carries drawn, LCs, available, and size, each verbatim from its own sentence, cited (Rule 46), with the arithmetic check shown. Liquidity = cash + (size − drawn − LCs) (Rule 48), computed only where components are stated and the total is not, so a stated availability is not double-deducted.
- **B5.** Facility maturities are searched across the full corpus and cited to the filing that states them (Rule 40, Rule 44). A stated maturity anywhere that falls in-window cards. Relative maturities ("five years from funding") render relative. None guessed.

Result shape: Molina's revolver reads $0 drawn of $1.25B; CHS's ABL reads $0 drawn, $751M available, $32M LCs of $1.0B; Quest's two facilities carry their capacities; no company loses a facility it has; no facility figure sourced from a filing that does not state it. STOP with the facility results per company.

## Stage 4 — the three small unblocks ($0 each expected)

- **Quest** — one row cites a non-anchor filing: the 3.50% notes due March 2025, matured. Diagnose: a stale row that should have rolled off, or a citation to the wrong document. Fix as the rule for matured rows (a row whose maturity predates the anchor period and whose balance the anchor prints as nil or absent is retired, stated), not a Quest patch.
- **Centene** — criterion 2: a facility size ($4,000 million) was claimed and appears in no fetched filing. Either the corpus is missing the document that states it (then fetch it, and B5's corpus-wide search may already resolve it) or the model produced it without a source (then it withholds, stated). Report which.
- **HCA** — criterion 8a as written cannot pass an aggregate filer. Amend it per the agreed disposition: a filer whose note prints one aggregate line passes 8a if the ladder renders "aggregate, per-tranche detail not in this filing" rather than feigning tranches. HCA signs as a labelled aggregate golden, off the demo script.

STOP with all three resolved or honestly stated.

## Stage 5 — the full ten-name product, for the RM read

Generate the complete product as it renders, all ten names, in the review-artifact format (same URL pattern as the signature sheets, generated from the pinned data, formatting only, never hand-authored): every ladder with facility type and provenance per figure, the portfolio table, every card with its why-now and derived lines, every liquidity line, every Tier 2 event, every refusal with its reason. Amounts in $millions with as-printed beneath. This is what Akshay reads end to end as an RM, against three questions per company: does the position tie and say where it came from; is there a call and does its why-now rest on an event; where the tool refuses, does it say why.

STOP. Akshay reads all ten. His findings come back as a list; fix them as rules, re-verify, and re-present. Do not proceed to signatures until his product read is done, because a card-layer finding may change what a ladder should show.

## Stage 6 — re-sign to 9 or 10 golden

The v30 bump re-rolled every model-filled field, so the six goldens must be re-confirmed, and the new names signed. For each of the ten: the verification sheet (regenerated, Rule 46 belonging-check on every figure), CACHE_BUST x3 (position-identical, wording drift fine), Akshay's signature, then the golden written. Any name whose position doesn't reproduce three-for-three does not golden; report its variance. Cigna signs only if Stage 2 tied; otherwise it carries with its honest state.

## Stage 7 — close

Narration priced and held; determinism x3 both books local and live on the pinned as-of; suites, tsc, build; push only if clean, deployment confirmed by Vercel's build record or a runtime marker (never manufactured). BRD to v1.8 (transcription, roll-forward, facilities, the 8a amendment, the golden set); `docs/rules.md` regenerated with no gaps; build-log close-out with rules numbered from 51; the audit-session carry-list in full (signature:check and which derived files need one, guard-corpus type-completeness, cost-log narration persistence, the measured-vs-unreachable helper, PRIORITY_CLASSES junior-above-senior ordering, the headline verb from trancheEvent.kind).

## Out of scope — do not touch

- The ~40-name pre-warm. The audit session sits between this session and it.
- The v2 bucket: waterfall from intercreditor terms, month-from-range-floor, "already refinanced" verbiage, voluntary roll-forward (reach into an itemized 10-K when the 10-Q is aggregate but does not point there).
- 424B / prospectus parsing.

## Standing constraints

- One substantive change per paid run (Stages 1 and 3 share one bump because they are one re-extraction; declare both shapes).
- Never suppress; a withheld figure keeps its instrument; a stated zero is a figure.
- Availability over instruction; one deciding function per value; verify as printed, display normalized.
- Flag merges rather than making them silently; measure before designing; read the rows, not the count.
- Rules over instances. The audit that follows tests every rule for company-specific residue, so write none.

## Acceptance

Nine or ten golden on signature, each reproduced; Cigna either rolled-forward and tied or honestly empty with the reason stated; every facility carrying its capacity and stated zeros; Akshay's ten-name product read complete with findings fixed as rules. Then the audit.
