# Session 27, Stage 1: Checkpoint 3 (the rulings applied, at $0)

Everything here ran at $0, with the key blank. The re-tastes have **not** started, because not all six names show zero position change (section 5). Nothing is re-signed and nothing is pushed.

## 1. Write failures (approved)

`WriteFailedError`: every answer write is the write and at most two retries, each attempt cut off by the timeout, with the blob client's own retries off. A `put` overwrites, so a retry cannot duplicate an answer. The proceeds-use catch now rethrows any failed read or write.

`failClosed.test`, with W1–W2 added, all six names:
- **W1:** Tenet's proceeds-use call (answered by the test at $0, standing in for the billed one), then its write failing.
- **W2:** the shared answer-cache write failing.

| | Before | After |
|---|---|---|
| W1–W2 | 0 of 7 (W1 swallowed the failure and completed) | 7 of 7, each a `WriteFailedError` after 3 attempts |
| Whole file (R1–R6, H1–H5, W1–W2) | — | **73 passed, 0 failed**; controls 2 of 2 |

## 2. Tenet: the three position rules

**Cause.** Every redemption claim took its date from the trigger's *first* citation, here the Sept 22, 2026 8-K. Tenet's v33 answer listed its November 2025 redemptions, which are stated in the 2025 10-K, under that issuance. So they were subtracted from a June 30 balance that already reflected them, and the 6.125% 2028 row was marked retired.

**Fix.** The loop now records, on each claim, the document whose text states it and that document's filing date (`foundIn`). One function, `classifyRedeemsClaims`, decides every claim, and the position, Tier 2, the refinancing-pattern line and the card's move sizes all read it:
- **(a)** A claim done and stated by a filing dated on or before the position date is already in that balance. It is recorded as an event (`priorRetirements`) and nothing is subtracted.
- **(b)** A partial retirement leaves the row live with its amount and the remainder (`applyPartialRetirements`, run after every row is assembled, so it reaches pricing-8-K rows too).
- **(c)** An intended redemption, or a "completed" one whose own sentence sets a later date, stays pending, "redemption set for [date], awaiting confirmation", until a filing after that date confirms it.

A legacy claim with no `foundIn` keeps its old date, and the six committed cards are byte-identical after the change.

**Tests:**

| Test | Before | After |
|---|---|---|
| `retirementRules.test`: (a), (b), (c) on synthetic claims against a real live row of each of the six, each with a control | 28 passed, 38 failed | **66 passed, 0 failed** |
| `pendingSize.test`: a move's size comes from the same decision, over all six names' moves, v31 and v33 | could not run (the function did not exist) | **7 passed, 0 failed**; control: the old chooser would size Tenet's pending move from the $750MM already in the balance |

**The replay.** Tenet's cached v33 answer replayed through the fixed code at $0 has a position equal to the signed golden: rows, Tier 2 and the refinancing-pattern line.

- **The one remaining difference is in two derived lines' inputs.** Each cites a re-transcribed source line, "Senior secured first lien notes: 5.125 % due 2027 1,500" where the signed one read "5.125 % due 2027 $ 1,500 $ 1,500".
- **The v33 line is verbatim in the 10-Q; the signed one is not** (both checked with whitespace ignored).
- **Stability control:** the position is the same with and without the 2 redemption claims and 4 note-prose retirements that the signed answer did not have.
- **Card:** its displayed text is identical to the committed card. The pending 6.125% 2028 move is again "$500MM … pending, not yet confirmed".

## 3. CHS

**Cause.** The v33 answer copied the ABL's drawn figure as "$ —" against the same sentence the signed answer used for "$ 0 million" ("the Company had no outstanding borrowings"). The verifier did not recognise "$ —" as a zero, so it rejected it. That is a Rule 53 defect.

**Fix.** `isZeroValue` now reads past the currency sign, the scale word and spacing.

`statedZeroForms.test`, with a control on each of the six names' real facility figures:

| Before | After |
|---|---|
| 28 passed, 11 failed | **39 passed, 0 failed** |

The existing `statedZero.test` still passes 22 of 22, and the six committed cards are byte-identical.

**After the replay:**
- **The card's displayed text is identical** to the committed card, and "$0 drawn" is shown and linked to the same sentence.
- **The bytes differ in exactly two fields:** the figure's internal `printed` record is "$ —", where the committed card has "$ 0 million". Neither form is printed in the filing; the sentence says it in words.
- **Not byte-identical, so per your ruling CHS is not accepted yet.** Your call: accept as is, or normalise a zero's recorded form.
- **The position diff:** the ABL row's provenance is "note-narrative" where it was "note". The v33 answer's schedule does not carry an ABL row, so the row is built from the facility.

## 4. Cigna

**Accepted, under Rule 66:** the 2025 10-K joins the position identity as the labelled prior-period base. It was already cited.

**The verbatim-label check, N1**, is in acceptance now, over all six cards with a control. It checks that every label segment of every displayed instrument name is in its own cited sentence, ignoring whitespace (the HTML-to-text spacing prints "3.400 %") and keeping case.

- **Committed cards:** 0 failures; acceptance is 294 passed, 0 failed.
- **The v33 Cigna card fails once:** its commercial paper label is stated "Commercial Paper", where its sentence says "commercial paper program".
- **On the position side, two labels and one roll-forward delta label are not verbatim.** Under your ruling they are not accepted: "Revolving Credit Agreement", "Commercial Paper Program", and "$ 550 million, 1.250 % Notes due March 2026".
- **One roll-forward delta's date** is now "2026-03" where it was "2026-03-01". Its sentence says "March 2026".

**Card diff (displayed text, committed → v33):**

```
- Undrawn revolver, matures April 2030
- Undrawn revolver shown net of ~$1,000MM commercial paper it backs. Commercial paper itself is not counted as liquidity.
- revolver · $6,500MM size · $0 drawn · matures April 2030
+ revolver · $6,500MM size · $0 drawn · $500MM letters of credit · matures April 2030
- Letter-of-credit sub-facility $500MM, capacity only, as of Dec 31, 2025, per 10-K Note 7. Letters of credit outstanding not stated.
+ Letter-of-credit sub-facility $500MM, capacity only, as of Dec 31, 2025, per 10-K Note 7. Availability not stated.
```

**Cause.** The v33 answer read the revolver's letter-of-credit *sub-limit* ("with up to $500 million available for issuance of letters of credit") as letters of credit outstanding, and it dropped the revolver's availability. With no availability, the liquidity section loses the undrawn revolver, and with it the netting of commercial paper you ruled on. Both are model variance on facility fields that the golden does not pin.

**Not fixed.** A guard that reads "available for issuance of" as capacity would be a vocabulary rule, and needs your ruling.

## 5. The six diffs, again ($0 replay of the cached v33 answers)

| Name | Position | Card (displayed text) |
|---|---|---|
| Encompass | **zero change** | one line differs: an L/C figure withheld for a different reason ($53.6MM → $46.3MM, withheld either way) |
| DaVita | **zero change** | identical |
| Molina | **zero change** | one line differs: an L/C "$0" now withheld ("claimed zero, but the sentence states a quantity") |
| Tenet | equal; only the derived lines' source text differs (section 2) | identical |
| CHS | ABL provenance (section 3) | identical; 2 internal `printed` fields differ |
| Cigna | Rule 66 accepted; labels not verbatim; one delta date (section 4) | changed (section 4) |

**Stability holds on all six:** each position is the same with and without the events the signed answer did not have.

## 6. Declared, not spent

- **Refill Tenet's proceeds-use answer:** about $0.064, one Sonnet call. That is the v31 ledger's figure for the same call on an input of the same size (about 45,000 characters).
- **The Sonnet narration pass that makes the determinism test $0:** at the test's as-of date (Sept 1, 2026), 2 of the 6 names' narrated cards miss the wording cache (Tenet's 5.125% 2027 card and DaVita's new-issuance card). That is about 8,854 input tokens and at most 1,400 output tokens: **at most $0.0476**. Narration is not captured by the cost ledger (Rule 43), so this is priced from the prompt sizes.
- **The re-tastes ($2.5596)** stay held until all six show zero position change.

## 7. Asks

1. **Tenet:** accept that the only difference is the derived lines' source text, now verbatim where the signed text was not?
2. **CHS:** accept a card whose displayed text and links are identical but whose two internal `printed` fields record "$ —" for "$ 0 million"? Or normalise a stated zero's recorded form first?
3. **Cigna:** the labels fail the verbatim rule, and the card lost the undrawn revolver and the CP netting to two model variances. Options:
   - a facility rule for L/C sub-limits;
   - accepting Cigna's card change;
   - treating Cigna as a re-sign candidate rather than a zero-change name.
