# Coverage Signal card spec, Demo v1

Version 3.0, Oct 19, 2026. The card redesign Akshay approved on three mockups (Tenet: debt due, partly refinanced; Molina: nothing due in the window; Cigna: rolled position, long ladder; saved in sessions/26/mockups/). A presentation change: layout, hierarchy, charts, tables and wording. Every v2.2 content rule is kept and restated below; it adds no new data. Supersedes v2.2.

Known difference from the mockups: the card shows each company's registered EDGAR name ("TENET HEALTHCARE CORP"), not a display name ("Tenet Healthcare"). Display names come with the name-lookup work in Session 27 (Akshay, Oct 19, 2026).

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

One order on every card:

1. **Header** (2.1).
2. **Rolled-position note**, only where the position is rolled from an earlier filing (2.1).
3. **The call box**: tinted, bordered, full width (2.2).
4. **Recent debt moves** (2.3).
5. **Total debt** and **Liquidity**, side by side (2.4).
6. **Maturity ladder**: chart, then table (2.5, 2.6).
7. **Facilities** and **Not shown, and why**, side by side, smaller (2.7, 2.8).
8. **Footnote**: the coverage line, smallest, on a light ground (2.9).

### 2.1 Header and rolled-position note

- A label "Weekly coverage brief · [brief week as a date range]", then the company name, large. "Last week" means since the previous logged brief for that name, or the trailing seven days for a first brief.
- On the right: "Position as of [period end]", the filing the position comes from (form and filing date, linked), and a one-phrase this-week status: "No new debt filings this week", or "N filing(s) this week, none affecting debt".
- **Actionable filings this week**, where present, render as a short list directly under the header. A filing is actionable when its form or 8-K item number signals a debt, liquidity or maturity change (a new 10-Q or 10-K; 8-K Items 1.01, 1.02, 2.03, 2.04; 2.01 where debt-financed), or when already-read text states such a change. Each line gives what happened, the date, the face amount, the instrument with its labels, why it matters, and a link. Everything else is counted in the status phrase, grouped by form, each filing one click deeper.
- **Rolled-position note** (Rule 66 cases): one plain sentence in a light box under the header, naming the earlier filing (linked): "This company's 10-Q does not list its notes. This list comes from the Dec 31, 2025 10-K, updated for changes through June 30, 2026. Rows from the 10-K carry a 10-K tag." Each row from that filing carries the tag; the explanation never repeats per row.

### 2.2 The call box

**Label:** "The call · next 18 months, to [window end]". The window is the next 18 months from the brief date.

**Headline:** one sentence from a deterministic template over stated facts, never model text, chosen by rule, every figure linked:

| Case | Rule | Template |
|---|---|---|
| A | Named instruments mature in the window and at least one is not refinanced | "$X of [instrument] [is/are] not yet refinanced." Add "[The other instrument] [is/are] already refinanced." when some are. |
| B | Every named instrument in the window is refinanced | "Everything due in the next 18 months is refinanced." |
| C | Only scheduled amortization or other principal falls in the window | "No notes or loans mature in the next 18 months. $X of scheduled amortization." |
| D | Nothing falls in the window | "Nothing matures in the next 18 months." |

When commercial paper is outstanding, one more sentence: "About $X of commercial paper is also outstanding[, backed by the $Y revolver]" (backing only where the filer states it).

**Named instruments** are notes, debentures, term-loan final maturities, facility maturities and commercial paper outstanding. Scheduled amortization, other scheduled principal, ranged items (leases, other notes) and partly overlapping year buckets are not named instruments.

**Tiles:**

- **Cases A and B:** three tiles. "Due in window": total face of the named in-window instruments, with a count of issues. "Refinanced": face of in-window instruments with a stated payoff funded by new debt; "$0 · none stated in any filing" when nothing qualifies. "Not yet refinanced": the difference, orange, shown only when above zero. **All three count only instruments inside the window** (the v2.2 scope rule: a payoff of an instrument outside the window is never added in). **Commercial paper is never counted in the tiles.**
- **Cases C and D:** one large "Next maturity" tile instead: face, coupon, labels, type, the exact date as stated, and "[N] months away", counted from the brief date in whole months, never shown when only a year is stated.

**Rows under the tiles:** one row per named in-window instrument (date, face, coupon, labels, type, source tag), with a status tag on the right (2.10). Commercial paper outstanding, where present, is the first row ("Short-term"), with its stated descriptors (rate, backing). Scheduled amortization and other principal in the window collapse to one line under the rows, from the filer's own schedule where printed. Then the "Next after the window" line, with any stated payoff of it. Then the † legend, if a † is used.

**Markers:** a maturity stated only to a year or month that overlaps the window, or a schedule year only partly inside it, carries a "†" with one legend line: "† Year only stated; may fall inside the window." No "not stated" fallback appears in the box.

### 2.3 Recent debt moves

Every debt transaction the filings state from the start of the anchor's fiscal year through the brief date, newest first. A move stated only in a later filing is "since the position date" and never changes the position totals; a move in the anchor is already in the position.

Covered: issuance; redemption, full or partial, including special calls; tender or repurchase; repayment at maturity; facility entry, amendment, refinancing or termination; incremental add-ons; material draws or paydowns where stated.

**Each move is a small card:** date and move word (2.10) on a grey line; face and instrument in bold, in 3.7 format; funding or use as one short line ("with ~$600MM of divestiture proceeds", "at 103% of principal", "funding source not stated"). No raw filer prose, no defined terms ("the '2027 Notes'"), no legal agreement titles; the full source sentence is one click away through the link.

- **A move that funds others renders as a pair:** the new debt on the left, an arrow, and what it retires on the right, each retired instrument with its face. Both sides link to their sentences.
- **Related moves merge into one event:** the same date, or a stated causal link (a new agreement entered, an old one terminated, a draw used to retire it). "Refinanced revolver: new $1,000MM credit agreement replaced the 2022 agreement; $250MM drawn to retire it." Each component figure keeps its own link.
- A transaction completed before the period start never appears. A facility borrowed and repaid inside the period appears as two moves, never as an "intention."
- An amended agreement with no other detail on the card says plainly that its terms are not covered in this version.

### 2.4 Total debt and Liquidity

Each is one large figure, then a single stacked bar, then a legend list with amounts. No headline amount appears without its instrument type.

**Total debt**, at face, as of the position date.

- **Grouping by label.** A type splits by seniority or security only when every row of that type carries the label; otherwise its rows group by type alone, and the labels stay per row in the ladder. A type never appears as two lines because some rows got a label from a different source. Never two lines with the same label.
- **Order by priority:** secured, then junior or second-lien secured, then unsecured, then types without a stated label, then leases and other obligations. Within a tier, the filer's table order.
- Bar segments follow the same groups, colored per 3.9. **Carrying-value amounts sit in a note line under the list, never in the bar.** Where the face total comes from the filer's maturity schedule because some rows are stated only at carrying value, the part of the face total no row states at face is one segment, "face stated only in the filer's schedule".

**Liquidity**, as of the position date.

- Cash, labeled exactly as the filer states it. Where the filer also states a parent-company or unrestricted figure, it shows beside the consolidated one, linked, never added.
- Undrawn committed capacity, per facility, with stated availability (BRD 8.12: never computed as size minus drawn). Where availability is not stated, size, drawn and letters of credit show, and "availability not stated".
- The bar holds cash and undrawn committed capacity, two greens. **Uncommitted capacity** (accordions, incremental options) and **commercial paper a facility backs** go in a note line, never in the bar or the total. A commercial paper program is never liquidity.

### 2.5 Maturity ladder chart

- **One bar per year, at face, $MM.** The value label sits above each bar and the year below it; every value label links to its parts.
- **The 18-month window is a shaded band** with a dashed edge at the window end, labelled "18-month window" ("· nothing due" in case D).
- **Commercial paper outstanding** gets its own leftmost bar, labelled "CP".
- **Amortizing debt.** Where the anchor prints a maturity schedule, each bar's total equals the schedule's figure for that year. Bonds (a single repayment at maturity) sit at full face in their year, and term loans, leases and other amortizing debt fill the remainder of the bar as scheduled other principal. Where no schedule exists, bars show named instruments only. A bond stated only at carrying value is not drawn at a face it does not have: its year's bar is the schedule's figure, and the caption says so.
- **Status overlays** (3.9): debt refinanced but not yet confirmed by a filing is striped over its seniority shade; debt due inside the window and not yet refinanced is solid orange.
- **Long ladders:** when more than 10 year-columns would show, years with nothing due are left out first; then the years after the ninth collapse into one range bar ("2037–56"). A bar more than twice the next-tallest is cut with a visible break mark, and the caption states its true size.
- **Instruments with no single maturity** (ranges, leases with no date) stay out of the chart and are named in the caption.
- **Where most bars are grey**, one caption line says why ("[Company]'s filings state seniority for few of these notes").
- Instruments repaid inside the period never appear as $0 bars or rows (Rule 64). Undrawn facilities are capacity, never debt.

### 2.6 Maturity ladder table

- **Columns:** Matures, Instrument (coupon, labels, type, source tag), Face ($MM, right-aligned, tabular figures), Status.
- One row per instrument, zebra-striped, ordered by maturity. Commercial paper first where outstanding. Ranged and undated items last, with their range or "Various". Each instrument appears exactly once (Rule 49), at face where stated, labeled "carrying value" where only carrying value is stated.
- Maturity ranges are stated maturities: "2026 to 2038" shows as a range, never as "no maturity stated."
- **More than 10 rows:** the first 8 show, then a "Show all N" control. Every in-window row is within the rows shown.
- **The status column uses only the 2.10 vocabulary.** A not-stated label shows in the status column as a short phrase ("Seniority not stated"), not as a sentence; where it applies to most rows, it shows once in the chart caption instead (the v2.1 "once per group" rule).
- **Pre-period lines never appear:** for a rolled position, an instrument the referenced filing states at $0, or as repaid before its period end, never appears, and neither does any line listing them. Mechanics (how two filings' statements of one note were reconciled) are not card copy.
- The filer's maturity schedule, where printed, stays reachable by year ("Show scheduled amortization by year"), with any remainder as "other scheduled principal, per the filer's schedule", linked; a year a schedule shows that lines exceed is stated as such, never silently dropped.

### 2.7 Facilities

- One bold line per facility: type and name, then size · drawn · letters of credit · maturity, with seniority and security labels where stated. Then a grey line for sub-facilities, sub-limits and capacity notes.
- **Stated sub-facilities and sub-limits are capacity** (Rule 48), never drawn amounts.
- **Letter-of-credit-only facilities** show letters of credit outstanding and, if stated, size; no drawn line, and at most one "facility size not stated".
- **Commercial paper programs** get their own line: size · outstanding · average rate, and any backing facility. Never facility fields (drawn, LCs, available).
- Borrowing-base facilities carry the flag, linked to the filer's full sentence.
- A fact stated only in a 10-K note the anchor directs to is labelled "as of [date], per 10-K [note]".

### 2.8 Not shown, and why

Every withheld figure with its reason. Each reason matches the item's actual stated status; a reason that contradicts the filing is a defect. "Nothing withheld this week" when empty.

### 2.9 Footnote

The coverage line, then "Every figure links to the sentence it came from."

- Ties: "Face total $13,333MM. Balance sheet $13,248MM, after $85MM of unamortized issue costs and note discounts."
- Rolled: the same, plus "Using the Dec 31, 2025 10-K, updated through June 30, 2026."
- Stated basis: where the filer states its table is net of issuance costs, discounts or premiums, or prints face and net side by side, the footnote says so, linked, and cites any carrying-basis check that holds.
- Gap: "$Z is not accounted for" only where no filer statement explains the difference.
- The two numbers never render as the same string when their values differ.

### 2.10 Status and move vocabulary

Status tags and move labels use only these words, each decided by what the filings state:

| Word | When |
|---|---|
| **Refinanced** | Retired, or set to be retired, with the stated proceeds of new debt |
| **Repaid** | Paid at maturity, or with cash, or the funding is not stated |
| **Repurchased** | Bought back or tendered, with the stated cash source named |
| **Redeemed** | Called before maturity; price where stated |
| **Amended** | A credit agreement was amended |
| **Issued** | New debt, with its own confirmation ("Issued, confirmed by 8-K") |
| **Not yet refinanced** | In the window, with no stated payoff (orange) |

Also: "Short-term" for commercial paper outstanding, "Backed by revolver" where stated, and the not-stated phrases of 3.5.

- **Confirmation travels with the word.** A payoff announced but not confirmed by a filing reads "Refinanced · redemption set for [date], awaiting confirmation in a filing" (in a tag: "Refinanced · redemption set for [date]"). Once confirmed: "Refinanced · redeemed [month year]". The word "redeemed" never appears unconfirmed.
- **Partial retirements show what remains:** "$500MM refinanced · $1,250MM remains"; "$454MM retired in 2026 · $1,549MM remains".

## 3. Display rules

### 3.1 Sources

Every amount, date and label links to the exact sentence, table row or heading it came from, highlighted. **That includes every figure inside a chart, tile, bar label and table cell**, and every "not stated" phrase, which links to the instrument's own row.

### 3.2 Face value first

- Every amount is **face** (principal) where any permitted source states it: a table cell, the instrument's own name ("$1,500 million, 3.400% Notes due March 2027"), a sentence, or a remaining face computed from a retirement sentence that states both the prior principal and the amount retired.
- Where only carrying value is stated, it shows labeled "carrying value". Face and carrying never mix inside one chart segment, bar or total; the footnote (2.9) does all bridging.

### 3.3 Units and numbers

- All amounts in **$MM**, with thousands separators: $13,333MM, $1,450MM. Table cells show the number alone under a "Face" ($MM) header.
- Decimals only where the source carries them, or where conversion from thousands needs one: $188.5MM. Never rounded beyond the source. **No trailing ".0"**: $2,750MM, never $2,750.0MM.
- Billions in a source convert to $MM in code for display. Verification always runs against the printed form (Rules 39 and 67).
- Hedges carry through exactly: "approximately" shows "~" (or "About" in a sentence), "less than" shows "<". A hedge governs only the figure it qualifies.
- "$0" replaces "nil" wherever a stated absence is shown.
- No Σ or other unexplained symbols; the "†" marker and the "10-K" tag are each explained once.

### 3.4 Dates

- A displayed date never claims more precision than its source (Rules 76 to 78).
- **One instrument, one maturity, everywhere on the card**: the most precise maturity stated for it in the anchor or a later filing, linked to that sentence. Every mention (call box, moves, chart, table) uses that one value.
- Pre-anchor filings and prior-period annual reports supply days only where Rule 66 directs to them.
- "[N] months away" is whole calendar months from the brief date, and only for a maturity stated to the month or day.

### 3.5 Instrument type, seniority, security

- **Type** is the filer's own type word: notes, debentures, term loan A, term loan B, revolver, ABL, commercial paper, letters of credit, finance lease and financing obligations, other.
- **Seniority** (senior, junior-priority, subordinated) and **security** (secured, first lien, unsecured) are separate labels.
- A label counts as stated when it appears in any of these, each linked: the instrument's own name or table-row label; **a printed table heading that names a single class and governs a contiguous block of rows**; a sentence in a permitted source that names the instrument or its class and states the label.
- Never inferred. Never borrowed from a filing Rule 66 does not permit.
- Where a label is not stated: "Seniority not stated", "Security not stated", or "Seniority and security not stated", in the status column or a caption, linked.

### 3.6 Labels

The filer's full label, never shortened: "Finance lease and financing obligations", "Acquisition obligations and other notes payable", "Other, including finance leases", "Other notes payable".

### 3.7 Line format

An instrument reads, in this order: **face amount, coupon, labels, type, maturity**, then any flags. "$1,549MM 10⅞% senior secured notes, due 2032". The coupon leads because it is a credit signal. No stray spaces inside coupons ("10⅞%", "5.125%"). In the table the same order runs across the columns.

### 3.8 Plain language

Card copy contains no rule numbers, no engine terms ("base row", "roll", "tie", "anchor", "identity", "fingerprint"), and no internal mechanics. No cryptic parenthetical tags; say it in plain words or rely on the link.

### 3.9 Colors and chart encoding (one set for all six cards)

- **Seniority shades:** senior secured `#1F4E79`; junior or second-lien secured `#2E8B8B`; unsecured `#5C8DBF`; seniority or security not stated `#9AA3AD` (plain grey); scheduled other principal `#C9CED4`.
- **Status overlays:** refinanced but not yet confirmed, diagonal stripes over the instrument's seniority shade; not yet refinanced inside the window, solid orange `#B4440C`.
- **Liquidity:** cash `#2E7D6B`; undrawn committed capacity `#9CCBBE`.
- Colors that must be told apart also differ in lightness. Text contrast meets 4.5:1.
- **Every chart has a legend entry for every color and pattern it shows, and nothing else**, plus a one-line caption explaining the encoding in words.

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
15. **(v3.0) The redesign**, each asserted over all six cards with a negative control: the layout order; the call-box case (A to D) matches its rule; the tiles sum (due = refinanced + not yet refinanced), in-window only, with commercial paper never counted; the next-maturity tile's months; every status word from the 2.10 list, and "redeemed" only with a confirming filing; every chart color and pattern has a legend entry and nothing else; each bar's total equals its source (the schedule, or named instruments); the total-debt and liquidity bars sum to their figures with carrying and uncommitted amounts kept out; the table carries every filer row once and shows every in-window row before any "Show all" cut; every figure in a tile, chart, bar label and table cell links to its sentence.
12. Akshay's read against the demo's three questions per company.
