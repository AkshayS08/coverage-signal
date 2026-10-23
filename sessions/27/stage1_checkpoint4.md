# Session 27, Stage 1: Checkpoint 4 (the Oct 23 rulings; an over-ceiling fill)

Status: **stopped.**
- One approved fill billed over its ceiling. The gate stopped the script before anything else was spent.
- Not all six names show zero position change with identical card text.
- The re-tastes have not started. Nothing is re-signed and nothing is pushed.

## Spend: declared vs billed

| Fill | Approved | Billed |
|---|---|---|
| Tenet proceeds-use refill | up to $0.064 | **$0.0738** (Sonnet, 24,405 in / 42 out). **$0.0098 over** |
| Narration pass | up to $0.0476 | not run: the gate stopped before it |

**Why the estimate was low.** It came from the v31 call, which had about 21,200 input tokens. This call sent the same bounded proceeds-use text, 45,454 characters, which came to 24,405 tokens. The gate measured the spend and stopped, but a single call cannot be stopped mid-way, so its overage was spent. The ledger has the line. Tenet's `proceedsUse` is now stored ("refinancing_only").

## The rulings, as built (all $0, tests first, with controls)

| Ruling | Test: before → after |
|---|---|
| **Tenet, tolerated class:** a re-transcribed source line is tolerated when it is verbatim in its row's document and states the amount (Rule 58). `compareToGolden` takes the check; 9b uses the same comparison. | `goldenSourceLine.test` → **4/4** (could not run before). Only Tenet computes a derived line from a row, and the other five say so. |
| **CHS, canonical zero:** one internal form, "$0", for every stated zero, applied at storage (the loop) and at comparison (the card). | `statedZeroForms.test` 39/20 → **59/59**. The committed cards changed only in 8 internal `printed` fields; nothing displayed moved. |
| **Cigna (a), letters-of-credit predicate:** a figure is outstanding only where its own clause says outstanding, issued, utilized or drawn. A capacity predicate (available for issuance, sub-limit, sub-facility, up to) makes it capacity, so outstanding reads "not stated". | `lcPredicate.test` 3/16 → **20/20** |
| **Cigna (b), liquidity components:** one reading of undrawn capacity, `undrawnOf`: stated availability, else size less drawn and letters of credit (flagged), else "availability not stated". The CP netting follows either way. | `liquidityComponents.test` 7/9 → **16/16** |
| **Name check:** case-insensitive, whitespace removed. A name not in its sentence renders as the plain instrument type, linked where the sentence prints the type word. | `nameCheck.test` 11/5 → **16/16**. Acceptance N1 is case-insensitive, and its control is now a paraphrase. |
| **Narration in the ledger:** `withLedgerDelta` writes narration spend as its own "(narration)" line, also when the call throws. | `narrationLedger.test` 0/4 → **4/4** |

**Under the letters-of-credit rule, the figures you asked about:**
- **Cigna:** "$500 million available for issuance" is now capacity, and outstanding reads "not stated".
- **Molina:** the $0 claimed from "a $100 million letter of credit sub-facility" is now "not stated" rather than withheld. Its card text is identical to the committed card again.
- **Encompass:** "$46.3 million … was being utilized under the letter of credit subfacility" is predicated outstanding. It is withheld anyway, under Rule 71 (stated as of Dec 31, 2025, not the anchor date). The signed answer's $53.6MM was withheld because its sentence did not state it. Outstanding is withheld both times; only the withheld line differs.
- **Tenet, DaVita and CHS:** predicated outstanding, as before.

**Offline suite: 69 of 69.** The six committed cards build byte-identically apart from the eight `printed` fields.

## The re-diff ($0 replay of the six cached v33 answers through this code)

| Name | Position | Card text |
|---|---|---|
| Tenet | **zero change** (two derived inputs tolerated) | **identical** |
| Encompass | **zero change** | **1 line differs:** the withheld L/C line ($53.6MM "sentence does not state" → $46.3MM "stated as of another date") |
| DaVita | **zero change** | **identical** |
| CHS | provenance only (allowed by your ruling) | **byte-identical** |
| Molina | **zero change** | **identical** |
| Cigna | Rule 66 accepted; CP labels now accepted. **Still differs:** the roll-delta label "$ 550 million, 1.250 % Notes due March 2026" is not in its sentence even case-insensitively, and the roll-delta date is "2026-03" where it was "2026-03-01" | **Differs:** undrawn revolver and CP netting are back, plus the flag "Undrawn revolver computed as size less drawn and letters of credit; no availability stated, and letters of credit outstanding not stated, so it may be lower" and "Availability not stated" |

Stability holds on all six.

## What stands in the way of the re-tastes

1. **The over-ceiling fill.** You need to know before more is spent.
2. **Encompass:** a withheld letters-of-credit line whose figure and reason differ between samples. No figure is shown either way.
3. **Cigna:**
   - the roll-delta label is not verbatim;
   - the roll-delta date precision changed ("March 2026" read as 2026-03, where the signed run had 2026-03-01);
   - the card now flags a computed availability where the signed answer had a stated one.

The narration pass ($0.0476 approved, $0 spent) still stands between the determinism test and $0, so the determinism check is not yet in the release checklist.
