# v29 — result shape, declared before the run

Written **before** any v29 call was made, so the outcome can be checked
against a prediction rather than a memory. Session spend at time of writing:
**$0.1759**. Declared cost for this run: **~$1.30–2.10**, taking the session
to roughly **$2.40 of $10**.

Anything below that this run contradicts is a finding, and gets reported as
one rather than quietly re-described.

## What must change

1. **Quest gains two facilities where it has none.** Its v28 `revolver` field
   is null and it has zero facility rows, because both facilities are stated
   in MD&A capital-resources and the model was never shown that text. The
   sentence it must now find: *"$1.3 billion of borrowing capacity available
   under our existing credit facilities, including $518 million available
   under our secured receivables credit facility and $750 million available
   under our senior unsecured revolving credit facility."*
   (Correction to my own earlier claim of a "$600M receivables facility" —
   the filing says **$518 million available**, and $600M appears nowhere in
   that section.)

2. **DaVita and UHS carry three facilities each, not one.** Both have three
   facility rows on the ladder against v28's single `revolver` slot.

3. **Molina's five note rows clear from "class not stated on this row"** to
   senior unsecured, read from its note's own prose — *"Each of these notes
   are senior unsecured obligations of the Parent corporation ... and rank
   equally in right of payment"* — via `seniorityStatement`. Its `Credit
   Facility` row may stay unclassed; the prose sentence scopes itself to
   "these notes".

4. **Encompass resolves one way or the other, and both are acceptable:**
   - it finds the other three figures in the wider span, each in a sentence
     that states it, and the facility reconciles or renders a named gap; or
   - those figures are still unverifiable and are **withheld with the refusal
     language intact**, the facility itself surviving.

   What is NOT acceptable, and what the guard makes impossible: any figure
   attributed to a sentence that does not state it. `verifyFacility.test.ts`
   pins this on Encompass's exact v28 shape, including the case where the
   missing figure would have made the arithmetic reconcile.

5. **Every remaining facility figure is traceable to a sentence that states
   it.** Rejections are logged by facility, field, value and reason.

## What must NOT change

- **No company loses a facility it has today.** Seven of ten populate the v28
  `revolver` field; all seven must still carry that facility, whatever
  happens to its individual figures.
- No company's **ladder rows** change. This stage touches facilities,
  seniority prose and proceeds — not the debt schedule. A moved ladder row is
  a finding, not an improvement.
- Coverage denominators stay on the filer's own XBRL tags where they were.

## What I expect to be uncertain about

- **Tenet's liquidity region is 51,866 characters**, by far the largest. It
  raises Tenet's input cost and may push its per-company cost above the
  $0.18 measured at v28.
- **Cigna's liquidity region states no facility language at all** — its
  revolver is in the debt note instead. Cigna should still produce its $6.5B
  revolver, from the note, not the new region.
- `proceedsUses` is new and unmeasured. Encompass's May issuance is the case
  to look at: it should return three uses (redemption, revolver repayment,
  fees) where v28 captured one.
