# Session 26, part 4: card redesign (v3.0)

Akshay approved a redesigned card layout on three mockups: Tenet (debt due, partly refinanced), Molina (nothing due in the window) and Cigna (rolled position, long ladder). Screenshots are saved in sessions/26/mockups/. This prompt applies that design to all six cards.

The content rules from card_spec v2.2 all stay. This is a presentation change: layout, hierarchy, charts, tables and wording. It adds no new data.

## Standing constraints

- **$0.** Cards build only from the committed snapshots. No extraction, no model calls. Run preflight and assertFree. If any element below needs data the snapshots lack, stop and report it rather than extracting.
- **Rules over the class.** Every rule applies to all six cards. Company names below show shape only.
- **Spec first.** Rewrite docs/card_spec.md as v3.0 from this prompt before building: §2 (layout) and §3 (display rules) restated, every v2.2 content rule kept. Commit it before any code.
- **Tests first.** Each new rule gets an acceptance assertion over all six cards, with a negative control that must fail. Report failure counts before and after. §5.1 to §5.14 stay green, except DaVita's two ruled residuals. goldenThroughLoop stays 20/20 at $0.
- **Every figure still links to the sentence it came from**, including every figure inside a chart, tile, bar label and table cell.
- **Plain-language lint applies to every new string.**
- The terms block (covenants, springing maturities, rates and hedging) stays out of scope.

## 1. Layout, top to bottom

1. **Header:** "Weekly coverage brief · [week]" label, company name large, and on the right: position date, the anchor filing linked, and a one-phrase this-week status ("No new debt filings this week", or "N filings this week, none affecting debt"). Actionable filings this week, when present, render as a short list directly under the header.
2. **Rolled-position note** (only where the position is rolled from an earlier filing): one plain sentence in a light box under the header, naming the earlier filing, with a "10-K" tag explained. Each row from that filing carries the tag. The explanation never repeats per row.
3. **The call box** (tinted, bordered, full width).
4. **Recent debt moves.**
5. **Total debt and Liquidity**, side by side.
6. **Maturity ladder:** chart, then table.
7. **Facilities** and **Not shown, and why**, side by side, smaller.
8. **Footnote:** the coverage line, smallest, on a light ground.

## 2. The call box

**Label:** "The call · next 18 months, to [window end]".

**Headline:** one sentence from a deterministic template, chosen by rule, with every figure linked:

| Case | Rule | Template |
|---|---|---|
| A | Named instruments mature in the window and at least one is not refinanced | "$X of [instrument] [is/are] not yet refinanced." Add "[The other instrument] [is/are] already refinanced." when some are. |
| B | Every named instrument in the window is refinanced | "Everything due in the next 18 months is refinanced." |
| C | Only scheduled amortization or other principal falls in the window | "No notes or loans mature in the next 18 months. $X of scheduled amortization." |
| D | Nothing falls in the window | "Nothing matures in the next 18 months." |

When commercial paper is outstanding, add one sentence: "About $X of commercial paper is also outstanding[, backed by the $Y revolver]" (backing only where stated).

**Tiles:**
- **Cases A and B:** three tiles. "Due in window" (total face, with a count of issues), "Refinanced" (face of in-window instruments with a stated debt-funded payoff), and "Not yet refinanced" (the difference). The third tile is orange and appears only when its value is above zero. "Refinanced" shows "$0 · none stated in any filing" when nothing qualifies. All three count only instruments inside the window (§5.14). **Commercial paper is never counted in the tiles**, since it rolls continuously.
- **Cases C and D:** one large "Next maturity" tile instead: face, coupon, labels, type, the exact date as stated, and "[N] months away". Months are counted from the brief date, and never shown when only a year is stated.

**Rows under the tiles:** one row per named in-window instrument (date, face, coupon, labels, type), plus a status tag on the right. Commercial paper, where outstanding, is the first row ("Short-term"). Scheduled amortization collapses to one line under the rows. Then the "Next after the window" line, then the † legend if used.

## 3. Status and move vocabulary

Status tags and move labels use only these words, each decided by what the filings state:

| Word | When | Example of the shape |
|---|---|---|
| **Refinanced** | Retired, or set to be retired, with the stated proceeds of new debt | Tenet's 2027 notes; Encompass's May 2026 redemption |
| **Repaid** | Paid at maturity, or with cash, or the funding is not stated | Cigna's March 2026 notes, "funding source not stated" |
| **Repurchased** | Bought back or tendered, with the stated cash source named | CHS, "with ~$600MM of divestiture proceeds" |
| **Redeemed** | Called before maturity; price where stated | CHS special call "at 103% of principal" |
| **Amended** | A credit agreement was amended | Molina, "terms of the amendment are not covered in this version" |
| **Not yet refinanced** | In the window, with no stated payoff | Orange tag |

Rules:
- **Confirmation travels with the word.** A payoff announced but not confirmed by a filing reads "Refinanced · redemption set for [date], awaiting confirmation in a filing". Once confirmed, it reads "Refinanced · redeemed [month year]". The word "redeemed" never appears unconfirmed.
- **Partial retirements show what remains:** "$500MM refinanced · $1,250MM remains", "$454MM retired in 2026 · $1,549MM remains".
- **New debt shows its own confirmation:** "Issued, confirmed by 8-K".
- An amended agreement with no other detail on the card says plainly that its terms aren't covered.

## 4. Recent debt moves

Each move is a small card: date and move word on a grey line, face and instrument in bold, funding or use as one short line. A move that funds others renders as a pair: the new debt on the left, an arrow, and what it retires on the right, with each retired instrument and its face. Related moves merge per §2.3 (v2.1 B12).

## 5. Total debt and Liquidity

Each is one large figure, then a single stacked bar, then a legend list with amounts.
- **Total debt:** segments follow the v2.1 grouping and priority-order rules (secured, junior or second-lien secured, unsecured, not stated, other), colored per §6. Carrying-value amounts sit in a note line under the list, never in the bar.
- **Liquidity:** cash and undrawn committed capacity, two greens. Uncommitted capacity, and any CP backed by a facility, go in a note line, never in the bar or the total.

## 6. Colors and chart encoding (one set for all six cards)

- **Seniority shades:** senior secured `#1F4E79`, junior or second-lien secured `#2E8B8B`, unsecured `#5C8DBF`, **seniority or security not stated `#9AA3AD` (plain grey)**, scheduled other principal `#C9CED4`.
- **Status overlays:** refinanced but not yet confirmed, diagonal stripes over the instrument's seniority shade; not yet refinanced inside the window, solid orange `#B4440C`.
- **Liquidity:** cash `#2E7D6B`, undrawn capacity `#9CCBBE`.
- Colors that must be told apart also differ in lightness. Text contrast meets 4.5:1.
- **Every chart has a legend entry for every color and pattern it shows, and nothing else**, plus a one-line caption explaining the encoding in words.

## 7. Maturity ladder chart

- **One bar per year, face, $MM.** The value label sits above each bar, and the year below it.
- **The 18-month window is a shaded band** with a dashed edge at the window end, labelled "18-month window" ("· nothing due" in case D).
- **Commercial paper outstanding** gets its own leftmost bar, labelled "CP".
- **Amortizing debt:** where the filer prints a maturity schedule, each bar's total equals the schedule's figure for that year. Bonds (single repayment at maturity) sit at full face in their year, and term loans, leases and other amortizing debt fill the remainder of the bar. Where no schedule exists, bars show named instruments only.
- **Long ladders:** when more than 10 year-columns would show, the years after the tenth collapse into one range bar ("2037–56"). A bar more than twice the next-tallest is cut with a visible break mark, and the caption states its true size.
- **Instruments with no single maturity** (ranges, leases with no date) stay out of the chart, named in the caption.
- **Where most bars are grey,** one caption line says why ("[Company]'s filings state seniority for few of these notes").

## 8. Maturity ladder table

- **Columns:** Matures, Instrument (coupon, labels, type, source tag), Face ($MM, right-aligned, tabular figures), Status.
- One row per instrument, zebra-striped, ordered by maturity. Commercial paper is first where outstanding. Ranged and undated items sit last, with their range or "Various".
- **More than 10 rows:** show the first 8, then a "Show all N" link. Every in-window row must be within those first rows.
- **The status column uses only the §3 vocabulary.** A not-stated label shows once in the status column ("Seniority not stated"), not as a sentence.

## 9. Facilities and footnote

- **Facilities:** one bold line per facility (size · drawn · LCs · maturity), then a grey line for sub-facilities and capacity notes. Commercial paper programs get their own line (size · outstanding · average rate).
- **Footnote:** the v2.2 coverage wording, followed by "Every figure links to the sentence it came from."

## Verify and stop

- New acceptance assertions green on all six, each with a failing negative control. At minimum:
  - the call-box case (A to D) matches its rule on each card;
  - the tiles sum (due = refinanced + not yet refinanced, in-window only);
  - every status word comes from the §3 list, and "redeemed" appears only with a confirming filing;
  - every chart color and pattern has a legend entry;
  - each bar's total equals its source (the schedule, or named instruments);
  - the table shows every in-window row before any "Show all" cut.
- §5.1 to §5.14 unchanged apart from DaVita's residuals. goldenThroughLoop 20/20 at $0. Zero console errors.
- Fresh screenshots of all six to sessions/26/screenshots_v4/. Put Tenet, Molina and Cigna side by side with the mockups in sessions/26/mockups/, and report any difference in structure.
- Card_spec v3.0 committed.

**Stop and report.** Do not push until Akshay clears the six cards.
