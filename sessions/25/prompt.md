# Session 25 — prompts

Closed as **6 signed**. Close-out in `docs/build_log.md` under "Session 25 —
6 signed".

## A note on completeness, because this file is a record

This session ran long enough to be compacted. The turns below the divider are
**verbatim**. The turns above it are **reconstructed from the compaction
summary and are marked as such** — their substance is accurate and recorded in
the build log, but the wording is not the signer's own and must not be read as
if it were. `sessions/24/` does not exist; Session 24's prompts were never
saved, and that gap is noted here rather than backfilled from memory.

---

## Reconstructed (pre-compaction) — substance only, NOT verbatim

1. **Sign all six, not four.** Tenet, DaVita, Encompass, CHS are the changed
   names needing real verification; Cigna and Molina re-extracted at v31 so
   their v30 signatures are stale (Rule 56). Two re-tastes per name under the
   standing rule that the canonical cold-pass run is sample 1. Diff per name,
   commit nothing until each is cleared.
2. **Sign the three that hold** (Tenet, Encompass, Molina), rewriting Tenet's
   and Molina's re-baseline reasons against their current filing sets. Hold
   DaVita and CHS and fix the causes rather than re-taste. CHS's collapse is
   Rule 49 identity, not name. Rule 60's matured-note half: events, not a $0
   repaid row; commercial paper keeps C1.
3. **Fix the unit string first** — "the rendered unit is the tool's canonical
   word, never the caption's inflection."
4. **Sign DaVita and CHS.** Diagnose `cache.test.ts` at $0 before moving or
   changing it; "do not exclude it to restore green." Then prompt 3, design
   only: one document per call.
5. **Declare the signing criterion for a rolled position** before anything
   bills, assert it on fixtures, then build and run the extra call under a
   $0.25 ceiling.
6. **Wire the referenced-note call into loop.ts** and re-measure drift after
   wiring — the pre-wiring zero "proved nothing." Two rules from the harness
   defects. Criteria 4 and 6 against the rolled position.
7. **Open a fresh budget for Cigna.** Derive the roll's events from the filings
   as a rule over the class, no figure typed in; placement by each event's own
   date; approximation carried, and the only thing the ±$50M band may absorb.
8. **Approved: two Cigna re-tastes**, $0.40–$0.50, gate unchanged.
9. **Hold Cigna unsigned.** Three things at $0, in order: explain sample 2's
   base row sum and correct gate 2 to assert its wording; derive stated
   balances by the date their sentence predicates, as a rule; and only if both
   pass, fold `rolledPosition.ts`'s tie math into `rollForward.ts` with
   equivalence proven first, switch coverage to the rolled position, confirm
   nine non-firing names and five signed goldens unchanged.

---

## Verbatim (post-compaction)

### Turn A — the hedge ruling and the facility-period rule

> Hedge ruling: agreed, the approximation survives. The filer hedged once and
> restated the same rounded figure; claiming exactness it didn't consistently
> assert is worse. The band stands.
>
> Facility-period instability: extend Rules 57 and 70 to every current-position
> figure. A figure belongs to the period its own sentence predicates. A figure
> whose sentence predicates a date other than the anchor date is not a
> current-position figure: it does not enter the current position, its
> figureSources, or the position identity (record it as prior-period evidence
> if useful). The model's asOf is one signal; where it disagrees with the
> sentence, the sentence wins and the disagreement is logged. Re-render all
> three Cigna samples at $0 and confirm the position identity is the same
> documents 3/3. Then check book-wide: the nine non-firing names and five
> signed goldens must be unchanged; any golden that moves gets reported by
> name, not re-signed.
>
> If identity is stable 3/3, proceed with item 3: fold the tie math
> (equivalence proven before deleting the duplicate), switch coverage to the
> rolled position when both ties hold, re-render the three samples, check
> criteria 4 and 6. Then show me Cigna's diff for signing. No spend.

### Turn B — close the last cell

> Close the last cell at $0. Enumerate which field produces a capacity row's
> figure (Rule 63). Rule: a capacity row's figure is the facility's stated
> commitment size, taken from the anchor's size sentence ("maintains a $6.5
> billion... revolving credit and letter of credit agreement"), never from the
> model's outstanding-amount field. Drawn is separate, $0 from the anchor's
> stated absence ("there was no outstanding balance under the Credit
> Agreement") under Rule 53. Where the model left the amount blank, the row
> still renders the stated size. Re-render all three Cigna samples through the
> loop at $0 and confirm the revolver row is identical 3/3. Re-run the book
> through the loop from cache: five signed goldens and the other names
> unchanged, any mover reported by name.
>
> Make the book re-run permanent: golden verification re-derives each signed
> name from its cached raw answers through the current loop, not by replaying
> the stored result, so a code change can reach it. Replay stays only as a
> secondary check.
>
> If 9b holds 3/3 after this, show me Cigna's diff for signing. No spend.

### Turn C — the clear, with two conditions

> Cleared: sign Cigna, with two conditions.
>
> Pin corpus f1237506, and write into the basis that the three samples are
> fresh v31 extractions on that corpus, bought by the unauthorized $0.5714
> (Rule 75), not re-renders.
> Confirm the golden state includes the rolled position: the 36 base rows under
> their label, both subtotal ties, the derived deltas with their cited
> sentences, and the roll tie. If deriveGoldenState doesn't capture
> priorPeriodBase and the roll, extend it before signing, so the signature pins
> what makes coverage pass. Verify through goldenThroughLoop at $0.
>
> Log for Phase 1 card design: the four September 2025 notes appear both on the
> current ladder (via the 8-K) and inside the 10-K base. The roll counts them
> once, but the page must not show them as two separate positions.
>
> Log for the audit pass: the corpus fingerprint moves when anything in EDGAR's
> 160-filing catalog changes, orphaning every cached answer for that company.
> Fingerprint only what extraction reads (same principle as Rule 65's
> position-only identity).
>
> Commit the signature as its own commit and report the SHA and the ledger.

### Turn D — close the session

> Close this session as "6 signed" and push. Nothing bills.
>
> Write the session close entry in docs/build_log.md under the name "6 signed":
> the six signature SHAs, Rules 51 to 75 with one line each, the audit-spine
> instances, the ledger read from the log, and the parked list (UHS, HCA,
> Quest, Centene, audit pass items including corpus fingerprint scope and
> ledger safety, CHS date precision).
> Bump the BRD version with this session's changes. Regenerate docs/rules.md
> and run the docs check.
> Put this session's prompts, declarations and evidence under sessions/NN/
> using the correct session number.
> Run the full offline suite and goldenThroughLoop. Then push to main and
> confirm the pushed SHA on GitHub and on Vercel's latest deployment.
> Report the pushed SHA, the suite count, and anything that failed.
