# Session 22, Stage 6 — Cigna roll-forward. Cost shape, declared before spending.

Stage 6 is Cigna only: HCA was reclassified at Stage 0 as aggregate-disclosure,
not a roll-forward case, and "voluntary roll-forward" was parked in the
v2/post-demo bucket.

**Recommendation up front: this should be its own session. The numbers are
below and I am not spending against them.**

## What Cigna's v29 extraction actually holds

Measured at $0, not assumed:

```
anchor        10-Q 2026-07-30  (period 2026-06-30)
scheduleSequence                        0 rows   — no ladder at the anchor
priorFiling   10-Q 2026-04-30  (period 2026-03-31)
priorScheduleSequence                   3 rows   — and it is not a ladder either
balance-sheet anchor   $2,792M short-term + $29,086M long-term = $31.878B
XBRL                   $31.878B, exact agreement
current ladder         6 rows (4 tranches from pricing 8-Ks, revolver, CP)
```

The three prior rows are near-dated notes only:

```
$ 1,500 million, 3.400 % Notes due March 2027      $ 1,481 million
$   259 million, 7.875 % Debentures due May 2027   $   260 million
$   600 million, 3.050 % Notes due October 2027    $   599 million
```

## Why this is the largest build in the session, and it is not the money

**The base filing is not extracted, and the prior slot is already taken.** The
roll-forward's base must be "the most recent prior filing in the reference
chain carrying tranche detail" — Cigna's 10-K (2026-02-26), where the locator
reports 37 tabular matches. `priorScheduleSequence` does not point there; it
points at the Q1 10-Q. So the base has to become a THIRD named filing, which
is a new extraction field, not a re-use of an existing one.

**And the model transcribes three rows of that table, not a ladder.** The v29
run logged `OFF-ANCHOR ROWS DROPPED — 3 schedule row(s) verified against
ci-20251231.htm`. Against $31.878 billion of stated debt and a 37-match note,
three rows is not a base to roll anything forward from. Making the model
transcribe that table completely is prompt work with genuinely uncertain
convergence — and it is the same work whether or not the roll-forward is
built.

**The deltas bridge two periods, and one of them is itself empty.** Base
(2025-12-31) → Q1 (2026-03-31) → anchor (2026-06-30). Q1's own sequence is the
three rows above, so the first delta has to be derived from a filing that
states no complete position either.

So the build is: a new base-filing field, a new per-period delta shape,
instrument-identity verification across three filings, a new checksum (base +
deltas against the anchor's balance sheet), and a prompt that reliably
transcribes a large 10-K debt note. That is a schema change, not a wiring
change.

## Cost shape

`EXTRACTION_PROMPT_VERSION` 29 → 30 invalidates every cached answer for all
ten companies. Sized off the v29 run's own cold cost — and note per Rule 43
that the persisted cost log cannot see narration, so any line drawn from it
under-promises a run that narrates.

| | |
|---|---|
| v30 full re-extraction, one pass | **~$1.90** |
| a second pass if the roll-forward shape is not right first time | **~$1.90** |
| narration re-run if the cards move | **$0.30 – $0.90** |
| session today | **$4.5899** |
| **one clean pass** | **~$6.5 of $10** |
| **one iteration** | **~$8.4 – $9.3 of $10** |

A novel extraction shape landing correctly on the first pass would be the
exception in this session's record, not the expectation: v29 needed three
post-run fixes, and this is a larger change than v29 was.

## The reason to defer is not the budget

**A v30 bump re-extracts the whole book, and the demo is currently green on
v29 data.** Stage 4's gate passes 16/16 against extractions that exist now.
Every one of those green assertions rests on model-filled fields that a
re-extraction re-rolls:

- Tenet's section headings — already demonstrated to move between fields
  between versions, and its 11 classed rows are the demo opener
- Encompass's `$746 million` and its withheld LC line — the flagship trust slide
- Centene's two facilities and their 10-K-sourced maturities
- Molina's seniority statement, UHS's 2.28% residual

None of that is protected by a test that runs before the spend. The gate would
have to be re-run afterwards, and if it fails, the fix is another
re-extraction.

**Cigna is not a demo name.** Spending a third of the remaining budget and
re-rolling the three names the demo opens on, to add a bucket for a name that
is benched, is the wrong trade — and Stage 7 (goldens and close) still needs
budget of its own.

## What I recommend instead

1. **Close Session 22 at Stage 7** with the demo green and the ten-name book
   honest — Cigna renders its empty anchor ladder with the reason stated,
   which is the never-suppress rule working, not a gap being hidden.
2. **Stage 6 becomes Session 23**, opening with the full-transcription
   problem, which is the real blocker and is worth solving on its own terms.
   It also benefits the whole book, not just Cigna.
3. **Carry the audit items** already logged: the guard-corpus type-completeness
   fix (Rule 42), the cost-log persistence fix (Rule 43), the headline verb
   (carry item 5), junior-above-senior ordering, and `capturedFace`.

**STOP here. No spend against this declaration.**
