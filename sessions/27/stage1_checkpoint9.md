# Session 27: Checkpoint 9 (rulings of Oct 30 applied; screenshots_v8)

Status: **stopped**, as instructed. Nothing is pushed. **Spend this round: $0.00.**

**Next step, after your clear of the screenshots:** `npm run release`.

## Signing results

| Name | Result |
|---|---|
| Tenet | **SIGNED at v33**, re-signed after the Rule 66 ruling (see below). 3/3; 12 rows; residual 0%. |
| Encompass | **SIGNED at v33** (pre-Oct 28 read set). Unchanged this round. |
| DaVita | **SIGNED at v33** on the tolerated classes (the condition was withdrawn). 3/3; 9 rows; residual 0%; 9 tolerated differences recorded. |
| Cigna | **SIGNED at v33** on 3/3 and criterion 2. 6 rows; residual 0.11%; every computed criterion holds. |
| Molina | held for your review of the refreshed card |
| CHS | not re-signed (waits for its Q3 10-Q) |

**Gates:** goldenThroughLoop 14/14. 9b 8 of 8. Offline suite **79/79 (2,269 assertions)**.

## Rules landed (tests first; pass/fail before → after)

| Ruling | Code | Test |
|---|---|---|
| **Cigna:** fill a commitment, with a guardrail | `fillCommitmentFromFacility` (instrument.ts), in the loop | `commitmentFill.test`: did not run → **50/50**. Leak control: the same $6.5B recorded as outstanding moves captured face. |
| **Tenet:** no 10-K figure outside Rule 66 | `retargetAnnualReportFigures` removes a figure only the 10-K states unless Rule 66 permits it, records `removedUnderRule66`, and the position drops a row's matching withheld claim | `annualReportSource.test`: 7/2 → **9/9**. Controls: an injected 10-K citation is caught; Cigna's are caught once its cross-reference is removed. |
| **Encompass:** figures through the format function | `partText` (format.ts), used by the view for a computed figure's parts | `rawAmount.test`: did not run → **8/8**. Control: the pre-fix view fails. |

**Tests that followed the product:**
- `printedHeadings`: Cigna has no anchor rows; the control is now constructed.
- `goldenSourceLine` L1: carries the two ruled Tenet changes into its v31 fixture.

## Tenet under Rule 66

- **No 10-Q or 8-K Tenet holds states either maturity.** I searched all six of its documents for "November 4, 2030" and for every L/C facility sentence.
- **So both are removed:**
  - the **revolver's** November 4, 2030 ("The 2025 Credit Agreement will terminate on the earlier of (1) November 4, 2030…");
  - the **L/C facility's** November 4, 2030 ("We amended the LC Facility in November 2025…").
- **The revolver is the visible one.** The rendered card showed only the revolver's maturity; the L/C maturity was in a legacy field the page does not render.
- **This is the cost the code had recorded.** In Session 22 a first version withheld these and was reversed to keep "standing terms". Your ruling now supersedes that for any anchor Rule 66 does not cover.
- **The withheld line is removed too.** The row's model-claimed 2030-11-04 would otherwise have shown as "withheld" with a misleading reason.
- **Tenet's signed state moved only as ruled:** the 10-K left the position identity (other triggers still cite it), and the revolver row's maturity is null. So I re-signed it, with the ruling recorded in the basis. **Tell me if you'd rather have cleared that re-signature yourself.**

## Screenshots and visible changes

`sessions/26/screenshots_v8/`: six full-page PNGs from a production build at $0, with 0 console errors. The full list is `visible_changes.md`, against `origin/main` (production, Oct 21).

**Every card**
- An opened computed figure's parts now show the card format ("$600MM", "~$1,000MM") instead of the filing's raw wording ("$ 600 million", "$ 62,283 thousand").

**Tenet**
- Liquidity: "Undrawn revolver, matures November 4, 2030" becomes "Undrawn revolver".
- Facilities: the revolver line drops "· matures November 4, 2030".
- Behind source links: the table lines cited are the v33 transcription, and the 10-K sentence is gone.

**Encompass**
- Not shown: "Senior secured revolver letters of credit, $53.6MM: withheld. Sentence does not state this figure." becomes "$46.3MM: withheld. Stated as of a date other than the period this card reports."
- Its availability part shows "~$746MM", not the raw "approximately $ 746 million".
- Behind source links: the revolver maturity cites the 10-Q's "the maturity date has been changed to March 9, 2031", not the March 9 8-K.

**Molina**
- Parts in card format only. The refreshed (Sep 30) card is not live, pending your review.

**DaVita**
- Behind source links only: the table lines cited include their fair-value cell, and the revolver maturity cites "…balances are due on November 24, 2030".
- Parts in card format.

**CHS**
- Parts in card format only.

**Cigna**
- Move: "$550MM 1.250% senior notes" becomes "$550MM 1.250% notes due March 2026".
- A liquidity tooltip reads "Revolving Credit Agreement", and a table row name reads "Commercial Paper Program".
- Availability now cites "As of June 30, 2026, we had $6.5 billion of undrawn committed capacity under our revolving credit agreement" (golden finding 3(c) resolved).
- Parts in card format.
