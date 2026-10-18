# Coverage Signal card spec, Demo v1

Version 2.2, Oct 18, 2026. One change: the refinance summary's two halves count the same instruments (2.4 rule 2), marked **(v2.2)**. Supersedes v2.1.

Version 2.1, Oct 17, 2026. Round-2 review of the six v2.0 cards: the refinance box redesigned (2.4), five material fixes (2.3, 2.4, 2.5) and four consistency fixes (2.4, 2.5, 3.3, 3.8). Each change is marked **(v2.1)**. Supersedes v2.0 (Oct 6, 2026, rewritten after Akshay's review of all six cards, 53 findings), which superseded v1.2.

Every rule here is a rule over the class. Company names appear only to show the shape of a case. A change that fixes a named company while the rule stays unimplemented does not count as done.

## 1. What the card is for

An RM opening a card asks first: **what changed since last week?** The card answers that at the top, then shows how the debt moved recently, then the full position. It does this every week, quiet or not.

Scope for Demo v1:

- Six signed names: Tenet, Encompass, Molina, DaVita, CHS, Cigna.
- One card per name. No portfolio view.
- The demo uses the real latest week, even if quiet.
- Cards render from the deterministic cache. Rendering bills nothing.

## 2. Card layout, top to bottom

**(v2.1)** Order: header (2.1), this week (2.2), the potential refinance box (2.4), recent debt moves (2.3), the total-debt and liquidity headlines (2.4), maturity ladder (2.5), facilities (2.6), what the tool did not show (2.7), coverage footnote (2.8).

### 2.1 Header

- Company name.
- Brief week as a date range.
- The filing the position comes from, with its period and filing date, linked.
- Where the position is rolled forward from an earlier filing (Rule 66 cases), one plain sentence saying so. The shape: "This company's 10-Q does not list its notes. This list comes from the Dec 31, 2025 10-K, updated for changes through June 30, 2026." No engine terms (3.8).

### 2.2 This week

"Last week" means since the previous logged brief for that name, or the trailing seven days for a first brief.

- **Actionable filings**, one per line. A filing is actionable when its form or 8-K item number signals a debt, liquidity or maturity change (a new 10-Q or 10-K; 8-K Items 1.01, 1.02, 2.03, 2.04; 2.01 where debt-financed), or when already-read text states such a change. Each line gives what happened, the date, the face amount, the instrument with its labels, one line on why it matters, and a link.
- **Everything else** is counted in one line, grouped by form, with links one click deeper. The shape: "9 Form 4s (insider trades), none affecting debt."
- **Quiet week:** "No new filings affecting debt since [date]."

### 2.3 Recent debt moves (new in v2.0)

Every debt transaction the filings state from the start of the anchor's fiscal year through the brief date, newest first, in two groups:

- **Since the position date**, from later filings (8-Ks), marked "not yet in the position totals."
- **During the period**, from the anchor filing, already reflected in the position.

Covered: issuance; redemption, full or partial, including special calls; tender or repurchase; repayment at maturity; facility entry, amendment, refinancing or termination; incremental add-ons; material draws or paydowns where stated.

Each line carries:

- Date, type, instrument with its labels, and face amount.
- **How it was funded**, when stated ("funded by the $500MM 5.875% senior notes due 2034", "funded by ~$600MM of divestiture proceeds").
- **What it was used for**, when stated ("used to redeem $400MM of the 4.50% senior notes due 2028").
- Price, when stated ("at 103% of principal").
- A link to the sentence for every figure.

Linking rules:

- When a move funds or retires another instrument, both lines reference each other.
- An instrument partly retired shows its remaining face and the retired portion on its own row elsewhere on the card ("$400MM remaining; $400MM of $800MM redeemed May 2026").
- A pending transaction (announced, not confirmed complete) reads "pending, not yet confirmed by a filing" and never changes position totals.
- A transaction completed before the period start never appears. A facility borrowed and repaid inside the window appears as two moves, never as an "intention."

**(v2.1) Card format, not filing prose.** Each move line follows 3.7: date, type, face in $MM, coupon, labels, instrument, then funding, use and price as short clauses ("funded by ~$600MM of divestiture proceeds", "at 103% of principal"). No raw filer prose in the line, no defined terms ("the '2027 Notes'"), no legal agreement titles. The full source sentence stays one click away through the link.

**(v2.1) Related moves merge into one event.** Moves stated as parts of one transaction (the same date, or a stated causal link: a new agreement entered, an old one terminated, a draw used to retire it) render as one line describing the event: "Refinanced revolver: new $1,000MM credit agreement replaced the 2022 agreement; $250MM drawn to retire it." Each component figure keeps its own link.

**(v2.1) No cryptic tags.** No "(also stated here)", no "(use of proceeds)". What such a tag conveyed is said in plain words, or left to the link.

### 2.4 Headlines

Three headlines. Slot 4 is reserved for the tranche mix after the demo. No headline amount ever appears without its instrument type.

**Total debt**, at face, as of the position date.

- Breakdown lines follow the filer's own table structure and order. One line per filer grouping, each with its seniority and security labels and the filer's full label.
- **(v2.1) Grouping by label.** A type splits by seniority or security only when every row of that type carries the label. Otherwise its rows group by type alone ("Notes $29,736MM") and the labels stay per row in the ladder. A type never appears as two lines because some rows got a label from a different source.
- **(v2.1) One line per type.** A type with rows on different bases shows as one line with the basis inside it: "Senior notes $2,073.5MM (of which $1,673.5MM at carrying value)". Never two lines with the same type word.
- **(v2.1) Order by priority.** Secured first, then unsecured, then types without a stated label, then leases and other obligations. Within a tier, the filer's table order.

**Liquidity**, as of the position date.

- Cash, labeled exactly as the filer states it ("consolidated cash and cash equivalents"). Where the filer also states a parent-company or unrestricted figure, it shows beside the consolidated one, linked. No industry-based assumption either way.
- Undrawn committed capacity, one line per facility, with stated availability (BRD 8.12: never computed as size minus drawn). Where availability is not stated, show size, drawn and letters of credit, plus "availability not stated."
- Uncommitted capacity (accordions, incremental options) is listed as "uncommitted, not counted in liquidity."
- A commercial paper program is never liquidity. Where the filer states that a facility backs a CP program, both facts show side by side ("Revolver $6,500MM undrawn; backs ~$1,000MM CP outstanding"). No netted figure is computed.

**Potential refinance opportunities**, the next 18 months from the brief date. **(v2.1) Redesigned as the card's call to action:**

1. **Placement and emphasis.** The box sits directly after "This week," above recent debt moves and the headlines, in a visually distinct container (border and tinted background), the same on every card.
2. **Summary line first.** One sentence from a deterministic template over stated facts only, never model text. It gives the total face of named instruments maturing inside the window and how many there are; then the amount already subject to a stated pending or completed redemption, and what funds it where stated. The shape: "$2,100MM across 2 notes in the next 18 months; $2,000MM already being redeemed with the $2,000MM 6.250% notes issued Sept 22, 2026." When nothing matures in the window: "Nothing matures within 18 months." Every figure links to its source.
   **(v2.2) Both halves count the same instruments.** The redemption figure counts only redemptions of instruments maturing inside the window. A redemption of an instrument outside the window is stated in its own clause ("which also fund $500MM of the 6.125% senior unsecured notes due October 2028") or left to recent debt moves, never added to the in-window figure. The shape: "$2,100MM across 2 notes in the next 18 months; $1,500MM already being redeemed with the $2,000MM 6.250% notes issued Sept 22, 2026, which also fund $500MM of the October 2028 notes."
3. **Named instruments only.** Box rows are notes, debentures, term-loan final maturities, facility maturities and commercial paper outstanding. One line each in 3.7 format, plus a status where stated: "pending redemption $X, not yet confirmed by a filing", "$X of $Y redeemed [month year]".
4. **Leftovers collapse to one line.** Scheduled amortization, other scheduled principal, ranged items (leases, other notes) and partly-overlapping year buckets get no rows of their own. They sum to one line: "Plus $XMM of scheduled amortization and other principal, per the filer's schedule (see maturity ladder)." The sum carries the flag marker if any component only may fall inside the window. The detail stays in the ladder, unchanged.
5. **Flags as markers.** "Year only stated" and "may fall within 18 months" become a short marker ("†") with one legend line under the box. "Not stated" fallbacks do not appear in the box; they stay in the ladder.
6. **Commercial paper.** Where CP is outstanding it is a box row: "~$1,000MM unsecured commercial paper outstanding, short-term, backed by the $6,500MM revolver", each descriptor only where stated (backing only where the filer states it).
7. A **Next** line follows the rows: "Next, after [window end]: …"

### 2.5 Maturity ladder

- Drawn debt by year, one row per instrument at face.
- **The filer's maturity schedule is used where printed.** Instrument rows reconcile to it by year. Principal the schedule shows but no instrument row accounts for (amortization, leases, other notes) appears as "other scheduled principal, per the filer's schedule" for that year, linked. Never silently dropped. A year bucket partly inside a window is flagged, never pro-rated.
- **Maturity ranges are stated maturities.** "2026 to 2038" shows as a range, never as "no maturity stated."
- Undrawn facilities sit in a separate capacity group, never as $0 debt.
- Instruments repaid inside the period show only in 2.3, never as $0 rows (Rule 64).
- Rolled rows sit under one group label at the top of their section, with a small marker per row. The label never repeats per row.
- Each instrument appears exactly once (stated-fact identity, Rule 49).
- **(v2.1) Pre-period lines never appear.** For a rolled position, an instrument the referenced filing states at $0, or as repaid before the referenced period end, never appears on the card, including any summary line listing them. Mechanics sentences (how many instruments are stated in two filings, which one is shown) are not card copy; they may move to the detail view.
- **(v2.1) "Not stated" once per group.** When the same fallback applies to every row in a ladder group (a year, or the "from the 10-K" lines), it shows once at the group's top, not on each row. When only some rows lack the label, it stays per row.

### 2.6 Facilities

One block per facility, with seniority and security labels where stated:

- Size, drawn, letters of credit outstanding, available, maturity.
- **Stated sub-facilities and sub-limits are capacity** (Rule 48): letter-of-credit sub-facilities, swingline sub-facilities. Shown as capacity lines, never as drawn amounts.
- **Letter-of-credit-only facilities** show letters of credit outstanding and, if stated, size. No "drawn" line, and no stack of "not stated" lines. At most one "facility size not stated."
- **Commercial paper programs** show program size, amount outstanding, average rate if stated, and any backing facility. Never rendered with facility fields (drawn, LCs, available).
- Borrowing-base facilities carry the flag with the filer's full sentence.

### 2.7 What the tool did not show

Every withheld figure with its reason. Each reason must match the item's actual stated status. A reason that contradicts the filing (calling a completed, repaid facility an "intention") is a defect. "Nothing withheld this week" when empty.

### 2.8 Footnote: coverage

One line, plain language:

- Ties: "Face total $13,333MM. Balance sheet $13,248MM, after $85MM of unamortized issue costs and discounts."
- Rolled: the same, plus "using the Dec 31, 2025 10-K, updated through June 30, 2026."
- Gap: "Face total $X. Balance sheet $Y. $Z is not accounted for," linked to detail.

The two numbers in this line never render as the same string when their values differ.

## 3. Display rules

### 3.1 Sources

Every amount, date and label links to the exact sentence, table row or heading it came from, highlighted. That includes every "not stated" line, which links to the instrument's own row.

### 3.2 Face value first

- Every amount is **face** (principal) where any permitted source states it: a table cell, the instrument's own name ("$1,500 million, 3.400% Notes due March 2027"), or a sentence.
- Where only carrying value is stated, it shows labeled "carrying value."
- The coverage footnote (2.8) does all bridging between face and the balance sheet. Face and carrying never mix inside one figure or one total.

### 3.3 Units and numbers

- All amounts in **$MM**, with thousands separators: $13,333MM, $1,450MM.
- Decimals only where the source carries them, or where conversion from thousands needs one: $188.5MM. Never rounded beyond the source.
- **(v2.1) No trailing ".0".** A decimal shows only when it is non-zero in the source-derived value: $188.5MM and $2,357.9MM, but $2,750MM, never $2,750.0MM. Every amount on every card.
- Billions in a source convert to $MM in code for display. Verification always runs against the printed form (Rules 39 and 67).
- Hedges carry through exactly: "approximately" shows "~", "less than" shows "<". A hedge governs only the figure it qualifies.
- "$0" replaces "nil" wherever a stated absence is shown.
- No Σ or other unexplained symbols.

### 3.4 Dates

- A displayed date never claims more precision than its source (Rules 76 to 78).
- **One instrument, one maturity, everywhere on the card.** It is the most precise maturity stated for that instrument in the anchor or a later filing. Every mention of the instrument (ladder, refinance window, moves) uses that one value.
- A maturity stated in a different anchor sentence than the table row (a note sentence giving the exact day) is used, linked to that sentence.
- Pre-anchor filings and prior-period annual reports supply days only where Rule 66 directs to them.

### 3.5 Instrument type, seniority, security

- **Type** is the filer's own type word: notes, debentures, term loan A, term loan B, revolver, ABL, commercial paper, letters of credit, finance lease and financing obligations, other.
- **Seniority** (senior, junior-priority, subordinated) and **security** (secured, first lien, unsecured) are separate labels.
- A label counts as stated when it appears in any of these, each linked:
  - the instrument's own name or table-row label;
  - **a table heading that names a single class and governs a contiguous block of rows** ("Senior secured first lien notes:", "Senior Secured Credit Facilities:"). A heading over mixed classes does not count;
  - a sentence in a permitted source that names the instrument or its class and states the label ("secured by a perfected first-priority security interest", "short-term, unsecured commercial paper notes", "each of these notes are senior unsecured obligations").
- Never inferred. Never borrowed from a filing Rule 66 does not permit.
- Fallback wording goes **at the end of the line**, after the instrument and date:
  - "· security not stated, please refer to sources"
  - "· seniority not stated, please refer to sources"
  - "· seniority and security not stated, please refer to sources"

### 3.6 Labels

The filer's full label, never shortened: "Finance lease and financing obligations", "Acquisition obligations and other notes payable", "Other, including finance leases", "Other notes payable".

### 3.7 Line format

One line per instrument, in this order: **face amount, coupon, labels, type, maturity**, then any flags at the end.

The shape: "$1,549MM 10⅞% senior secured notes, due 2032". The coupon leads because it is a credit signal. No repeated name after a dash. No stray spaces inside coupons ("10⅞%", "5.125%").

### 3.8 Plain language

Card copy contains no rule numbers, no engine terms ("base row", "roll", "tie", "anchor", "identity", "fingerprint"), and no internal mechanics. Mechanics move to a detail view reachable from the footnote. **(v2.1)** No cryptic parenthetical tags ("(also stated here)", "(use of proceeds)"): say it in plain words or rely on the link.

## 4. Out of scope for Demo v1, logged for after

The terms block, deferred by Akshay on Oct 6, 2026:

- Covenants: thresholds, step schedules, amendments, compliance (Molina's February 2026 covenant relief, Cigna's leverage covenant).
- Springing maturities and springing covenants (DaVita's TLA-2 and revolver, which come due March 2, 2030 if the 4.625% notes remain outstanding; CHS's springing FCCR).
- Rates and hedging: floating exposure, caps, swaps, weighted rates.
- Facility options: extension options.

Also deferred:

- Days from pre-anchor filings where Rule 66 does not direct.
- Tranche tagging for headline slot 4.
- Leverage (needs EBITDA).
- UHS, HCA, Quest, Centene.

## 5. Acceptance

Every check below is asserted as a test over all six cards. Inspection alone does not count.

1. **Renders at $0**, verified by preflight and assertFree.
2. **Every figure, date and label links to a source containing it.**
3. **Table reconciliation.** Every row of the filer's debt table (for a rolled position, the referenced table plus stated changes) appears on the card exactly once, at face, with its filer label. The card's face total equals the sum of those rows.
4. **No false "not stated."** For every "not stated" label, the test confirms no permitted source (row label, governing heading, permitted sentence) states it. If one does, the test fails.
5. **One maturity per instrument.** No instrument shows two different maturity values anywhere on its card.
6. **No precision loss.** No two instruments with different face amounts render the same amount string, and no amount is rounded beyond its source.
7. **Schedule reconciliation.** Where the filer prints a maturity schedule, per-year amounts reconcile to it, with any remainder shown as "other scheduled principal."
8. **Moves are complete.** Every debt transaction stated in the anchor for the period, and in later filings through the brief date, appears in 2.3 with funding and use of proceeds where stated.
9. **Plain-language lint.** No card contains rule numbers or the engine terms in 3.8.
10. **Hedges and labels.** Every hedge in a source survives to the card, and every label is the filer's full label.
11. All six signed goldens still reproduce through goldenThroughLoop.
14. **(v2.2) Summary scope:** the refinance summary's redemption figure equals the stated redemptions of the box's own in-window rows, with a negative control.
13. **(v2.1) Round-2 rules**, each asserted over all six cards with a negative control: the refinance box (placement, summary, named rows only, leftovers in one line, markers with a legend, CP row, Next line); no pre-period or mechanics lines; total-debt grouping by label, one line per type, priority order; moves in card format and related moves merged; no trailing ".0"; "not stated" once per group; no cryptic tags.
12. Akshay's read against the demo's three questions per company.
