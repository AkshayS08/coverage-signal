# Session 26, part 3: card review round 2

Akshay reviewed the six v2.0 cards. This prompt covers his round-2 findings: one redesign (the refinance box), five material fixes, and four cross-card consistency fixes. All of it is display work over the committed card input snapshots.

## Standing constraints

- **$0.** No extraction, no model calls. Cards build from the committed snapshots. Run preflight and assertFree. If any item turns out to need data the snapshots lack, stop and report it rather than extracting.
- **Rules over the class.** Every fix is a rule applied to all six cards. Company names below show shape only.
- **Spec first.** Update docs/card_spec.md to v2.1 with each rule below before implementing it, citing the section changed.
- **Tests first.** For each rule, add an assertion to the acceptance suite that runs over all six cards, with a negative control that must fail. Report the failure counts before and after.
- **Keep everything already passing.** §5.1 to §5.10 stay green (DaVita's two ruled residuals stay as they are). goldenThroughLoop stays 20/20 at $0. The plain-language lint applies to every new string.
- **The terms block stays out of scope.**
- Commit per rule where hunks allow; otherwise list each rule in the commit message.

## A. Refinance box redesign (spec §2.4)

The refinance section is the card's call to action, and today it is a wall of mixed lines. New rules:

1. **Placement and emphasis.** The box sits directly after "This week," above Recent debt moves and the headlines, in a visually distinct container (border or tinted background, consistent across all six cards).
2. **Summary line first.** One sentence, assembled by a deterministic template from stated facts only, with no model text. It gives:
   - the total face of named instruments maturing inside the window, and how many instruments;
   - the amount already subject to a stated pending or completed redemption, and what funds it, where stated.

   The shape: "$2,100MM across 2 notes in the next 18 months; $2,000MM already being redeemed with the $2,000MM 6.250% notes issued Sept 22, 2026." When nothing matures in the window: "Nothing matures within 18 months." Every figure in the sentence links to its source.
3. **Named instruments only.** Box rows are notes, debentures, term-loan final maturities, facility maturities, and commercial paper outstanding. One line each, in §3.7 format, plus a status where stated: "pending redemption $X, not yet confirmed by a filing", "$X of $Y redeemed [month year]".
4. **Leftovers collapse to one line.** Scheduled amortization, "other scheduled principal," ranged items (leases, other notes) and partly-overlapping year buckets do not get their own box rows. They sum to one line: "Plus $XMM of scheduled amortization and other principal, per the filer's schedule (see maturity ladder)." The sum carries a flag marker if any component only may fall inside the window. The detail stays in the ladder, unchanged.
5. **Flags as markers.** In the box, "year only stated" and "may fall within 18 months" become a short marker (for example "†") with one legend line under the box. "Not stated" fallbacks do not appear in the box; they stay in the ladder.
6. **Commercial paper.** Where CP is outstanding, it is a box row: "~$1,000MM unsecured commercial paper outstanding, short-term, rolled continuously, backed by the $6,500MM revolver" (backing shown only where stated).
7. **Next line** stays, after the rows: "Next, after [window end]: …"

## B. Material fixes

8. **Pre-period lines removed** (spec §2.3, §2.5). For a rolled position, instruments the referenced filing states at $0 or as repaid before the referenced period end never appear on the card, including any summary line listing them ("6 lines the 10-K states at $0…"). Mechanics sentences ("N notes are stated in both…, each shown once…") are removed from card copy and may move to the detail view.
9. **Total-debt grouping by label** (spec §2.4). A total-debt breakdown splits a type by seniority or security only when every row of that type carries the label. Otherwise rows group by type alone ("Notes $29,736MM"), and labels stay per row in the ladder. A type never appears as two lines because some rows got a label from a different source.
10. **One line per type in the total.** A type with rows on different bases (face and carrying) shows as one line, with the basis noted inside it: "Senior notes $2,073.5MM (of which $1,673.5MM at carrying value)". Never two lines with the same type word.
11. **Moves use card format, not filing prose** (spec §2.3). Each move line follows §3.7: date, type, face in $MM, coupon, labels, instrument, then funding, use and price as short clauses ("funded by ~$600MM of divestiture proceeds", "at 103% of principal"). No raw filer prose in the line, no defined terms ("the '2027 Notes'"), no legal agreement titles. The full source sentence stays one click away through the link.
12. **Related moves merge into one event.** Moves stated as parts of one transaction (same date or a stated causal link: a new agreement entered, an old one terminated, a draw used to retire it) render as one line describing the event. The shape: "Refinanced revolver: new $1,000MM credit agreement replaced the 2022 agreement; $250MM drawn to retire it." Each component figure keeps its own link.

## C. Consistency across cards

13. **Decimals.** No trailing ".0". A decimal shows only when it is non-zero in the source-derived value ($188.5MM, $2,357.9MM). Applies to every amount on every card.
14. **Total-debt order.** Every card orders its total-debt breakdown by priority: secured first, then unsecured, then types without a stated label, then leases and other obligations. Within a tier, filer table order. This replaces the size and mixed orders currently showing.
15. **"Not stated" once per group.** When the same fallback applies to every row in a ladder group (a year, or a "from the 10-K" section), it shows once at the group's top, not on each row. When only some rows lack the label, it stays per row.
16. **No cryptic tags.** Remove "(also stated here)" and "(use of proceeds)". Where they conveyed something real, say it in plain words or rely on the link.

## Verify and stop

- All new assertions green on all six cards, each with a failing negative control.
- §5.1 to §5.10 unchanged except DaVita's ruled residuals. goldenThroughLoop 20/20 at $0.
- Fresh screenshots of all six to sessions/26/screenshots_v3/, zero console errors.
- Per card, a short list of what changed against v2.
- card_spec.md at v2.1, committed.

**Stop and report.** Do not push until Akshay clears the six cards.
