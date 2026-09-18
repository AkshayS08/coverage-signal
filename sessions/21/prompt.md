# Session 21 — ten names, clean, callable, and signed

Read the numbered rules at the end of `coverage_signal_build_log.md` (1 through 21, plus corollaries) before writing any code. Everything below is rules over the data. Company names are worked examples of a shape; a change that satisfies the named company while the rule stays unimplemented has fixed nothing.

Work in stages. Stop at each STOP and report. Nothing after a STOP starts until the report has been reviewed. Findings log forward to Session 22 unless a wrong number would render as a position.

Budget: $10.00 authorized, stop-and-ask above it. Every paid run declares its Rule 13 cost shape and result shape before spending, and persists its per-company cost log (Rule 20). Declared shapes must be shapes the mechanism can produce: span-identity plus attributable model variance, not byte-identity across a bump.

**The session's purpose.** No expansion. The ~40-name pre-warm is Session 22. This session makes the ten-name book demoable on its own: every name ties, every check passes without caveats, every company with a live event produces a card an RM would act on, and every company has a golden file Akshay has signed. When an RM picks any of the ten and probes it, nothing should need a caveat.

---

## Definitions

Carry forward every definition in BRD §8.6 unchanged (anchor filing, stated total debt, ladder entry, debt, capacity, bridge, captured face, residual, coverage, layered event, coverage surface). New this session:

**Tier 1.** The anchor position: the anchor filing's ladder (schedule rows and prose instruments), its stated total debt, and its coverage. The only tier that carries a coverage percentage, because it is the only tier with a balance sheet to check against.

**Tier 2.** Events since the anchor: each post-anchor 8-K (per the layered-event definition) rendered as its own line with date, effect, and verbatim source. Nets, never stacks: an issuance adds its stated amount; a redemption subtracts against the exact named tranche; an intended-but-unconfirmed repayment stays on the ladder marked pending until an 8-K confirms it. Carries a rolled total labelled "adjusted for events since [anchor date], unverified against a balance sheet until the next 10-Q." Never a coverage percentage. Nothing from a 424B "as adjusted" column is a position.

**Golden file.** A company's hand-verified ladder (Tier 1 rows and prose instruments, stated total, coverage), tied to the specific anchor filing it was verified against. A run whose filing set matches the golden file's must reproduce it; a divergence is a regression, not a finding. When a new anchor filing arrives, the golden file is marked stale until re-verified.

**Card-eligible instrument.** Any Tier 1 or Tier 2 instrument, schedule row or prose instrument, whose maturity or event falls inside the window. Card candidates are built from instruments, never from schedule rows alone.

---

## Stage 1 — UHS cards, and the rule behind them ($0 unless a bump is required)

UHS ties at 98%, hand-verified, and produces no card, with its $700M 1.65% notes maturing September 1, 2026 — the most urgent item in the book. Two causes; diagnose both before fixing either.

**1a. Cards are built from instruments, not rows.** Today card candidates come from the position's schedule rows, and UHS's ladder is entirely prose. Rule: a card candidate is any card-eligible instrument per the definition above, whatever field it lives in. Prose instruments card exactly as schedule rows do.

**1b. The second cause.** UHS also failed to card at v22 when it held eleven schedule rows. That is not 1a. Diagnose it from the v22 baseline before writing code: trace UHS's v22 rows through eligibility and name the gate that stopped them. Report the cause as a rule, then fix it as one.

Verify offline: UHS's $700M 2026 note and its $1.448B term loan (due 2029-09-26) are card candidates; the delayed-draw facility (capacity) is not; the three 2027 cards on Tenet, Quest, Centene are unchanged. Then confirm book-wide that no company gained a card from capacity or from a pending event.

**STOP.** Report both causes as rules, the offline verification, and whether a bump is needed. If a bump is needed, declare its shape and wait.

---

## Stage 2 — the denominator, made structural (XBRL totals as anchor)

Molina's stated total moved $184M with prompt wording (finance-lease caption in or out). The denominator is currently the model's reading of which balance-sheet lines are debt. Rule: stated total debt comes from the company's own XBRL tags, never from a model reading of the balance sheet.

**2a. XBRL totals.** Pull the anchor filing's standard tags for long-term debt and current maturities (and the lease-liability tags where the note's own scope includes finance leases, per the stated-total definition's lease-scope rule) from the SEC's free company-facts data. The captions summed are still named on the surface, now from the tags. The model-read caption set becomes the cross-check witness, not the source.

**2b. Measure before switching.** For all ten, compare the XBRL total against the current model-read denominator. Report each: identical, differs by a named lease/scope item, or differs unexplained. An unexplained difference stops; a scope difference is decided once by the lease-scope rule.

**2c. Coverage as a decimal.** Once the denominator is structural, coverage quotes a decimal again. Until then it renders as "accounts for / does not account for." State in the report which surfaces now show the decimal.

**2d. XBRL maturity buckets as the floor.** Pull the standard maturity tags (due in 12 months, 13–24, 25–36, 37–48, 49–60, thereafter). Every company renders these beneath its ladder as a floor, so no company ever renders blank. Cigna's empty-with-reason state gets a floor. The buckets are a floor, never a substitute for the ladder; the ladder is the product.

**STOP.** Report the ten-company measurement, which denominators moved and why, and the shape if a bump is needed.

---

## Stage 3 — Tier 2 render

Build Tier 2 per the definition. The position-layer arithmetic exists (Session 18 redeems, note-prose retirements, authority rule); this is the render and the pending state.

- One ladder, two rendered tiers, never blended. Tier 1 as reviewed. Tier 2 beneath it.
- Each post-anchor 8-K as its own line: date, effect (+ / − against a named tranche), verbatim source.
- Pending state: an intended repayment stated in a prospectus or note but not confirmed by 8-K stays on the ladder, marked pending, with the stated intent and its source. It is never removed on intent alone.
- Rolled total, labelled unverified until the next 10-Q. No coverage percentage on Tier 2.
- The coverage surface names the tier it reports.

UHS is the worked example: Tier 1 at $4.85B / 98%; Tier 2 showing +$600M 5.500% 2031 and +$500M 6.000% 2036 (8-K, accruing Aug 20), the $225M revolver repayment if an 8-K confirms it, and the $700M 1.65% 2026 notes marked pending repayment (matured Sept 1, takeout stated in the prospectus, not yet confirmed by 8-K). Verify offline against the real 8-Ks, then confirm book-wide that every company with a post-anchor 8-K renders a Tier 2 and every company without one renders none.

**STOP.** Show UHS's two-tier render and the book-wide Tier 2 inventory.

---

## Stage 4 — the two remaining names

**4a. Cigna.** The book's largest note (38 entries) reads captions but no rows. Diagnose from the raw response before fixing: truncation, a locator issue, or a read failure. Fix as a rule. Cigna must tie or state exactly why not.

**4b. DaVita.** Its $65M revolving-line row sits outside the note's own subtotal. Decide once as a rule where a row outside the note's subtotal belongs (prose instrument, or row with its exclusion stated on the surface) and apply book-wide. "Clean" means resolved or explained on the surface, never silently tolerated.

**STOP.** Report both as rules with their effect on all ten.

---

## Stage 5 — derived analysis lines on cards ($0, arithmetic on verified facts)

Cards state facts. Add the derived lines that make a fact a call, all computed from verified facts, none from inference:

- Months to maturity, from the verified date and the pinned as-of date.
- The company's own refinancing pattern, from its verified issuance-redeems history (e.g. "refinanced its 2025 notes 14 months early").
- Next tranche up, from a sort of its own ladder.
- Liquidity next to the maturity: revolver available, from the verified revolver fields.

Nothing about market conditions, rates environment, or "favourable timing." That is the unsupported-inference class removed in Session 19 and it does not return. Every derived line must pass the derived guard corpus (Rule 6): if it isn't computable from a verified fact, it doesn't render.

**STOP.** Show all cards with their derived lines.

---

## Stage 6 — golden files for all ten

For each company, write the golden file per the definition from the current hand-verified state. UHS first (already verified by Akshay against the June 30, 2026 10-Q). For the other nine, produce a verification sheet per company — ladder rows and prose instruments with their verbatim source lines and offsets, stated total with its captions, coverage — for Akshay to check against the filing. A golden file is written only after his sign-off on that sheet.

Add the golden check to the offline suite: a run whose filing set matches a golden file's must reproduce it, and any divergence fails by name.

**STOP.** Present the ten verification sheets. Akshay signs each; golden files are written per signature.

---

## Stage 7 — close

1. Narration set priced and listed, attempted and rendered-clean as separate columns, held for review before spending.
2. Determinism x3 both books, local and live, fixed harness, pinned as-of date. State plainly that determinism tests the pipeline, not the model; CACHE_BUST is the lever for model-reading stability and is used only where a denominator or caption set is in question.
3. Suites, tsc, build. Push to main only if all clean; report branch, hash, deployment.
4. BRD → v1.6: Tier 1/Tier 2 and golden-file definitions into §8.6, XBRL totals and buckets into the guards table, standing costs from the persisted log, the Session 22 carry-list.
5. Build-log close-out with new rules numbered from 22, full artifact at the session boundary.

---

## Out of scope — do not touch

- The ~40-name pre-warm: Session 22.
- 424B / prospectus parsing: Session 22. Tier 2's pending state uses the prospectus only as the stated intent's source for the pending label, never as a position.
- XBRL per-tranche as a primary source: measure in Session 22; this session uses XBRL for totals and buckets only.
- Book-level ranking across names: Session 22.
- Item 3 market risk, D2 month recovery, taxonomy edits: unchanged, out.

## Standing constraints

- One substantive change per paid run.
- Never suppress. Coverage computed and rendered nowhere, and prose instruments feeding a figure and never the page, were both violations this project has already made; the check for each new surface is "where does the reader see this."
- Two surfaces deciding one thing is the same defect as two fields holding one instrument (Rule 21 corollary). Every rendered number has one deciding function.
- A control is defined by text unchanged, never marker unchanged.
- Rules over instances, always. New rules to the log, numbered from 22.

## Acceptance

All ten names tie or state exactly why not; every check passes without caveats; coverage quotes a structural decimal; every company with a live event produces a card an RM would act on, with derived lines; Tier 2 renders wherever a post-anchor 8-K exists; and all ten golden files are written on Akshay's signature. When that holds, the ten-name book is demoable on its own, and Session 22's only job is to prove it scales.
