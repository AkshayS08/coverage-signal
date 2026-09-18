# Checksum redesign — stop before the remaining 8

The checksum was built around the wrong model of a debt note. Three rounds of patching (`category`, `feedsIntoTotal`, numeric fallback) were all solving a question the filing never asks. Hand-verification of both pilot companies established the correct model.

## What the filings actually do

A debt note is a **running total**, not a set of lines belonging to one grand total. Every printed subtotal equals the sum of everything printed above it. No labels are needed to reconcile it.

**DaVita** (10-Q, quarter ended 2026-06-30):

```
9 tranche rows sum to                    10,847,516  ← "Total debt principal outstanding" (labelled)
minus discount, premium, financing costs    (66,503)
                                       =  10,781,013  ← printed, unlabelled
minus current portion                      (117,177)
                                       =  10,663,836  ← printed, unlabelled
```

**HCA** (10-Q, quarter ended 2026-06-30):

```
3 aggregate rows sum to                      46,279  ← no pre-adjustment total printed
minus debt issuance costs and discounts        (451)
                                       =     45,828  ← "Total long-term debt"
plus commercial paper (short-term)            3,890
                                       =     49,718  ← "Total debt"
minus amounts due within one year            (6,264)
                                       =     43,454  ← printed, unlabelled
```

Both walk cleanly. Both were verified by hand against the actual filings.

Note what this shows about the current implementation: DaVita's rows tie exactly to a **labelled** total, `Total debt principal outstanding`, with zero adjustments applied. The entire unlabelled-total problem was created by reaching past that figure for a lower one. Report which total the current code selects as `statedTotal` and why.

## The replacement design — two independent checks

### Check 1: internal walk

Extraction preserves the note's **printed order** and captures every printed subtotal as it appears:

```
scheduleSequence: [
  { kind: "row"      | "adjustment" | "subtotal",
    label,                          // verbatim, or null if the filing prints none
    amount,                         // sign as printed — parentheses mean negative
    sourceLine }                    // verbatim, verified as today
]
```

The checksum walks the sequence in order and asserts each `subtotal` equals the running sum of everything before it. A company passes check 1 when every printed subtotal reconciles.

Labels are captured for display, never required for reconciliation.

**Catches:** a missing or fabricated tranche row.

### Check 2: balance-sheet anchor

Every 10-Q and 10-K carries a balance sheet with debt captions. Reconcile the note's figures against them.

DaVita:

```
balance sheet: current portion of long-term debt      117,177
balance sheet: long-term debt                      10,663,836
                                                   10,781,013
note walk at the post-adjustment subtotal          10,781,013  ✓
```

Two requirements:

- **Not a fixed formula.** Reconcile against the debt captions actually present on that balance sheet. Finance leases sometimes sit outside `long-term debt`; short-term borrowings (HCA's commercial paper) carry their own caption. The rule reads the captions, it does not assume a fixed set.
- **Report unreconciled captions explicitly** rather than forcing a tie.

**Catches:** a stale or wrong debt note. An internal walk on a prior-quarter note ties perfectly on its own — the balance sheet is what proves the note belongs to this period.

### Why both

They fail differently. Check 1 proves the rows are complete. Check 2 proves the note is the right one. A company passing one and failing the other names its own failure, which is more useful than a single blended number.

**Report per company, separately: check 1 pass/fail, check 2 pass/fail, and the dollar gap for each.** Never merge them into one tie rate.

## Delete

- `feedsIntoTotal` — the schema field for which total a reconciling line bridges to.
- The category-scoping requirement on reconciling lines.
- The numeric-confirmation fallback.

All three exist to answer "which total does this line belong to," which the running walk makes unnecessary.

## Sequencing

1. Implement both checks and delete the three items above.
2. Re-pilot DaVita and HCA only. Expected: DaVita passes both. HCA passes check 1 on its aggregates; report what check 2 does with commercial paper's separate caption.
3. Report results before any further spend.
4. Then the remaining 8.

## Standing conditions, still open from before

1. **Base-ladder filing selection.** Confirm the position layer picks whichever filing carries the schedule, not the newest by date. Cigna's table exists only in the 10-K. Show the base filing's form and date in the output.
2. **Row accounting per company.** Report rows extracted, verified, and dropped. Centene's 28 fabricated rows were caught by row verification but only visible because someone looked. Flag any nonzero drop count.
3. **HCA renders honestly.** Three aggregate lines plus the $6,264M due-within-one-year figure, stated as an aggregate disclosure with no tranche-level ladder available. Never `no signal found`, never a synthesized ladder. Confirmed by hand: HCA has no itemized table in either the 10-Q or the 10-K.

## Rules that apply

- **Rules first, never instances.** DaVita and HCA are worked examples of the walk, not the targets. Every assertion applies across all 10 companies.
- **Never suppress.** A failed check renders with its gap stated, never a hidden line or a silent pass.
- **Fix the shape, not the symptom.** Three prompt patches on the same class is the signal the shape was wrong. It was.
