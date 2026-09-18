# Session 22, Stage 5, item 4 — why-now. Cost and result shape, declared before spending.

Four of Stage 5's five items landed at **$0** (facility maturities, computed
liquidity, revolver semantics, at-maturity language). This one cannot: it is
the only item whose fix lives in what the model is ASKED rather than in what
the code computes.

## The item

> Why-now cites an event or pattern on the card's own tranche, never a
> balance. Where a verified retirement, repurchase, or issuance exists on that
> tranche it is the why-now (Centene's $1,147M repurchase program, already
> extracted, currently ignored in favour of cash). Cash is never a refi
> rationale; for an insurer the balance-sheet cash figure is not treasury
> liquidity.

## Why it is not a $0 change

`whyNow` is written by Sonnet from the fact base. Two halves, and only one is
free:

**Free (done as part of this, no bump):** the card's own tranche already
carries its events — `retiredByNote`, `retiredBy`, `issuedOn`, `priorBalance`
— and the fact base does not surface them as the row's own facts. Handing
narration the tranche's events is a factBase change, deterministic and $0.

**Paid:** the instruction that a balance may not BE the why-now. That is
prompt text, and prompt text is `NARRATION_PROMPT_VERSION`, which invalidates
every cached card wording. There is no way to test whether the instruction
works without re-narrating.

A structural guard is the tempting free alternative — reject any `whyNow`
whose only supporting fact is a balance, and retry. It is the wrong shape
here: retries cost money too, they cost it unpredictably, and a guard that
rejects without telling the model what to write instead converts a wording
problem into a failure rate. The existing `narrationIntegrity` guard is the
right place for the CHECK, but the instruction has to come first.

## Cost shape

`NARRATION_PROMPT_VERSION` 9 → 10. Re-narrates every card in the book.

| | |
|---|---|
| cards today | 6 debt-maturity + the non-refi cards across ten names |
| narration model | Sonnet, one call per card, retried only on guard failure |
| estimate | **$0.30 – $0.60** |
| session after | **~$4.0 – $4.3 of $10** |

Sized off the wording-cache misses in the v29 run rather than off a
partially-cached line — the Rule 20 note from Stage 4 applies, and this
estimate deliberately does not reuse a cost-log entry that was itself a
partial hit.

## Result shape — what the run must show

1. **Centene's why-now cites its own tranche's repurchase**, not its
   $24.2B cash balance. Its `noteRetirements` already carry the $1,147M
   figure, verified, and the current card ignores it.
2. **No card's why-now rests on a cash balance or a drawn revolver balance**
   as the reason. Asserted across every card in the book, not on Centene
   alone.
3. **A card whose tranche has no event says so** rather than reaching for a
   balance to fill the sentence — the never-suppress rule applies to the
   reason as much as to the figure.
4. **Quest's card reads "pre-funded and repaid at maturity"** in its narration
   as well as in its derived line, and does not say "refinanced N months
   ahead".
5. **No card loses a why-now it has today.** A bump that trades one bad
   rationale for no rationale is not an improvement.

**Not in scope:** the extraction. This is narration only; no
`EXTRACTION_PROMPT_VERSION` change, and every v29/Stage-5 gain stands
untouched.

---

# Addendum, written after the free half landed — the premise changed

## The $1,147M is not what the item assumed, and the bug was not narration

The item reads "Centene's $1,147M repurchase program, already extracted,
currently ignored in favour of cash". Measured:

```
noteRetirements[0]
  instrument  "Senior Notes due December 15, 2027"
  amount      "$ 118 million"
  sourceLine  "During the three and six months ended June 30, 2026, the
               Company repurchased $ 118 million and $ 1,147 million,
               respectively, of its par value Senior Notes due 2027..."
```

**$1,147 million is the SIX-MONTH figure and $118 million the three-month
figure, in one sentence, about one tranche.** Both are real, both are in the
verified sourceLine, and the extraction correctly recorded the quarter's
figure as the field value. It is a BOND repurchase on the exact tranche the
December 2027 card is about — not a share buyback, which would have had no
business being a debt card's why-now at all.

**And it was not "ignored in favour of cash" by the narration.** It never
reached the narration. Two code-level causes, both now fixed at $0:

1. `rowMatchesRedemptionText` refused any row whose coupon the prose did not
   repeat. Centene's sentence names its tranche by maturity date and states no
   coupon anywhere, so the repurchase matched nothing. Absence of corroboration
   was being treated as contradiction. Now: a text naming a DIFFERENT rate
   still refuses; a text naming NO rate falls back to maturity, and only where
   exactly one row on the ladder matches — uniqueness checked from the
   retirement's side, because maturity alone is a weaker key than
   maturity-plus-rate and needs the ambiguity check the rate was providing.
   Book-wide: rows carrying a note-stated retirement **1 → 3**, the two new
   ones both Centene's and both correct.

2. Every ladder-row fact set `redeemsInfo: null` and carried no other event
   field, so the fact base discarded `retiredByNote` / `retiredBy` /
   `issuedOn`. Now surfaced as `trancheEvent`.

So the model never had the repurchase in front of it. It reached for cash
because cash was the only other thing on the page.

## What is left to buy, and it is smaller than declared

Only the instruction. With `trancheEvent` in the context, the model can state
the repurchase — the bump is what stops it preferring a balance when both are
present, and what makes a card with NO tranche event say so instead of
reaching.

`NARRATION_PROMPT_VERSION` 9 → 10. Estimate unchanged at **$0.30 – $0.60**;
session to **~$4.0 – $4.3 of $10**.

## Result shape — v10

Asserted across every card in the book, not on Centene alone.

1. **Centene's why-now cites its own tranche's repurchase**, and may state
   $118 million (the quarter) or $1,147 million (the six months) or both,
   because its own verified sentence states both — and must not present either
   as the other's period.
2. **No card's why-now rests on a cash balance or a drawn revolver balance**
   as its reason.
3. **Encompass's why-now stays the 2028 takeout** — an event on its own
   tranche, and already correct. A bump that fixes Centene and degrades a demo
   name loses ground.
4. **UHS's why-now stays the pending maturity.**
5. **Quest reads "pre-funded and repaid at maturity"**, never "refinanced N
   months ahead".
6. **A card whose tranche has no event says so** rather than filling the
   sentence with a balance. Quest's receivables facility is the live case: it
   carries no tranche event at all.
7. **No card loses a why-now it has today.**

Then CACHE_BUST the affected names, and hold the changed why-nows for review.
