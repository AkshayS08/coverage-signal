# Session 27, Stage 1: Checkpoint 2 (canonical run, diffs, DaVita)

Status:
- The canonical run is done and billed.
- The re-tastes are held: three names changed position, and the approval made the re-tastes conditional on zero change.
- Nothing is re-signed and nothing is pushed.
- The key was loaded only into the run's process environment (from the gitignored `.env.local`, written nowhere). Every command since has run with `ANTHROPIC_API_KEY=""`.

## Reconciliation: declared vs billed

| Name | Declared | Billed | Calls |
|---|---|---|---|
| Tenet | $0.2246 | $0.2326 | Haiku 1, Sonnet 1 |
| Encompass | $0.1949 | $0.1866 | Haiku 1, Sonnet 1 |
| DaVita | $0.1923 | $0.1855 | Haiku 1, Sonnet 1 |
| CHS | $0.2428 (incl. $0.10 dig) | $0.1238 | Haiku 1 (the dig did not fire) |
| Molina | $0.2063 | $0.1512 | Haiku 1, Sonnet 1 |
| Cigna | $0.2001 | $0.1910 | Haiku 1, Sonnet 1 (the referenced note came from cache) |
| **Total** | **$1.2610** | **$1.0707** | |

**Gate:**
- Before: 6 forced misses, exactly the declared runs.
- During: every run billed more than $0 and stayed within its ceiling. Tenet was $0.0080 over its point estimate, inside its 1.5× limit.
- After: all 6 read-set keys are cached.

The ledger's six new lines sum to $1.0707, the same as the run measured.

## Diffs against the signed v31 goldens

Full output: [stage1_diffs_canonical.txt](stage1_diffs_canonical.txt).

- **Encompass, DaVita, Molina: zero position change.**
- **Tenet: changed.**
  - **What changed in the answer.** v33's answer fills `noteRetirements`, which the signed v31 answer left empty. It has two sets:
    - two Nov 19, 2025 redemptions: all $1.5B of the 6.250% second-lien notes due Feb 2027, and $750MM of the 6.125% notes due Oct 2028;
    - two Sept 23, 2026 intended redemptions from the 8-K: $1.5B of the 5.125% notes due 2027, and $0.5B of the 6.125% notes due 2028.
  - **What that does to the position.** The position layer marks the **6.125% 2028 row retired**, but each redemption covers only part of a $2.5B issue. Tier 2 goes from 3 entries to 5. The pending Sept 23 redemption becomes two confirmed repayments. The refinancing-pattern line now reads "Last refinanced 0 months ago".
  - **Why.** The documents read are the same as the signed run's; only the catalog section of the prompt changed. So this is the model answering differently, and the position layer then mishandling a partial redemption. Both are findings.
- **CHS: changed.** The ABL facility lost its stated "$0 drawn". The signed answer carried "$ 0 million"; v33's has none. The row's provenance label moves from "note" to "note-narrative". The amounts on the row are unchanged. This is a field drop.
- **Cigna: changed.**
  - **Amounts:** all unchanged.
  - **Labels:** the instrument names were transcribed differently. "revolving credit and letter of credit agreement" became "Revolving Credit Agreement", "commercial paper program" became "Commercial Paper Program", and the roll-forward delta "1.250 % senior notes" became "$ 550 million, 1.250 % Notes due March 2026".
  - **Position identity:** the 2025 10-K moved from "other citations" into the documents the position rests on, so the golden reports the filing set as moved.

## Finding: a failed WRITE after a paid call is swallowed

In Tenet's canonical run, the proceeds-use Sonnet call billed. Then the blob write of its answer failed on a network drop ("fetch failed"). The proceeds-use catch-all left `proceedsUse` null and carried on.

- The paid answer is lost, and Tenet's stored canonical result has `proceedsUse: null`.
- The next Tenet run will buy that call again (about $0.06).

Step 4 closed this catch for failed reads only. A write after a billed call deserves the same rule.

**Proposed, not done:** writes get the same treatment as reads: at most two retries of the same write, then a named error, never swallowed. The proceeds-use catch then rethrows write failures as well as read failures.

## DaVita (at $0)

**5.7: the test computed it.** $9,344.3MM = 2,750 + 1,975 + 65 + 4,554.3, and $7,622.1MM = 1,500 + 2,357.9 + 3,764.2.

The test added the first figure of each year's closing sentence ("The filer's schedule shows $4,554.3MM for 2030: $235.7MM less than the lines above") to the instrument lines.

**No card surface shows either figure:**
- the v3 chart's 2030 bar is $4,554.3MM;
- the amortization-by-year expander shows the three lines and that sentence;
- neither string appears anywhere in the generated card.

**Fixed in the test, per "the test follows the product".** A year now ties when two things hold: the stated schedule figure is the filer's, and the lines less the stated difference equal it. Three new controls must fail, and they do:
- a wrong stated difference;
- a wrong stated schedule figure;
- the sentence removed.

**5.8: marked as a ruled expected failure.** It is reported, not counted, citing Session 26's ruling and the $65MM, and only while it fails exactly as ruled. It is counted again, loudly, if it stops failing, fails twice, or its amount moves; three controls prove each case. Not deleted.

**Acceptance:** 287 passed, 1 failed → **288 passed, 0 failed**. Every control fails as required.

## The determinism test

**Not added to the release checklist yet: it is not $0.** Run over the six with the key blank:
- every base answer hits;
- Tenet's proceeds-use misses (the lost write above);
- Tenet's card narration misses the wording cache, which is expected after a changed position.

Both would bill with a key, so the run could not take a clean sample.

It goes into the checklist once both caches are filled. That needs Tenet's proceeds-use re-bought and a narration pass, at about $0.06 plus Sonnet narration. Both are billed and not approved.

## Asks

1. Rule on the three changed names: Tenet (a model change plus a position-layer defect on partial redemptions), CHS (a field drop), Cigna (labels and identity, no amount change).
2. The write-failure fix, at $0, before any further spend.
3. The re-tastes stay held until (1).
