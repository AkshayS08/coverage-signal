# Session 27: rulings on the six acceptance findings, plus Encompass refresh approval

Standing constraints apply:
- rules over the class, never instances;
- read before write (Rule 69);
- tests first, each with a control that must fail, over all ten cards (the six current and the four refreshed);
- nothing signs until Akshay has seen the rendered card;
- nothing bills beyond its declared, approved figure;
- commit per change, and push only through npm run release.

## Part A: acceptance findings ($0)

1. **Tenet "2034" is a product bug.** A ladder-table maturity keeps the precision its sentence states. The 10-Q states "September 2034", so the table shows Sept 2034 (Rules 76–78). Fix it in the code path that builds table maturities, for every card.

2. **Correction to my earlier ruling (b): the more precise statement wins only when it states the same fact.**
   - A scheduled or expected date ("expected to be redeemed on September 23") never dates a completed move.
   - A completed move takes the precision of the sentence that states it done. Tenet's redemption reads "Redeemed Sept 2026".
   - When a scheduled day exists for the same move, it is shown labelled: "Redeemed Sept 2026 (scheduled for Sept 23)".
   - This applies to every move type: redemptions, repurchases, issuances and repayments.
   - The acceptance check accepts exactly that form.
   - Control: a card showing "redeemed Sept 23" taken from an intention-only sentence fails.

3. **Cigna's commercial paper is a regression.**
   - Per card_spec §8, outstanding commercial paper is the first ladder-table row ("Short-term"), as it was on the Oct 15 card.
   - Find the change that removed it and restore it.
   - Add a check over all cards: every outstanding commercial paper row in the signed answer appears in the table.
   - Control: a card with the row removed fails.

4. **Encompass's loss on extinguishment is not a move-card fact.**
   - Move cards state the debt change and its funding, not its effect on profit and loss.
   - Remove the requirement from the acceptance fixture, and log the ruling in card_spec.

5. **Ruled residuals bind to the anchor they were ruled on.**
   - Record the anchor (form and filing date) in every ruling.
   - On a new anchor, the plain check governs. DaVita's $65MM ruling was made on Q2, so it drops for Q3, where the check now passes.
   - Control: a ruling applied to a different anchor than its own fails.

Then acceptance must be fully green, and the offline suite fully green, with the vacuous-pass guard active.

## Part B: publish the Nov 3 brief ($0)

- Merge brief-2026-11-03 once Part A is green.
- Publish with npm run release, and confirm /api/health serves the new SHA.
- Confirm on production that:
  - Tenet, DaVita, CHS and Molina show "Position as of September 30, 2026";
  - Encompass shows its Nov 3 10-Q as a new 10-Q, not yet read;
  - Cigna is unchanged.
- Report the six cards' headline figures as served.

## Part C: Encompass refresh (billed, approved up to $1.80)

- **Approved:** up to $1.80, on pre-call counts, under the $2.00 per-build cap. That covers the canonical run, two re-tastes, proceeds-use and the facts run, on the Nov 3 10-Q (period Sept 30).
- **If anything changes the declared figure, re-declare and stop.** For example, decision 11 landing first would raise the facts line. Never spend over $1.80.
- **Fix the pricing script's closing line** so it names the run it priced. A summary that names the wrong batch is a check failure, with a test and a control.
- **After the run:**
  - check 3/3;
  - render Encompass's refresh card to sessions/26/screenshots_v11/Encompass-refresh.png;
  - list every visible difference from its current card;
  - give the reconciliation (declared against billed, per call).
- Stop. Nothing signs until I've seen it.

## Stop and report

Report:
- the Part A results (before and after counts, with controls);
- production confirmation of the four Sept 30 cards;
- Encompass's spend, its 3/3 result, its screenshot path and its difference list.
