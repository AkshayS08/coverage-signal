# Session 20 — locator by content, the prose half of the capital structure, and coverage

Read the numbered rules at the end of `coverage_signal_build_log.md` (1 through 16) before writing any code. Everything below is rules over the data. Company names are worked examples of a shape; a change that satisfies the named company while the rule stays unimplemented has fixed nothing.

Work in stages. Stop at each STOP and report. Nothing after a STOP starts until the report has been reviewed. Scope is frozen: findings from any stage log forward to Session 21 unless a wrong number would render as a position.

Budget: $5.00 authorized for the whole session. Every paid run declares its Rule 13 cost shape and result shape before spending. If projected total exceeds $5.00, stop and ask.

---

## Definitions

These are the spec. Where a term below is used anywhere in this prompt, it means exactly this.

**Anchor filing.** One named filing (its period of report and its filing date together), the most recent 10-Q or 10-K. Both sides of every anchor-date check come from this one filing. Never mix quarters.

**Stated total debt.** The sum of the anchor filing's balance-sheet long-term debt caption and its current-maturities caption, at carrying value, matched by category (never proximity). The captions summed are named on the rendered surface. Lease scope follows the note's own scope: if the note's total includes finance leases, the anchor includes the balance-sheet lease line, and which way it went is stated.

**Prose instrument.** An instrument stated in the located note's narrative carrying, at minimum, a category (term loan, revolver, delayed-draw term loan, finance-lease financing, other) and a stated amount with its as-of date, all copied verbatim. No stated amount means no coverage entry — it becomes narrative context only.

**Coverage.** Two tests, reported separately:
1. Category completeness — every debt category the note states to exist is either captured (row or prose instrument) or flagged as stated-but-missing. No threshold; a stated term loan we hold no entry for flags regardless of size.
2. Residual materiality — after every captured entry is summed at face, the unexplained remainder against stated total debt must be under the threshold. The threshold is set in this session by measurement (see Stage 3), never assumed.

**Layered event.** An 8-K post-dating the anchor filing's *filing date*, applying an exact-match delta to a named tranche (or adding a new one), keyed to the anchor it adjusts. An 8-K dated between the period of report and the filing date is a gap-window event: flagged for the subsequent-events check, never auto-layered (the note may already reflect it). When a new anchor filing arrives, all deltas retire and events re-qualify against the new filing date — deltas never carry over.

**Coverage surface.** The coverage line states which stage it reports: "at [anchor period]" for the anchor check, plus "adjusted for N events since [filing date]" when deltas exist. The two are never blended into one number.

---

## Stage 1 — foundation, code-only, $0.00

**1a. Module consolidation.** The note-location logic (heading finder, density fallback, fraction-glyph handling, span marking, lead-window logic) moves into one module with one job: filing text in, located and marked note out. Nothing gets smarter. Prove byte-identical: the full book re-renders identical at $0.00 across 0 calls before anything else in this session touches the module.

**1b. Failed-fetch visibility.** The Session 19 1c finding. Rule: a company that was attempted and failed renders as a failed attempt on the primary surface, and the assessed count counts attempts, not successes. A ten-name book with one failed fetch reads "10 companies assessed, 1 failed: [company, reason]" — never "9 companies assessed." Verify by fault injection against the rendered surface.

**1c. Flagged-items page.** One page listing every flag across both books in one place: company, what is flagged, why, link to the spot. Flags include: walks that don't tie, suppressed cards, coverage gaps (once Stage 3 lands), read failures, failed fetches. This is the review queue. No new data — it collects what already renders.

**STOP.** Report all three with verifications. Commit code-only.

---

## Stage 2 — locator by content, isolated, its own bump

The UHS finding: its real debt lives in a note headed "Treasury / Credit Facilities and Outstanding Debt Securities," vocabulary the heading finder doesn't recognize, and the density fallback lands on an interest-expense table. The rule: a debt note is identifiable by what it contains, not only what it is titled.

**Design constraints, all mandatory:**
- Heading-first stays primary. Content identification is the fallback, replacing or augmenting density.
- Content rules include disqualifiers, not just qualifiers. The decisive one is structural: a debt schedule's amounts are balances that sum toward the stated total debt; an interest table's amounts run roughly 1–7% of the balances they reference and sum to an expense figure. Magnitude relative to the balance-sheet debt line is the test. Never a vocabulary list.
- A content-located span records `via=content` in its provenance, same as `via=heading` and `via=density` today, so a wrong location is traceable.
- The marker stays provenance-worded per Rule 14. A span the model reads and finds not to be a schedule returns empty, stated.

Write the change, show the design and the offline evidence (which spans each of the ten companies would now select, with provenance), and STOP before bumping.

**Then bump and run.** Rule 13 shape, declared here and corrected by you before the run if your survey shows otherwise: ~$1.05, 10 base calls, zero proceedsUse, zero dig. UHS locates the Treasury note and its five senior notes extract from the real list (the $700M 1.65% due Sept 2026, $500M 4.625% due Oct 2029, $800M 2.65% due Oct 2030, $500M 2.65% due Jan 2032, $500M 5.050% due Oct 2034 — face values from the note's own bullets). Every company whose selected span is unchanged must be byte-identical; every changed span is named before the run with its expected effect. Any movement outside that stops.

**STOP.** Report against the shape. UHS's rows go to Akshay for the blend check (each row's verbatim sourceLine against the filing) before they count — Rule 15 exists because of this exact company.

---

## Stage 3 — the prose half, coverage, and the anchor, one bump

Written entirely and reviewed at a STOP before any spend. Show the schema diff, the prompt diff, and the per-company expected effects.

**3a. Prose instruments.** New extraction fields for instruments stated in the located note's narrative, per the definition above. Category-typed, never name-matched: identity across periods is category plus amount continuity (a company has one term loan A, one revolver; names like "Eleventh Amendment" are display text, never match keys). Amounts copied verbatim with their as-of dates. The DaVita current-portion soft spot and Quest's composite projectName (both carried from Session 19) are re-examined under this work since both are the one-slot/prose shape; report whether each resolves as a consequence of the rule or stays logged.

**3b. Revolver and liquidity.** Where the note states them, extract as separate named fields: facility size, drawn, letters of credit, available, plus delayed-draw capacity. Free arithmetic check: drawn + LCs + available = facility size; a mismatch renders as its own flag. Liquidity renders with the ladder — what is owed and when, next to what they can reach for.

**3c. Dedup before coverage.** A prose instrument that duplicates a table row (same category, same amount or same instrument) is one entry. The coverage sum names which entries it counted. This is what prevents the UHS "Subtotal — revolving credit, term loan A and Senior Notes" class from double-counting.

**3d. The coverage check.** Per the definition: category completeness (no threshold) plus residual materiality (measured threshold). Before setting the threshold, measure the bridge residual (discounts, issuance costs, lease-scope differences) across all ten companies at the anchor date and set the line comfortably above the noise floor; report the measurement and the chosen number. Coverage renders on every ladder: "rows + prose cover $X of $Y stated total debt," with the anchor captions named.

**3e. Layering respects the anchor.** The coverage check runs only at the anchor filing. Layered events (per the definition) adjust the displayed position as exact-match deltas, each checkable at its own layer, and the coverage surface separates the two stages. Gap-window events flag, never auto-layer. Reuse the Session 18 filing-date bound; do not re-derive it.

**3f. proceedsUse key.** This session's changes alter proceedsUse's bounded input (anchors come from base-pass output), so this is the legitimate re-bill the Session 19 close-out deferred to. Fold the input hash into the key now, in the same bump. Expected: 8 proceedsUse misses at ~$0.51. Baseline the current values first; any flip is reported with both values and the input diff, never tuned away.

**STOP.** Both diffs, per-company expected effects, threshold measurement plan, and the Rule 13 cost and result shape for the run. Approval before spending.

**Then bump and run.** Expected shape stated before the run, including: which companies gain prose instruments (UHS gains term loan A ~$1.448B as of June 30, revolver drawn $225M, per its note), which are byte-identical, coverage percentages expected where computable. UHS's coverage should move from ~61% to near-complete — that movement is the session's acceptance test. Full baseline diff, every changed line attributed to 3a–3f, slab/rail artifact at the stage close only.

---

## Stage 4 — close

1. Narration set priced and listed before spending, Rule 9 pre-flight (derived corpus held), only companies whose facts changed plus any forced by key movement.
2. Determinism x3 both books, local and live, fixed harness. INCOMPLETE reported with its error log.
3. Suites, tsc, build. Push to main only if all clean; report branch, hash, deployment.
4. BRD updates: coverage check and definitions into the spec (the Definitions block above goes in verbatim), threshold and its measurement recorded, standing costs restated if the measured pass cost moved, Session 21 carry-list (anything logged forward this session).
5. Build-log close-out entry with the session's earned rules, numbering from 17. Full artifact at the session boundary only.

---

## Out of scope — do not touch

- The ~40-name pre-warm and golden files: Session 21, after this rebuild is proven on ten names.
- Book-level ranking and derived analysis lines on cards: Session 21.
- Item 3 market risk; D2 month recovery: unchanged, out.
- Taxonomy edits: report, never change.

## Standing constraints

- One substantive change per paid run (Stage 2 and Stage 3 are separate bumps for this reason).
- Persist line-level output after each run; the next diff has a baseline.
- Never suppress: a line or check that cannot resolve renders with its problem stated — including the coverage check itself ("no anchor located, coverage unmeasured" is a valid rendered state; silence is not).
- Rules over instances, always. New rules to the log, numbered from 17.
