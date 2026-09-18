Stage 2 closed and approved. Proceed to Stage 3 as written in `files/session_20_prompt.md`, with the additions below folded in. Write everything, show both diffs, the per-company expected effects, the threshold measurement plan, and the Rule 13 cost-and-result shape. STOP before spending.

## UHS is the worked example, and its layering is now hand-verified

Akshay verified UHS against the filings. The facts, which the coverage and layering math must reproduce:

- Anchor (10-Q, period June 30 2026, filed Aug 7): balance sheet states current maturities $771,910K + long-term debt $4,079,937K = stated total debt $4,851,847K. This is confirmed against UHS's own capitalization table (424B5 "Actual" column totals $4,851,847K exactly).
- What the anchor's $4.85B contains, all currently missing from the rendered ladder and living in prose: Tranche A term loan $1,447,500K, five existing senior secured notes ~$3.0B, revolver $225,000K drawn, other existing debt $197,052K, less deferred financing costs.
- Two post-anchor 8-K notes ($600M 5.500% due 2031, $500M 6.000% due 2036) accrue interest from Aug 20 2026 — after the anchor. They are NOT inside the $4.85B. They layer on top as deltas.

So the layering rule is confirmed and is the definition already in the prompt: post-anchor issuances are additions to the anchor total, never inside it. Do not read the 424B5 — prospectus parsing is explicitly Session 21. The two new notes reach the tool via 8-K, which is sufficient. The 424B "As adjusted" column is a pro-forma projection, not a position, and is out of scope here.

## The acceptance test, restated with real numbers

- At the anchor, before prose instruments: UHS renders 2 tranches ($1.1B from the 8-Ks) against $4.85B stated = ~23% coverage. Correctly terrible, because the term loan, the five existing notes, the revolver, and other debt are all uncaptured prose.
- After 3a/3b land: UHS's captured face total (existing notes + term loan + revolver + other) should reconcile to the $4.85B anchor within the measured threshold — coverage climbs toward ~100% of the anchor. That climb is the session's acceptance test.
- The two 8-K notes then layer as deltas on top, and the coverage surface states both: "at June 30, $4.85B" and "adjusted for the August issuance." Never blended into one number.

## Pre-registered test cases (from the Stage 1 flagged-items page)

The balance-sheet anchor (Check 2) currently fails on Molina ($184M unaccounted), DaVita ($66.5M), and UHS. State the prediction now: if Stage 3 lands and these anchors still fail with the same gaps, the coverage check did not work. Molina and DaVita are almost certainly prose instruments the itemized ladder misses. Report each of the three after the run: resolved by captured prose, or still failing and why.

## Everything else per the Stage 3 spec

3a prose instruments (category-typed, never name-matched, amounts verbatim with as-of dates; DaVita current-portion soft spot and Quest composite projectName re-examined under this work). 3b revolver and liquidity with the drawn+LCs+available=facility arithmetic check. 3c dedup by category before coverage. 3d the two-part coverage check with the threshold set by measuring the book's actual bridge noise, not assumed. 3e layering respects the anchor, filing-date bound reused from Session 18. 3f proceedsUse input-hash key fix rides this bump as its legitimate re-bill, values baselined first, any flip reported not tuned.

STOP with both diffs and the cost-and-result shape. Approval before the bump.
