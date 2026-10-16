# Session 26, part 2: card review fixes

Akshay reviewed all six cards against their filings and logged 53 findings. They are consolidated as rules in docs/card_spec.md v2.0, which replaces v1.2. This prompt builds v2.0.

Read docs/card_spec.md v2.0 in full before anything else, then diff it against v1.2 so you know exactly what changed. The spec is the source of truth. Where this prompt and the spec disagree, the spec wins and you report the disagreement.

## Standing constraints

- **Rules over the class, never instances.** Every fix is a rule over the data. Company names in the spec show shape only. A fix that makes one card right while the rule stays unimplemented has fixed nothing.
- **Nothing bills without a written declaration and my approval.** Run preflight and assertFree before anything that could reach a model.
- **Read before write** (Rule 69). **Enumerate before diagnosing** (Rule 63).
- **The terms block is out of scope** (spec §4): covenants, springing maturities and covenants, rates and hedging, extension options. Do not build any of it, even where it is easy.
- **Commit each rule as its own commit.** Do not push until I clear the final review.

## Step 1: Inventory (Checkpoint A)

At $0, for every element of the spec that is new or changed in v2.0, report what the cached answers already carry, what is missing, and whether closing the gap is a code change over cache ($0) or needs extraction (bills). At minimum:

1. Table headings above each debt row, and which rows each heading governs.
2. Note sentences that state seniority or security for a named instrument or class.
3. Face amounts stated in instrument names or sentences, where the table carries carrying value (including the rolled position's referenced table).
4. The filer's printed maturity schedule (by year, face), per name.
5. Stated maturity ranges ("2026 to 2038").
6. The most precise stated maturity per instrument across the anchor and later filings.
7. Sub-facilities and sub-limits (letter-of-credit, swingline), uncommitted capacity (accordions, incremental options), CP program facts (size, outstanding, average rate), and stated facility-backs-CP relationships.
8. Parent-company or unrestricted cash, where stated.
9. **Recent debt moves (§2.3):** every issuance, redemption, special call, tender, repurchase, repayment, facility entry, amendment, refinancing, termination and incremental add-on stated in the anchor for the period and in later filings through the brief date, with funding source, use of proceeds and price where stated. Report which of these sentences are already in cache and which would need extraction.

For anything that bills, apply Rule 55 first: confirm the filing actually states it before pricing a re-ask. Then declare the cost per name.

**Stop at Checkpoint A.** I approve the inventory and any spend before you build.

## Step 2: Tests first (Checkpoint B)

Write the §5 acceptance tests before changing any rendering code. Run them against the current six cards.

- Each test runs over all six cards, never a named subset.
- Each test includes at least one negative control: a deliberately corrupted card or fixture that must fail. A test that cannot fail does not count (the audit-spine rule).
- Report the failure count per test per card. These counts measure the gap. If any test passes on all six before the fix, investigate whether it can fail at all, and say what you found.

The table-reconciliation test (§5.3) is the backbone. For each card, every row of the filer's debt table appears exactly once at face with its filer label, and the face total equals the sum. Build this one with the most care.

**Stop at Checkpoint B** with the failure counts.

## Step 3: Build

Implement v2.0 rule by rule, in this order, since later rules depend on earlier ones:

1. Units and numbers (§3.3), including $MM, source precision, hedges, "$0".
2. Face first (§3.2) and the coverage footnote wording (§2.8).
3. Filer labels (§3.6), types and the seniority and security sources (§3.5), with fallback wording at the end of the line.
4. Dates: one maturity per instrument (§3.4).
5. Line format (§3.7) and plain language (§3.8).
6. The filer's maturity schedule and ranges in the ladder (§2.5).
7. Facilities: sub-facilities, LC-only facilities, CP programs (§2.6).
8. Liquidity: cash labeling, uncommitted capacity, the CP backstop relationship (§2.4).
9. Recent debt moves (§2.3) and its links into the refinance window and ladder.
10. Potential refinance opportunities over 18 months, with the Next line (§2.4).
11. This week grouping (§2.2), the rolled-position header (§2.1), and trust-section reasons (§2.7).

After each rule:

- Re-run the full §5 suite and report which failure counts moved.
- Report the rule's blast radius across all six cards: which cards changed and how. A rule meant for one shape that moves an unrelated card is a finding, not a side effect.
- Confirm goldenThroughLoop still reproduces all six at $0. If a rule changes what a signature pins, stop and report before re-signing anything.

## Step 4: Verify (Checkpoint C)

- All §5 tests green on all six cards. Any test still failing is reported with the reason, never skipped or excluded.
- Full offline suite green, golden suite included.
- Fresh screenshots of all six cards, top to bottom, saved to sessions/26/screenshots_v2/.
- For each card, a short list of what changed against the v1 screenshot.
- A residual list: anything in the spec you could not implement at $0, with the reason and the declared cost to close it.

**Stop at Checkpoint C.** I review all six cards before anything is pushed.
